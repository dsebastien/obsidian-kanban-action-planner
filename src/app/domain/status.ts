import type { ColorSpec, ColumnDef } from './profile'
import { UNMAPPED_COLUMN_ID } from '../constants'

/**
 * Status-property detection and column derivation (pure).
 *
 * Columns come from the distinct status values observed in the notes (until a
 * profile defines an explicit set). Values may carry a numeric/lexical sort
 * prefix (e.g. `10 Todo`) which orders the columns and is stripped for display.
 */

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

const PLACEHOLDER_COLOR: ColorSpec = { kind: 'palette', token: 'default' }

/**
 * Derive ordered columns from the distinct status values observed in the notes.
 * `colorFor` assigns a color per status value (defaults to a placeholder).
 */
export function deriveColumns(
    statusValues: ReadonlyArray<string | null>,
    colorFor: (statusValue: string, index: number) => ColorSpec = () => PLACEHOLDER_COLOR
): ColumnDef[] {
    const distinct = Array.from(new Set(statusValues.filter((v): v is string => v !== null))).sort(
        compareStatusValues
    )

    return distinct.map((statusValue, index) => {
        const { sortKey, label } = splitStatusValue(statusValue)
        return {
            id: statusValue,
            statusValue,
            label,
            sortKey,
            color: colorFor(statusValue, index)
        }
    })
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
