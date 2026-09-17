import { UNMAPPED_COLUMN_ID } from '../constants'

/**
 * Status-property detection and column derivation (pure).
 *
 * Columns come from the distinct status values observed in the notes (until a
 * noteType defines an explicit set). Values may carry a numeric/lexical sort
 * prefix (e.g. `10 Todo`) which orders the columns and is stripped for display.
 */

/**
 * The status property a write for a note of a given type must target (issue #188).
 * Precedence mirrors the board's read path so a created card lands in the column
 * it was added to: the per-view override, then a RECOGNIZED type's own property,
 * then the board-wide detected property. The shared Default note type is never
 * authoritative — its stored `statusProperty` is a snapshot of the global default
 * taken when it was first created, and goes stale when that setting changes.
 * Blank names fall through (never a `''` frontmatter key).
 */
export function resolveWriteStatusProperty(input: {
    viewOverride: string | null | undefined
    typeProperty: string | null | undefined
    isDefaultType: boolean
    boardProperty: string | null
}): string | null {
    const override = input.viewOverride?.trim()
    if (override) return override
    const own = input.isDefaultType ? '' : input.typeProperty?.trim()
    if (own) return own
    return input.boardProperty?.trim() || null
}

/**
 * Pick the status property name. Preference order:
 * 1. an explicitly configured name, if present in `propertyNames`;
 * 2. a property named exactly `status` (case-insensitive);
 * 3. the first property whose name contains `status` (case-insensitive).
 * Returns `null` when nothing matches.
 */
export function detectStatusProperty(
    propertyNames: string[],
    configured?: string | null
): string | null {
    if (configured) {
        const exact = propertyNames.find((p) => p.toLowerCase() === configured.toLowerCase())
        if (exact) return exact
    }
    const named = propertyNames.find((p) => p.toLowerCase() === 'status')
    if (named) return named
    const contains = propertyNames.find((p) => p.toLowerCase().includes('status'))
    return contains ?? null
}

/** Split a status value into a sort key and a display label. */
export function splitStatusValue(value: string): { sortKey: string; label: string } {
    const match = /^(\d+)\s*[-.)]?\s+(.*)$/.exec(value)
    if (match && match[1] !== undefined && match[2] !== undefined) {
        // Zero-pad the numeric prefix so lexical sort matches numeric order.
        const sortKey = match[1].padStart(12, '0')
        return { sortKey, label: match[2].trim() || value }
    }
    return { sortKey: value.toLowerCase(), label: value }
}

/** Compare two status values by numeric prefix when present, else lexically. */
export function compareStatusValues(a: string, b: string): number {
    const sa = splitStatusValue(a).sortKey
    const sb = splitStatusValue(b).sortKey
    return sa < sb ? -1 : sa > sb ? 1 : 0
}

/** Normalize a raw frontmatter value into a status string, or `null`. */
export function normalizeStatusValue(raw: unknown): string | null {
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        return trimmed.length > 0 ? trimmed : null
    }
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
    return null
}

/**
 * Resolve which column a card's status belongs to. Unknown/`null` status maps
 * to the Unmapped sentinel column.
 */
export function resolveColumnId(
    statusValue: string | null,
    knownColumnIds: ReadonlySet<string>
): string {
    if (statusValue !== null && knownColumnIds.has(statusValue)) return statusValue
    return UNMAPPED_COLUMN_ID
}
