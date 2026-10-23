/**
 * The property picker (filter by any note-type property): the enum
 * properties the board's note types define, merged across types. Pure: the
 * view resolves each type's properties (`listEnumProperties`) and passes them.
 */

/** One enum property of one note type, as the enum service lists it. */
export interface TypeEnumProperty {
    name: string
    displayName: string
    values: string[]
}

/** An enum property offered by the picker: merged across the board's note types. */
export interface BoardEnumProperty {
    /** Frontmatter name (the filter term's name). */
    name: string
    displayName: string
    /** Allowed values, in each type's order, de-duplicated across types. */
    values: string[]
    /** The note types defining it (labels the entry on a mixed board). */
    types: string[]
}

/**
 * Merge the enum properties of the board's note types by name
 * (case-insensitive), skipping `excluded` names (reserved qualifiers, the
 * status and contexts properties, which have their own controls). Values keep
 * the first type's order, then append the others' new ones. Sorted by label.
 */
export function mergeBoardEnumProperties(
    perType: ReadonlyArray<{ type: string; properties: readonly TypeEnumProperty[] }>,
    excluded: ReadonlySet<string>
): BoardEnumProperty[] {
    const byName = new Map<string, BoardEnumProperty>()
    for (const { type, properties } of perType) {
        for (const property of properties) {
            const key = property.name.toLowerCase()
            if (excluded.has(key) || property.values.length === 0) continue
            const existing = byName.get(key)
            if (!existing) {
                byName.set(key, {
                    name: property.name,
                    displayName: property.displayName,
                    values: [...property.values],
                    types: [type]
                })
                continue
            }
            const seen = new Set(existing.values.map((v) => v.toLowerCase()))
            for (const value of property.values) {
                if (!seen.has(value.toLowerCase())) existing.values.push(value)
            }
            if (!existing.types.includes(type)) existing.types.push(type)
        }
    }
    return [...byName.values()].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    )
}
