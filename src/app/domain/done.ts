import type { NoteType } from './note-type'

/**
 * Done-state resolution + matching (issue #56).
 *
 * A note type may declare a done definition: a frontmatter property and the
 * value(s) that mean "this note is done". Consumers (WBS progress rollups
 * today) treat a done note as 100% complete.
 */

/** A note type's done config resolved to a concrete property + values. */
export interface ResolvedDoneConfig {
    property: string
    /** Values meaning done (case-insensitive); empty = boolean `true`. */
    values: string[]
}

/**
 * Resolve a note type's done config: `null` when the type has none, disabled
 * it, or no property can be resolved. An empty configured property falls back
 * to the type's status property.
 */
export function resolveDoneConfig(
    noteType: NoteType | undefined | null
): ResolvedDoneConfig | null {
    if (!noteType?.done?.enabled) return null
    const property = noteType.done.property.trim() || noteType.statusProperty
    if (!property) return null
    return { property, values: noteType.done.values }
}

/**
 * Whether a raw frontmatter value matches the done definition. Values compare
 * trimmed and case-insensitive; list properties count as done when ANY element
 * matches. An empty `values` list means "checkbox semantics": boolean `true`
 * (or the strings 'true'/'yes') is done.
 */
export function isDoneValue(raw: unknown, values: string[]): boolean {
    if (raw === null || raw === undefined) return false
    if (Array.isArray(raw)) return raw.some((item) => isDoneValue(item, values))
    const normalized = String(raw as string | number | boolean)
        .trim()
        .toLowerCase()
    if (normalized.length === 0) return false
    if (values.length === 0) return normalized === 'true' || normalized === 'yes'
    return values.some((value) => value.trim().toLowerCase() === normalized)
}
