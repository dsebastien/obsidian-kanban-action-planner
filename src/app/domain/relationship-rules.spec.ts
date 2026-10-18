import { describe, expect, it } from 'bun:test'
import { noteTypeSchema, relationshipRuleSchema } from './note-type'
import type { RelationshipRule } from './note-type'
import {
    choiceProblem,
    chosenProperty,
    distinctProperties,
    roleLinkRules,
    roleProperties,
    selectLinkProperty
} from './relationship-rules'
import { createDefaultNoteType } from '../services/note-type.service'

function typeWith(
    relationships: RelationshipRule[],
    relationshipsMirrored?: boolean
): ReturnType<typeof createDefaultNoteType> {
    const base = createDefaultNoteType('t', 'T', 'local')
    return { ...base, relationships, ...(relationshipsMirrored ? { relationshipsMirrored } : {}) }
}

describe('relationshipRuleSchema', () => {
    it('accepts the older shape (no targetTypeIds, no mirrored)', () => {
        const parsed = relationshipRuleSchema.parse({ role: 'parent', linkProperty: 'parent' })
        expect(parsed).toEqual({ role: 'parent', linkProperty: 'parent' })
    })

    it('carries targetTypeIds and mirrored when set', () => {
        const parsed = relationshipRuleSchema.parse({
            role: 'parent',
            linkProperty: 'related_projects',
            targetTypeIds: ['projects'],
            mirrored: true
        })
        expect(parsed.targetTypeIds).toEqual(['projects'])
        expect(parsed.mirrored).toBe(true)
    })

    it('parses a stored note type written before multi-rule relationships', () => {
        const base = createDefaultNoteType('nt', 'X', 'local')
        const older = {
            ...base,
            relationships: [
                { role: 'parent', linkProperty: 'related_projects' },
                {
                    role: 'child',
                    linkProperty: 'related_tasks',
                    heuristic: { allowedTypeTags: ['#task'], requiresLinkToSource: true }
                }
            ]
        }
        const parsed = noteTypeSchema.parse(older)
        expect(parsed.relationshipsMirrored).toBeUndefined()
        expect(roleProperties(parsed).parent).toEqual(['related_projects'])
        expect(roleProperties(parsed).child).toEqual(['related_tasks'])
        // roles without a rule keep their default property
        expect(roleProperties(parsed).sibling).toEqual(['siblings'])
    })
})

describe('roleLinkRules (local config)', () => {
    it('gives a role with no rule its default property', () => {
        const rules = roleLinkRules(typeWith([]))
        expect(rules.parent).toEqual([{ property: 'parent', targetTypeIds: [] }])
    })

    it('treats an empty link property as None (no default, no rules)', () => {
        const rules = roleLinkRules(typeWith([{ role: 'parent', linkProperty: '' }]))
        expect(rules.parent).toEqual([])
    })

    it('keeps several rules per role, with their target scope', () => {
        const rules = roleLinkRules(
            typeWith([
                { role: 'parent', linkProperty: 'related_projects', targetTypeIds: ['projects'] },
                { role: 'parent', linkProperty: 'related_goals', targetTypeIds: ['goals'] },
                { role: 'parent', linkProperty: 'parent' }
            ])
        )
        expect(rules.parent).toEqual([
            { property: 'related_projects', targetTypeIds: ['projects'] },
            { property: 'related_goals', targetTypeIds: ['goals'] },
            { property: 'parent', targetTypeIds: [] }
        ])
    })

    it('reads the UNION of a role (every rule property, deduped case-insensitively)', () => {
        const props = roleProperties(
            typeWith([
                { role: 'parent', linkProperty: 'related_projects' },
                { role: 'parent', linkProperty: 'related_goals' },
                { role: 'parent', linkProperty: 'Related_Projects' }
            ])
        )
        expect(props.parent).toEqual(['related_projects', 'related_goals'])
    })

    it('an older data.json with two same-role rules now unions them (it used to keep the last)', () => {
        const props = roleProperties(
            typeWith([
                { role: 'parent', linkProperty: 'a' },
                { role: 'parent', linkProperty: 'b' }
            ])
        )
        expect(props.parent).toEqual(['a', 'b'])
    })
})

describe('roleLinkRules (mirrored from the Starter Kit)', () => {
    it('counts only the mirrored rules, with no defaults', () => {
        const rules = roleLinkRules(
            typeWith(
                [
                    { role: 'parent', linkProperty: 'related_projects', mirrored: true },
                    { role: 'child', linkProperty: 'old_local' }
                ],
                true
            )
        )
        expect(rules.parent).toEqual([{ property: 'related_projects', targetTypeIds: [] }])
        expect(rules.child).toEqual([])
        expect(rules.sibling).toEqual([])
        expect(rules.blocked_by).toEqual([])
    })

    it('a mirrored type with no rules at all turns every role off', () => {
        const props = roleProperties(typeWith([], true))
        expect(props).toEqual({ parent: [], sibling: [], child: [], blocked_by: [] })
    })
})

describe('selectLinkProperty (property selection by target type)', () => {
    const projects = { property: 'related_projects', targetTypeIds: ['projects'] }
    const goals = { property: 'related_goals', targetTypeIds: ['goals'] }
    const any = { property: 'parent', targetTypeIds: [] }

    it('zero candidates: none', () => {
        expect(selectLinkProperty([], 'projects')).toEqual({ kind: 'none' })
        expect(selectLinkProperty([projects, goals], 'plans')).toEqual({ kind: 'none' })
        expect(selectLinkProperty([projects], null)).toEqual({ kind: 'none' })
    })

    it('exactly one candidate: that property', () => {
        expect(selectLinkProperty([projects, goals], 'goals')).toEqual({
            kind: 'property',
            property: 'related_goals'
        })
        expect(selectLinkProperty([any], 'whatever')).toEqual({
            kind: 'property',
            property: 'parent'
        })
        expect(selectLinkProperty([any], null)).toEqual({ kind: 'property', property: 'parent' })
    })

    it('a scoped rule wins over an unscoped one for its type, which stays the fallback', () => {
        expect(selectLinkProperty([projects, any], 'projects')).toEqual({
            kind: 'property',
            property: 'related_projects'
        })
        expect(selectLinkProperty([projects, any], 'goals')).toEqual({
            kind: 'property',
            property: 'parent'
        })
    })

    it('several candidates: ambiguous, never guessed', () => {
        expect(
            selectLinkProperty(
                [projects, { property: 'also_projects', targetTypeIds: ['projects'] }],
                'projects'
            )
        ).toEqual({ kind: 'ambiguous', properties: ['related_projects', 'also_projects'] })
        expect(
            selectLinkProperty([any, { property: 'other', targetTypeIds: [] }], 'goals')
        ).toEqual({ kind: 'ambiguous', properties: ['parent', 'other'] })
    })

    it('two rules on the same property count once', () => {
        expect(
            selectLinkProperty(
                [
                    { property: 'x', targetTypeIds: ['a'] },
                    { property: 'X', targetTypeIds: ['a', 'b'] }
                ],
                'a'
            )
        ).toEqual({ kind: 'property', property: 'x' })
    })

    it('explains why a choice is not writable', () => {
        expect(choiceProblem({ kind: 'none' }, 'parent', '"Foo"')).toContain('no parent property')
        const ambiguous = choiceProblem(
            { kind: 'ambiguous', properties: ['a', 'b'] },
            'parent',
            '"Foo"'
        )
        expect(ambiguous).toContain('a, b')
        expect(chosenProperty({ kind: 'none' })).toBe('')
        expect(chosenProperty({ kind: 'property', property: 'p' })).toBe('p')
    })

    it('distinctProperties keeps the first casing', () => {
        expect(
            distinctProperties([
                { property: 'A', targetTypeIds: [] },
                { property: 'a', targetTypeIds: [] }
            ])
        ).toEqual(['A'])
    })
})
