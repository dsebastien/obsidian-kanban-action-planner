/**
 * Timeline resize gating (issue #105, finding N1).
 *
 * Bars are %-positioned, so the layout is fluid at every width — the ONLY
 * render-time decisions a width change can invalidate are the px-gated
 * affordances (issue #80): the resize handles (>= 24px rendered bar width)
 * and the duration tag (>= 32px). A resize tick therefore needs a re-render
 * only when some bar crosses one of those gates between the width it was
 * rendered at and the current width; every other tick is a no-op.
 */

/** Rendered bar width (px) below which the resize handles are dropped. */
export const BAR_HANDLES_MIN_PX = 24
/** Rendered bar width (px) below which the duration tag is dropped. */
export const BAR_DURATION_TAG_MIN_PX = 32

const GATES_PX = [BAR_HANDLES_MIN_PX, BAR_DURATION_TAG_MIN_PX] as const

/**
 * Whether re-rendering at `nextTrackWidth` would change any px-gated
 * affordance decided when the bars (given as % of the track) were rendered at
 * `previousTrackWidth`.
 */
export function timelineWidthGatesCrossed(
    barWidthPcts: readonly number[],
    previousTrackWidth: number,
    nextTrackWidth: number
): boolean {
    if (previousTrackWidth === nextTrackWidth) return false
    for (const pct of barWidthPcts) {
        const before = (pct / 100) * previousTrackWidth
        const after = (pct / 100) * nextTrackWidth
        for (const gate of GATES_PX) {
            if (before >= gate !== after >= gate) return true
        }
    }
    return false
}
