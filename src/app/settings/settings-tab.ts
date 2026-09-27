import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type { SettingDefinitionItem, SettingGroupItem } from 'obsidian'
import { produce } from 'immer'
import type { Draft } from 'immer'
import { RESERVED_QUALIFIER_NAMES } from '../domain/filter-query'
import { VIEW_MODES, VIEW_MODE_LABELS, modeEnabled } from '../domain/embed-params'
import type { ViewMode } from '../domain/embed-params'
import { DEFAULT_CONTEXTS_PROPERTY } from '../constants'
import type KanbanActionPlannerPlugin from '../../main'
import { DEFAULT_SETTINGS } from '../types/plugin-settings.intf'
import type { PluginSettings, SettingsRefreshScope } from '../types/plugin-settings.intf'
import { configurableStatusValues } from '../domain/status'
import { formatDays, formatMinutes as minutesLabel, parseTimeBlock } from '../domain/time-blocks'
import { parseAvailableHours } from '../domain/week-targets'
import type { NoteType } from '../domain/note-type'
import {
    findStatusProperty,
    getNoteTypeStatus,
    listNoteTypes
} from '../services/starter-kit.service'
import {
    DEFAULT_NOTE_TYPE_ID,
    createLocalNoteType,
    deleteNoteType,
    findNoteType,
    getOrCreateNoteType
} from '../services/note-type.service'
import { ConfigureBoardModal } from '../ui/configure-board-modal'
import { ConfirmModal } from '../ui/confirm-modal'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../assets/buy-me-a-coffee'
import { renderSupportSection } from '../ui/support-links'
import { log } from '../../utils/log'

/** A note type known to the plugin (Starter Kit or a stored local note type). */
interface NoteTypeRow {
    id: string
    name: string
    source: NoteType['source']
    statusValues: string[]
}

// Keys whose value is a *plain* string (accepts any string) — excludes literal
// unions like `cardChipStyle`, which have their own dedicated updater.
type StringSettingKey = {
    [K in keyof PluginSettings]: string extends PluginSettings[K] ? K : never
}[keyof PluginSettings]

/** Settings keys holding a plain number (pomodoro durations and cadence). */
type NumberSettingKey = {
    [K in keyof PluginSettings]: number extends PluginSettings[K] ? K : never
}[keyof PluginSettings]

/** A property-name setting: a cleared field falls back to `fallback`. */
interface TextSetting {
    key: StringSettingKey
    name: string
    desc: string
    fallback: string
    scope?: SettingsRefreshScope
}

/** A whole-number setting between `min` and `max` (inclusive). */
interface NumberSetting {
    key: NumberSettingKey
    name: string
    desc: string
    placeholder: string
    min: number
    max?: number
    scope: SettingsRefreshScope
}

/** Day tokens (`mon-fri`, `tue,thu`) → Monday-first indexes, via the block grammar; null when invalid. */
function parseDayTokens(value: string): number[] | null {
    const trimmed = value.trim()
    if (trimmed === '') return []
    const result = parseTimeBlock(`${trimmed} 00:00-01:00`)
    return result.ok ? result.block.days : null
}

/**
 * An `HH:MM-HH:MM` range in minutes, `[0, 0]` for an empty field (no range),
 * or null when the text is not a valid range within one day.
 */
function parseMinuteRange(value: string): [number, number] | null {
    const trimmed = value.trim()
    if (trimmed === '') return [0, 0]
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(trimmed)
    if (!m) return null
    const start = Number(m[1]) * 60 + Number(m[2])
    const end = Number(m[3]) * 60 + Number(m[4])
    return start >= 0 && end <= 1440 && end > start ? [start, end] : null
}

/** A stored minute range as `HH:MM-HH:MM`, or '' when there is none. */
function formatMinuteRange(start: number, end: number): string {
    return end > start ? `${minutesLabel(start)}-${minutesLabel(end)}` : ''
}

/** Full weekday names indexed by `Date.getDay()` (0 = Sunday). */
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const WEEKDAY_OPTIONS: Record<string, string> = Object.fromEntries(
    WEEKDAY_NAMES.map((name, day) => [String(day), name])
)

const CHIP_STYLE_OPTIONS: Record<PluginSettings['cardChipStyle'], string> = {
    minimal: 'Minimal (no fills)',
    tinted: 'Tinted (color-filled)',
    rail: 'Rail (colored edge)'
}

const COUNTDOWN_STYLE_OPTIONS: Record<PluginSettings['dueCountdownStyle'], string> = {
    title: 'Title row (right-aligned)',
    chip: 'Field chip',
    corner: 'Top-right corner',
    footer: 'Footer row'
}

/** Control key prefix for the per-mode switches (`mode:timeline`). */
const MODE_KEY_PREFIX = 'mode:'

const PROPERTY_SETTINGS: TextSetting[] = [
    {
        key: 'defaultStatusProperty',
        name: 'Default column property',
        desc: 'Property whose value places a note in a column (its "status"). Any property works, e.g. "priority". A board can override this.',
        fallback: 'status'
    },
    {
        key: 'defaultOrderProperty',
        name: 'Manual order property',
        desc: 'Property storing a card’s position within its column.',
        fallback: 'manual_order'
    },
    {
        key: 'defaultBlockedByProperty',
        name: 'Blocked-by property',
        desc: 'Property listing the notes a note is blocked by.',
        fallback: 'blocked_by'
    },
    {
        key: 'defaultScheduledDateProperty',
        name: 'Scheduled date property',
        desc: 'Date a note is scheduled to be worked on.',
        fallback: 'date_scheduled'
    },
    {
        key: 'defaultDueDateProperty',
        name: 'Due date property',
        desc: 'Date a note is due.',
        fallback: 'date_due'
    },
    {
        key: 'defaultDeferDateProperty',
        name: 'Defer date property',
        desc: 'Date before which a note cannot be started ("can\'t start until"). Deferred cards render muted and are excluded by the is:available filter.',
        fallback: 'date_defer'
    },
    {
        key: 'defaultEstimateProperty',
        name: 'Estimate property',
        desc: 'Days a note is expected to take. The default for every note type — a note type can override the property and unit (days or minutes) in its Configure dialog.',
        fallback: 'estimate'
    }
]

const PROGRESS_SETTINGS: TextSetting[] = [
    {
        key: 'defaultMilestonesProperty',
        name: 'Milestones property',
        desc: 'List of "<date> [label]" milestone entries.',
        fallback: 'milestones'
    },
    {
        key: 'defaultProgressProperty',
        name: 'Progress property',
        desc: 'Completion percentage 0–100.',
        fallback: 'progress'
    },
    {
        key: 'defaultDurationProperty',
        name: 'Duration property',
        desc: 'Own tracked minutes: recomputed from the time-entries list on every stop (a note type can override it in its Configure dialog).',
        fallback: 'duration'
    },
    {
        key: 'defaultTotalDurationProperty',
        name: 'Total duration property',
        desc: 'Persisted tracked-time rollup (minutes): the WBS row menu’s "Save total tracked time" writes the subtree total here.',
        fallback: 'total_duration'
    },
    {
        key: 'defaultTimeEntriesProperty',
        name: 'Time entries property',
        desc: 'List of {startTime, endTime, description} session objects (TaskNotes-compatible); the ledger the duration property is recomputed from.',
        fallback: 'time_entries'
    },
    {
        key: 'defaultLastSessionProperty',
        name: 'Last session property',
        desc: 'Date of the latest time entry, stamped on every stop.',
        fallback: 'date_last_session'
    }
]

const DATE_FORMAT_SETTING: TextSetting = {
    key: 'defaultDateFormat',
    name: 'Date format',
    desc: 'Moment.js format used when writing scheduling dates to notes.',
    fallback: 'YYYY-MM-DD'
}

const POMODORO_TEXT_SETTINGS: TextSetting[] = [
    {
        key: 'pomodorosProperty',
        name: 'Pomodoros property',
        desc: 'Daily-note list property receiving one record per pomodoro (TaskNotes’ shape and name).',
        fallback: 'pomodoros'
    },
    {
        key: 'dailyNoteFolder',
        name: 'Daily note folder (fallback)',
        desc: 'Used only when neither the Periodic Notes plugin nor the core Daily Notes plugin provides a folder. Empty = vault root.',
        fallback: ''
    },
    {
        key: 'dailyNoteFormat',
        name: 'Daily note format (fallback)',
        desc: 'Moment.js date format of daily-note names, used only when no daily-notes plugin provides one. Empty = YYYY-MM-DD.',
        fallback: 'YYYY-MM-DD'
    }
]

const IDEAL_WEEK_TEXT_SETTINGS: TextSetting[] = [
    {
        key: 'defaultTimeBlocksProperty',
        name: 'Time blocks property',
        desc: 'List of "<days> HH:MM-HH:MM" entries the week grid reads and writes.',
        fallback: 'time_blocks'
    },
    {
        key: 'defaultPlannedMinutesProperty',
        name: 'Planned minutes property',
        desc: 'Minutes per week reserved by the blocks; recomputed on every edit.',
        fallback: 'minutes_planned_per_week'
    },
    {
        key: 'defaultTargetMinutesProperty',
        name: 'Target minutes property',
        desc: 'Weekly time budget in minutes; asked for when a block is first planned for a note without one.',
        fallback: 'minutes_per_week'
    },
    {
        key: 'committedDateProperty',
        name: 'Committed date property',
        desc: 'When the note was committed to. The WBS shows lead time (started − committed), cycle time (done − started) and lateness (done − due).',
        fallback: 'date_committed'
    },
    {
        key: 'defaultAlarmMinutesProperty',
        name: 'Alarm minutes property',
        desc: 'Weekly alarm in minutes: a week tracked above it turns the budget ring red and shows one notice.',
        fallback: 'minutes_alarm_per_week'
    },
    {
        key: 'defaultAreasProperty',
        name: 'Areas property',
        desc: 'List of the areas a note belongs to (Health, Work, …). The ideal week rail and its targets table can group by it.',
        fallback: 'areas'
    }
]

const REVIEW_TEXT_SETTINGS: TextSetting[] = [
    {
        key: 'reviewedDateProperty',
        name: 'Last-reviewed property',
        desc: 'Date a note was last reviewed (triage “Due for review”).',
        fallback: 'last_reviewed'
    },
    {
        key: 'reviewIntervalProperty',
        name: 'Review-interval property',
        desc: 'Days between reviews, read per note.',
        fallback: 'review_interval'
    },
    {
        key: 'reviewCountProperty',
        name: 'Review-count property',
        desc: 'Number of times a note has been reviewed (incremented on “Reviewed”).',
        fallback: 'review_count'
    }
]

const MINUTES_PER_DAY: NumberSetting = {
    key: 'minutesPerDay',
    name: 'Minutes per day',
    desc: 'How many minutes one day of work represents. Converts minute-based estimates (note-type unit override) into days for rollups and timeline spans. Default 480 = an 8-hour workday.',
    placeholder: '480',
    min: 1,
    scope: 'full'
}

const SESSION_GUARD_SETTINGS: NumberSetting[] = [
    {
        key: 'sessionIdleMinutes',
        name: 'Idle detection (minutes)',
        desc: 'Minutes without any activity in Obsidian before a running session asks whether to end when the activity stopped, keep running, or be discarded. 0 = off.',
        placeholder: '30',
        min: 0,
        scope: 'chrome'
    },
    {
        key: 'sessionMaxMinutes',
        name: 'Session cap (minutes)',
        desc: 'Longest session written without asking. Past it (and after a restart) you are asked to end the session at the cap, keep it running, or discard it. 0 = no cap.',
        placeholder: '480',
        min: 0,
        scope: 'chrome'
    }
]

const POMODORO_NUMBER_SETTINGS: NumberSetting[] = [
    {
        key: 'pomodoroWorkMinutes',
        name: 'Work pomodoro (minutes)',
        desc: 'Length of a work pomodoro. A work pomodoro on a card also runs a time-tracking session on it.',
        placeholder: '25',
        min: 1,
        scope: 'cards'
    },
    {
        key: 'pomodoroShortBreakMinutes',
        name: 'Short break (minutes)',
        desc: 'Length of a short break.',
        placeholder: '5',
        min: 1,
        scope: 'cards'
    },
    {
        key: 'pomodoroLongBreakMinutes',
        name: 'Long break (minutes)',
        desc: 'Length of a long break.',
        placeholder: '15',
        min: 1,
        scope: 'cards'
    },
    {
        key: 'pomodoroLongBreakInterval',
        name: 'Long break interval',
        desc: 'Every Nth completed work pomodoro is followed by a long break instead of a short one.',
        placeholder: '4',
        min: 1,
        scope: 'cards'
    }
]

const GRID_START_HOUR: NumberSetting = {
    key: 'weekGridStartHour',
    name: 'Grid starts at (hour)',
    desc: 'First hour shown, 0–23.',
    placeholder: '0',
    min: 0,
    max: 23,
    scope: 'full'
}

const GRID_END_HOUR: NumberSetting = {
    key: 'weekGridEndHour',
    name: 'Grid ends at (hour)',
    desc: 'Last hour shown, 1–24.',
    placeholder: '24',
    min: 1,
    max: 24,
    scope: 'full'
}

const BLOCK_MINUTES: NumberSetting = {
    key: 'weekBlockMinutes',
    name: 'New block length (minutes)',
    desc: 'Length of a block created by clicking the grid or dropping a note on it.',
    placeholder: '60',
    min: 15,
    max: 1440,
    scope: 'full'
}

const PIXELS_PER_HOUR: NumberSetting = {
    key: 'weekPixelsPerHour',
    name: 'Minimum pixels per hour',
    desc: 'The grid never gets denser than this: when the day window would not fit the pane at this scale, the grid scrolls instead.',
    placeholder: '24',
    min: 12,
    max: 240,
    scope: 'full'
}

const REVIEW_INTERVAL: NumberSetting = {
    key: 'defaultReviewIntervalDays',
    name: 'Default review interval (days)',
    desc: 'Used when a note has no review-interval value.',
    placeholder: '30',
    min: 1,
    scope: 'full'
}

const SOON_THRESHOLD: NumberSetting = {
    key: 'dueSoonThresholdDays',
    name: 'Due "soon" threshold (days)',
    desc: 'Within how many days the due countdown turns warm (orange).',
    placeholder: '7',
    min: 1,
    scope: 'cards'
}

const ARCHIVE_GRACE: NumberSetting = {
    key: 'archiveGraceDays',
    name: 'Archive grace period (days)',
    desc: 'How long a note stays on the board after entering an auto-archive status. Counted from its done date (Configure → Archiving → Done-date properties); aged notes are archived when a board loads, or via the "Archive aged done notes" command. 0 archives on the transition itself.',
    placeholder: '0',
    min: 0,
    // Read at decision time only — no board re-derivation needed
    scope: 'chrome'
}

const NUMBER_SETTINGS: NumberSetting[] = [
    MINUTES_PER_DAY,
    ...SESSION_GUARD_SETTINGS,
    ...POMODORO_NUMBER_SETTINGS,
    GRID_START_HOUR,
    GRID_END_HOUR,
    BLOCK_MINUTES,
    PIXELS_PER_HOUR,
    REVIEW_INTERVAL,
    SOON_THRESHOLD,
    ARCHIVE_GRACE
]

const TEXT_SETTINGS: TextSetting[] = [
    ...PROPERTY_SETTINGS,
    ...PROGRESS_SETTINGS,
    DATE_FORMAT_SETTING,
    ...POMODORO_TEXT_SETTINGS,
    ...IDEAL_WEEK_TEXT_SETTINGS,
    ...REVIEW_TEXT_SETTINGS
]

/**
 * Plain boolean toggles and the refresh each needs: `chrome` for values read
 * live (no board re-render), `cards` when card rendering depends on it.
 */
const TOGGLE_SCOPES = {
    askDescriptionOnStop: 'chrome',
    pomodoroAutoChain: 'chrome',
    pomodoroSoundCue: 'chrome',
    pomodoroNotificationCue: 'chrome',
    weekTargetFollowsPlanned: 'cards',
    // Read live when triage completes
    triageCelebrateOnComplete: 'chrome'
} as const satisfies Partial<Record<keyof PluginSettings, SettingsRefreshScope>>

type ToggleKey = keyof typeof TOGGLE_SCOPES

/** A settings change a control edit stands for, validated before any write. */
interface SettingsChange {
    apply: (draft: Draft<PluginSettings>) => void
    scope: SettingsRefreshScope
}

/** Report a failed save once per burst: typing fails once per keystroke. */
let lastFailureNoticeAt = 0
function reportSaveFailure(error: unknown): void {
    log('Failed to save settings', 'error', error)
    const now = Date.now()
    if (now - lastFailureNoticeAt < 5000) return
    lastFailureNoticeAt = now
    new Notice('Failed to save settings. Your changes apply until Obsidian restarts.')
}

/**
 * Settings tab, declared rather than rendered (Obsidian 1.13+).
 *
 * `getSettingDefinitions()` REPLACES `display()`: every vault-wide default is a
 * declared control, found by Obsidian's settings search. The note types list
 * is a `render:` row, because it reads the Obsidian Starter Kit, which may
 * register after this plugin loads and can change while the settings are
 * open: Obsidian builds the definitions once (in `update()`) and reuses them
 * on every opening, but re-runs render hooks each time.
 *
 * Writes keep this plugin's write path: memory first (`produce`), then
 * `saveSettings(scope)`, which refreshes open boards as narrowly as the change
 * allows. Obsidian awaits `setControlValue` but catches nothing, so a refused
 * value or a failed save is reported here and the promise resolves.
 *
 * Rules that each cost a shipped bug in a sibling plugin: a `render:` hook
 * writes into its own row only, and returns a cleanup when it appends content
 * (update() re-runs it on the same row and only resets the control area); a
 * row with neither a control nor a render hook is skipped.
 */
export class KanbanActionPlannerSettingTab extends PluginSettingTab {
    plugin: KanbanActionPlannerPlugin

    constructor(app: App, plugin: KanbanActionPlannerPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    override getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                items: [
                    {
                        name: 'Vault-wide defaults',
                        desc: 'Used when a board or note type does not specify its own. Per-note-type config (statuses, colors, cards, relationships, archiving) lives under "Note types" below; per-board options live in each board’s Bases "Configure view" panel.',
                        searchable: false,
                        render: (): void => {}
                    }
                ]
            },
            {
                type: 'group',
                heading: 'Default property names',
                items: [
                    ...PROPERTY_SETTINGS.map((setting) => this.textItem(setting)),
                    this.numberItem(MINUTES_PER_DAY),
                    ...PROGRESS_SETTINGS.map((setting) => this.textItem(setting)),
                    {
                        name: 'Contexts property',
                        desc: 'Multi-value list property holding a note’s GTD contexts (e.g. @work, @home). Used by the context filter switcher and chips.',
                        control: {
                            type: 'text',
                            key: 'defaultContextsProperty',
                            placeholder: DEFAULT_CONTEXTS_PROPERTY,
                            validate: (value: string): string | undefined => {
                                const name = value.trim() || DEFAULT_CONTEXTS_PROPERTY
                                // The contexts property must not collide with a
                                // reserved qualifier (parent, status, due, …):
                                // setContextTerms and the zoom helpers would
                                // fight over the same `<name>:` tokens.
                                return RESERVED_QUALIFIER_NAMES.has(name.toLowerCase())
                                    ? `"${name}" is a reserved filter qualifier and can’t be used as the contexts property. Choose another property name (e.g. contexts).`
                                    : undefined
                            }
                        }
                    },
                    this.textItem(DATE_FORMAT_SETTING)
                ]
            },
            {
                type: 'group',
                heading: 'Time tracking',
                items: [
                    this.toggleItem(
                        'askDescriptionOnStop',
                        'Ask for a description when a session stops',
                        'After a session stops, prompt for what it was about and write it into the entry’s description. The entry is written first, so skipping or closing the prompt loses nothing; the last description on the note is prefilled.'
                    ),
                    ...SESSION_GUARD_SETTINGS.map((setting) => this.numberItem(setting))
                ]
            },
            {
                type: 'group',
                heading: 'Pomodoro',
                items: [
                    ...POMODORO_NUMBER_SETTINGS.map((setting) => this.numberItem(setting)),
                    this.toggleItem(
                        'pomodoroAutoChain',
                        'Chain phases automatically',
                        'When a phase completes, start the next one by itself: work, then the break the cadence calls for, then work again. Off: the tracker notices that a break is next and waits for you. A stopped-early phase never chains; "Skip to the next phase" always does.'
                    ),
                    this.toggleItem(
                        'pomodoroSoundCue',
                        'Sound at phase boundaries',
                        'A short two-tone cue when a phase completes.'
                    ),
                    this.toggleItem(
                        'pomodoroNotificationCue',
                        'System notification at phase boundaries',
                        'A desktop notification when a phase completes (asks for permission once).'
                    ),
                    ...POMODORO_TEXT_SETTINGS.map((setting) => this.textItem(setting))
                ]
            },
            {
                type: 'group',
                heading: 'Ideal week',
                items: [
                    {
                        name: 'How the ideal week works',
                        desc: 'How you want to spend a week: every active note’s recurring time blocks on a weekly grid. Blocks are "<days> HH:MM-HH:MM" entries (mon-fri 09:00-12:00) on a 15-minute grid.',
                        searchable: false,
                        render: (): void => {}
                    },
                    ...IDEAL_WEEK_TEXT_SETTINGS.map((setting) => this.textItem(setting)),
                    this.toggleItem(
                        'weekTargetFollowsPlanned',
                        'Target follows planned',
                        'When an ideal-week edit plans more minutes than a note’s weekly target, raise the target to the planned minutes, and give a note that has no target yet one from its planned minutes instead of asking (a notice says so). A target is never lowered. Off: a note without a target is asked for one when its first block is planned.'
                    ),
                    {
                        name: 'Available hours per week',
                        desc: 'The time every share in the targets table is measured against (10, 37.5, 168…). Empty = the visible grid hours times seven days (the whole week by default).',
                        control: {
                            type: 'text',
                            key: 'weekAvailableHoursPerWeek',
                            placeholder: 'Grid hours × 7',
                            validate: (value: string): string | undefined =>
                                parseAvailableHours(value) === undefined
                                    ? 'Enter a number of hours above 0 and up to 168, or leave it empty.'
                                    : undefined
                        }
                    },
                    this.numberItem(GRID_START_HOUR),
                    this.numberItem(GRID_END_HOUR),
                    {
                        name: 'Work hours',
                        desc: 'Highlighted band on work days, written like 09:00-17:00. Empty = no band.',
                        control: {
                            type: 'text',
                            key: 'weekWorkHours',
                            placeholder: '09:00-17:00',
                            validate: (value: string): string | undefined =>
                                parseMinuteRange(value) === null
                                    ? 'Enter a range like 09:00-17:00 within one day, or leave it empty.'
                                    : undefined
                        }
                    },
                    {
                        name: 'Work days',
                        desc: 'Days carrying the work band, as day tokens (mon-fri, or mon,tue,thu).',
                        control: {
                            type: 'text',
                            key: 'weekWorkDays',
                            placeholder: 'Day tokens',
                            validate: (value: string): string | undefined =>
                                parseDayTokens(value) === null
                                    ? 'Enter day tokens like mon-fri or mon,tue,thu.'
                                    : undefined
                        }
                    },
                    this.numberItem(BLOCK_MINUTES),
                    {
                        name: 'Day window',
                        desc: 'The hours that fill the ideal week pane, written like 06:00-22:00; the scale follows the pane height and the rest of the day scrolls. Empty = the whole grid.',
                        control: {
                            type: 'text',
                            key: 'weekDayWindow',
                            placeholder: '06:00-22:00',
                            validate: (value: string): string | undefined =>
                                parseMinuteRange(value) === null
                                    ? 'Enter a range like 06:00-22:00 within one day, or leave it empty.'
                                    : undefined
                        }
                    },
                    this.numberItem(PIXELS_PER_HOUR)
                ]
            },
            {
                type: 'group',
                heading: 'View modes',
                items: [
                    {
                        name: 'Unused modes',
                        desc: 'Switch off the modes you do not use: they leave the mode switch, their commands do nothing, and embeds or views remembered in them open the board instead. The board itself cannot be switched off.',
                        searchable: false,
                        render: (): void => {}
                    },
                    ...VIEW_MODES.filter((mode) => mode !== 'board').map(
                        (mode): SettingGroupItem => ({
                            name: VIEW_MODE_LABELS[mode],
                            control: { type: 'toggle', key: `${MODE_KEY_PREFIX}${mode}` }
                        })
                    )
                ]
            },
            {
                type: 'group',
                heading: 'Review (triage)',
                items: [
                    ...REVIEW_TEXT_SETTINGS.map((setting) => this.textItem(setting)),
                    this.numberItem(REVIEW_INTERVAL),
                    this.toggleItem(
                        'triageCelebrateOnComplete',
                        'Celebrate completed triage',
                        'Play a short confetti burst when a note’s triage is completed.'
                    ),
                    {
                        name: 'First day of the week',
                        desc: 'Which day calendar weeks start on.',
                        control: {
                            type: 'dropdown',
                            key: 'firstDayOfWeek',
                            options: WEEKDAY_OPTIONS
                        }
                    },
                    {
                        name: 'Card chip style',
                        desc: 'How property values render on cards. Minimal: a clean stat list, no fills. Tinted: color-filled pills (a heatmap). Rail: neutral pills with a colored edge.',
                        control: {
                            type: 'dropdown',
                            key: 'cardChipStyle',
                            options: CHIP_STYLE_OPTIONS
                        }
                    },
                    {
                        name: 'Due countdown position',
                        desc: 'Where the due-countdown badge renders on cards (enable it per board in the view options). Title row: a right-aligned pill on the title. Chip: among the bottom field chips. Corner: a pill in the top-right corner. Footer: a row at the bottom.',
                        control: {
                            type: 'dropdown',
                            key: 'dueCountdownStyle',
                            options: COUNTDOWN_STYLE_OPTIONS
                        }
                    },
                    this.numberItem(SOON_THRESHOLD)
                ]
            },
            {
                type: 'group',
                heading: 'Archiving',
                items: [
                    this.numberItem(ARCHIVE_GRACE),
                    {
                        name: 'Default column values',
                        desc: 'One column property value per line, in column order. Used when a board does not define its own column values and no Starter Kit note type applies. Number prefixes (e.g. "10 Todo") set order and are hidden on the column header.',
                        control: {
                            type: 'textarea',
                            key: 'defaultStatuses',
                            placeholder: '10 Todo\n20 In progress\n30 Done'
                        }
                    }
                ]
            },
            {
                type: 'group',
                heading: 'Note types',
                items: [
                    {
                        name: 'Note types',
                        desc: 'Each note type carries its own statuses, colors, cards, relationships, and archiving. Any board applies these automatically to its recognized notes, so you configure a type once here instead of on every board. When the Obsidian Starter Kit is present, its note types are synchronized below.',
                        aliases: ['statuses', 'colors', 'relationships', 'recognition'],
                        render: (setting): (() => void) => {
                            // Drawn at render time: the Starter Kit's note
                            // types may change while the settings are open
                            setting.settingEl.addClass('kap-settings-stack')
                            const listEl = setting.settingEl.createDiv()
                            this.renderNoteTypes(listEl)
                            return () => listEl.remove()
                        }
                    }
                ]
            },
            {
                type: 'group',
                heading: 'About',
                items: [
                    {
                        name: 'Follow the author',
                        desc: 'Sébastien Dubois (@dSebastien)',
                        searchable: false,
                        // A CTA button, not a row `action:`, which would make the
                        // whole row clickable and draw no button
                        render: (setting): void => {
                            setting.addButton((button) => {
                                button.setCta()
                                button.setButtonText('Follow on X').onClick(() => {
                                    window.open('https://x.com/dSebastien')
                                })
                            })
                        }
                    },
                    {
                        name: 'Support',
                        searchable: false,
                        render: (setting): (() => void) => {
                            // The section draws its own headings; `.setting-item`
                            // is a flex row, and the block is a stack of rows
                            setting.infoEl.remove()
                            setting.settingEl.addClass('kap-settings-stack')
                            const blockEl = setting.settingEl.createDiv()
                            renderSupportSection(blockEl, (el) => {
                                this.renderBuyMeACoffeeBadge(el)
                            })
                            // update() re-runs this hook on the SAME row: only
                            // the control area is reset, so remove what was added
                            return () => blockEl.remove()
                        }
                    }
                ]
            }
        ]
    }

    private textItem(setting: TextSetting): SettingGroupItem {
        return {
            name: setting.name,
            desc: setting.desc,
            control: { type: 'text', key: setting.key, placeholder: setting.fallback }
        }
    }

    private numberItem(setting: NumberSetting): SettingGroupItem {
        const { min, max } = setting
        return {
            name: setting.name,
            desc: setting.desc,
            control: {
                type: 'number',
                key: setting.key,
                placeholder: setting.placeholder,
                min,
                ...(max === undefined ? {} : { max }),
                step: 1,
                // Obsidian 1.13 commits `defaultValue ?? 0` when the field is
                // cleared. Without a defaultValue, clearing the idle or cap
                // field would store 0 and switch that guard off; with the
                // setting's own default, a cleared field falls back to it,
                // as the property-name fields do
                defaultValue: DEFAULT_SETTINGS[setting.key] ?? undefined,
                validate: (value: number): string | undefined => numberProblem(value, min, max)
            }
        }
    }

    private toggleItem(key: ToggleKey, name: string, desc: string): SettingGroupItem {
        return { name, desc, control: { type: 'toggle', key } }
    }

    override getControlValue(key: string): unknown {
        const settings = this.plugin.settings
        if (key.startsWith(MODE_KEY_PREFIX)) {
            const mode = this.viewModeOf(key)
            return mode === null ? undefined : modeEnabled(mode, settings.disabledModes)
        }
        switch (key) {
            case 'weekAvailableHoursPerWeek':
                return settings.weekAvailableHoursPerWeek === null
                    ? ''
                    : String(settings.weekAvailableHoursPerWeek)
            case 'weekWorkHours':
                return formatMinuteRange(settings.weekWorkStartMinutes, settings.weekWorkEndMinutes)
            case 'weekDayWindow':
                return formatMinuteRange(settings.weekDayStartMinutes, settings.weekDayEndMinutes)
            case 'weekWorkDays':
                return formatDays(settings.weekWorkDays)
            case 'firstDayOfWeek':
                return String(settings.firstDayOfWeek)
            case 'defaultStatuses':
                return settings.defaultStatuses.join('\n')
        }
        if (this.isKnownKey(key)) {
            return settings[key as keyof PluginSettings]
        }
        return undefined
    }

    /**
     * Persists a control edit. The value is checked first (the same checks the
     * controls' `validate` runs); a refused value writes nothing.
     */
    override async setControlValue(key: string, value: unknown): Promise<void> {
        let change: SettingsChange
        try {
            change = this.controlChange(key, value)
        } catch (error) {
            log('Refused a settings value', 'warn', error)
            new Notice('That value could not be applied.')
            return
        }
        const next = produce(this.plugin.settings, change.apply)
        // Obsidian commits a number field on every blur, changed or not;
        // immer returns the same object when nothing changed, so an
        // untouched field neither rewrites data.json nor refreshes boards
        if (next === this.plugin.settings) return
        try {
            this.plugin.settings = next
            await this.plugin.saveSettings(change.scope)
        } catch (error) {
            reportSaveFailure(error)
        }
    }

    private controlChange(key: string, value: unknown): SettingsChange {
        if (key.startsWith(MODE_KEY_PREFIX)) {
            const mode = this.viewModeOf(key)
            if (mode === null) throw new Error(`Unknown view mode in "${key}".`)
            const enabled = expectBoolean(key, value)
            return {
                apply: (draft) => {
                    const without = draft.disabledModes.filter((m) => m !== mode)
                    draft.disabledModes = enabled ? without : [...without, mode]
                },
                scope: 'full'
            }
        }

        const text = TEXT_SETTINGS.find((setting) => setting.key === key)
        if (text) {
            const next = expectString(key, value).trim() || text.fallback
            return {
                apply: (draft) => {
                    draft[text.key] = next
                },
                scope: text.scope ?? 'full'
            }
        }

        const number = NUMBER_SETTINGS.find((setting) => setting.key === key)
        if (number) {
            const n = value
            if (typeof n !== 'number' || numberProblem(n, number.min, number.max)) {
                throw new Error(`Setting "${key}" expects a whole number in range.`)
            }
            return {
                apply: (draft) => {
                    draft[number.key] = n
                },
                scope: number.scope
            }
        }

        if (Object.hasOwn(TOGGLE_SCOPES, key)) {
            const toggle = key as ToggleKey
            const enabled = expectBoolean(key, value)
            return {
                apply: (draft) => {
                    draft[toggle] = enabled
                },
                scope: TOGGLE_SCOPES[toggle]
            }
        }

        switch (key) {
            case 'defaultContextsProperty': {
                const name = expectString(key, value).trim() || DEFAULT_CONTEXTS_PROPERTY
                if (RESERVED_QUALIFIER_NAMES.has(name.toLowerCase())) {
                    throw new Error(`"${name}" is a reserved filter qualifier.`)
                }
                return {
                    apply: (draft) => {
                        draft.defaultContextsProperty = name
                    },
                    scope: 'full'
                }
            }
            case 'weekAvailableHoursPerWeek': {
                const hours = parseAvailableHours(expectString(key, value))
                if (hours === undefined)
                    throw new Error(`Setting "${key}" is not a number of hours.`)
                return {
                    apply: (draft) => {
                        draft.weekAvailableHoursPerWeek = hours
                    },
                    scope: 'full'
                }
            }
            case 'weekWorkHours':
            case 'weekDayWindow': {
                const range = parseMinuteRange(expectString(key, value))
                if (range === null) throw new Error(`Setting "${key}" is not a time range.`)
                const [start, end] = range
                return {
                    apply: (draft) => {
                        if (key === 'weekWorkHours') {
                            draft.weekWorkStartMinutes = start
                            draft.weekWorkEndMinutes = end
                        } else {
                            draft.weekDayStartMinutes = start
                            draft.weekDayEndMinutes = end
                        }
                    },
                    scope: 'full'
                }
            }
            case 'weekWorkDays': {
                const days = parseDayTokens(expectString(key, value))
                if (days === null) throw new Error(`Setting "${key}" is not a list of days.`)
                return {
                    apply: (draft) => {
                        draft.weekWorkDays = days
                    },
                    scope: 'full'
                }
            }
            case 'firstDayOfWeek': {
                const day = Number(value)
                if (typeof value !== 'string' || !Number.isInteger(day) || day < 0 || day > 6) {
                    throw new Error(`Setting "${key}" expects a day from 0 to 6.`)
                }
                return {
                    apply: (draft) => {
                        draft.firstDayOfWeek = day
                    },
                    scope: 'full'
                }
            }
            case 'cardChipStyle': {
                if (typeof value !== 'string' || !Object.hasOwn(CHIP_STYLE_OPTIONS, value)) {
                    throw new Error(`Setting "${key}" expects one of the listed styles.`)
                }
                const style = value as PluginSettings['cardChipStyle']
                return {
                    apply: (draft) => {
                        draft.cardChipStyle = style
                    },
                    // A CSS class toggle — `chrome` applies it instantly (#67)
                    scope: 'chrome'
                }
            }
            case 'dueCountdownStyle': {
                if (typeof value !== 'string' || !Object.hasOwn(COUNTDOWN_STYLE_OPTIONS, value)) {
                    throw new Error(`Setting "${key}" expects one of the listed positions.`)
                }
                const style = value as PluginSettings['dueCountdownStyle']
                return {
                    apply: (draft) => {
                        draft.dueCountdownStyle = style
                    },
                    // Baked into card display — `cards` re-renders just the cards (#67)
                    scope: 'cards'
                }
            }
            case 'defaultStatuses': {
                const statuses = expectString(key, value)
                    .split('\n')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0)
                return {
                    apply: (draft) => {
                        draft.defaultStatuses = statuses
                    },
                    scope: 'full'
                }
            }
            default:
                throw new Error(`Setting "${key}" does not address a known field.`)
        }
    }

    /** The view mode a `mode:<mode>` key addresses, or null. */
    private viewModeOf(key: string): ViewMode | null {
        const mode = key.slice(MODE_KEY_PREFIX.length)
        return (VIEW_MODES as readonly string[]).includes(mode) && mode !== 'board'
            ? (mode as ViewMode)
            : null
    }

    /** Whether `key` is one of the plain settings read straight from memory. */
    private isKnownKey(key: string): boolean {
        return (
            TEXT_SETTINGS.some((setting) => setting.key === key) ||
            NUMBER_SETTINGS.some((setting) => setting.key === key) ||
            Object.hasOwn(TOGGLE_SCOPES, key) ||
            key === 'defaultContextsProperty' ||
            key === 'cardChipStyle' ||
            key === 'dueCountdownStyle'
        )
    }

    /**
     * Central note-type management: every note type's shared config (statuses,
     * colors, cards, relationships, archiving) lives here, applied by any board
     * to its recognized notes — no per-board duplication. Starter Kit types sync
     * automatically; the Default applies to notes with no recognized type.
     */
    private renderNoteTypes(containerEl: HTMLElement): void {
        for (const type of this.knownNoteTypes()) {
            const setting = new Setting(containerEl)
                .setName(type.name)
                .setDesc(
                    type.source === 'starter-kit'
                        ? `Synced from the Obsidian Starter Kit${
                              type.statusValues.length
                                  ? ` · ${String(type.statusValues.length)} statuses`
                                  : ''
                          }.`
                        : 'Local note type — recognized by your own tag / folder / regex rules.'
                )
                .addButton((button) =>
                    button.setButtonText('Configure').onClick(() => void this.openTypeConfig(type))
                )
            if (type.source === 'local') {
                setting.addExtraButton((b) =>
                    b
                        .setIcon('trash')
                        .setTooltip('Delete note type')
                        .onClick(() => this.confirmDeleteNoteType(type))
                )
            }
        }

        new Setting(containerEl)
            .setName('Add a local note type')
            .setDesc(
                'Define a type recognized by tag, folder, or path regex — no Starter Kit needed.'
            )
            .addButton((button) =>
                button
                    .setButtonText('Add note type')
                    .setCta()
                    .onClick(() => void this.addLocalNoteType())
            )

        new Setting(containerEl)
            .setName('Default (unrecognized notes)')
            .setDesc('Applies to notes without a recognized type.')
            .addButton((button) =>
                button.setButtonText('Configure').onClick(
                    () =>
                        void this.openTypeConfig({
                            id: DEFAULT_NOTE_TYPE_ID,
                            name: 'Default',
                            source: 'local',
                            statusValues: this.plugin.settings.defaultStatuses
                        })
                )
            )
    }

    /** Merge Starter Kit note types with any stored local note types (deduped). */
    private knownNoteTypes(): NoteTypeRow[] {
        const map = new Map<string, NoteTypeRow>()
        for (const sk of listNoteTypes(this.app)) {
            map.set(sk.id, {
                id: sk.id,
                name: sk.name,
                source: 'starter-kit',
                statusValues: this.statusValuesFor(sk.id, 'starter-kit')
            })
        }
        for (const noteType of this.plugin.settings.noteTypes) {
            if (noteType.id === DEFAULT_NOTE_TYPE_ID || map.has(noteType.id)) continue
            map.set(noteType.id, {
                id: noteType.id,
                name: noteType.name,
                source: noteType.source,
                statusValues: this.statusValuesFor(noteType.id, noteType.source)
            })
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
    }

    /**
     * The status values to offer when configuring a note type (issue #200) —
     * chiefly the per-status color rows, which used to disappear for every type
     * that wasn't being created right then.
     *
     * The chain mirrors how a board resolves its columns, so "Configure" shows
     * what the board shows: the Starter Kit's EXPLICIT status declaration first
     * (its 1.13+ Status section, which the old heuristic never consulted, so an
     * explicitly-configured type yielded nothing), then the historical property
     * heuristic, then the type's own stored columns (what was last mirrored —
     * also the answer when the Starter Kit is absent), and finally the global
     * default statuses, so a freshly-created local type with no columns yet is
     * still configurable.
     */
    private statusValuesFor(id: string, source: NoteType['source']): string[] {
        const sk =
            source === 'starter-kit'
                ? listNoteTypes(this.app).find((type) => type.id === id)
                : undefined
        const explicit = sk ? getNoteTypeStatus(this.app, id) : null
        return configurableStatusValues({
            starterKitExplicit: explicit?.explicit ? explicit.values.map((v) => v.value) : [],
            starterKitDetected: sk
                ? (findStatusProperty(sk, this.plugin.settings.defaultStatusProperty)
                      ?.allowedValues ?? [])
                : [],
            storedColumns: findNoteType(this.plugin, id)?.columns.map((c) => c.statusValue) ?? [],
            globalDefaults: this.plugin.settings.defaultStatuses
        })
    }

    /** Open the shared note-type config (reuses the Configure-board editor). */
    private async openTypeConfig(type: NoteTypeRow): Promise<void> {
        const noteType = await getOrCreateNoteType(this.plugin, type.id, type.name, type.source)
        new ConfigureBoardModal(
            this.app,
            this.plugin,
            noteType,
            type.statusValues,
            this.propertiesForType(type.id),
            () => this.update()
        ).open()
    }

    /** Create a local note type and open its config (recognition first). */
    private async addLocalNoteType(): Promise<void> {
        const noteType = await createLocalNoteType(this.plugin, 'New type')
        this.update()
        new ConfigureBoardModal(
            this.app,
            this.plugin,
            noteType,
            this.statusValuesFor(noteType.id, noteType.source),
            this.propertiesForType(noteType.id),
            () => this.update(),
            'recognition'
        ).open()
    }

    /** Confirm + delete a local note type (its notes are untouched). */
    private confirmDeleteNoteType(type: NoteTypeRow): void {
        new ConfirmModal(this.app, {
            title: `Delete note type "${type.name}"?`,
            message:
                'This removes the type and its configuration (colors, cards, relationships, ' +
                'archiving, recognition rules). Your notes are not changed.',
            confirmText: 'Delete',
            onConfirm: () => {
                void deleteNoteType(this.plugin, type.id).then(() => this.update())
            }
        }).open()
    }

    /** Best-available property names for a type's dropdowns (no board context). */
    private propertiesForType(id: string): string[] {
        const names = new Set<string>()
        const sk = listNoteTypes(this.app).find((t) => t.id === id)
        for (const prop of sk?.properties ?? []) names.add(prop.name)
        const noteType = findNoteType(this.plugin, id)
        if (noteType) {
            for (const rule of noteType.relationships) {
                if (rule.linkProperty) names.add(rule.linkProperty)
            }
            if (noteType.laneGrouping.kind === 'property') names.add(noteType.laneGrouping.property)
            names.add(noteType.statusProperty)
            names.add(noteType.orderProperty)
        }
        names.add(this.plugin.settings.defaultBlockedByProperty)
        return Array.from(names)
            .filter((n) => n.length > 0)
            .sort()
    }

    private renderBuyMeACoffeeBadge(contentEl: HTMLElement | DocumentFragment, width = 175): void {
        const linkEl = contentEl.createEl('a', {
            href: 'https://www.buymeacoffee.com/dsebastien'
        })
        const imgEl = linkEl.createEl('img')
        imgEl.src = BUY_ME_A_COFFEE_BADGE_DATA_URL
        imgEl.alt = 'Buy me a coffee'
        imgEl.width = width
    }
}

/** Why a number is refused (not whole, or out of bounds), or undefined when it is fine. */
function numberProblem(value: number, min: number, max?: number): string | undefined {
    if (!Number.isInteger(value)) return 'Enter a whole number.'
    if (value < min) return `Enter ${String(min)} or more.`
    if (max !== undefined && value > max) return `Enter ${String(max)} or less.`
    return undefined
}

function expectBoolean(key: string, value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error(`Setting "${key}" expects a boolean.`)
    return value
}

function expectString(key: string, value: unknown): string {
    if (typeof value !== 'string') throw new Error(`Setting "${key}" expects text.`)
    return value
}
