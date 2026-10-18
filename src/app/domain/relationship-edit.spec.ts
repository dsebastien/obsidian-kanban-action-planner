import { describe, expect, it } from 'bun:test'
import type { RelationshipRule } from './note-type'
import {
    addLinkRule,
    childHeuristicTags,
    linkRuleIndexes,
    materializeRules,
    removeLinkRule,
    setChildHeuristic,
    updateLinkRule
} from './relationship-edit'

describe('materializeRules', () => {
    it('adds the default rule of every role that has none, and nothing else', () => {
        const out = materializeRules([{ role: 'parent', linkProperty: 'related_projects' }])
        expect(out.filter((r) => r.role === 'parent')).toEqual([
            { role: 'parent', linkProperty: 'related_projects' }
        ])
        expect(out.map((r) => r.role).sort()).toEqual(['blocked_by', 'child', 'parent', 'sibling'])
    })
})

describe('link rule edits', () => {
    const base: RelationshipRule[] = [
        { role: 'parent', linkProperty: 'a' },
        { role: 'parent', linkProperty: 'b', targetTypeIds: ['goals'] },
        { role: 'child', linkProperty: '' }
    ]

    it('lists a role editable rules (a None marker is not one)', () => {
        expect(linkRuleIndexes(base, 'parent')).toEqual([0, 1])
        expect(linkRuleIndexes(base, 'child')).toEqual([])
    })

    it('adding to a None role reuses its marker', () => {
        const out = addLinkRule(base, 'child', 'related_tasks')
        expect(out).toHaveLength(3)
        expect(out[2]).toEqual({ role: 'child', linkProperty: 'related_tasks' })
    })

    it('adding to a role with rules appends', () => {
        expect(addLinkRule(base, 'parent', 'c')).toHaveLength(4)
    })

    it('sets and clears target types (empty = absent = any type)', () => {
        const set = updateLinkRule(base, 0, { targetTypeIds: ['projects', 'projects'] })
        expect(set[0]?.targetTypeIds).toEqual(['projects'])
        const cleared = updateLinkRule(set, 0, { targetTypeIds: [] })
        expect(cleared[0] && 'targetTypeIds' in cleared[0]).toBe(false)
    })

    it('renames the property and keeps the targets', () => {
        const out = updateLinkRule(base, 1, { linkProperty: 'z' })
        expect(out[1]).toEqual({ role: 'parent', linkProperty: 'z', targetTypeIds: ['goals'] })
    })

    it('removing one of several rules drops just that rule', () => {
        const out = removeLinkRule(base, 0)
        expect(out.filter((r) => r.role === 'parent').map((r) => r.linkProperty)).toEqual(['b'])
    })

    it('removing the last rule of a role leaves a None marker (not the default)', () => {
        const only: RelationshipRule[] = [{ role: 'parent', linkProperty: 'a' }]
        expect(removeLinkRule(only, 0)).toEqual([{ role: 'parent', linkProperty: '' }])
    })

    it('removing a rule that carries the heuristic keeps the heuristic', () => {
        const heuristic = { allowedTypeTags: ['#t'], requiresLinkToSource: true }
        const out = removeLinkRule(
            [{ role: 'child', linkProperty: 'x', targetTypeIds: ['a'], heuristic }],
            0
        )
        expect(out).toEqual([{ role: 'child', linkProperty: '', heuristic }])
    })
})

describe('child heuristic', () => {
    it('reads and sets the tags on the existing local child rule', () => {
        const rules: RelationshipRule[] = [{ role: 'child', linkProperty: 'related_tasks' }]
        const out = setChildHeuristic(rules, ['#task'], false)
        expect(childHeuristicTags(out)).toEqual(['#task'])
        expect(out).toHaveLength(1)
        expect(childHeuristicTags(setChildHeuristic(out, [], false))).toEqual([])
    })

    it('creates a link-less rule when the Starter Kit owns the link properties', () => {
        const out = setChildHeuristic(
            [{ role: 'child', linkProperty: 'related_tasks', mirrored: true }],
            ['#task'],
            true
        )
        expect(out).toHaveLength(2)
        expect(out[1]).toMatchObject({ role: 'child', linkProperty: '' })
        expect(childHeuristicTags(out)).toEqual(['#task'])
    })

    it('keeps the default property when a locally configured role had no child rule yet', () => {
        const out = setChildHeuristic([], ['#task'], false)
        expect(out[0]).toMatchObject({ role: 'child', linkProperty: 'children' })
    })
})
