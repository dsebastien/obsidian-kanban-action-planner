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

/** The running pomodoro, persisted in settings so a restart loses nothing. */
export interface ActivePomodoro {
    id: string
    /** Vault path of the tracked note; null for a pomodoro on nothing. */
    path: string | null
    type: PomodoroType
    /** Epoch ms. */
    startedAt: number
    plannedMinutes: number
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

/** Whole seconds left before the pomodoro ends (0 once elapsed). */
export function remainingSeconds(active: ActivePomodoro, now: number): number {
    const end = active.startedAt + active.plannedMinutes * 60000
    return Math.max(0, Math.round((end - now) / 1000))
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
    const plannedEnd = active.startedAt + active.plannedMinutes * 60000
    const completed = endedAt >= plannedEnd
    const end = completed ? plannedEnd : Math.max(active.startedAt, endedAt)
    const startTime = formatEntryDateTime(new Date(active.startedAt))
    const endTime = formatEntryDateTime(new Date(end))
    return {
        id: active.id,
        taskPath: active.path ?? '',
        startTime,
        endTime,
        plannedDuration: active.plannedMinutes,
        type: active.type,
        completed,
        activePeriods: [{ startTime, endTime }]
    }
}

/** A collision-safe id for a new pomodoro (TaskNotes-style `pomo_<ms>_<rand>`). */
export function newPomodoroId(now: number, random: () => number = Math.random): string {
    return `pomo_${now}_${Math.floor(random() * 0xffffff)
        .toString(36)
        .padStart(4, '0')}`
}
