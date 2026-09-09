import { z } from 'zod'
import { noteTypeSchema } from '../domain/note-type'
import {
    DEFAULT_ARCHIVE_GRACE_DAYS,
    DEFAULT_BLOCKED_BY_PROPERTY,
    DEFAULT_CONTEXTS_PROPERTY,
    DEFAULT_DATE_FORMAT,
    DEFAULT_DUE_DATE_PROPERTY,
    DEFAULT_DEFER_DATE_PROPERTY,
    DEFAULT_DUE_SOON_THRESHOLD_DAYS,
    DEFAULT_DURATION_PROPERTY,
    DEFAULT_ESTIMATE_PROPERTY,
    DEFAULT_MILESTONES_PROPERTY,
    DEFAULT_MINUTES_PER_DAY,
    DEFAULT_PROGRESS_PROPERTY,
    DEFAULT_FIRST_DAY_OF_WEEK,
    DEFAULT_ORDER_PROPERTY,
    DEFAULT_REVIEW_COUNT_PROPERTY,
    DEFAULT_REVIEW_INTERVAL_DAYS,
    DEFAULT_REVIEW_INTERVAL_PROPERTY,
    DEFAULT_REVIEWED_DATE_PROPERTY,
    DEFAULT_SCHEDULED_DATE_PROPERTY,
    DEFAULT_STATUS_PROPERTY,
    DEFAULT_TOTAL_DURATION_PROPERTY,
    DEFAULT_TIME_ENTRIES_PROPERTY,
    DEFAULT_LAST_SESSION_PROPERTY,
    DEFAULT_POMODOROS_PROPERTY,
    DEFAULT_POMODORO_WORK_MINUTES,
    DEFAULT_POMODORO_SHORT_BREAK_MINUTES,
    DEFAULT_POMODORO_LONG_BREAK_MINUTES,
    DEFAULT_POMODORO_LONG_BREAK_INTERVAL
} from '../constants'

/** Current settings schema version; bump when the shape changes (migrations). */
const SETTINGS_SCHEMA_VERSION = 1

/**
 * Plugin settings.
 *
 * Holds global default property names (used when a note type/view does not
 * override them) and the local note-type store. The note-type store is the local
 * snapshot/override layer: empty until a board is configured or mirrored from
 * the Starter Kit. Validated with {@link pluginSettingsSchema} on load.
 */
export const pluginSettingsSchema = z.object({
    schemaVersion: z.number(),
    /** Global default frontmatter property names. */
    defaultStatusProperty: z.string(),
    defaultOrderProperty: z.string(),
    defaultBlockedByProperty: z.string(),
    /**
     * Multi-value GTD contexts list property (e.g. `@work`, `@home`). A single
     * GLOBAL default, intentionally not per-type — GTD contexts are cross-cutting.
     * `.default()` so older `data.json` (written before this field existed)
     * still parses cleanly instead of resetting all settings.
     */
    defaultContextsProperty: z.string().default(DEFAULT_CONTEXTS_PROPERTY),
    defaultScheduledDateProperty: z.string(),
    defaultDueDateProperty: z.string(),
    /**
     * Defer ("can't start until") date property (issue #113). `.default()` so
     * older `data.json` still parses cleanly instead of resetting settings.
     */
    defaultDeferDateProperty: z.string().default(DEFAULT_DEFER_DATE_PROPERTY),
    /** Days a note is expected to take (timeline bar length; issue #80 rework). */
    defaultEstimateProperty: z.string(),
    /**
     * Minutes one day of work represents — converts minute-based estimates
     * (per-note-type unit override) into days for rollups/spans. 480 = 8h.
     */
    minutesPerDay: z.number().int().positive(),
    /** Milestone list property (`<date> [label]` entries; timeline diamonds). */
    defaultMilestonesProperty: z.string(),
    /** Completion percentage 0–100 (WBS progress bars; issue #76). */
    defaultProgressProperty: z.string(),
    /**
     * Time tracking (issue #119). `duration` accumulates tracked minutes from
     * start/stop sessions; `totalDuration` is the persisted subtree rollup.
     * `.default()` so older `data.json` still parses cleanly.
     */
    defaultDurationProperty: z.string().default(DEFAULT_DURATION_PROPERTY),
    defaultTotalDurationProperty: z.string().default(DEFAULT_TOTAL_DURATION_PROPERTY),
    /**
     * The single active time-tracking session (issue #119): the tracked
     * note's path and the epoch-ms start. Persisted so a restart mid-session
     * loses nothing; null = no session running.
     */
    activeTimeSession: z
        .object({ path: z.string(), startedAt: z.number() })
        .nullable()
        .default(null),
    /**
     * TaskNotes-compatible tracking (issue #172): the entries-list property
     * (`{startTime, endTime, description}` objects, the ledger the duration
     * cache is recomputed from) and the last-session date property. Global
     * defaults; a note type can override both in its Configure dialog.
     */
    defaultTimeEntriesProperty: z.string().default(DEFAULT_TIME_ENTRIES_PROPERTY),
    defaultLastSessionProperty: z.string().default(DEFAULT_LAST_SESSION_PROPERTY),
    /**
     * Pomodoro mode of the tracker (issue #172): work / break lengths in
     * minutes, the long-break cadence, the daily-note list property the
     * records go to, and the daily-note folder + format used only when
     * neither Periodic Notes nor the core Daily Notes plugin answers.
     */
    pomodoroWorkMinutes: z.number().int().positive().default(DEFAULT_POMODORO_WORK_MINUTES),
    pomodoroShortBreakMinutes: z
        .number()
        .int()
        .positive()
        .default(DEFAULT_POMODORO_SHORT_BREAK_MINUTES),
    pomodoroLongBreakMinutes: z
        .number()
        .int()
        .positive()
        .default(DEFAULT_POMODORO_LONG_BREAK_MINUTES),
    pomodoroLongBreakInterval: z
        .number()
        .int()
        .positive()
        .default(DEFAULT_POMODORO_LONG_BREAK_INTERVAL),
    pomodorosProperty: z.string().default(DEFAULT_POMODOROS_PROPERTY),
    dailyNoteFolder: z.string().default(''),
    dailyNoteFormat: z.string().default(''),
    /**
     * The running pomodoro (null = none) and how many work pomodoros
     * completed in a row (drives the long-break cadence; reset by a manual
     * stop). Persisted so a restart mid-pomodoro loses nothing.
     */
    activePomodoro: z
        .object({
            id: z.string(),
            path: z.string().nullable(),
            type: z.enum(['work', 'short-break', 'long-break']),
            startedAt: z.number(),
            plannedMinutes: z.number()
        })
        .nullable()
        .default(null),
    pomodoroCompletedWork: z.number().int().min(0).default(0),
    /** Review (spaced-repetition) property names (issue #57). */
    reviewedDateProperty: z.string(),
    reviewIntervalProperty: z.string(),
    reviewCountProperty: z.string(),
    /** Fallback review interval (days) when a note has no `review_interval`. */
    defaultReviewIntervalDays: z.number().int().positive(),
    /** Default momentjs format for scheduling dates written to notes. */
    defaultDateFormat: z.string(),
    /** First day of the calendar week (0 = Sunday … 6 = Saturday). */
    firstDayOfWeek: z.number().int().min(0).max(6),
    /** How card property chips are styled: `minimal` (no fills) / `tinted` / `rail`. */
    cardChipStyle: z.enum(['minimal', 'tinted', 'rail']),
    /** "Soon" threshold (days) for the due-countdown color ramp (issue #62). */
    dueSoonThresholdDays: z.number().int().positive(),
    /** Where the due-countdown badge renders: title row / chip / corner / footer. */
    dueCountdownStyle: z.enum(['title', 'chip', 'corner', 'footer']),
    /** Play a confetti burst when a note's triage is completed in triage mode. */
    triageCelebrateOnComplete: z.boolean(),
    /**
     * Archive grace period (days): a note entering an auto-archive status stays
     * on the board until its done date (the type's `doneDateProperties`) is this
     * many days old; the board-load sweep then archives it. 0 = archive on the
     * transition itself. `.default()` so older `data.json` still parses.
     */
    archiveGraceDays: z.number().int().min(0).default(DEFAULT_ARCHIVE_GRACE_DAYS),
    /**
     * Global default status values (columns) used when neither the view nor a
     * Starter Kit note type defines them. Order is the column order.
     */
    defaultStatuses: z.array(z.string()),
    /** Local noteType store (mirror snapshot + local noteTypes + overrides). */
    noteTypes: z.array(noteTypeSchema)
})

export type PluginSettings = z.infer<typeof pluginSettingsSchema>

/**
 * How much of an open board to refresh after a settings change (issue #67), so a
 * purely cosmetic change applies instantly instead of running the heavy full
 * re-derivation (note-type recognition + relationships + search index, ~seconds
 * on large boards):
 * - `chrome` — CSS chrome only (chip style); a class toggle, no re-render.
 * - `cards` — re-derive each card's display + re-render (due countdown position /
 *   "soon" threshold); skips relationships, search, note-type recognition.
 * - `full` — full re-resolution (property names, note types, statuses, swimlanes).
 */
export type SettingsRefreshScope = 'chrome' | 'cards' | 'full'

export const DEFAULT_SETTINGS: PluginSettings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    defaultStatusProperty: DEFAULT_STATUS_PROPERTY,
    defaultOrderProperty: DEFAULT_ORDER_PROPERTY,
    defaultBlockedByProperty: DEFAULT_BLOCKED_BY_PROPERTY,
    defaultContextsProperty: DEFAULT_CONTEXTS_PROPERTY,
    defaultScheduledDateProperty: DEFAULT_SCHEDULED_DATE_PROPERTY,
    defaultDueDateProperty: DEFAULT_DUE_DATE_PROPERTY,
    defaultDeferDateProperty: DEFAULT_DEFER_DATE_PROPERTY,
    defaultEstimateProperty: DEFAULT_ESTIMATE_PROPERTY,
    minutesPerDay: DEFAULT_MINUTES_PER_DAY,
    defaultMilestonesProperty: DEFAULT_MILESTONES_PROPERTY,
    defaultProgressProperty: DEFAULT_PROGRESS_PROPERTY,
    defaultDurationProperty: DEFAULT_DURATION_PROPERTY,
    defaultTotalDurationProperty: DEFAULT_TOTAL_DURATION_PROPERTY,
    activeTimeSession: null,
    defaultTimeEntriesProperty: DEFAULT_TIME_ENTRIES_PROPERTY,
    defaultLastSessionProperty: DEFAULT_LAST_SESSION_PROPERTY,
    pomodoroWorkMinutes: DEFAULT_POMODORO_WORK_MINUTES,
    pomodoroShortBreakMinutes: DEFAULT_POMODORO_SHORT_BREAK_MINUTES,
    pomodoroLongBreakMinutes: DEFAULT_POMODORO_LONG_BREAK_MINUTES,
    pomodoroLongBreakInterval: DEFAULT_POMODORO_LONG_BREAK_INTERVAL,
    pomodorosProperty: DEFAULT_POMODOROS_PROPERTY,
    dailyNoteFolder: '',
    dailyNoteFormat: '',
    activePomodoro: null,
    pomodoroCompletedWork: 0,
    reviewedDateProperty: DEFAULT_REVIEWED_DATE_PROPERTY,
    reviewIntervalProperty: DEFAULT_REVIEW_INTERVAL_PROPERTY,
    reviewCountProperty: DEFAULT_REVIEW_COUNT_PROPERTY,
    defaultReviewIntervalDays: DEFAULT_REVIEW_INTERVAL_DAYS,
    defaultDateFormat: DEFAULT_DATE_FORMAT,
    firstDayOfWeek: DEFAULT_FIRST_DAY_OF_WEEK,
    cardChipStyle: 'minimal',
    dueSoonThresholdDays: DEFAULT_DUE_SOON_THRESHOLD_DAYS,
    dueCountdownStyle: 'title',
    triageCelebrateOnComplete: true,
    archiveGraceDays: DEFAULT_ARCHIVE_GRACE_DAYS,
    defaultStatuses: [],
    noteTypes: []
}
