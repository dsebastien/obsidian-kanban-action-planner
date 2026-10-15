/**
 * Board-wide uniform card height.
 *
 * Every card adopts the height of the content-tallest card, so all cards are the
 * same size while still growing automatically to fit the richest card's content
 * (no clipping). The shared height is published as a CSS custom property that the
 * card stylesheet reads for its `min-height`.
 */

import { captureScrollEntries, restoreScrollEntries } from '../scroll-preservation'
import {
    CARD_HEIGHT_VAR,
    cachedHeights,
    captureVirtualAnchors,
    mountHeightProbes,
    publishedCardHeight,
    restoreVirtualAnchors
} from './board-virtualizer'

/**
 * The shared height (px) for a set of measured natural card heights: the max,
 * or `null` when there is nothing to size (so callers clear the override and
 * let the stylesheet fall back to its default floor).
 */
export function uniformCardHeight(naturalHeights: readonly number[]): number | null {
    let max = 0
    for (const h of naturalHeights) {
        if (h > max) max = h
    }
    return max > 0 ? max : null
}

/**
 * The value to (re)stamp as {@link CARD_HEIGHT_VAR}: the freshly measured max,
 * rounded up to a whole pixel ({@link publishedCardHeight}), when there is one, else the PREVIOUS value ('' when there was none). A null
 * measurement means every card measured 0 — a hidden tab, not a real layout —
 * so the stale height is kept rather than destroyed; it is re-measured on
 * reveal (issue #105, finding 5.5). Returns '' when there is nothing to set.
 */
export function cardHeightVarValue(measuredMax: number | null, previous: string): string {
    if (measuredMax !== null) return `${String(publishedCardHeight(measuredMax))}px`
    return previous
}

/**
 * Equalize every `.kap-card` under `boardEl` to the tallest card's height.
 *
 * Clears any prior override first so cards re-measure at their natural height
 * (heights must be able to shrink when content is removed), then stamps the
 * shared height as {@link CARD_HEIGHT_VAR} for the stylesheet to apply as
 * `min-height`. Reading `offsetHeight` forces the reflow that applies the
 * cleared override, so each card is measured at its natural content height.
 * Cards in collapsed (hidden) columns measure `0` and are ignored. When EVERY
 * card measures 0 (a hidden tab) the previous height is kept instead of being
 * destroyed — see {@link cardHeightVarValue}.
 *
 * A virtualized column (issue #111) has only its window mounted: its probe
 * cards (the ones most likely to be tallest) are mounted for the measurement
 * and removed again, and heights measured earlier for cards that are not
 * mounted now still count (the height cache). Afterwards every virtual
 * column is re-windowed for the new height, anchored on the card at its top.
 *
 * During the intermediate natural-height layout every column/lane scroller's
 * scrollHeight shrinks, so the browser silently clamps any scrollTop past the
 * shrunken extent — and re-setting the variable does NOT bring it back
 * (issue #105, finding 3.2). The scrollers are snapshotted before the clear
 * and pinned back after the re-set, in the same task.
 */
export function applyUniformCardHeight(boardEl: HTMLElement): void {
    const scrollers = Array.from(
        boardEl.querySelectorAll<HTMLElement>('.kap-column-cards, .kap-lanes')
    ).map((el, i) => [String(i), el] as const)
    const scrollSnapshot = captureScrollEntries(scrollers)
    const anchors = captureVirtualAnchors(boardEl)

    const previous = boardEl.style.getPropertyValue(CARD_HEIGHT_VAR)
    boardEl.style.removeProperty(CARD_HEIGHT_VAR)
    const probes = mountHeightProbes(boardEl)
    // Fractional heights (getBoundingClientRect, not the rounded offsetHeight):
    // a 76.4px card published as 76px would push every later card off its
    // computed slot in a virtual column (issue #111 review, finding 3).
    const measured = Array.from(boardEl.querySelectorAll<HTMLElement>('.kap-card')).map((el) => ({
        el,
        height: el.getBoundingClientRect().height
    }))
    const cached = cachedHeights(boardEl, measured)
    for (const probe of probes) probe.remove()
    const value = cardHeightVarValue(
        uniformCardHeight([...measured.map((m) => m.height), ...cached]),
        previous
    )
    if (value !== '') boardEl.style.setProperty(CARD_HEIGHT_VAR, value)

    restoreScrollEntries(scrollers, scrollSnapshot)
    restoreVirtualAnchors(boardEl, anchors)
}
