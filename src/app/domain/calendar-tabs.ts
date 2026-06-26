/**
 * Pure sort/filter logic for the scheduling panel's tab card lists (Milestone
 * 5e). Operates on minimal sort keys so it stays Obsidian-free and testable; the
 * view maps its cards to {@link TabSortKey} and back.
 */

/** How tab cards are ordered. */
export type TabSortMode = 'order' | 'name' | 'property'

/** The minimal fields needed to sort/filter one tab card. */
export interface TabSortKey {
    /** The card title (also the tie-breaker). */
    title: string
    /** The manual-order value (null sorts last). */
    order: number | null
    /** The chosen sort property's value for `property` mode (null sorts last). */
    sortValue: number | string | null
    /** Lowercased title + tags, used by {@link matchesQuery}. */
    searchText: string
}

/** Case-insensitive substring match; an empty query matches everything. */
export function matchesQuery(searchText: string, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return true
    return searchText.toLowerCase().includes(q)
}

/** Compare two tab cards for the given sort mode (nulls last, ties by title). */
export function compareTabCards(a: TabSortKey, b: TabSortKey, mode: TabSortMode): number {
    if (mode === 'name') return byTitle(a, b)
    if (mode === 'property') return byValue(a.sortValue, b.sortValue) || byTitle(a, b)
    return byNumber(a.order, b.order) || byTitle(a, b)
}

function byTitle(a: TabSortKey, b: TabSortKey): number {
    return a.title.localeCompare(b.title)
}

function byNumber(a: number | null, b: number | null): number {
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a - b
}

/** Numeric-aware compare: numbers before strings; both nulls equal; nulls last. */
function byValue(a: number | string | null, b: number | string | null): number {
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a).localeCompare(String(b))
}
