/**
 * Non-displacing drop-indicator geometry (issue #105, finding 5.7).
 *
 * The card drag placeholder and the column drop indicator are absolutely
 * positioned overlays (the calendar's `.kap-cal-drop` outline is the same
 * non-displacing idea): they mark an insertion slot WITHOUT joining the flex
 * flow, so repositioning them never shifts cards or re-widths columns. This
 * module computes where the line goes, in the scroller's content coordinates
 * (the same space as `offsetTop`/`offsetLeft` of the items).
 */

/** The rendered edges of the items around an insertion slot (content coords). */
export interface InsertionNeighbors {
    /** End edge (bottom/right) of the item just before the slot, or null when the slot is first. */
    prevEnd: number | null
    /** Start edge (top/left) of the item just after the slot, or null when the slot is last. */
    nextStart: number | null
}

/**
 * Offset of an insertion line of `thickness` px along the main axis:
 * centered in the gap between the two neighbors, hugging the single neighbor
 * when the slot is at either end, or `fallback` (the container padding) when
 * the list is empty. Never negative.
 */
export function insertionLineOffset(
    neighbors: InsertionNeighbors,
    thickness: number,
    fallback: number
): number {
    const { prevEnd, nextStart } = neighbors
    if (prevEnd !== null && nextStart !== null) {
        return Math.max(0, (prevEnd + nextStart) / 2 - thickness / 2)
    }
    if (nextStart !== null) return Math.max(0, nextStart - thickness - 2)
    if (prevEnd !== null) return prevEnd + 2
    return fallback
}
