import { test, expect, describe } from 'bun:test'
import { insertionLineOffset } from './drop-indicator'

describe('insertionLineOffset', () => {
    test('centers the line in the gap between two neighbors', () => {
        // Gap 100..108 (8px), 2px line → centered at 103.
        expect(insertionLineOffset({ prevEnd: 100, nextStart: 108 }, 2, 8)).toBe(103)
    })

    test('centers a thicker line too', () => {
        // Gap 88..100 (12px), 3px line → (88+100)/2 - 1.5 = 92.5.
        expect(insertionLineOffset({ prevEnd: 88, nextStart: 100 }, 3, 12)).toBe(92.5)
    })

    test('hugs the next item when the slot is first', () => {
        expect(insertionLineOffset({ prevEnd: null, nextStart: 10 }, 2, 8)).toBe(6)
    })

    test('never goes negative at the very start', () => {
        expect(insertionLineOffset({ prevEnd: null, nextStart: 1 }, 2, 8)).toBe(0)
    })

    test('hugs the previous item when the slot is last', () => {
        expect(insertionLineOffset({ prevEnd: 240, nextStart: null }, 2, 8)).toBe(242)
    })

    test('falls back to the container padding for an empty list', () => {
        expect(insertionLineOffset({ prevEnd: null, nextStart: null }, 2, 8)).toBe(8)
    })

    test('overlapping neighbors (zero gap) still clamp at zero', () => {
        expect(insertionLineOffset({ prevEnd: 0, nextStart: 0 }, 2, 8)).toBe(0)
    })
})
