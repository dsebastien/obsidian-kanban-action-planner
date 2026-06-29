import { describe, expect, it } from 'bun:test'
import { computeDueState, parseProgressField } from './card-display.service'

const TODAY = new Date(2026, 5, 28)

describe('computeDueState (issue #22)', () => {
    it('is "none" with no due date', () => {
        expect(computeDueState(null, TODAY)).toBe('none')
    })

    it('is "overdue" strictly before today', () => {
        expect(computeDueState(new Date(2026, 5, 27), TODAY)).toBe('overdue')
        expect(computeDueState(new Date(2026, 4, 1), TODAY)).toBe('overdue')
    })

    it('is "today" on the same day (ignores time of day)', () => {
        expect(computeDueState(new Date(2026, 5, 28), TODAY)).toBe('today')
        expect(computeDueState(new Date(2026, 5, 28, 23, 59), TODAY)).toBe('today')
    })

    it('is "none" in the future', () => {
        expect(computeDueState(new Date(2026, 5, 29), TODAY)).toBe('none')
    })
})

describe('parseProgressField', () => {
    it('detects percentage-like labels and clamps to 0–100', () => {
        expect(parseProgressField('Progress %', '0')).toBe(0)
        expect(parseProgressField('Progress %', '45')).toBe(45)
        expect(parseProgressField('Progress', '100')).toBe(100)
        expect(parseProgressField('Progress %', '45%')).toBe(45)
        expect(parseProgressField('Progress %', '150')).toBe(100)
        expect(parseProgressField('Progress %', '-10')).toBe(0)
    })

    it('returns null when the label is not progress/percentage', () => {
        expect(parseProgressField('Priority Score', '13')).toBeNull()
        expect(parseProgressField('Urgency', '20 - Soon')).toBeNull()
        expect(parseProgressField(null, '50')).toBeNull()
    })

    it('returns null when the value is not numeric', () => {
        expect(parseProgressField('Progress %', 'n/a')).toBeNull()
        expect(parseProgressField('Progress %', '')).toBeNull()
    })
})
