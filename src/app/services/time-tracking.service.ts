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
    isPaused,
    newPomodoroId,
    nextPhaseAfter,
    pausePomodoro,
    plannedMinutesFor,
    remainingSeconds,
    resumePomodoro
} from '../domain/pomodoro'
import { guardVerdict, recoveryChoices } from '../domain/session-guard'
import { withEntryDescription } from '../domain/time-entries'
import { DescriptionPromptModal } from '../ui/description-prompt-modal'
import { SessionRecoveryModal } from '../ui/session-recovery-modal'
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
export async function stopTimeSession(
    plugin: KanbanActionPlannerPlugin,
    /**
     * When the session ends (issue #197): now by default; the idle instant or
     * the cap when the guard trims it. Never before the session started.
     */
    endedAt: number = Date.now(),
    /** Skip the description prompt (a chained phase / a trim asks nothing). */
    quiet = false
): Promise<void> {
    const session = plugin.settings.activeTimeSession
    if (!session) return
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activeTimeSession = null
    })
    guardAsked = null
    const file = plugin.app.vault.getFileByPath(session.path)
    if (!file) {
        await plugin.saveSettings('cards')
        new Notice(`Time tracking stopped — note not found: ${session.path}`)
        return
    }
    const now = Math.max(session.startedAt, endedAt)
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
    // The entry is on disk. The description prompt only fills it in
    // afterwards, so ignoring or closing the prompt loses nothing (issue #197).
    if (plugin.settings.askDescriptionOnStop && !quiet) {
        const previous = [...parsed].reverse().find((e) => (e.description ?? '').trim() !== '')
        new DescriptionPromptModal(plugin.app, {
            title: 'What was this session about?',
            subtitle: `${basename(session.path)} · ${formatTrackedMinutes(elapsed, perDay)}. Skip to leave the entry as it is.`,
            placeholder: 'Description',
            initial: previous?.description ?? '',
            submitText: 'Save',
            onSubmit: (value) => {
                const current = getFrontmatterValue(plugin.app, file, properties.entries)
                const next = withEntryDescription(current, entry.startTime, value)
                void setProperties(plugin.app, file, { [properties.entries]: next })
            }
        }).open()
    }
}

// ── Session guard (issue #197) ────────────────────────────────────────

/** Epoch ms of the last user activity Obsidian reported (see `noteActivity`). */
let lastActivityAt = Date.now()
/** The session start the guard already asked about, so it asks once per session. */
let guardAsked: number | null = null

/** Record user activity (pointer, key, wheel, leaf change). Cheap; called often. */
export function noteActivity(now: number = Date.now()): void {
    lastActivityAt = now
}

/**
 * One tick of the session guard: when the running session is idle or over
 * the cap, ask ONCE what to do — keep it, end it at the idle instant / the
 * cap, or discard it. Nothing is written until the user chooses; closing the
 * prompt keeps the session.
 */
export function tickSessionGuard(plugin: KanbanActionPlannerPlugin, now: number): void {
    const session = plugin.settings.activeTimeSession
    if (!session || guardAsked === session.startedAt) return
    const verdict = guardVerdict(session, lastActivityAt, now, {
        idleMinutes: plugin.settings.sessionIdleMinutes,
        maxMinutes: plugin.settings.sessionMaxMinutes
    })
    if (verdict.kind === 'ok') return
    guardAsked = session.startedAt
    const perDay = plugin.settings.minutesPerDay
    const note = basename(session.path)
    const trimAt = verdict.kind === 'idle' ? verdict.idleSince : verdict.capAt
    new SessionRecoveryModal(plugin.app, {
        title: verdict.kind === 'idle' ? 'Still working?' : 'Long session',
        message:
            verdict.kind === 'idle'
                ? `No activity for ${formatTrackedMinutes(verdict.idleMinutes, perDay)} while tracking ${note}. End the session when the activity stopped, keep it running, or discard it?`
                : `${note} has been tracked for ${formatTrackedMinutes(verdict.elapsedMinutes, perDay)}, past the ${formatTrackedMinutes(plugin.settings.sessionMaxMinutes, perDay)} cap. End it at the cap, keep it running, or discard it?`,
        trimText: verdict.kind === 'idle' ? 'End when activity stopped' : 'End at the cap',
        onDecide: (decision) => void applyRecovery(plugin, decision, trimAt)
    }).open()
}

/**
 * A session found running after a restart (issue #197): a short one simply
 * keeps running, as before; one past the idle threshold or the cap gets the
 * same keep / trim / discard prompt as the live guard.
 */
export function recoverSessionOnLoad(plugin: KanbanActionPlannerPlugin, now: number): void {
    const session = plugin.settings.activeTimeSession
    if (!session) return
    const choices = recoveryChoices(session, now, {
        idleMinutes: plugin.settings.sessionIdleMinutes,
        maxMinutes: plugin.settings.sessionMaxMinutes
    })
    if (!choices.suspicious) return
    guardAsked = session.startedAt
    const perDay = plugin.settings.minutesPerDay
    new SessionRecoveryModal(plugin.app, {
        title: 'A session was still running',
        message: `${basename(session.path)} has been tracked for ${formatTrackedMinutes(choices.elapsedMinutes, perDay)}, across a restart. Keep it running, end it now, or discard it?`,
        trimText: choices.trimTo !== null ? 'End at the cap' : 'End now',
        onDecide: (decision) => void applyRecovery(plugin, decision, choices.trimTo ?? now)
    }).open()
}

async function applyRecovery(
    plugin: KanbanActionPlannerPlugin,
    decision: 'keep' | 'trim' | 'discard',
    trimAt: number
): Promise<void> {
    if (decision === 'keep') return
    if (decision === 'trim') {
        // A trimmed session also ends a running work pomodoro on it.
        if (plugin.settings.activePomodoro?.path === plugin.settings.activeTimeSession?.path) {
            await stopPomodoro(plugin, { chain: false })
        }
        await stopTimeSession(plugin, trimAt, true)
        return
    }
    const path = plugin.settings.activeTimeSession?.path
    if (plugin.settings.activePomodoro?.path === path) await stopPomodoro(plugin, { chain: false })
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activeTimeSession = null
    })
    await plugin.saveSettings('cards')
    if (path) new Notice(`Session discarded: ${basename(path)} (nothing written)`)
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
        plannedMinutes: plannedMinutesFor(type, pomodoroConfig(plugin)),
        pausedAt: null,
        periods: []
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
export async function stopPomodoro(
    plugin: KanbanActionPlannerPlugin,
    options: {
        /**
         * Start the next phase when this one COMPLETED and auto-chaining is
         * on (issue #197). A manual stop never chains; a skip always does.
         */
        chain?: boolean
        /** Treat the stop as a skip: the next phase starts whatever the state. */
        skip?: boolean
    } = {}
): Promise<void> {
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
    const willChain =
        options.skip === true ||
        (options.chain !== false && record.completed && plugin.settings.pomodoroAutoChain)
    const nextType = nextPhaseAfter(
        active,
        plugin.settings.pomodoroCompletedWork,
        pomodoroConfig(plugin)
    )
    // A chained work → work on the same note keeps its session open; anything
    // else closes the work session (quietly when a phase follows at once).
    const keepsSession = willChain && nextType === 'work' && active.path !== null
    if (
        active.type === 'work' &&
        active.path &&
        isTrackingPath(plugin, active.path) &&
        !keepsSession
    ) {
        await stopTimeSession(plugin, now, willChain)
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
    if (record.completed) phaseCues(plugin, active.type, nextType)
    if (willChain) {
        new Notice(
            `${pomodoroLabel(active.type)} ${options.skip ? 'skipped' : 'completed'}` +
                (active.path ? `: ${basename(active.path)}` : '') +
                ` → ${pomodoroLabel(nextType).toLowerCase()}`
        )
        // The next phase reuses the work note: a break remembers which note
        // work resumes on; a work phase after a break goes back to it.
        const path = nextType === 'work' ? (active.path ?? lastWorkPath) : null
        if (active.type === 'work' && active.path) lastWorkPath = active.path
        await startPomodoro(plugin, path, nextType)
        return
    }
    if (active.type === 'work' && active.path) lastWorkPath = active.path
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

/** The note the last work pomodoro ran on, so a chained break → work returns to it. */
let lastWorkPath: string | null = null

/** Skip the current phase: record it as it stands and start the next one (issue #197). */
export async function skipPomodoroPhase(plugin: KanbanActionPlannerPlugin): Promise<void> {
    if (!plugin.settings.activePomodoro) return
    await stopPomodoro(plugin, { skip: true })
}

/** Pause the running pomodoro (issue #199); a no-op when none runs or it is paused. */
export async function pauseActivePomodoro(plugin: KanbanActionPlannerPlugin): Promise<void> {
    const active = plugin.settings.activePomodoro
    if (!active || isPaused(active)) return
    const paused = pausePomodoro(active, Date.now())
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activePomodoro = paused
    })
    await plugin.saveSettings('chrome')
}

/** Resume a paused pomodoro (issue #199); a no-op when none is paused. */
export async function resumeActivePomodoro(plugin: KanbanActionPlannerPlugin): Promise<void> {
    const active = plugin.settings.activePomodoro
    if (!active || !isPaused(active)) return
    const resumed = resumePomodoro(active, Date.now())
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activePomodoro = resumed
    })
    await plugin.saveSettings('chrome')
}

/** Pause when running, resume when paused. */
export async function togglePomodoroPause(plugin: KanbanActionPlannerPlugin): Promise<void> {
    const active = plugin.settings.activePomodoro
    if (!active) return
    await (isPaused(active) ? resumeActivePomodoro(plugin) : pauseActivePomodoro(plugin))
}

/**
 * Optional cues at a phase boundary (issue #199): a short two-tone beep and a
 * system notification, each off by default. Best effort — a missing audio
 * context or a denied notification permission is silently skipped.
 */
function phaseCues(
    plugin: KanbanActionPlannerPlugin,
    ended: PomodoroType,
    next: PomodoroType
): void {
    if (plugin.settings.pomodoroSoundCue) {
        try {
            const Ctx = window.AudioContext
            const ctx = new Ctx()
            const tone = (freq: number, at: number): void => {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.frequency.value = freq
                gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
                gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02)
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35)
                osc.connect(gain).connect(ctx.destination)
                osc.start(ctx.currentTime + at)
                osc.stop(ctx.currentTime + at + 0.4)
            }
            tone(ended === 'work' ? 660 : 523, 0)
            tone(ended === 'work' ? 880 : 659, 0.25)
            window.setTimeout(() => void ctx.close(), 1500)
        } catch {
            // No audio available: skip the cue.
        }
    }
    if (plugin.settings.pomodoroNotificationCue && 'Notification' in window) {
        const show = (): void => {
            try {
                new Notification(`${pomodoroLabel(ended)} completed`, {
                    body: `Next: ${pomodoroLabel(next).toLowerCase()}`,
                    silent: true
                })
            } catch {
                // Notifications unavailable: skip the cue.
            }
        }
        if (Notification.permission === 'granted') show()
        else if (Notification.permission === 'default') {
            void Notification.requestPermission().then((p) => {
                if (p === 'granted') show()
            })
        }
    }
}

/**
 * One tick of the pomodoro clock (the plugin calls it every second): a
 * pomodoro whose planned time elapsed is stopped and recorded as completed.
 * Re-entrancy guarded — the async stop must not be started twice.
 */
let completing = false
export async function tickPomodoro(plugin: KanbanActionPlannerPlugin, now: number): Promise<void> {
    const active = plugin.settings.activePomodoro
    if (!active || completing || isPaused(active) || remainingSeconds(active, now) > 0) return
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
        const paused = isPaused(active) ? ' ⏸' : ''
        return `🍅 ${formatCountdown(remainingSeconds(active, now))}${paused} ${label}${note}`
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
