import { test, expect, describe } from 'bun:test'
import {
    LANE_STACK_SCROLL_KEY,
    captureScrollEntries,
    clampScrollOffset,
    columnScrollKey,
    restoreScrollEntries,
    restoreScrollPosition
} from './scroll-preservation'
import type { ScrollableLike } from './scroll-preservation'

/** A fake scroller that records how often its offsets are written. */
interface FakeScroller extends ScrollableLike {
    topWrites: number
    leftWrites: number
}

function makeScroller(overrides: Partial<ScrollableLike> = {}): FakeScroller {
    const state = {
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 1000,
        scrollWidth: 1000,
        clientHeight: 300,
        clientWidth: 300,
        ...overrides
    }
    const fake = {
        topWrites: 0,
        leftWrites: 0,
        scrollHeight: state.scrollHeight,
        scrollWidth: state.scrollWidth,
        clientHeight: state.clientHeight,
        clientWidth: state.clientWidth,
        get scrollTop(): number {
            return state.scrollTop
        },
        set scrollTop(value: number) {
            fake.topWrites++
            state.scrollTop = value
        },
        get scrollLeft(): number {
            return state.scrollLeft
        },
        set scrollLeft(value: number) {
            fake.leftWrites++
            state.scrollLeft = value
        }
    }
    return fake
}

describe('clampScrollOffset', () => {
    test('keeps an in-range offset unchanged', () => {
        expect(clampScrollOffset(250, 1000, 300)).toBe(250)
    })

    test('clamps to the maximum scrollable extent when content shrank', () => {
        expect(clampScrollOffset(900, 1000, 300)).toBe(700)
    })

    test('returns 0 when the content no longer overflows', () => {
        expect(clampScrollOffset(500, 200, 300)).toBe(0)
    })

    test('floors negative saved offsets at 0', () => {
        expect(clampScrollOffset(-10, 1000, 300)).toBe(0)
    })

    test('returns 0 for a zero saved offset', () => {
        expect(clampScrollOffset(0, 1000, 300)).toBe(0)
    })
})

describe('restoreScrollPosition', () => {
    test('restores both axes exactly when in range', () => {
        const el = makeScroller()
        restoreScrollPosition(el, { top: 250, left: 40 })
        expect(el.scrollTop).toBe(250)
        expect(el.scrollLeft).toBe(40)
    })

    test('clamps to the new extent when the rebuilt content is shorter', () => {
        const el = makeScroller({ scrollHeight: 400, clientHeight: 300 })
        restoreScrollPosition(el, { top: 999, left: 0 })
        expect(el.scrollTop).toBe(100)
    })

    test('skips no-op writes (no spurious scroll events)', () => {
        const el = makeScroller({ scrollTop: 250, scrollLeft: 40 })
        restoreScrollPosition(el, { top: 250, left: 40 })
        expect(el.topWrites).toBe(0)
        expect(el.leftWrites).toBe(0)
    })

    test('writes only the axis that changed', () => {
        const el = makeScroller({ scrollTop: 250 })
        restoreScrollPosition(el, { top: 250, left: 60 })
        expect(el.topWrites).toBe(0)
        expect(el.leftWrites).toBe(1)
        expect(el.scrollLeft).toBe(60)
    })
})

describe('columnScrollKey', () => {
    test('same column id in different lanes gets distinct keys', () => {
        expect(columnScrollKey('lane-a', 'todo')).not.toBe(columnScrollKey('lane-b', 'todo'))
    })

    test('the lane/column split is unambiguous even with spaces in ids', () => {
        expect(columnScrollKey('a b', 'c')).not.toBe(columnScrollKey('a', 'b c'))
    })

    test('never collides with the lane-stack key', () => {
        expect(columnScrollKey('', LANE_STACK_SCROLL_KEY)).not.toBe(LANE_STACK_SCROLL_KEY)
    })
})

describe('captureScrollEntries', () => {
    test('captures scrolled entries with their keys', () => {
        const a = makeScroller({ scrollTop: 120 })
        const b = makeScroller({ scrollLeft: 55 })
        const snapshot = captureScrollEntries([
            ['a', a],
            ['b', b]
        ])
        expect(snapshot.get('a')).toEqual({ top: 120, left: 0 })
        expect(snapshot.get('b')).toEqual({ top: 0, left: 55 })
    })

    test('omits scrollers sitting at the origin', () => {
        const snapshot = captureScrollEntries([['a', makeScroller()]])
        expect(snapshot.size).toBe(0)
    })
})

describe('restoreScrollEntries', () => {
    test('restores matching keys and leaves unknown scrollers alone', () => {
        const kept = makeScroller()
        const fresh = makeScroller()
        const snapshot = captureScrollEntries([['kept', makeScroller({ scrollTop: 200 })]])
        restoreScrollEntries(
            [
                ['kept', kept],
                ['fresh', fresh]
            ],
            snapshot
        )
        expect(kept.scrollTop).toBe(200)
        expect(fresh.topWrites).toBe(0)
        expect(fresh.leftWrites).toBe(0)
    })

    test('an empty snapshot never touches any scroller', () => {
        const el = makeScroller({ scrollTop: 10 })
        restoreScrollEntries([['a', el]], new Map())
        expect(el.topWrites).toBe(0)
        expect(el.scrollTop).toBe(10)
    })
})
