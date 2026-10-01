import { test, expect, describe } from 'bun:test'
import { canScroll, edgeScrollStep } from './auto-scroll'

describe('edgeScrollStep', () => {
    test('no step in the middle of the scroller', () => {
        expect(edgeScrollStep(200, 0, 400)).toBe(0)
    })

    test('scrolls backwards near the start edge', () => {
        expect(edgeScrollStep(10, 0, 400)).toBeLessThan(0)
    })

    test('scrolls forwards near the end edge', () => {
        expect(edgeScrollStep(390, 0, 400)).toBeGreaterThan(0)
    })

    test('the step grows towards the edge and peaks at maxStep', () => {
        const far = edgeScrollStep(40, 0, 400, 48, 18)
        const near = edgeScrollStep(5, 0, 400, 48, 18)
        expect(Math.abs(near)).toBeGreaterThan(Math.abs(far))
        expect(edgeScrollStep(0, 0, 400, 48, 18)).toBe(-18)
        expect(edgeScrollStep(400, 0, 400, 48, 18)).toBe(18)
    })

    test('no step outside the scroller', () => {
        expect(edgeScrollStep(-5, 0, 400)).toBe(0)
        expect(edgeScrollStep(405, 0, 400)).toBe(0)
    })

    test('honours an offset start', () => {
        expect(edgeScrollStep(105, 100, 500)).toBeLessThan(0)
        expect(edgeScrollStep(300, 100, 500)).toBe(0)
    })

    test('a tiny scroller splits itself in half', () => {
        expect(edgeScrollStep(10, 0, 40)).toBeLessThan(0)
        expect(edgeScrollStep(30, 0, 40)).toBeGreaterThan(0)
    })

    test('a degenerate scroller never scrolls', () => {
        expect(edgeScrollStep(0, 0, 0)).toBe(0)
    })
})

describe('canScroll', () => {
    test('cannot scroll back from the start', () => {
        expect(canScroll(-5, 0, 1000, 400)).toBe(false)
        expect(canScroll(-5, 10, 1000, 400)).toBe(true)
    })

    test('cannot scroll past the end', () => {
        expect(canScroll(5, 600, 1000, 400)).toBe(false)
        expect(canScroll(5, 500, 1000, 400)).toBe(true)
    })

    test('a zero step never scrolls', () => {
        expect(canScroll(0, 100, 1000, 400)).toBe(false)
    })
})
