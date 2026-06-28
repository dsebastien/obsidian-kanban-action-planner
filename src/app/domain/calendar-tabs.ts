/**
 * Pure sort/filter logic for the scheduling panel's tab card lists (Milestone
 * 5e). Operates on minimal sort keys so it stays Obsidian-free and testable; the
 * view maps its cards to {@link TabSortKey} and back.
 */

/** How tab cards are ordered. */
export type TabSortMode = 'order' | 'name' | 'property'

/** Sort direction; flips the value comparison only (nulls stay last). */
export type SortDirection = 'asc' | 'desc'

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

/**
 * Compare two tab cards for the given sort mode and direction. `direction` flips
 * only the value comparison; **nulls always sort last** and the title tie-break
 * stays ascending, so missing values never jump to the top and ties are stable.
 */
export function compareTabCards(
    a: TabSortKey,
    b: TabSortKey,
    mode: TabSortMode,
    direction: SortDirection = 'asc'
): number {
    const sign = direction === 'desc' ? -1 : 1
    if (mode === 'name') return sign * byTitle(a, b)
    if (mode === 'property') return byValue(a.sortValue, b.sortValue, sign) || byTitle(a, b)
    return byNumber(a.order, b.order, sign) || byTitle(a, b)
}

function byTitle(a: TabSortKey, b: TabSortKey): number {
    return a.title.localeCompare(b.title)
}

function byNumber(a: number | null, b: number | null, sign: number): number {
    if (a === null && b === null) return 0
    if (a === null) return 1 // null always last, regardless of direction
    if (b === null) return -1
    return sign * (a - b)
}

/** Numeric-aware compare: numbers before strings; both nulls equal; nulls last. */
function byValue(a: number | string | null, b: number | string | null, sign: number): number {
    if (a === null && b === null) return 0
    if (a === null) return 1 // null always last, regardless of direction
    if (b === null) return -1
    if (typeof a === 'number' && typeof b === 'number') return sign * (a - b)
    return sign * String(a).localeCompare(String(b))
}

/** Coerce a frontmatter value into a sortable number/string, or null. */
export function coerceSortValue(raw: unknown): number | string | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed.length === 0) return null
        const n = Number(trimmed)
        return Number.isFinite(n) ? n : trimmed
    }
    return null
}
