/**
 * Vertical offset of `el` inside `ancestor`, walking the offsetParent chain.
 *
 * Preferred over client rects wherever the subtree may sit under a CSS
 * transform — Obsidian Canvas scales its nodes with one (issue #154), so rect
 * deltas come back in scaled pixels while layout offsets stay in CSS pixels.
 *
 * Returns 0 when the chain leaves the document before reaching `ancestor`
 * (positioned ancestors in between are skipped by the offsetParent chain
 * itself, so `ancestor` must be an offset ancestor of `el`).
 */
export function offsetTopWithin(el: HTMLElement, ancestor: HTMLElement): number {
    let total = 0
    let current: HTMLElement | null = el
    while (current && current !== ancestor) {
        total += current.offsetTop
        current = current.offsetParent as HTMLElement | null
    }
    return current === ancestor ? total : 0
}
