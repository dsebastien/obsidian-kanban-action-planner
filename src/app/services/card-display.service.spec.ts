import { describe, expect, it } from 'bun:test'
import { computeDueState } from './card-display.service'

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
