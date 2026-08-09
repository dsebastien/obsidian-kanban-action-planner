/**
 * Scroll capture/restore across DOM-teardown re-renders (issue #105, audit
 * theme 2). The full-render paths — `renderBoard`'s `rootEl.empty()` on a
 * structure flip, the calendar/timeline renderers' unconditional teardown,
 * and `applyUniformCardHeight`'s clear→measure→set cycle — destroy or clamp
 * scroll positions the user set. These helpers snapshot every affected
 * scroller BEFORE the mutation and pin the offsets back immediately after,
 * in the same task, so no frame ever paints at scroll 0.
 *
 * Saved offsets are clamped to the scroller's NEW extent on restore (content
 * may have shrunk), and no-op writes are skipped so untouched scrollers never
 * fire scroll events.
 */

/** The minimal scrollable-element surface — real elements satisfy it, specs use fakes. */
export interface ScrollableLike {
    scrollTop: number
    scrollLeft: number
    scrollHeight: number
    scrollWidth: number
    clientHeight: number
    clientWidth: number
}

/** One captured scroll offset pair. */
export interface ScrollPosition {
    top: number
    left: number
}

/** Captured scroll positions keyed by a stable scroller key. */
export type ScrollSnapshot = Map<string, ScrollPosition>

/** Snapshot key of the multi-lane vertical lane-stack scroller (`.kap-lanes`). */
export const LANE_STACK_SCROLL_KEY = 'lanes'

/**
 * Stable snapshot key for one column's card list. Keyed by lane AND column id
 * because the same status column id exists in every lane of a multi-lane
 * board. a NUL escape separates the parts - it cannot appear in the YAML-derived ids.
 */
export function columnScrollKey(laneId: string, columnId: string): string {
    return `${laneId}\u0000${columnId}`
}

/** Clamp a saved scroll offset into a scroller's current scrollable range. */
export function clampScrollOffset(saved: number, scrollSize: number, clientSize: number): number {
    if (saved <= 0) return 0
    return Math.min(saved, Math.max(0, scrollSize - clientSize))
}

/**
 * Write a saved position back onto a scroller, clamped to its current extent.
 * Skips writes that would not change anything (no spurious scroll events).
 */
export function restoreScrollPosition(el: ScrollableLike, saved: ScrollPosition): void {
    const top = clampScrollOffset(saved.top, el.scrollHeight, el.clientHeight)
    const left = clampScrollOffset(saved.left, el.scrollWidth, el.clientWidth)
    if (el.scrollTop !== top) el.scrollTop = top
    if (el.scrollLeft !== left) el.scrollLeft = left
}

/**
 * Snapshot a keyed set of scrollers. Scrollers sitting at the origin are
 * omitted — freshly rendered nodes already start there, so restoring them
 * would be a no-op write per scroller.
 */
export function captureScrollEntries(
    entries: Iterable<readonly [string, ScrollableLike]>
): ScrollSnapshot {
    const snapshot: ScrollSnapshot = new Map()
    for (const [key, el] of entries) {
        if (el.scrollTop === 0 && el.scrollLeft === 0) continue
        snapshot.set(key, { top: el.scrollTop, left: el.scrollLeft })
    }
    return snapshot
}

/** Restore a snapshot onto a keyed set of scrollers; unknown keys are left alone. */
export function restoreScrollEntries(
    entries: Iterable<readonly [string, ScrollableLike]>,
    snapshot: ScrollSnapshot
): void {
    if (snapshot.size === 0) return
    for (const [key, el] of entries) {
        const saved = snapshot.get(key)
        if (saved) restoreScrollPosition(el, saved)
    }
}

/**
 * Enumerate the board's vertical scrollers: the multi-lane lane stack
 * (`.kap-lanes`) plus every column card list (`.kap-column-cards`), keyed so
 * the same scrollers can be found again in a freshly rebuilt DOM.
 */
function* boardScrollers(rootEl: HTMLElement): Generator<readonly [string, HTMLElement]> {
    const lanes = rootEl.querySelector<HTMLElement>(':scope > .kap-lanes')
    if (lanes) yield [LANE_STACK_SCROLL_KEY, lanes]
    for (const list of Array.from(rootEl.querySelectorAll<HTMLElement>('.kap-column-cards'))) {
        const colEl = list.closest<HTMLElement>('.kap-column')
        const columnId = colEl?.dataset['columnId']
        if (!colEl || columnId === undefined) continue
        yield [columnScrollKey(colEl.dataset['laneId'] ?? '', columnId), list]
    }
}

/**
 * Capture per-column and lane-stack vertical scroll before a full board
 * render (structure flip → `rootEl.empty()`), keyed by lane + column id
 * (finding 3.3).
 */
export function captureBoardScroll(rootEl: HTMLElement): ScrollSnapshot {
    return captureScrollEntries(boardScrollers(rootEl))
}

/** Pin the captured column/lane-stack offsets back onto the rebuilt board DOM. */
export function restoreBoardScroll(rootEl: HTMLElement, snapshot: ScrollSnapshot): void {
    restoreScrollEntries(boardScrollers(rootEl), snapshot)
}

/** Sub-pixel tolerance for anchor comparisons (fractional layout offsets). */
const ANCHOR_EPSILON = 0.5

/** One card's position inside its column scroller, measured from the scroller's visible top. */
export interface ScrollAnchorCandidate {
    /** The card's `data-card-key`. */
    key: string
    /** Distance (px) from the scroller's visible top edge; negative = scrolled past. */
    top: number
}

/**
 * Pick the card whose on-screen position must stay put across a reorder that
 * sends `movedKey` far away (Send to top / Send to bottom, issue #78): the
 * first card at or below the scroller's visible top edge that is NOT the moved
 * card. `candidates` must be in DOM order.
 *
 * Anchoring to the TOP of the viewport — rather than following the moved card —
 * is what makes the move feel local: the cards the user is looking at stay
 * where they are and simply close the gap the card left behind. Returns null
 * when there is nothing to anchor to (moved card only, or every other card
 * scrolled above the top edge), in which case the raw scrollTop is kept.
 */
export function pickScrollAnchor(
    candidates: readonly ScrollAnchorCandidate[],
    movedKey: string
): ScrollAnchorCandidate | null {
    for (const candidate of candidates) {
        if (candidate.key === movedKey) continue
        if (candidate.top >= -ANCHOR_EPSILON) return candidate
    }
    return null
}

/**
 * The delta to ADD to a scroller's `scrollTop` to bring an anchor card back to
 * its captured offset. Sub-pixel differences return 0 so an unchanged scroller
 * is never written to.
 */
export function anchorScrollDelta(saved: number, current: number): number {
    const delta = current - saved
    return Math.abs(delta) < ANCHOR_EPSILON ? 0 : delta
}

/** The calendar mode's scrollers: backlog panel list, grid pane, focused-day list (finding 2.1). */
export const CALENDAR_SCROLLER_SELECTORS: readonly string[] = [
    '.kap-panel-list',
    '.kap-calendar',
    '.kap-cal-focus-day'
]

/** The timeline mode's scrollers: undated panel body and the chart row list (finding 2.2). */
export const TIMELINE_SCROLLER_SELECTORS: readonly string[] = ['.kap-tl-panel-body', '.kap-tl-body']

/**
 * Snapshot the first match of each selector under `rootEl`, keyed by the
 * selector itself (the calendar/timeline scrollers are singletons).
 */
export function captureScrollBySelector(
    rootEl: HTMLElement,
    selectors: readonly string[]
): ScrollSnapshot {
    return captureScrollEntries(
        selectors.flatMap((selector) => {
            const el = rootEl.querySelector<HTMLElement>(selector)
            return el ? [[selector, el] as const] : []
        })
    )
}

/**
 * Drop snapshot entries whose scroller now shows DIFFERENT content.
 * `previous`/`next` map a snapshot key to a stable content identity (the
 * calendar keys its backlog list by tab, the grid by anchor + range, the
 * focused-day list by day). Carrying the old content's offset onto a
 * different list would pin the user to a meaningless position — navigation
 * starts at the top, while unchanged panes keep their scroll (issue #105
 * review). Keys absent from `next` are not content-tracked and are kept;
 * a null `previous` (first render) drops every tracked key.
 */
export function pruneStaleContent(
    snapshot: ScrollSnapshot,
    previous: ReadonlyMap<string, string> | null,
    next: ReadonlyMap<string, string>
): void {
    for (const key of [...snapshot.keys()]) {
        const identity = next.get(key)
        if (identity === undefined) continue
        if (previous === null || previous.get(key) !== identity) snapshot.delete(key)
    }
}

/** Restore a selector-keyed snapshot onto the freshly rebuilt DOM under `rootEl`. */
export function restoreScrollBySelector(rootEl: HTMLElement, snapshot: ScrollSnapshot): void {
    for (const [selector, saved] of snapshot) {
        const el = rootEl.querySelector<HTMLElement>(selector)
        if (el) restoreScrollPosition(el, saved)
    }
}
