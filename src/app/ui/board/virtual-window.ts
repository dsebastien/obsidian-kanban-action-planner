/**
 * Column virtualization math (issue #111). Pure, DOM-free.
 *
 * A long column keeps only the cards in or near its visible area in the DOM;
 * two spacers stand in for the cards above and below, so the scrollbar and
 * the scroll position behave as if every card were there. Cards share ONE
 * height board-wide (Business Rule 8a), so a column is a fixed-pitch list:
 * card `i` sits at `padTop + i * pitch`, where `pitch = cardHeight + gap`.
 * That makes every position exact: no per-card height estimates, no drift.
 *
 * Layout of a virtual card list (a flex column with `gap`):
 *
 *     padding-top
 *     [top spacer]      (hidden when no card is above the window)
 *     card start … card end-1
 *     [bottom spacer]   (hidden when no card is below the window)
 *     padding-bottom
 *
 * A visible spacer is followed (or preceded) by one flex gap, so it is one
 * gap shorter than the cards it replaces: see {@link spacerHeights}.
 */

/** A column virtualizes only from this many cards: smaller columns render every card, as before. */
export const VIRTUALIZE_MIN_CARDS = 100

/** How far (px) beyond a column's visible area cards stay mounted, on each side. */
export const OVERSCAN_PX = 800

/** Card height (px) assumed before the board has measured one (the stylesheet's 2.75rem floor). */
export const FALLBACK_CARD_HEIGHT_PX = 44

/** A half-open index range `[start, end)` of a column's cards. */
export interface IndexRange {
    start: number
    end: number
}

/** The geometry of a virtual column at one moment. */
export interface ColumnGeometry {
    /** Number of cards in the column (model, not DOM). */
    count: number
    /** The uniform card height (px). */
    cardHeight: number
    /** The flex gap between cards (px). */
    gap: number
    /** The card list's top padding (px). */
    padTop: number
    /** The card list's current `scrollTop`. */
    scrollTop: number
    /** The card list's visible height (`clientHeight`). */
    viewportHeight: number
}

/** Whether a column of `count` cards is virtualized. */
export function shouldVirtualize(count: number, threshold = VIRTUALIZE_MIN_CARDS): boolean {
    return count >= threshold
}

/** Distance (px) from one card's top to the next card's top. */
export function cardPitch(cardHeight: number, gap: number): number {
    return Math.max(1, cardHeight + gap)
}

/** Total height (px) of `count` cards and the gaps between them (no padding). */
export function cardsExtent(count: number, cardHeight: number, gap: number): number {
    return count > 0 ? count * cardPitch(cardHeight, gap) - gap : 0
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n))
}

/**
 * The scroll offset the list will really have: a `scrollTop` saved against a
 * longer list is clamped by the browser to the new extent (content shrank:
 * filtering, a move out), so the window is computed against that.
 */
export function effectiveScrollTop(g: ColumnGeometry, padBottom = g.padTop): number {
    const content = g.padTop + cardsExtent(g.count, g.cardHeight, g.gap) + padBottom
    return clamp(g.scrollTop, 0, Math.max(0, content - g.viewportHeight))
}

/**
 * The cards intersecting `[top, bottom)` in the list's content coordinates.
 * Empty (`start === end`) when the range holds no card.
 */
export function rangeBetween(g: ColumnGeometry, top: number, bottom: number): IndexRange {
    if (g.count <= 0 || bottom <= top) return { start: 0, end: 0 }
    const pitch = cardPitch(g.cardHeight, g.gap)
    // First card whose bottom edge is below `top`.
    const start = clamp(Math.floor((top - g.padTop - g.cardHeight) / pitch) + 1, 0, g.count)
    // First card whose top edge is at or below `bottom`.
    const end = clamp(Math.ceil((bottom - g.padTop) / pitch), start, g.count)
    return { start, end }
}

/** The cards currently visible in the list's viewport. */
export function visibleRange(g: ColumnGeometry): IndexRange {
    const top = effectiveScrollTop(g)
    return rangeBetween(g, top, top + g.viewportHeight)
}

/** The cards to mount: the visible ones plus `overscan` px of cards on each side. */
export function windowRange(g: ColumnGeometry, overscan = OVERSCAN_PX): IndexRange {
    if (g.viewportHeight <= 0) return { start: 0, end: 0 }
    const top = effectiveScrollTop(g)
    return rangeBetween(g, top - overscan, top + g.viewportHeight + overscan)
}

/**
 * The window to mount next, given the mounted one. The mounted window is kept
 * while it still covers every visible card with `margin` px to spare, so a
 * scroll does not touch the DOM on every frame: it remounts (a full overscan
 * window) only once the visible area nears the window's edge.
 */
export function nextWindow(
    current: IndexRange | null,
    g: ColumnGeometry,
    overscan = OVERSCAN_PX,
    margin = overscan / 4
): IndexRange {
    const wanted = windowRange(g, overscan)
    if (current === null || g.viewportHeight <= 0) return wanted
    if (current.end > g.count) return wanted
    const top = effectiveScrollTop(g)
    const needed = rangeBetween(g, top - margin, top + g.viewportHeight + margin)
    const covered =
        needed.start === needed.end || (needed.start >= current.start && needed.end <= current.end)
    return covered ? current : wanted
}

/**
 * Heights (px) of the top and bottom spacers for a mounted window, or 0 when
 * the spacer is hidden (no card on that side). With the spacers, the list's
 * content height equals the fully rendered one exactly.
 */
export function spacerHeights(
    count: number,
    range: IndexRange,
    cardHeight: number,
    gap: number
): { top: number; bottom: number } {
    const start = clamp(range.start, 0, count)
    const end = clamp(range.end, start, count)
    const pitch = cardPitch(cardHeight, gap)
    return {
        top: start > 0 ? start * pitch - gap : 0,
        bottom: end < count ? (count - end) * pitch - gap : 0
    }
}

/** The top offset (px, list content coordinates) of card `index`. */
export function cardTop(index: number, cardHeight: number, gap: number, padTop: number): number {
    return padTop + index * cardPitch(cardHeight, gap)
}

/**
 * A scroll position expressed as "card `index`, `offset` px into it" (negative
 * in the list's top padding, above card 0).
 */
export interface ScrollAnchor {
    index: number
    offset: number
}

/**
 * Express a scroll position as the card at the top of the viewport and how
 * far into it the viewport starts, so the same card can be kept in place
 * when the card height changes (see {@link anchoredScrollTop}).
 */
export function scrollAnchor(
    scrollTop: number,
    cardHeight: number,
    gap: number,
    padTop: number
): ScrollAnchor {
    const pitch = cardPitch(cardHeight, gap)
    const index = Math.max(0, Math.floor((scrollTop - padTop) / pitch))
    return { index, offset: scrollTop - cardTop(index, cardHeight, gap, padTop) }
}

/**
 * The `scrollTop` that puts an anchor's card back at the top of the viewport
 * under a new card height. The offset into the card is kept, capped to the
 * new card height, so a card that grew or shrank stays where the user was
 * looking instead of the whole column sliding by `index × Δheight`.
 */
export function anchoredScrollTop(
    anchor: ScrollAnchor,
    cardHeight: number,
    gap: number,
    padTop: number
): number {
    const offset = Math.min(anchor.offset, cardHeight + gap)
    return Math.max(0, cardTop(anchor.index, cardHeight, gap, padTop) + offset)
}

/**
 * The `scrollTop` that brings card `index` fully into view with the least
 * movement (like `scrollIntoView({ block: 'nearest' })`), or null when it is
 * already fully visible.
 */
export function revealScrollTop(index: number, g: ColumnGeometry): number | null {
    const top = cardTop(index, g.cardHeight, g.gap, g.padTop)
    const bottom = top + g.cardHeight
    const viewTop = g.scrollTop
    const viewBottom = g.scrollTop + g.viewportHeight
    if (top >= viewTop && bottom <= viewBottom) return null
    if (top < viewTop || g.cardHeight + 2 * g.padTop > g.viewportHeight) {
        return Math.max(0, top - g.padTop)
    }
    return Math.max(0, bottom + g.padTop - g.viewportHeight)
}

/** Where a dragged card would land in a virtual column, and the insertion line's neighbors. */
export interface DropSlot {
    /** Insertion index among the column's cards, the dragged card excluded. */
    index: number
    /** Bottom edge of the card just above the slot (content coordinates), or null. */
    prevEnd: number | null
    /** Top edge of the card just below the slot (content coordinates), or null. */
    nextStart: number | null
}

/**
 * The drop slot for a pointer at `y` (list content coordinates), matching the
 * fully rendered board's hit test: the slot is before the first card (dragged
 * card skipped) whose vertical middle is below the pointer. `draggedIndex` is
 * the dragged card's index in THIS column, or -1 when it comes from elsewhere;
 * the dragged card keeps its slot on screen while it is dragged, so the
 * geometry of the others does not move.
 */
export function dropSlot(
    g: Pick<ColumnGeometry, 'count' | 'cardHeight' | 'gap' | 'padTop'>,
    y: number,
    draggedIndex: number
): DropSlot {
    const { count, cardHeight, gap, padTop } = g
    const pitch = cardPitch(cardHeight, gap)
    // Number of cards (dragged one included) whose middle is at or above y.
    const above = clamp(Math.floor((y - padTop - cardHeight / 2) / pitch) + 1, 0, count)
    const draggedAbove = draggedIndex >= 0 && draggedIndex < above ? 1 : 0
    const index = above - draggedAbove
    // Neighbors in full-list indices, skipping the dragged card.
    let prev = above - 1
    if (prev === draggedIndex) prev--
    let next = above
    if (next === draggedIndex) next++
    return {
        index,
        prevEnd: prev >= 0 ? cardTop(prev, cardHeight, gap, padTop) + cardHeight : null,
        nextStart: next < count ? cardTop(next, cardHeight, gap, padTop) : null
    }
}

/** What a card shows that can make it taller, for picking measurement probes. */
export interface CardHeightFeatures {
    /** Title length in characters (titles wrap up to three lines). */
    titleLength: number
    /** Whether the card shows a cover (a full cover box, or the compact thumbnail). */
    hasCover: boolean
    /** Rows below the title: field chips, budget, countdown chip/footer, relationship badges. */
    bodyRows: number
    /** Total characters across the card's field chips (long values wrap). */
    bodyLength: number
}

/**
 * The cards worth measuring when a virtual column cannot measure all of its
 * cards: the top `perFeature` cards by each feature that drives a card's
 * natural height (longest titles; most and longest body rows; longest titles
 * among covered cards). Cards outside the mounted window are never in the
 * DOM, so the board-wide uniform height is the max over the mounted cards,
 * these probes, and the heights already measured (the height cache). Returns
 * ascending, de-duplicated indices.
 */
export function pickProbeIndices(
    features: readonly CardHeightFeatures[],
    perFeature: number
): number[] {
    if (perFeature <= 0 || features.length === 0) return []
    const picked = new Set<number>()
    const take = (score: (f: CardHeightFeatures) => number): void => {
        const ranked = features
            .map((f, i) => ({ i, s: score(f) }))
            .sort((a, b) => b.s - a.s || a.i - b.i)
        for (const r of ranked.slice(0, perFeature)) picked.add(r.i)
    }
    take((f) => f.titleLength)
    take((f) => f.bodyRows * 1000 + f.bodyLength)
    take((f) => (f.hasCover ? 1_000_000 : 0) + f.titleLength)
    return [...picked].sort((a, b) => a - b)
}

/** The tallest of `heights` (0 when empty). */
export function maxHeight(heights: Iterable<number>): number {
    let max = 0
    for (const h of heights) if (h > max) max = h
    return max
}
