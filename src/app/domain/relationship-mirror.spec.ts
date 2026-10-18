import { describe, expect, it } from 'bun:test'
import type { RelationshipRule } from './note-type'
import { mirroredRelationshipRules, reconcileRelationships } from './relationship-mirror'

const sk = [
    { role: 'parent' as const, property: 'related_projects', targetTypeIds: ['projects'] },
    { role: 'parent' as const, property: 'related_goals', targetTypeIds: ['goals'] },
    { role: 'sibling' as const, property: 'related_tasks', targetTypeIds: [] }
]

describe('mirroredRelationshipRules', () => {
    it('maps Starter Kit rules to read-only rules; empty targets are omitted', () => {
        expect(mirroredRelationshipRules(sk)).toEqual([
            {
                role: 'parent',
                linkProperty: 'related_projects',
                targetTypeIds: ['projects'],
                mirrored: true
            },
            {
                role: 'parent',
                linkProperty: 'related_goals',
                targetTypeIds: ['goals'],
                mirrored: true
            },
            { role: 'sibling', linkProperty: 'related_tasks', mirrored: true }
        ])
    })
})

describe('reconcileRelationships', () => {
    const local: RelationshipRule[] = [
        { role: 'parent', linkProperty: 'parent' },
        {
            role: 'child',
            linkProperty: '',
            heuristic: { allowedTypeTags: ['#task'], requiresLinkToSource: true }
        }
    ]

    it('mirrors the Starter Kit rules first and keeps the local ones for the hand-back', () => {
        const out = reconcileRelationships(local, sk)
        expect(out.relationshipsMirrored).toBe(true)
        expect(out.relationships.slice(0, 3).every((r) => r.mirrored === true)).toBe(true)
        expect(out.relationships.slice(3)).toEqual(local)
    })

    it('replaces previously mirrored rules instead of accumulating them', () => {
        const once = reconcileRelationships(local, sk)
        const twice = reconcileRelationships(once.relationships, [sk[0] ?? never()])
        expect(twice.relationships.filter((r) => r.mirrored === true)).toHaveLength(1)
        expect(twice.relationships.filter((r) => r.mirrored !== true)).toEqual(local)
    })

    it('is idempotent', () => {
        const once = reconcileRelationships(local, sk)
        expect(reconcileRelationships(once.relationships, sk)).toEqual(once)
    })

    it('an empty Starter Kit declaration is still a declaration (mirrored, no link rules)', () => {
        const out = reconcileRelationships(local, [])
        expect(out.relationshipsMirrored).toBe(true)
        expect(out.relationships).toEqual(local)
    })

    it('null hands back the local config and drops the mirrored rules', () => {
        const mirrored = reconcileRelationships(local, sk)
        const back = reconcileRelationships(mirrored.relationships, null)
        expect(back.relationshipsMirrored).toBe(false)
        expect(back.relationships).toEqual(local)
    })
})

function never(): never {
    throw new Error('unreachable')
}
