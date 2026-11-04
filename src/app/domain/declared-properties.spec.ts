import { describe, expect, it } from 'bun:test'
import {
    checkPlannedProperties,
    declarationOf,
    declaredTypeOf,
    mayWrite,
    mergeDeclaredProperties
} from './declared-properties'

describe('mergeDeclaredProperties (issue #232)', () => {
    it('merges own and global properties; the own definition wins a clash', () => {
        expect(
            mergeDeclaredProperties(
                [
                    { name: 'date_due', type: 'date' },
                    { name: 'Manual_Order', type: 'text' }
                ],
                [
                    { name: 'manual_order', type: 'number' },
                    { name: 'contexts', type: 'list' }
                ]
            )
        ).toEqual([
            { name: 'date_due', type: 'date' },
            { name: 'Manual_Order', type: 'text' },
            { name: 'contexts', type: 'list' }
        ])
    })

    it('skips blank or non-string names and keeps an untyped entry', () => {
        expect(mergeDeclaredProperties([{ name: ' ' }, { name: 3 }, { name: 'x' }], [])).toEqual([
            { name: 'x' }
        ])
    })
})

describe('declarationOf / mayWrite', () => {
    const type = { declaredProperties: [{ name: 'time_spent', type: 'number' }, { name: 'notes' }] }

    it('unknown declarations allow everything', () => {
        expect(declarationOf(undefined, 'x')).toEqual({ kind: 'unknown' })
        expect(declarationOf({}, 'x')).toEqual({ kind: 'unknown' })
        expect(mayWrite({}, 'anything')).toBe(true)
    })

    it('matches case-insensitively and reports the type', () => {
        expect(declarationOf(type, 'Time_Spent')).toEqual({ kind: 'declared', type: 'number' })
        expect(declaredTypeOf(type, 'time_spent')).toBe('number')
        expect(declaredTypeOf(type, 'notes')).toBeNull()
        expect(mayWrite(type, 'notes')).toBe(true)
    })

    it('an undeclared property may not be written', () => {
        expect(declarationOf(type, 'time_entries')).toEqual({ kind: 'undeclared' })
        expect(mayWrite(type, 'time_entries')).toBe(false)
    })
})

describe('checkPlannedProperties', () => {
    const type = {
        declaredProperties: [
            { name: 'date_scheduled', type: 'date' },
            { name: 'progress', type: 'text' },
            { name: 'notes' }
        ]
    }

    it('reports undeclared and wrongly typed properties, once each', () => {
        expect(
            checkPlannedProperties(type, [
                { role: 'Start date', name: 'date_scheduled', expected: ['date', 'datetime'] },
                { role: 'Start date', name: 'date_scheduled', expected: ['date', 'datetime'] },
                { role: 'Progress', name: 'progress', expected: ['number'] },
                { role: 'Estimate', name: 'estimate', expected: ['number'] },
                { role: 'Notes', name: 'notes', expected: ['number'] },
                { role: 'Status', name: '', expected: [] }
            ])
        ).toEqual([
            {
                role: 'Progress',
                name: 'progress',
                problem: 'wrong-type',
                declaredType: 'text',
                expected: ['number']
            },
            {
                role: 'Estimate',
                name: 'estimate',
                problem: 'undeclared',
                declaredType: null,
                expected: ['number']
            }
        ])
    })

    it('nothing to compare against = no findings', () => {
        expect(checkPlannedProperties({}, [{ role: 'X', name: 'x', expected: [] }])).toEqual([])
    })
})
