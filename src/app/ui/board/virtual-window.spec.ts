import { describe, expect, test } from 'bun:test'
import {
    anchoredScrollTop,
    cardTop,
    cardsExtent,
    dropSlot,
    effectiveScrollTop,
    maxHeight,
    nextWindow,
    pickProbeIndices,
    revealScrollTop,
    scrollAnchor,
    shouldVirtualize,
    spacerHeights,
    visibleRange,
    VIRTUALIZE_MIN_CARDS,
    windowRange
} from './virtual-window'
import type { CardHeightFeatures, ColumnGeometry } from './virtual-window'

/** 1,000 cards of 76px with an 8px gap (pitch 84) and 8px padding, viewport 400px. */
function geometry(overrides: Partial<ColumnGeometry> = {}): ColumnGeometry {
    return {
        count: 1000,
        cardHeight: 76,
        gap: 8,
        padTop: 8,
        scrollTop: 0,
        viewportHeight: 400,
        ...overrides
    }
}

describe('shouldVirtualize', () => {
    test('small columns render every card, as before', () => {
        expect(shouldVirtualize(0)).toBe(false)
        expect(shouldVirtualize(VIRTUALIZE_MIN_CARDS - 1)).toBe(false)
    })

    test('long columns virtualize from the threshold on', () => {
        expect(shouldVirtualize(VIRTUALIZE_MIN_CARDS)).toBe(true)
        expect(shouldVirtualize(4888)).toBe(true)
        expect(shouldVirtualize(10, 5)).toBe(true)
    })
})

describe('cardsExtent / cardTop', () => {
    test('n cards take n heights and n-1 gaps', () => {
        expect(cardsExtent(0, 76, 8)).toBe(0)
        expect(cardsExtent(1, 76, 8)).toBe(76)
        expect(cardsExtent(3, 76, 8)).toBe(3 * 76 + 2 * 8)
    })

    test('card i sits at padding + i pitches', () => {
        expect(cardTop(0, 76, 8, 8)).toBe(8)
        expect(cardTop(10, 76, 8, 8)).toBe(8 + 840)
    })
})

describe('visibleRange', () => {
    test('at the top: the cards intersecting the viewport', () => {
        // Cards 0..4 start at 8, 92, 176, 260, 344; card 5 starts at 428 > 400.
        expect(visibleRange(geometry())).toEqual({ start: 0, end: 5 })
    })

    test('a card scrolled half out is still visible; a card fully above is not', () => {
        // scrollTop 100: card 0 ends at 84 (hidden), card 1 ends at 168 (visible).
        expect(visibleRange(geometry({ scrollTop: 100 }))).toEqual({ start: 1, end: 6 })
    })

    test('a scroll offset past the end is clamped to the real extent', () => {
        const g = geometry({ count: 20, scrollTop: 1e9 })
        const range = visibleRange(g)
        expect(range.end).toBe(20)
        expect(range.start).toBeGreaterThan(14)
    })

    test('an empty column has nothing visible', () => {
        expect(visibleRange(geometry({ count: 0 }))).toEqual({ start: 0, end: 0 })
    })
})

describe('effectiveScrollTop', () => {
    test('keeps an offset inside the extent', () => {
        expect(effectiveScrollTop(geometry({ scrollTop: 5000 }))).toBe(5000)
    })

    test('clamps to content height minus viewport', () => {
        // 10 cards: 8 + 10*84 - 8 + 8 = 848 content, 400 viewport.
        expect(effectiveScrollTop(geometry({ count: 10, scrollTop: 9999 }))).toBe(448)
        expect(effectiveScrollTop(geometry({ count: 2, scrollTop: 9999 }))).toBe(0)
    })
})

describe('windowRange (overscan)', () => {
    test('extends the visible range by the overscan on both sides, clamped', () => {
        expect(windowRange(geometry(), 168)).toEqual({ start: 0, end: 7 })
        const mid = windowRange(geometry({ scrollTop: 8400 }), 168)
        const visible = visibleRange(geometry({ scrollTop: 8400 }))
        expect(mid.start).toBe(visible.start - 2)
        expect(mid.end).toBe(visible.end + 2)
    })

    test('never runs past the last card', () => {
        expect(windowRange(geometry({ count: 30, scrollTop: 1e9 }), 800).end).toBe(30)
    })

    test('a hidden list (no viewport: collapsed, hidden leaf) mounts nothing', () => {
        expect(windowRange(geometry({ viewportHeight: 0 }), 800)).toEqual({ start: 0, end: 0 })
    })
})

describe('nextWindow (hysteresis)', () => {
    test('first window: the overscanned range', () => {
        expect(nextWindow(null, geometry(), 800, 200)).toEqual(windowRange(geometry(), 800))
    })

    test('keeps the mounted window while the view stays well inside it', () => {
        const current = nextWindow(null, geometry({ scrollTop: 8400 }), 800, 200)
        const after = nextWindow(current, geometry({ scrollTop: 8400 + 300 }), 800, 200)
        expect(after).toBe(current)
    })

    test('remounts once the view nears the window edge', () => {
        const current = nextWindow(null, geometry({ scrollTop: 8400 }), 800, 200)
        const after = nextWindow(current, geometry({ scrollTop: 8400 + 700 }), 800, 200)
        expect(after).not.toBe(current)
        expect(after).toEqual(windowRange(geometry({ scrollTop: 9100 }), 800))
    })

    test('remounts when the column shrank below the mounted window', () => {
        const current = { start: 0, end: 30 }
        expect(nextWindow(current, geometry({ count: 12 }), 800, 200).end).toBe(12)
    })
})

describe('spacerHeights', () => {
    test('the spacers plus the mounted cards add up to the full content height', () => {
        const count = 1000
        const range = { start: 100, end: 130 }
        const { top, bottom } = spacerHeights(count, range, 76, 8)
        const mounted = cardsExtent(range.end - range.start, 76, 8)
        // A shown spacer is followed / preceded by one flex gap.
        expect(top + 8 + mounted + 8 + bottom).toBe(cardsExtent(count, 76, 8))
    })

    test('the first mounted card lands exactly where the full render puts it', () => {
        const { top } = spacerHeights(1000, { start: 100, end: 130 }, 76, 8)
        expect(8 + top + 8).toBe(cardTop(100, 76, 8, 8))
    })

    test('a side with no hidden card has no spacer', () => {
        expect(spacerHeights(1000, { start: 0, end: 20 }, 76, 8).top).toBe(0)
        expect(spacerHeights(1000, { start: 980, end: 1000 }, 76, 8).bottom).toBe(0)
    })

    test('nothing mounted: the spacers alone hold the full height', () => {
        const { top, bottom } = spacerHeights(1000, { start: 500, end: 500 }, 76, 8)
        expect(top + 8 + bottom).toBe(cardsExtent(1000, 76, 8))
        const none = spacerHeights(1000, { start: 0, end: 0 }, 76, 8)
        expect(none.top).toBe(0)
        expect(none.bottom).toBe(cardsExtent(1000, 76, 8))
    })

    test('out-of-range windows are clamped', () => {
        expect(spacerHeights(10, { start: -5, end: 99 }, 76, 8)).toEqual({ top: 0, bottom: 0 })
    })
})

describe('scroll anchoring across a card-height change', () => {
    test('anchor = card at the top of the viewport and the offset into it', () => {
        expect(scrollAnchor(0, 76, 8, 8)).toEqual({ index: 0, offset: -8 })
        expect(scrollAnchor(cardTop(250, 76, 8, 8) + 30, 76, 8, 8)).toEqual({
            index: 250,
            offset: 30
        })
    })

    test('the same card stays at the top when every card grows', () => {
        const before = cardTop(250, 76, 8, 8) + 30
        const anchor = scrollAnchor(before, 76, 8, 8)
        const after = anchoredScrollTop(anchor, 90, 8, 8)
        expect(after).toBe(cardTop(250, 90, 8, 8) + 30)
        // Without anchoring the view would land 250 × 14px further up the list.
        expect(after - before).toBe(250 * 14)
    })

    test('the offset is capped when the card shrinks below it', () => {
        const anchor = { index: 40, offset: 80 }
        expect(anchoredScrollTop(anchor, 50, 8, 8)).toBe(cardTop(40, 50, 8, 8) + 58)
    })

    test('the top of the list stays the top', () => {
        expect(anchoredScrollTop(scrollAnchor(0, 76, 8, 8), 120, 8, 8)).toBe(0)
    })

    test('round-trips when the height does not change', () => {
        for (const top of [0, 5, 84, 999, 50_000]) {
            expect(anchoredScrollTop(scrollAnchor(top, 76, 8, 8), 76, 8, 8)).toBe(top)
        }
    })
})

describe('revealScrollTop', () => {
    test('null when the card is already fully visible', () => {
        expect(revealScrollTop(1, geometry())).toBeNull()
    })

    test('scrolls down just enough to show a card below the view', () => {
        const g = geometry()
        const st = revealScrollTop(500, g)
        expect(st).not.toBeNull()
        const top = cardTop(500, 76, 8, 8)
        expect(top).toBeGreaterThanOrEqual(st ?? 0)
        expect(top + 76).toBeLessThanOrEqual((st ?? 0) + g.viewportHeight)
        // Bottom-aligned (nearest), with the list padding below it.
        expect((st ?? 0) + g.viewportHeight).toBe(top + 76 + 8)
    })

    test('scrolls up to show a card above the view', () => {
        const st = revealScrollTop(3, geometry({ scrollTop: 40_000 }))
        expect(st).toBe(cardTop(3, 76, 8, 8) - 8)
    })
})

describe('dropSlot', () => {
    const g = { count: 1000, cardHeight: 76, gap: 8, padTop: 8 }

    test('above a card middle inserts before it', () => {
        // Card 10: top 848, middle 886.
        expect(dropSlot(g, 870, -1).index).toBe(10)
        expect(dropSlot(g, 900, -1).index).toBe(11)
    })

    test('before the first card and after the last', () => {
        expect(dropSlot(g, 0, -1)).toEqual({ index: 0, prevEnd: null, nextStart: 8 })
        const last = dropSlot(g, 1e9, -1)
        expect(last.index).toBe(1000)
        expect(last.nextStart).toBeNull()
        expect(last.prevEnd).toBe(cardTop(999, 76, 8, 8) + 76)
    })

    test('neighbors are the cards around the slot', () => {
        expect(dropSlot(g, 870, -1)).toEqual({
            index: 10,
            prevEnd: cardTop(9, 76, 8, 8) + 76,
            nextStart: cardTop(10, 76, 8, 8)
        })
    })

    test('the dragged card is skipped, like the full render excludes it', () => {
        // Dragging card 5 down over card 10's upper half: 9 other cards above.
        const slot = dropSlot(g, 870, 5)
        expect(slot.index).toBe(9)
        // Dragging card 10 itself: its neighbors are 9 and 11.
        const self = dropSlot(g, 900, 10)
        expect(self.index).toBe(10)
        expect(self.prevEnd).toBe(cardTop(9, 76, 8, 8) + 76)
        expect(self.nextStart).toBe(cardTop(11, 76, 8, 8))
    })

    test('a dragged card below the slot does not shift the index', () => {
        expect(dropSlot(g, 870, 50).index).toBe(10)
    })

    test('an empty column', () => {
        expect(dropSlot({ ...g, count: 0 }, 100, -1)).toEqual({
            index: 0,
            prevEnd: null,
            nextStart: null
        })
    })
})

describe('pickProbeIndices (height cache probes)', () => {
    const base: CardHeightFeatures = {
        titleLength: 10,
        hasCover: false,
        bodyRows: 0,
        bodyLength: 0
    }
    const features: CardHeightFeatures[] = [
        base,
        { ...base, titleLength: 120 },
        { ...base, bodyRows: 4, bodyLength: 30 },
        { ...base, hasCover: true },
        base,
        { ...base, titleLength: 80 }
    ]

    test('picks the longest titles, the richest bodies and covered cards', () => {
        const picked = pickProbeIndices(features, 1)
        expect(picked).toContain(1)
        expect(picked).toContain(2)
        expect(picked).toContain(3)
    })

    test('ascending and de-duplicated', () => {
        const picked = pickProbeIndices(features, 3)
        expect(picked).toEqual([...new Set(picked)].sort((a, b) => a - b))
        expect(picked.length).toBeLessThanOrEqual(features.length)
    })

    test('nothing to pick', () => {
        expect(pickProbeIndices([], 8)).toEqual([])
        expect(pickProbeIndices(features, 0)).toEqual([])
    })
})

describe('maxHeight', () => {
    test('the tallest, 0 when empty', () => {
        expect(maxHeight([76, 90, 12])).toBe(90)
        expect(maxHeight([])).toBe(0)
    })
})
