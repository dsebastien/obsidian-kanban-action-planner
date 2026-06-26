import { describe, expect, it } from 'bun:test'
import { findStatusProperty, recognitionMappings } from './starter-kit.service'
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
