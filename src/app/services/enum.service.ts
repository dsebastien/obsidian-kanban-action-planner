import type { App } from 'obsidian'
import type { NoteType } from '../domain/note-type'
import { findKeyCaseInsensitive } from './frontmatter.service'
import { enumPropertyDefs, findProperty, listNoteTypes } from './starter-kit.service'
import { findNoteType } from './note-type.service'
import type { KanbanActionPlannerPlugin } from '../plugin'

/** A property the card "Set <property>" menu can quick-set (issue #52). */
export interface EnumPropertyDef {
    /** Frontmatter property name (the write target). */
    name: string
    /** Human label for the menu (Starter Kit display name, else the name). */
    displayName: string
    /** Ordered allowed values. */
    values: string[]
}

/**
 * Manual allowed-values for a property on a note type (case-insensitive name),
 * or `undefined` when the note type defines none. Pure.
 */
export function manualAllowedValues(
    noteType: NoteType | undefined,
    propertyName: string
): string[] | undefined {
    if (!noteType) return undefined
    const key = findKeyCaseInsensitive(noteType.enumProperties, propertyName)
    return key === null ? undefined : noteType.enumProperties[key]
}

/**
 * Apply the allowed-values precedence: a non-empty **manual** list wins, else the
 * **Starter Kit** list, else `[]` (unknown ⇒ free value, no quick-set). Pure.
 */
export function pickAllowedValues(manual: string[] | undefined, starterKit: string[]): string[] {
    if (manual && manual.length > 0) return manual
    return starterKit
}

/**
 * Resolve the ordered allowed values for `propertyName` on the given note type
 * (issue #52). Precedence: manual note-type list → Starter Kit → `[]`.
 */
export function resolveAllowedValues(
    app: App,
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    propertyName: string
): string[] {
    const noteType = findNoteType(plugin, noteTypeId)
    const manual = manualAllowedValues(noteType, propertyName)
    if (manual && manual.length > 0) return manual
    const skType = listNoteTypes(app).find((t) => t.id === noteTypeId)
    return skType ? findProperty(skType, propertyName) : []
}

/**
 * List every enum property the card "Set <property>" menu should offer for a note
 * type (issue #52): the union of Starter Kit constrained properties and the note
 * type's manual `enumProperties`, manual values overriding SK for the same name
 * (case-insensitive). Excludes properties with no values.
 */
export function listEnumProperties(
    app: App,
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string
): EnumPropertyDef[] {
    const byName = new Map<string, EnumPropertyDef>()
    const skType = listNoteTypes(app).find((t) => t.id === noteTypeId)
    if (skType) {
        for (const def of enumPropertyDefs(skType)) {
            byName.set(def.name.toLowerCase(), def)
        }
    }
    const noteType = findNoteType(plugin, noteTypeId)
    for (const [name, values] of Object.entries(noteType?.enumProperties ?? {})) {
        if (values.length === 0) continue
        const existing = byName.get(name.toLowerCase())
        byName.set(name.toLowerCase(), {
            name: existing?.name ?? name,
            displayName: existing?.displayName ?? name,
            values
        })
    }
    return [...byName.values()]
}
