import { describe, expect, it } from 'bun:test'
import { noteTypeSchema, relationshipRuleSchema } from './note-type'
import type { RelationshipRule } from './note-type'
import {
    choiceProblem,
    chosenCardinality,
    chosenProperty,
    effectiveCardinality,
    propertiesToClear,
    distinctProperties,
    roleLinkRules,
    roleProperties,
    selectLinkProperty
} from './relationship-rules'
import type { LinkRule } from './relationship-rules'
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
        expect(rules.parent).toEqual([
            { property: 'parent', cardinality: 'many', targetTypeIds: [] }
        ])
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
            { property: 'related_projects', cardinality: 'many', targetTypeIds: ['projects'] },
            { property: 'related_goals', cardinality: 'many', targetTypeIds: ['goals'] },
            { property: 'parent', cardinality: 'many', targetTypeIds: [] }
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
        expect(rules.parent).toEqual([
            { property: 'related_projects', cardinality: 'many', targetTypeIds: [] }
        ])
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
    const projects: LinkRule = {
        property: 'related_projects',
        cardinality: 'many',
        targetTypeIds: ['projects']
    }
    const goals: LinkRule = {
        property: 'related_goals',
        cardinality: 'many',
        targetTypeIds: ['goals']
    }
    const any: LinkRule = { property: 'parent', cardinality: 'many', targetTypeIds: [] }

    it('zero candidates: none', () => {
        expect(selectLinkProperty([], 'projects')).toEqual({ kind: 'none' })
        expect(selectLinkProperty([projects, goals], 'plans')).toEqual({ kind: 'none' })
        expect(selectLinkProperty([projects], null)).toEqual({ kind: 'none' })
    })

    it('exactly one candidate: that property', () => {
        expect(selectLinkProperty([projects, goals], 'goals')).toEqual({
            kind: 'property',
            property: 'related_goals',
            cardinality: 'many'
        })
        expect(selectLinkProperty([any], 'whatever')).toEqual({
            kind: 'property',
            property: 'parent',
            cardinality: 'many'
        })
        expect(selectLinkProperty([any], null)).toEqual({
            kind: 'property',
            property: 'parent',
            cardinality: 'many'
        })
    })

    it('a scoped rule wins over an unscoped one for its type, which stays the fallback', () => {
        expect(selectLinkProperty([projects, any], 'projects')).toEqual({
            kind: 'property',
            property: 'related_projects',
            cardinality: 'many'
        })
        expect(selectLinkProperty([projects, any], 'goals')).toEqual({
            kind: 'property',
            property: 'parent',
            cardinality: 'many'
        })
    })

    it('several candidates: ambiguous, never guessed', () => {
        expect(
            selectLinkProperty(
                [
                    projects,
                    { property: 'also_projects', cardinality: 'many', targetTypeIds: ['projects'] }
                ],
                'projects'
            )
        ).toEqual({ kind: 'ambiguous', properties: ['related_projects', 'also_projects'] })
        expect(
            selectLinkProperty(
                [any, { property: 'other', cardinality: 'many', targetTypeIds: [] }],
                'goals'
            )
        ).toEqual({ kind: 'ambiguous', properties: ['parent', 'other'] })
    })

    it('two rules on the same property count once', () => {
        expect(
            selectLinkProperty(
                [
                    { property: 'x', cardinality: 'many', targetTypeIds: ['a'] },
                    { property: 'X', cardinality: 'many', targetTypeIds: ['a', 'b'] }
                ],
                'a'
            )
        ).toEqual({ kind: 'property', property: 'x', cardinality: 'many' })
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
        expect(chosenProperty({ kind: 'property', property: 'p', cardinality: 'many' })).toBe('p')
    })

    it('distinctProperties keeps the first casing', () => {
        expect(
            distinctProperties([
                { property: 'A', cardinality: 'many', targetTypeIds: [] },
                { property: 'a', cardinality: 'many', targetTypeIds: [] }
            ])
        ).toEqual(['A'])
    })
})

describe('single-link (cardinality) rules', () => {
    const textType = (name: string): string | undefined => (name === 'show' ? 'text' : undefined)

    it('the rule schema carries an optional cardinality', () => {
        const parsed = relationshipRuleSchema.parse({
            role: 'parent',
            linkProperty: 'show',
            cardinality: 'one'
        })
        expect(parsed.cardinality).toBe('one')
        expect(
            relationshipRuleSchema.parse({ role: 'parent', linkProperty: 'show' }).cardinality
        ).toBeUndefined()
        expect(() =>
            relationshipRuleSchema.parse({ role: 'parent', linkProperty: 'show', cardinality: 'x' })
        ).toThrow()
    })

    it('precedence: the rule own cardinality, then the Obsidian text type, then many', () => {
        const rule = { linkProperty: 'show' }
        expect(effectiveCardinality({ ...rule, cardinality: 'many' }, textType)).toBe('many')
        expect(effectiveCardinality({ ...rule, cardinality: 'one' })).toBe('one')
        expect(effectiveCardinality(rule, textType)).toBe('one')
        expect(effectiveCardinality(rule, () => 'multitext')).toBe('many')
        expect(effectiveCardinality(rule, () => undefined)).toBe('many')
        expect(effectiveCardinality(rule)).toBe('many')
    })

    it('local inference: a text-typed property is single-link, a list one is not', () => {
        const type = typeWith([
            { role: 'parent', linkProperty: 'show', targetTypeIds: ['tv_shows'] },
            { role: 'sibling', linkProperty: 'related_media' }
        ])
        const rules = roleLinkRules(type, textType)
        expect(rules.parent).toEqual([
            { property: 'show', cardinality: 'one', targetTypeIds: ['tv_shows'] }
        ])
        expect(rules.sibling[0]?.cardinality).toBe('many')
        // no lookup (or an unknown type): list behaviour, as before
        expect(roleLinkRules(type).parent[0]?.cardinality).toBe('many')
    })

    it('a mirrored rule without cardinality (older Starter Kit) is inferred; an explicit one wins', () => {
        const type = typeWith(
            [
                { role: 'parent', linkProperty: 'show', mirrored: true },
                { role: 'parent', linkProperty: 'series', mirrored: true, cardinality: 'many' },
                { role: 'parent', linkProperty: 'base_game', mirrored: true, cardinality: 'one' }
            ],
            true
        )
        const lookup = (p: string): string | undefined =>
            p === 'series' || p === 'show' ? 'text' : undefined
        const byProp = Object.fromEntries(
            roleLinkRules(type, lookup).parent.map((r) => [r.property, r.cardinality])
        )
        expect(byProp).toEqual({ show: 'one', series: 'many', base_game: 'one' })
    })

    it('selectLinkProperty reports the chosen property cardinality', () => {
        const show: LinkRule = { property: 'show', cardinality: 'one', targetTypeIds: ['tv_shows'] }
        const list: LinkRule = { property: 'related', cardinality: 'many', targetTypeIds: [] }
        const choice = selectLinkProperty([show, list], 'tv_shows')
        expect(choice).toEqual({ kind: 'property', property: 'show', cardinality: 'one' })
        expect(chosenCardinality(choice)).toBe('one')
        expect(chosenCardinality(selectLinkProperty([show, list], 'other'))).toBe('many')
        expect(chosenCardinality({ kind: 'none' })).toBe('many')
        // two rules naming one property: 'one' wins
        const dup = selectLinkProperty(
            [
                { property: 'show', cardinality: 'many', targetTypeIds: [] },
                { property: 'Show', cardinality: 'one', targetTypeIds: [] }
            ],
            null
        )
        expect(chosenCardinality(dup)).toBe('one')
    })

    it('a re-parent skips the removal of a single-link property the write replaces', () => {
        expect(propertiesToClear(['show'], 'Show', 'one')).toEqual([])
        expect(propertiesToClear(['show', 'related_shows'], 'show', 'one')).toEqual([
            'related_shows'
        ])
        expect(propertiesToClear(['related'], 'related', 'many')).toEqual(['related'])
        expect(propertiesToClear(['show'], '', 'one')).toEqual(['show'])
    })
})
