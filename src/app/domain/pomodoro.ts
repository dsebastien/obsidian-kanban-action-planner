import { formatEntryDateTime } from './time-entries'

/**
 * Pomodoro as a MODE of the time tracker (issue #172, phase A).
 *
 * A pomodoro is a timed work or break period. Its record goes to the daily
 * note's `pomodoros` list in TaskNotes' shape and storage location, so both
 * tools read one ledger:
 *
 *   { id, taskPath, startTime, endTime, plannedDuration, type, completed,
 *     activePeriods: [{ startTime, endTime }] }
 *
 * `type` is `work` | `short-break` | `long-break`; `plannedDuration` is in
 * minutes; `taskPath` is the tracked note's vault path ('' for a pomodoro
 * on nothing). A work pomodoro on a note ALSO opens a time-entries session on
 * it (TaskNotes behaviour), so the note's ledger stays complete.
 *
 * Pure: no Obsidian imports.
 */

export type PomodoroType = 'work' | 'short-break' | 'long-break'

/** Durations and cadence (settings; TaskNotes' defaults). */
export interface PomodoroConfig {
    workMinutes: number
    shortBreakMinutes: number
    longBreakMinutes: number
    /** Every Nth completed work pomodoro is followed by a long break. */
    longBreakInterval: number
}

/** A closed run segment of a paused-and-resumed pomodoro (epoch ms). */
export interface PomodoroPeriod {
    start: number
    end: number
}

/**
 * The running pomodoro, persisted in settings so a restart loses nothing.
 *
 * Pause (issue #199): `pausedAt` is set while paused; `periods` holds the
 * closed run segments BEFORE the current one, so elapsed time is the sum of
 * the closed segments plus the open one — still derived from stored instants,
 * never from a ticking counter, so the visual is right after a reload. Both
 * are optional so a pomodoro stored by an older version keeps parsing.
 */
export interface ActivePomodoro {
    id: string
    /** Vault path of the tracked note; null for a pomodoro on nothing. */
    path: string | null
    type: PomodoroType
    /** Epoch ms of the current run segment's start (the pomodoro's start when never paused). */
    startedAt: number
    plannedMinutes: number
    /** Epoch ms when the pomodoro was paused; null / absent = running. */
    pausedAt?: number | null
    /** Closed run segments before the current one (empty when never paused). */
    periods?: PomodoroPeriod[]
}

/** One record as written to the daily note's `pomodoros` list. */
export interface PomodoroRecord {
    id: string
    taskPath: string
    startTime: string
    endTime: string
    plannedDuration: number
    type: PomodoroType
    completed: boolean
    activePeriods: { startTime: string; endTime: string }[]
}

/** Planned minutes of a pomodoro of `type` under `config` (at least 1). */
export function plannedMinutesFor(type: PomodoroType, config: PomodoroConfig): number {
    const minutes =
        type === 'work'
            ? config.workMinutes
            : type === 'short-break'
              ? config.shortBreakMinutes
              : config.longBreakMinutes
    return Math.max(1, Math.round(minutes))
}

/**
 * The break that follows the `completedWork`-th completed work pomodoro:
 * a long break every `longBreakInterval`-th one, a short break otherwise.
 */
export function breakTypeAfter(completedWork: number, config: PomodoroConfig): PomodoroType {
    const interval = Math.max(1, Math.round(config.longBreakInterval))
    return completedWork > 0 && completedWork % interval === 0 ? 'long-break' : 'short-break'
}

/** Whether the pomodoro is paused (issue #199). */
export function isPaused(active: ActivePomodoro): boolean {
    return typeof active.pausedAt === 'number'
}

/**
 * Milliseconds the pomodoro has actually RUN by `now`: every closed segment
 * plus the open one (frozen at `pausedAt` while paused).
 */
export function elapsedMs(active: ActivePomodoro, now: number): number {
    let total = 0
    for (const period of active.periods ?? []) total += Math.max(0, period.end - period.start)
    const openEnd = typeof active.pausedAt === 'number' ? active.pausedAt : now
    return total + Math.max(0, openEnd - active.startedAt)
}

/** Whole seconds left before the pomodoro ends (0 once elapsed); frozen while paused. */
export function remainingSeconds(active: ActivePomodoro, now: number): number {
    const left = active.plannedMinutes * 60000 - elapsedMs(active, now)
    return Math.max(0, Math.round(left / 1000))
}

/** Fraction of the planned time already run, 0..1 (the ring's drain). */
export function progressFraction(active: ActivePomodoro, now: number): number {
    const planned = active.plannedMinutes * 60000
    if (planned <= 0) return 1
    return Math.min(1, Math.max(0, elapsedMs(active, now) / planned))
}

/** The pomodoro paused at `now` (a no-op when already paused). */
export function pausePomodoro(active: ActivePomodoro, now: number): ActivePomodoro {
    if (isPaused(active)) return active
    return { ...active, pausedAt: Math.max(active.startedAt, now) }
}

/**
 * The pomodoro resumed at `now`: the segment that ran up to the pause is
 * closed into `periods` and a fresh segment opens. A no-op when not paused.
 */
export function resumePomodoro(active: ActivePomodoro, now: number): ActivePomodoro {
    if (typeof active.pausedAt !== 'number') return active
    const periods = [...(active.periods ?? []), { start: active.startedAt, end: active.pausedAt }]
    return { ...active, periods, startedAt: Math.max(active.pausedAt, now), pausedAt: null }
}

/**
 * The phase that follows `active` when it completes and chaining is on
 * (issue #197): a work pomodoro is followed by the cadence's break, a break
 * by work. `completedWork` is the count AFTER this pomodoro was accounted for.
 */
export function nextPhaseAfter(
    active: Pick<ActivePomodoro, 'type'>,
    completedWork: number,
    config: PomodoroConfig
): PomodoroType {
    return active.type === 'work' ? breakTypeAfter(completedWork, config) : 'work'
}

/** `m:ss` countdown label. */
export function formatCountdown(seconds: number): string {
    const s = Math.max(0, seconds)
    const minutes = Math.floor(s / 60)
    const rest = s % 60
    return `${minutes}:${rest < 10 ? '0' : ''}${rest}`
}

/**
 * The record a pomodoro produces when it ends at `endedAt` (epoch ms).
 * `completed` is true once the planned duration elapsed (an early stop is
 * an abandoned pomodoro, still recorded so the day stays honest). The end
 * time of a completed pomodoro is clamped to its planned end, so a record
 * written late (the plugin noticed after the fact) is not inflated.
 */
export function buildPomodoroRecord(active: ActivePomodoro, endedAt: number): PomodoroRecord {
    const planned = active.plannedMinutes * 60000
    const closed = active.periods ?? []
    const before = closed.reduce((sum, p) => sum + Math.max(0, p.end - p.start), 0)
    // The open segment ends when the pomodoro was paused, else at `endedAt`;
    // a completed pomodoro is clamped to the instant its planned time ran out.
    const openStart = active.startedAt
    const rawOpenEnd = typeof active.pausedAt === 'number' ? active.pausedAt : endedAt
    const plannedOpenEnd = openStart + Math.max(0, planned - before)
    const completed = before + (rawOpenEnd - openStart) >= planned
    const openEnd = completed
        ? Math.min(rawOpenEnd, plannedOpenEnd)
        : Math.max(openStart, rawOpenEnd)
    const first = closed[0]?.start ?? openStart
    const activePeriods = [...closed, { start: openStart, end: openEnd }].map((p) => ({
        startTime: formatEntryDateTime(new Date(p.start)),
        endTime: formatEntryDateTime(new Date(p.end))
    }))
    return {
        id: active.id,
        taskPath: active.path ?? '',
        startTime: formatEntryDateTime(new Date(first)),
        endTime: formatEntryDateTime(new Date(openEnd)),
        plannedDuration: active.plannedMinutes,
        type: active.type,
        completed,
        activePeriods
    }
}

/** A collision-safe id for a new pomodoro (TaskNotes-style `pomo_<ms>_<rand>`). */
export function newPomodoroId(now: number, random: () => number = Math.random): string {
    return `pomo_${now}_${Math.floor(random() * 0xffffff)
        .toString(36)
        .padStart(4, '0')}`
}
