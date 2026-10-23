import { describe, expect, test } from 'bun:test'
import { mergeBoardEnumProperties } from './property-filter'

const necessity = (values: string[]) => ({ name: 'necessity', displayName: 'Necessity', values })

describe('mergeBoardEnumProperties', () => {
    test('merges a property across note types, keeping value order and the types', () => {
        const merged = mergeBoardEnumProperties(
            [
                { type: 'Project', properties: [necessity(['10 - MUST', '20 - SHOULD'])] },
                { type: 'Task', properties: [necessity(['20 - should', '30 - COULD'])] }
            ],
            new Set()
        )
        expect(merged).toEqual([
            {
                name: 'necessity',
                displayName: 'Necessity',
                values: ['10 - MUST', '20 - SHOULD', '30 - COULD'],
                types: ['Project', 'Task']
            }
        ])
    })

    test('skips excluded names and properties without values, sorted by label', () => {
        const merged = mergeBoardEnumProperties(
            [
                {
                    type: 'Task',
                    properties: [
                        { name: 'Urgency', displayName: 'Urgency', values: ['Now'] },
                        { name: 'status', displayName: 'Status', values: ['Todo'] },
                        { name: 'empty', displayName: 'Empty', values: [] },
                        { name: 'effort', displayName: 'Effort', values: ['Small'] }
                    ]
                }
            ],
            new Set(['status'])
        )
        expect(merged.map((p) => p.name)).toEqual(['effort', 'Urgency'])
    })
})
