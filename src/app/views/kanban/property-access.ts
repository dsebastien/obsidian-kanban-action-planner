import type { BasesPropertyId, Value } from 'obsidian'

/**
 * How to **read** a Bases property a view option points at (issue #50):
 * - `note` — a frontmatter property, read by name from the metadata cache and
 *   **writeable** (status / order / drag-grouping go here).
 * - `computed` — a `formula.*` or `file.*` column, read per-card via
 *   `BasesEntry.getValue(id)` and **read-only** (the view can sort / display /
 *   group by it, but can't write it back — there's no underlying property).
 */
export type PropertyRef = { kind: 'note'; name: string } | { kind: 'computed'; id: BasesPropertyId }

/**
 * Parse a stored Bases property id (as a `type: 'property'` option saves it) into
 * a {@link PropertyRef}. A bare name (no prefix) is treated as a note property.
 * Returns `null` for empty/non-string input.
 */
export function parsePropertyRef(value: unknown): PropertyRef | null {
    if (typeof value !== 'string' || value.length === 0) return null
    const dot = value.indexOf('.')
    if (dot === -1) return { kind: 'note', name: value }
    const prefix = value.slice(0, dot)
    if (prefix === 'note') return { kind: 'note', name: value.slice(dot + 1) }
    if (prefix === 'formula' || prefix === 'file') {
        return { kind: 'computed', id: value as BasesPropertyId }
    }
    return null
}

/** The minimal shape of a Bases `Value` this module reads (kept loose for testing). */
interface ValueLike {
    getValue?: () => unknown
    toString: () => string
}

/**
 * Unwrap a Bases `Value` into a sortable/displayable scalar — a finite `number`
 * or a non-empty `string`, else `null`. Prefers the typed `getValue()` when it
 * yields a primitive; otherwise falls back to `toString()`. Numeric strings
 * (e.g. a formula returning `"12.5"`) become numbers so they sort numerically.
 */
export function unwrapValue(value: Value | null | undefined): number | string | null {
    if (value === null || value === undefined) return null
    const raw = (value as ValueLike).getValue?.()
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    if (typeof raw === 'string') return coerceScalar(raw)
    if (raw === null || raw === undefined) {
        // NullValue, or a Value with no primitive — try the string form.
        return coerceScalar((value as ValueLike).toString())
    }
    // Objects (Date / list / moment, …) — use their string form.
    return coerceScalar((value as ValueLike).toString())
}

/** Trim a string to a finite number, a non-empty string, or `null`. */
function coerceScalar(raw: string): number | string | null {
    const trimmed = raw.trim()
    if (trimmed.length === 0 || trimmed === 'null') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : trimmed
}
