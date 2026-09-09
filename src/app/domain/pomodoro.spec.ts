import { describe, expect, test } from 'bun:test'
import {
    breakTypeAfter,
    buildPomodoroRecord,
    formatCountdown,
    newPomodoroId,
    plannedMinutesFor,
    remainingSeconds
} from './pomodoro'
import type { ActivePomodoro, PomodoroConfig } from './pomodoro'

const config: PomodoroConfig = {
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakInterval: 4
}

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number =>
    new Date(y, mo - 1, d, h, mi, s).getTime()

describe('plannedMinutesFor / breakTypeAfter (issue #172)', () => {
    test('reads the configured duration per type, at least one minute', () => {
        expect(plannedMinutesFor('work', config)).toBe(25)
        expect(plannedMinutesFor('short-break', config)).toBe(5)
        expect(plannedMinutesFor('long-break', config)).toBe(15)
        expect(plannedMinutesFor('work', { ...config, workMinutes: 0 })).toBe(1)
    })

    test('every Nth completed work pomodoro earns a long break', () => {
        expect(breakTypeAfter(1, config)).toBe('short-break')
        expect(breakTypeAfter(3, config)).toBe('short-break')
        expect(breakTypeAfter(4, config)).toBe('long-break')
        expect(breakTypeAfter(8, config)).toBe('long-break')
        expect(breakTypeAfter(0, config)).toBe('short-break')
        expect(breakTypeAfter(1, { ...config, longBreakInterval: 1 })).toBe('long-break')
    })
})

describe('remainingSeconds / formatCountdown (issue #172)', () => {
    const active: ActivePomodoro = {
        id: 'p1',
        path: 'Work/Task A.md',
        type: 'work',
        startedAt: 1_000_000,
        plannedMinutes: 25
    }

    test('counts down to zero and never below', () => {
        expect(remainingSeconds(active, 1_000_000)).toBe(1500)
        expect(remainingSeconds(active, 1_000_000 + 10 * 60000)).toBe(900)
        expect(remainingSeconds(active, 1_000_000 + 30 * 60000)).toBe(0)
    })

    test('formats m:ss', () => {
        expect(formatCountdown(1500)).toBe('25:00')
        expect(formatCountdown(65)).toBe('1:05')
        expect(formatCountdown(0)).toBe('0:00')
        expect(formatCountdown(-3)).toBe('0:00')
    })
})

describe('buildPomodoroRecord (issue #172)', () => {
    const startedAt = local(2026, 9, 9, 9, 0, 0)
    const active: ActivePomodoro = {
        id: 'pomo_1',
        path: 'Work/Task A.md',
        type: 'work',
        startedAt,
        plannedMinutes: 25
    }

    test('a pomodoro that ran its course is completed and clamped to its planned end', () => {
        const record = buildPomodoroRecord(active, startedAt + 27 * 60000)
        expect(record).toEqual({
            id: 'pomo_1',
            taskPath: 'Work/Task A.md',
            startTime: '2026-09-09T09:00:00',
            endTime: '2026-09-09T09:25:00',
            plannedDuration: 25,
            type: 'work',
            completed: true,
            activePeriods: [{ startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:25:00' }]
        })
    })

    test('an early stop is recorded as not completed with its real end', () => {
        const record = buildPomodoroRecord(active, startedAt + 10 * 60000)
        expect(record.completed).toBe(false)
        expect(record.endTime).toBe('2026-09-09T09:10:00')
        expect(record.activePeriods[0]?.endTime).toBe('2026-09-09T09:10:00')
    })

    test('a pomodoro on nothing carries an empty taskPath', () => {
        expect(buildPomodoroRecord({ ...active, path: null }, startedAt + 1).taskPath).toBe('')
    })
})

describe('newPomodoroId (issue #172)', () => {
    test('is prefixed, timestamped, and randomized', () => {
        expect(newPomodoroId(1234, () => 0)).toBe('pomo_1234_0000')
        expect(newPomodoroId(1234, () => 0.5)).toMatch(/^pomo_1234_[0-9a-z]{4,}$/)
    })
})
