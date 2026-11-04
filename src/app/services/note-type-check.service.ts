import type { App } from 'obsidian'
import {
    checkPlannedProperties,
    mergeDeclaredProperties,
    type PropertyFinding
} from '../domain/declared-properties'
import { plannedPropertiesForType, type TypePropertyDefaults } from '../domain/type-properties'
import type { NoteType } from '../domain/note-type'
import { isStarterKitAvailable, listGlobalProperties, listNoteTypes } from './starter-kit.service'
import { createDefaultNoteType } from './note-type.service'

/** The check's result for one Starter Kit note type. */
export interface NoteTypeCheck {
    id: string
    name: string
    /** False when this plugin has no stored config for the type yet (defaults were checked). */
    configured: boolean
    findings: PropertyFinding[]
}

/** The whole report, or why there is none. */
export type NoteTypeCheckReport =
    | { kind: 'unavailable' }
    | { kind: 'no-global-properties' }
    | { kind: 'report'; types: NoteTypeCheck[] }

/**
 * Read-only check (issue #232): for every Starter Kit note type, the
 * properties this plugin would read or write that the type does not declare,
 * or declares with another type. Declarations come LIVE from the Starter Kit
 * (the type's properties + the global ones); the plugin's per-type config is
 * the stored one, else the defaults a new type would get. Nothing is written,
 * not even the mirror.
 */
export function checkNoteTypesAgainstStarterKit(
    app: App,
    settings: TypePropertyDefaults & { noteTypes: ReadonlyArray<NoteType> }
): NoteTypeCheckReport {
    if (!isStarterKitAvailable(app)) return { kind: 'unavailable' }
    const globals = listGlobalProperties(app)
    if (globals === null) return { kind: 'no-global-properties' }
    const types: NoteTypeCheck[] = []
    for (const skType of listNoteTypes(app)) {
        const stored = settings.noteTypes.find((t) => t.id === skType.id)
        const declared = mergeDeclaredProperties(skType.properties ?? [], globals)
        const base =
            stored ??
            createDefaultNoteType(skType.id, skType.name, 'starter-kit', undefined, declared)
        const noteType: NoteType = { ...base, declaredProperties: declared }
        types.push({
            id: skType.id,
            name: skType.name,
            configured: stored !== undefined,
            findings: checkPlannedProperties(noteType, plannedPropertiesForType(settings, noteType))
        })
    }
    types.sort((a, b) => a.name.localeCompare(b.name))
    return { kind: 'report', types }
}

/** One finding as a sentence, for the modal and the console. */
export function describeFinding(finding: PropertyFinding): string {
    if (finding.problem === 'undeclared') {
        return `${finding.role}: \`${finding.name}\` is not declared`
    }
    return `${finding.role}: \`${finding.name}\` is declared as ${finding.declaredType ?? '?'}, expected ${finding.expected.join(' or ')}`
}
