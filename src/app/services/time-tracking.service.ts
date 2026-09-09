import { Notice } from 'obsidian'
import type { App, TFile } from 'obsidian'
import { produce } from 'immer'
import { formatDuration } from '../domain/estimate'
import type { NoteType } from '../domain/note-type'
import {
    buildTimeEntry,
    latestEntryDate,
    parseTimeEntries,
    readTrackedMinutes,
    sumEntryMinutes
} from '../domain/time-entries'
import {
    breakTypeAfter,
    buildPomodoroRecord,
    formatCountdown,
    newPomodoroId,
    plannedMinutesFor,
    remainingSeconds
} from '../domain/pomodoro'
import type { ActivePomodoro, PomodoroConfig, PomodoroType } from '../domain/pomodoro'
import { DEFAULT_DURATION_PROPERTY } from '../constants'
import {
    appendRecordToListProperty,
    coerceOrder,
    getFrontmatterValue,
    setProperties,
    setProperty
} from './frontmatter.service'
import { findNoteType, recognizeNoteTypeFor } from './note-type.service'
import { ensureDailyNote } from './daily-note.service'
import { log } from '../../utils/log'
import type { KanbanActionPlannerPlugin } from '../plugin'

/**
 * Time tracking (issue #119, rewritten for issue #172): ONE start/stop
 * session at a time, on any note type. Stopping appends a TaskNotes-shaped
 * `{startTime, endTime, description}` entry to the note's entries list,
 * recomputes the spent-minutes cache from the whole list (an entry edited or
 * removed by hand is honoured — nothing accumulates blindly), and stamps the
 * last-session date. The active session persists in the plugin settings so a
 * restart mid-session loses nothing — elapsed time derives from the stored
 * epoch start, never from a timer.
 *
 * Pomodoro is a MODE of the same tracker: a timed work / break period whose
 * record goes to the daily note (`domain/pomodoro.ts`); a work pomodoro on a
 * note also opens a session on it, so its entries ledger stays complete.
 */

/** The four tracking properties resolved for one note (per type, else global). */
export interface TrackingProperties {
    /** Own tracked minutes cache. */
    duration: string
    /** Persisted subtree roll-up. */
    totalDuration: string
    /** Entries ledger. */
    entries: string
    /** Date of the latest entry. */
    lastSession: string
}

/** Elapsed whole minutes of a session, at least 1 (a tracked tap still counts). */
export function elapsedSessionMinutes(startedAt: number, now: number): number {
    return Math.max(1, Math.round((now - startedAt) / 60000))
}

/** Tracked minutes formatted with the estimate display grammar ("1h 30m"). */
export function formatTrackedMinutes(minutes: number, minutesPerDay: number): string {
    const perDay = minutesPerDay > 0 ? minutesPerDay : 1
    return formatDuration(minutes / perDay, perDay)
}

/** A positive tracked-minutes number from a raw property value, or null when unset. */
export function readDurationMinutes(raw: unknown): number | null {
    const value = coerceOrder(raw)
    return value !== null && value > 0 ? value : null
}

/**
 * The tracking properties for a note type: each per-type override wins when
 * non-blank, else the global default. `undefined` (untyped note) = globals.
 */
export function trackingPropertiesForType(
    settings: {
        defaultDurationProperty: string
        defaultTotalDurationProperty: string
        defaultTimeEntriesProperty: string
        defaultLastSessionProperty: string
    },
    noteType: Pick<NoteType, 'timeTracking'> | undefined
): TrackingProperties {
    const override = noteType?.timeTracking
    const pick = (value: string | undefined, fallback: string): string =>
        value && value.trim() !== '' ? value.trim() : fallback
    return {
        duration: pick(override?.durationProperty, settings.defaultDurationProperty),
        totalDuration: pick(override?.totalDurationProperty, settings.defaultTotalDurationProperty),
        entries: pick(override?.entriesProperty, settings.defaultTimeEntriesProperty),
        lastSession: pick(override?.lastSessionProperty, settings.defaultLastSessionProperty)
    }
}

/** The tracking properties for a note, recognizing its type first. */
export async function trackingPropertiesFor(
    plugin: KanbanActionPlannerPlugin,
    file: TFile
): Promise<TrackingProperties> {
    const type = await recognizeNoteTypeFor(plugin.app, plugin, file)
    const noteType = type ? findNoteType(plugin, type.id) : undefined
    return trackingPropertiesForType(plugin.settings, noteType)
}

/**
 * A note's own tracked minutes: its entries ledger when it holds any entry,
 * else its spent cache, else (compatibility) a legacy `duration` number left
 * by the pre-#172 tracker — read only when the configured duration property
 * is not `duration` itself, so nothing is double-counted. Null = untracked.
 */
export function readTrackedMinutesOf(
    app: App,
    file: TFile,
    properties: TrackingProperties
): number | null {
    return readTrackedMinutes({
        entries: getFrontmatterValue(app, file, properties.entries),
        spent: getFrontmatterValue(app, file, properties.duration),
        legacy:
            properties.duration === DEFAULT_DURATION_PROPERTY
                ? undefined
                : getFrontmatterValue(app, file, DEFAULT_DURATION_PROPERTY)
    })
}

/** Whether the active session (if any) tracks this path. */
export function isTrackingPath(plugin: KanbanActionPlannerPlugin, path: string): boolean {
    return plugin.settings.activeTimeSession?.path === path
}

/**
 * Start tracking `path`. An active session on another note is stopped first
 * (its entry is written); starting the already-tracked path is a no-op.
 */
export async function startTimeSession(
    plugin: KanbanActionPlannerPlugin,
    path: string
): Promise<void> {
    if (isTrackingPath(plugin, path)) return
    await stopTimeSession(plugin)
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activeTimeSession = { path, startedAt: Date.now() }
    })
    await plugin.saveSettings('cards')
    new Notice(`Time tracking started: ${basename(path)}`)
}

/**
 * Stop the active session (if any): append its entry to the tracked note's
 * entries list, recompute the spent cache from the list, and stamp the
 * last-session date — one frontmatter transaction. A session whose note no
 * longer exists is discarded with a notice instead of throwing.
 */
export async function stopTimeSession(plugin: KanbanActionPlannerPlugin): Promise<void> {
    const session = plugin.settings.activeTimeSession
    if (!session) return
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activeTimeSession = null
    })
    const file = plugin.app.vault.getFileByPath(session.path)
    if (!file) {
        await plugin.saveSettings('cards')
        new Notice(`Time tracking stopped — note not found: ${session.path}`)
        return
    }
    const now = Date.now()
    const properties = await trackingPropertiesFor(plugin, file)
    const raw = getFrontmatterValue(plugin.app, file, properties.entries)
    // Existing items are kept verbatim (a shape this version doesn't know is
    // not the plugin's to drop); only the sum reads the well-formed ones. A
    // template's empty placeholder (`- ` → null) is dropped.
    const existing: unknown[] = Array.isArray(raw) ? raw.filter((item) => item !== null) : []
    const entry = buildTimeEntry(session.startedAt, now)
    const list = [...existing, entry]
    const parsed = parseTimeEntries(list)
    const total = sumEntryMinutes(parsed)
    const lastSession = latestEntryDate(parsed)
    const write: Record<string, unknown> = {
        [properties.entries]: list,
        [properties.duration]: total
    }
    if (lastSession) write[properties.lastSession] = lastSession
    await setProperties(plugin.app, file, write)
    await plugin.saveSettings('cards')
    const perDay = plugin.settings.minutesPerDay
    const elapsed = elapsedSessionMinutes(session.startedAt, now)
    new Notice(
        `Time tracking stopped: ${basename(session.path)} — ` +
            `${formatTrackedMinutes(elapsed, perDay)} (total ${formatTrackedMinutes(total, perDay)})`
    )
}

/**
 * Recompute a note's spent cache and last-session date from its entries
 * list (the WBS row menu's "Recompute tracked time"): the repair for a
 * ledger edited by hand or by TaskNotes. Returns the new total, or null for
 * a note without entries (left alone — its cache may be its only record).
 */
export async function recomputeTrackedTime(
    plugin: KanbanActionPlannerPlugin,
    file: TFile
): Promise<number | null> {
    const properties = await trackingPropertiesFor(plugin, file)
    const parsed = parseTimeEntries(getFrontmatterValue(plugin.app, file, properties.entries))
    if (parsed.length === 0) return null
    const total = sumEntryMinutes(parsed)
    const write: Record<string, unknown> = { [properties.duration]: total }
    const lastSession = latestEntryDate(parsed)
    if (lastSession) write[properties.lastSession] = lastSession
    await setProperties(plugin.app, file, write)
    return total
}

/** Persist a subtree's tracked total to the note's total-duration property. */
export async function saveTotalTrackedTime(
    plugin: KanbanActionPlannerPlugin,
    file: TFile,
    totalMinutes: number
): Promise<void> {
    const properties = await trackingPropertiesFor(plugin, file)
    await setProperty(plugin.app, file, properties.totalDuration, totalMinutes)
}

// ── Pomodoro mode ─────────────────────────────────────────────────────

/** The pomodoro config from settings. */
export function pomodoroConfig(plugin: KanbanActionPlannerPlugin): PomodoroConfig {
    const s = plugin.settings
    return {
        workMinutes: s.pomodoroWorkMinutes,
        shortBreakMinutes: s.pomodoroShortBreakMinutes,
        longBreakMinutes: s.pomodoroLongBreakMinutes,
        longBreakInterval: s.pomodoroLongBreakInterval
    }
}

/** Whether the running pomodoro (if any) is a work pomodoro on this path. */
export function isPomodoroOnPath(plugin: KanbanActionPlannerPlugin, path: string): boolean {
    const active = plugin.settings.activePomodoro
    return active !== null && active.type === 'work' && active.path === path
}

/** The break the tracker would start next, from the completed-work count. */
export function nextBreakType(plugin: KanbanActionPlannerPlugin): PomodoroType {
    return breakTypeAfter(plugin.settings.pomodoroCompletedWork, pomodoroConfig(plugin))
}

/**
 * Start a pomodoro of `type` on `path` (null = on nothing). A running
 * pomodoro is stopped first (recorded as abandoned unless it had elapsed).
 * A work pomodoro on a note also starts a time session on it; a break
 * stops any running session (a break is not work).
 */
export async function startPomodoro(
    plugin: KanbanActionPlannerPlugin,
    path: string | null,
    type: PomodoroType = 'work'
): Promise<void> {
    if (plugin.settings.activePomodoro) await stopPomodoro(plugin)
    const now = Date.now()
    const active: ActivePomodoro = {
        id: newPomodoroId(now),
        path: type === 'work' ? path : null,
        type,
        startedAt: now,
        plannedMinutes: plannedMinutesFor(type, pomodoroConfig(plugin))
    }
    if (type === 'work' && path) await startTimeSession(plugin, path)
    else await stopTimeSession(plugin)
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activePomodoro = active
    })
    await plugin.saveSettings('cards')
    new Notice(
        `${pomodoroLabel(type)} started (${active.plannedMinutes} min)` +
            (active.path ? `: ${basename(active.path)}` : '')
    )
}

/**
 * Stop the running pomodoro (if any): write its record to the daily note,
 * close the work session it opened, and advance the long-break cadence when
 * a work pomodoro ran its course (an early stop resets the cadence). Safe
 * to call when nothing runs.
 */
export async function stopPomodoro(plugin: KanbanActionPlannerPlugin): Promise<void> {
    const active = plugin.settings.activePomodoro
    if (!active) return
    const now = Date.now()
    const record = buildPomodoroRecord(active, now)
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activePomodoro = null
        if (active.type === 'work') {
            draft.pomodoroCompletedWork = record.completed ? draft.pomodoroCompletedWork + 1 : 0
        }
    })
    if (active.type === 'work' && active.path && isTrackingPath(plugin, active.path)) {
        await stopTimeSession(plugin)
    }
    try {
        const daily = await ensureDailyNote(plugin.app, plugin.settings, new Date(now))
        await appendRecordToListProperty(
            plugin.app,
            daily,
            plugin.settings.pomodorosProperty,
            { ...record },
            (item) =>
                typeof item === 'object' &&
                item !== null &&
                (item as { id?: unknown }).id === record.id
        )
    } catch (error: unknown) {
        log('Pomodoro record could not be written to the daily note', 'error', error)
        new Notice(
            `Pomodoro ${record.completed ? 'completed' : 'stopped'}, but its record could not be ` +
                'written to the daily note. Check the daily-note settings.'
        )
    }
    await plugin.saveSettings('cards')
    const next =
        active.type === 'work'
            ? record.completed
                ? ` Next: ${pomodoroLabel(nextBreakType(plugin)).toLowerCase()}.`
                : ''
            : ' Next: work pomodoro.'
    new Notice(
        `${pomodoroLabel(active.type)} ${record.completed ? 'completed' : 'stopped early'}` +
            (active.path ? `: ${basename(active.path)}` : '') +
            next
    )
}

/**
 * One tick of the pomodoro clock (the plugin calls it every second): a
 * pomodoro whose planned time elapsed is stopped and recorded as completed.
 * Re-entrancy guarded — the async stop must not be started twice.
 */
let completing = false
export async function tickPomodoro(plugin: KanbanActionPlannerPlugin, now: number): Promise<void> {
    const active = plugin.settings.activePomodoro
    if (!active || completing || remainingSeconds(active, now) > 0) return
    completing = true
    try {
        await stopPomodoro(plugin)
    } finally {
        completing = false
    }
}

/**
 * The status-bar text for what runs right now: the pomodoro countdown when
 * one runs, else the plain session's elapsed time, else null (hidden).
 */
export function trackerStatusText(plugin: KanbanActionPlannerPlugin, now: number): string | null {
    const active = plugin.settings.activePomodoro
    if (active) {
        const note = active.path ? ` · ${basename(active.path)}` : ''
        const label = pomodoroLabel(active.type).toLowerCase()
        return `🍅 ${formatCountdown(remainingSeconds(active, now))} ${label}${note}`
    }
    const session = plugin.settings.activeTimeSession
    if (session) {
        const minutes = elapsedSessionMinutes(session.startedAt, now)
        const label = formatTrackedMinutes(minutes, plugin.settings.minutesPerDay)
        return `⏱ ${label} · ${basename(session.path)}`
    }
    return null
}

/** "Work pomodoro" / "Short break" / "Long break". */
export function pomodoroLabel(type: PomodoroType): string {
    return type === 'work' ? 'Work pomodoro' : type === 'short-break' ? 'Short break' : 'Long break'
}

/** The note's display basename (path without folders and extension). */
function basename(path: string): string {
    const name = path.split('/').pop() ?? path
    return name.replace(/\.md$/, '')
}
