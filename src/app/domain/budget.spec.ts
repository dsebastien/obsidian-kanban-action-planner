import { describe, expect, test } from 'bun:test'
import {
    alarmNoticeDue,
    budgetRing,
    formatBudgetMinutes,
    isoWeekKey,
    isoWeekRange,
    isoWeekStart
} from './budget'

describe('budgetRing (issue #172, phase C)', () => {
    test('under, on, over against the target', () => {
        expect(budgetRing({ target: 240, planned: 240, tracked: 60, alarm: null }).tone).toBe(
            'under'
        )
        expect(budgetRing({ target: 240, planned: 240, tracked: 216, alarm: null }).tone).toBe('on')
        expect(budgetRing({ target: 240, planned: 240, tracked: 240, alarm: null }).tone).toBe('on')
        expect(budgetRing({ target: 240, planned: 240, tracked: 241, alarm: null }).tone).toBe(
            'over'
        )
    })

    test('the alarm wins over every other tone', () => {
        const ring = budgetRing({ target: 240, planned: 240, tracked: 400, alarm: 360 })
        expect(ring.tone).toBe('alarm')
        expect(ring.detail).toContain('Over the alarm')
    })

    test('the arc ratio is tracked / target, clamped to 1', () => {
        expect(budgetRing({ target: 200, planned: null, tracked: 50, alarm: null }).ratio).toBe(
            0.25
        )
        expect(budgetRing({ target: 200, planned: null, tracked: 500, alarm: null }).ratio).toBe(1)
    })

    test('without a target the ring is a plain count', () => {
        const ring = budgetRing({ target: null, planned: 120, tracked: 90, alarm: null })
        expect(ring.tone).toBe('none')
        expect(ring.ratio).toBeNull()
        expect(ring.label).toBe('1h 30m')
        expect(ring.detail).toContain('No weekly target')
    })

    test('a zero target counts as none', () => {
        expect(budgetRing({ target: 0, planned: null, tracked: 30, alarm: null }).tone).toBe('none')
    })

    test('labels', () => {
        expect(budgetRing({ target: 240, planned: null, tracked: 90, alarm: null }).label).toBe(
            '1h 30m / 4h'
        )
        expect(budgetRing({ target: null, planned: null, tracked: 0, alarm: null }).label).toBe('–')
        expect(budgetRing({ target: null, planned: 60, tracked: 0, alarm: null }).label).toBe('0m')
    })

    test('the detail names planned and alarm when present', () => {
        const ring = budgetRing({ target: 240, planned: 180, tracked: 60, alarm: 300 })
        expect(ring.detail).toBe(
            'Tracked this week: 1h · Target: 4h · Planned: 3h · Alarm above: 5h'
        )
    })
})

describe('formatBudgetMinutes', () => {
    test('formats hours and minutes', () => {
        expect(formatBudgetMinutes(0)).toBe('0m')
        expect(formatBudgetMinutes(45)).toBe('45m')
        expect(formatBudgetMinutes(60)).toBe('1h')
        expect(formatBudgetMinutes(90)).toBe('1h 30m')
        expect(formatBudgetMinutes(-5)).toBe('0m')
    })
})

describe('ISO week helpers', () => {
    test('the week starts on the local Monday', () => {
        expect(isoWeekStart(new Date(2026, 8, 9, 13, 0))).toEqual(new Date(2026, 8, 7))
        expect(isoWeekStart(new Date(2026, 8, 7, 0, 0))).toEqual(new Date(2026, 8, 7))
        expect(isoWeekStart(new Date(2026, 8, 13, 23, 59))).toEqual(new Date(2026, 8, 7))
    })

    test('the range ends on the next Monday, exclusive', () => {
        const { start, end } = isoWeekRange(new Date(2026, 8, 9))
        expect(start).toEqual(new Date(2026, 8, 7))
        expect(end).toEqual(new Date(2026, 8, 14))
    })

    test('the key uses the ISO week-based year', () => {
        expect(isoWeekKey(new Date(2026, 8, 9))).toBe('2026-W37')
        expect(isoWeekKey(new Date(2027, 0, 1))).toBe('2026-W53')
        expect(isoWeekKey(new Date(2025, 11, 29))).toBe('2026-W01')
    })
})

describe('alarmNoticeDue', () => {
    test('fires once per note per week and prunes past weeks', () => {
        const first = alarmNoticeDue({}, 'a.md', '2026-W37')
        expect(first.due).toBe(true)
        expect(first.memo).toEqual({ 'a.md': '2026-W37' })
        const again = alarmNoticeDue(first.memo, 'a.md', '2026-W37')
        expect(again.due).toBe(false)
        const other = alarmNoticeDue(again.memo, 'b.md', '2026-W37')
        expect(other.due).toBe(true)
        expect(other.memo).toEqual({ 'a.md': '2026-W37', 'b.md': '2026-W37' })
        const nextWeek = alarmNoticeDue(other.memo, 'a.md', '2026-W38')
        expect(nextWeek.due).toBe(true)
        expect(nextWeek.memo).toEqual({ 'a.md': '2026-W38' })
    })
})
