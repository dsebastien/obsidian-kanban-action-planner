import { test, expect, describe } from 'bun:test'
import {
    BAR_HANDLES_MIN_PX,
    BAR_HANDLES_MIN_PX_MOBILE,
    barHandlesMinPx,
    timelineWidthGatesCrossed
} from './width-gates'

describe('timelineWidthGatesCrossed', () => {
    test('unchanged width never re-renders', () => {
        expect(timelineWidthGatesCrossed([10, 50], 800, 800)).toBe(false)
    })

    test('a width change that keeps every bar on the same side of both gates is a no-op', () => {
        // 10% of 800 = 80px, of 790 = 79px — both far above 32.
        expect(timelineWidthGatesCrossed([10], 800, 790)).toBe(false)
    })

    test('a bar crossing the 24px handle gate re-renders', () => {
        // 3% of 800 = 24px (handles on), of 790 = 23.7px (handles off).
        expect(timelineWidthGatesCrossed([3], 800, 790)).toBe(true)
    })

    test('a bar crossing the 32px duration-tag gate re-renders', () => {
        // 4% of 810 = 32.4px (tag on), of 790 = 31.6px (tag off).
        expect(timelineWidthGatesCrossed([4], 810, 790)).toBe(true)
    })

    test('rendered while hidden (width 0): any real width with bars re-renders', () => {
        expect(timelineWidthGatesCrossed([50], 0, 600)).toBe(true)
    })

    test('no bars at all: width changes never re-render', () => {
        expect(timelineWidthGatesCrossed([], 400, 900)).toBe(false)
    })

    test('tiny bars that stay under both gates at both widths are a no-op', () => {
        // 1% of 800 = 8px, of 1200 = 12px — both below 24.
        expect(timelineWidthGatesCrossed([1], 800, 1200)).toBe(false)
    })
})

describe('barHandlesMinPx', () => {
    test('desktop keeps the 24px gate', () => {
        expect(barHandlesMinPx(false)).toBe(BAR_HANDLES_MIN_PX)
    })

    test('mobile needs a wider bar for its finger-sized handles', () => {
        expect(barHandlesMinPx(true)).toBe(BAR_HANDLES_MIN_PX_MOBILE)
        expect(BAR_HANDLES_MIN_PX_MOBILE).toBeGreaterThan(BAR_HANDLES_MIN_PX)
    })

    test('a bar crossing the mobile gate re-renders', () => {
        // 7% of 800 = 56px (handles on), of 790 = 55.3px (handles off).
        expect(timelineWidthGatesCrossed([7], 800, 790)).toBe(true)
    })
})
