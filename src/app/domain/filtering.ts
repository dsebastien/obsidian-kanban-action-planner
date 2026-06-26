import type { RelationshipSet } from './relationships'

/**
 * Pure relational filtering, layered on top of the Base's own filters.
 *
 * Today this models the blocked-by filter (Business Rule #9): show all cards,
 * only blocked ones, or hide blocked ones. Kept pure and unit-tested; the view
 * applies it to the card list before building the board.
 */

export type BlockedFilter = 'all' | 'only' | 'hide'

export interface RelationalFilter {
    blocked: BlockedFilter
}

export const DEFAULT_RELATIONAL_FILTER: RelationalFilter = { blocked: 'all' }

/** A card is blocked when it has at least one (unresolved-or-resolved) blocker. */
export function isBlocked(relationships: RelationshipSet | undefined): boolean {
    return relationships !== undefined && relationships.blocked_by.length > 0
}

/** Whether a card with these relationships passes the relational filter. */
export function passesFilter(
    relationships: RelationshipSet | undefined,
    filter: RelationalFilter
): boolean {
    switch (filter.blocked) {
        case 'only':
            return isBlocked(relationships)
        case 'hide':
            return !isBlocked(relationships)
        case 'all':
            return true
    }
}
