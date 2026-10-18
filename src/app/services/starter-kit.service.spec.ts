import { describe, expect, it } from 'bun:test'
import { App } from 'obsidian'
import type { EventRef, Events } from 'obsidian'
import {
    STARTER_KIT_NOTE_TYPES_CHANGED,
    onStarterKitNoteTypesChanged,
    creationDefaults,
    enumPropertyDefs,
    findProperty,
    findStatusProperty,
    getNoteTypeRelationships,
    isStaleGuessedStatus,
    legacyGuessedStatusProperty,
    namingOf,
    recognitionMappings
} from './starter-kit.service'
import type { SkNoteType } from './starter-kit.service'

function noteType(partial: Partial<SkNoteType>): SkNoteType {
    return { id: 'id', name: 'Type', properties: [], mappings: [], ...partial }
}

describe('findStatusProperty', () => {
    it('prefers a configured property name', () => {
        const nt = noteType({
            properties: [
                { name: 'stage', allowedValues: ['a', 'b'] },
                { name: 'status', allowedValues: ['x'] }
            ]
        })
        expect(findStatusProperty(nt, 'stage')).toEqual({
            name: 'stage',
            allowedValues: ['a', 'b']
        })
    })

    it('prefers a property named status, else none', () => {
        expect(
            findStatusProperty(
                noteType({
                    properties: [
                        { name: 'task_status', allowedValues: [] },
                        { name: 'status', allowedValues: ['x'] }
                    ]
                })
            )
        ).toEqual({ name: 'status', allowedValues: ['x'] })

        expect(
            findStatusProperty(
                noteType({ properties: [{ name: 'task_status', allowedValues: ['t'] }] })
            )
        ).toBeNull()
    })

    it('never guesses from a select-typed or constrained property', () => {
        expect(
            findStatusProperty(
                noteType({
                    properties: [
                        { name: 'rating', type: 'select', allowedValues: ['1', '2'] },
                        { name: 'relationship', allowedValues: ['friend'] }
                    ]
                })
            )
        ).toBeNull()
    })

    it('isStaleGuessedStatus flags only a mirrored legacy guess', () => {
        const rated = noteType({
            properties: [{ name: 'rating', type: 'select', allowedValues: ['1'] }]
        })
        expect(isStaleGuessedStatus('rating', 'status', rated)).toBe(true)
        expect(isStaleGuessedStatus('status', 'status', rated)).toBe(false)
        expect(isStaleGuessedStatus('stage', 'status', rated)).toBe(false)
        expect(isStaleGuessedStatus('rating', 'rating', rated)).toBe(false)
        expect(isStaleGuessedStatus(undefined, 'status', rated)).toBe(false)
    })

    it('legacyGuessedStatusProperty recognizes what older versions picked', () => {
        expect(
            legacyGuessedStatusProperty(
                noteType({ properties: [{ name: 'rating', type: 'select', allowedValues: ['1'] }] })
            )
        ).toBe('rating')
        expect(
            legacyGuessedStatusProperty(
                noteType({
                    properties: [
                        { name: 'rating', type: 'select', allowedValues: ['1'] },
                        { name: 'health_status', allowedValues: ['ok'] }
                    ]
                })
            )
        ).toBe('health_status')
        expect(
            legacyGuessedStatusProperty(noteType({ properties: [{ name: 'title' }] }))
        ).toBeNull()
    })

    it('coerces numeric allowed values to strings and drops empties', () => {
        const nt = noteType({ properties: [{ name: 'status', allowedValues: [1, 'b', '', null] }] })
        expect(findStatusProperty(nt)).toEqual({ name: 'status', allowedValues: ['1', 'b'] })
    })

    it('returns null when no candidate exists', () => {
        expect(findStatusProperty(noteType({ properties: [{ name: 'title' }] }))).toBeNull()
    })
})

describe('findProperty (issue #52)', () => {
    const nt = noteType({
        properties: [
            { name: 'priority', allowedValues: ['10 - Top', '99 - TBD'] },
            { name: 'title' }
        ]
    })

    it('returns allowed values for a property by case-insensitive name', () => {
        expect(findProperty(nt, 'Priority')).toEqual(['10 - Top', '99 - TBD'])
    })

    it('returns [] for an unknown property or one without allowed values', () => {
        expect(findProperty(nt, 'effort')).toEqual([])
        expect(findProperty(nt, 'title')).toEqual([])
    })
})

describe('enumPropertyDefs (issue #52)', () => {
    it('lists only properties that have constrained values, using displayName', () => {
        const nt = noteType({
            properties: [
                { name: 'priority', displayName: 'Priority', allowedValues: ['a', 'b'] },
                { name: 'urgency', allowedValues: [] },
                { name: 'title' }
            ]
        })
        expect(enumPropertyDefs(nt)).toEqual([
            { name: 'priority', displayName: 'Priority', values: ['a', 'b'] }
        ])
    })
})

describe('recognitionMappings', () => {
    it('keeps supported mapping types only', () => {
        const nt = noteType({
            mappings: [
                { type: 'tag', value: 'project', enabled: true },
                { type: 'folder', value: 'Projects', enabled: true },
                { type: 'formula', value: 'x', enabled: true }
            ]
        })
        expect(recognitionMappings(nt)).toEqual([
            { type: 'tag', value: 'project', enabled: true },
            { type: 'folder', value: 'Projects', enabled: true }
        ])
    })
})

describe('creationDefaults (optional affixes, Starter Kit >= 1.22)', () => {
    it('inherits a REQUIRED prefix and suffix', () => {
        const nt = noteType({ noteNamePrefix: 'AI Wiki - ', noteNameSuffix: ' (Task)' })
        expect(creationDefaults(nt)).toEqual({
            folder: '',
            templatePath: '',
            namePrefix: 'AI Wiki - ',
            nameSuffix: ' (Task)'
        })
    })

    it('inherits NOTHING for an affix the Starter Kit marks optional', () => {
        const nt = noteType({
            noteNamePrefix: 'AI Wiki - ',
            noteNamePrefixOptional: true,
            noteNameSuffix: ' (Task)',
            noteNameSuffixOptional: true
        })
        expect(creationDefaults(nt).namePrefix).toBe('')
        expect(creationDefaults(nt).nameSuffix).toBe('')
    })

    it('leaves an optional prefix alone when only the suffix is optional', () => {
        const nt = noteType({
            noteNamePrefix: 'AI Wiki - ',
            noteNameSuffix: ' (Task)',
            noteNameSuffixOptional: true
        })
        expect(creationDefaults(nt).namePrefix).toBe('AI Wiki - ')
        expect(creationDefaults(nt).nameSuffix).toBe('')
    })

    it('inherits as before when the flags are absent (older Starter Kit)', () => {
        const nt = noteType({ noteNameSuffix: ' (Task)' })
        expect(creationDefaults(nt).nameSuffix).toBe(' (Task)')
    })
})

describe('namingOf', () => {
    it('mirrors the decoration with the flags OFF when absent', () => {
        expect(namingOf(noteType({ noteNameSuffix: ' (Task)' }))).toEqual({
            prefix: '',
            suffix: ' (Task)',
            prefixOptional: false,
            suffixOptional: false
        })
    })

    it('carries the optional flags the Starter Kit declares', () => {
        expect(
            namingOf(
                noteType({
                    noteNamePrefix: 'AI Wiki - ',
                    noteNamePrefixOptional: true,
                    noteNameSuffix: ' (Task)'
                })
            )
        ).toEqual({
            prefix: 'AI Wiki - ',
            suffix: ' (Task)',
            prefixOptional: true,
            suffixOptional: false
        })
    })
})

describe('onStarterKitNoteTypesChanged', () => {
    /** A minimal Events bus double. */
    function bus(): Pick<Events, 'on'> & { trigger: (name: string) => void } {
        const handlers = new Map<string, Array<() => unknown>>()
        return {
            on: (name: string, cb: () => unknown): EventRef => {
                handlers.set(name, [...(handlers.get(name) ?? []), cb])
                const ref: EventRef & { name: string } = { name }
                return ref
            },
            trigger: (name: string) => {
                for (const cb of handlers.get(name) ?? []) cb()
            }
        }
    }

    it('subscribes to the Starter Kit event and calls back on it only', () => {
        const events = bus()
        let calls = 0
        const ref = onStarterKitNoteTypesChanged(events, () => calls++)
        expect(ref).toEqual({ name: STARTER_KIT_NOTE_TYPES_CHANGED })
        events.trigger('layout-change')
        expect(calls).toBe(0)
        events.trigger('obsidian-starter-kit:note-types-changed')
        expect(calls).toBe(1)
    })
})

describe('getNoteTypeRelationships (feature-detected by method presence)', () => {
    function appWithApi(api: Record<string, unknown>): App {
        return Object.assign(new App(), {
            plugins: { plugins: { 'obsidian-starter-kit': { api } } }
        })
    }
    const listNoteTypes = (): unknown[] => []

    it('is null when the installed Starter Kit has no such method (no version check)', () => {
        expect(getNoteTypeRelationships(appWithApi({ listNoteTypes }), 'tasks')).toBeNull()
    })

    it('is null without a Starter Kit at all', () => {
        expect(getNoteTypeRelationships(Object.assign(new App(), {}), 'tasks')).toBeNull()
    })

    it('unwraps an ApiResult and maps target types to ids', () => {
        const calls: string[] = []
        const app = appWithApi({
            listNoteTypes,
            getNoteTypeRelationships: (ref: string) => {
                calls.push(ref)
                return {
                    success: true,
                    data: [
                        {
                            role: 'parent',
                            property: 'related_projects',
                            propertyId: 'p1',
                            targetTypes: [{ id: 'projects', name: 'Projects' }]
                        },
                        { role: 'parent', property: 'related_goals', targetTypes: [] },
                        {
                            role: 'sibling',
                            property: ' related_tasks ',
                            targetTypes: [{ id: 'x' }, { id: 'x' }]
                        }
                    ]
                }
            }
        })
        expect(getNoteTypeRelationships(app, 'tasks')).toEqual([
            { role: 'parent', property: 'related_projects', targetTypeIds: ['projects'] },
            { role: 'parent', property: 'related_goals', targetTypeIds: [] },
            { role: 'sibling', property: 'related_tasks', targetTypeIds: ['x'] }
        ])
        expect(calls).toEqual(['tasks'])
    })

    it("passes a valid 'cardinality' through and ignores anything else", () => {
        const app = appWithApi({
            listNoteTypes,
            getNoteTypeRelationships: () => ({
                success: true,
                data: [
                    { role: 'parent', property: 'show', cardinality: 'one', targetTypes: [] },
                    { role: 'sibling', property: 'related_media', cardinality: 'many' },
                    { role: 'child', property: 'episodes', cardinality: 'few' },
                    { role: 'child', property: 'seasons' }
                ]
            })
        })
        expect(getNoteTypeRelationships(app, 'tv_seasons')).toEqual([
            { role: 'parent', property: 'show', targetTypeIds: [], cardinality: 'one' },
            { role: 'sibling', property: 'related_media', targetTypeIds: [], cardinality: 'many' },
            { role: 'child', property: 'episodes', targetTypeIds: [] },
            { role: 'child', property: 'seasons', targetTypeIds: [] }
        ])
    })

    it('null (not configured) stays null, while an empty array is a real answer', () => {
        const nullApp = appWithApi({
            listNoteTypes,
            getNoteTypeRelationships: () => ({ success: true, data: null })
        })
        expect(getNoteTypeRelationships(nullApp, 'tasks')).toBeNull()
        const emptyApp = appWithApi({
            listNoteTypes,
            getNoteTypeRelationships: () => ({ success: true, data: [] })
        })
        expect(getNoteTypeRelationships(emptyApp, 'tasks')).toEqual([])
    })

    it('skips unusable entries and survives errors and failed results', () => {
        const messy = appWithApi({
            listNoteTypes,
            getNoteTypeRelationships: () => [
                { role: 'boss', property: 'x' },
                { role: 'parent', property: '' },
                null,
                { role: 'blocked_by', property: 'blocked_by' }
            ]
        })
        expect(getNoteTypeRelationships(messy, 't')).toEqual([
            { role: 'blocked_by', property: 'blocked_by', targetTypeIds: [] }
        ])
        const failed = appWithApi({
            listNoteTypes,
            getNoteTypeRelationships: () => ({ success: false, error: 'nope' })
        })
        expect(getNoteTypeRelationships(failed, 't')).toBeNull()
        const throwing = appWithApi({
            listNoteTypes,
            getNoteTypeRelationships: () => {
                throw new Error('boom')
            }
        })
        expect(getNoteTypeRelationships(throwing, 't')).toBeNull()
    })
})
