import { describe, expect, it } from 'bun:test'
import {
    enumPropertyDefs,
    findProperty,
    findStatusProperty,
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

    it('prefers a property named status, then one containing status', () => {
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
        ).toEqual({ name: 'task_status', allowedValues: ['t'] })
    })

    it('falls back to a select-typed or constrained property', () => {
        expect(
            findStatusProperty(
                noteType({ properties: [{ name: 'kind', type: 'select', allowedValues: ['p'] }] })
            )?.name
        ).toBe('kind')
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
