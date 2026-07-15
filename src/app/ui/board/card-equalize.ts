/**
 * Board-wide uniform card height.
 *
 * Every card adopts the height of the content-tallest card, so all cards are the
 * same size while still growing automatically to fit the richest card's content
 * (no clipping). The shared height is published as a CSS custom property that the
 * card stylesheet reads for its `min-height`.
 */

import { captureScrollEntries, restoreScrollEntries } from '../scroll-preservation'

/** CSS custom property the card stylesheet reads for its shared min-height. */
const CARD_HEIGHT_VAR = '--kap-card-height'

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
 * Equalize every `.kap-card` under `boardEl` to the tallest card's height.
 *
 * Clears any prior override first so cards re-measure at their natural height
 * (heights must be able to shrink when content is removed), then stamps the
 * shared height as {@link CARD_HEIGHT_VAR} for the stylesheet to apply as
 * `min-height`. Reading `offsetHeight` forces the reflow that applies the
 * cleared override, so each card is measured at its natural content height.
 * Cards in collapsed (hidden) columns measure `0` and are ignored.
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

    boardEl.style.removeProperty(CARD_HEIGHT_VAR)
    const cards = Array.from(boardEl.querySelectorAll<HTMLElement>('.kap-card'))
    if (cards.length > 0) {
        const height = uniformCardHeight(cards.map((el) => el.offsetHeight))
        if (height !== null) boardEl.style.setProperty(CARD_HEIGHT_VAR, `${String(height)}px`)
    }

    restoreScrollEntries(scrollers, scrollSnapshot)
}
