/**
 * Edge auto-scroll while dragging a card (issue #194).
 *
 * Holding the dragged card near the edge of a scroller scrolls it: the board
 * sideways (to reach a column off screen, one column at a time on a phone),
 * a column's card list or the lane stack vertically. The step grows as the
 * pointer gets closer to the edge, so a short hold nudges and a hold right at
 * the edge travels fast.
 */

/** Width (px) of the zone along a scroller's edge that triggers scrolling. */
export const EDGE_ZONE_PX = 48
/** Largest scroll step (px per animation frame), reached at the very edge. */
export const MAX_STEP_PX = 18

/**
 * Scroll step along one axis for a pointer at `pos`, inside a scroller whose
 * visible extent is `start`..`end`: negative near the start edge, positive
 * near the end edge, 0 in the middle or outside the scroller. A scroller too
 * small to hold two zones splits itself in half.
 */
export function edgeScrollStep(
    pos: number,
    start: number,
    end: number,
    zone = EDGE_ZONE_PX,
    maxStep = MAX_STEP_PX
): number {
    if (pos < start || pos > end || end <= start) return 0
    const z = Math.min(zone, (end - start) / 2)
    if (z <= 0) return 0
    if (pos < start + z) return -Math.ceil(((start + z - pos) / z) * maxStep)
    if (pos > end - z) return Math.ceil(((pos - (end - z)) / z) * maxStep)
    return 0
}

/**
 * Whether a scroller can still move by `step` along its axis, given its
 * current offset, its scroll extent and its visible size.
 */
export function canScroll(
    step: number,
    offset: number,
    scrollSize: number,
    clientSize: number
): boolean {
    if (step < 0) return offset > 0
    if (step > 0) return offset + clientSize < scrollSize - 1
    return false
}
