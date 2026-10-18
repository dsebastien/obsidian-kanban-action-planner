import { describe, expect, it } from 'bun:test'
import {
    matchParentTitle,
    parentLinkSubtitle,
    parentLinkUnmet,
    planParentLink
} from './parent-link'
import type { NoteRef, PlanParentLinkInput } from './parent-link'

const notes: NoteRef[] = [
    { path: 'P/AI Tooling (Project).md', basename: 'AI Tooling (Project)' },
    { path: 'P/AI Tooling (Task).md', basename: 'AI Tooling (Task)' },
    { path: 'P/Garden (Project).md', basename: 'Garden (Project)' }
]

describe('matchParentTitle', () => {
    it('prefers the unique exact basename, case-insensitively', () => {
        expect(matchParentTitle('ai tooling (project)', notes)).toEqual({
            kind: 'found',
            note: notes[0] ?? { path: '', basename: '' }
        })
    })

    it('falls back to a unique substring match (the filter is a substring match)', () => {
        const found = matchParentTitle('garden', notes)
        expect(found.kind).toBe('found')
    })

    it('never guesses between several substring candidates', () => {
        expect(matchParentTitle('AI Tooling', notes)).toEqual({ kind: 'ambiguous', count: 2 })
    })

    it('an exact match wins over longer names containing it', () => {
        const withShort = [...notes, { path: 'AI Tooling.md', basename: 'AI Tooling' }]
        expect(matchParentTitle('AI Tooling', withShort).kind).toBe('found')
    })

    it('reports duplicates of the exact name as ambiguous', () => {
        const dup = [
            { path: 'a/X.md', basename: 'X' },
            { path: 'b/X.md', basename: 'X' }
        ]
        expect(matchParentTitle('X', dup)).toEqual({ kind: 'ambiguous', count: 2 })
    })

    it('nothing or a blank title is missing', () => {
        expect(matchParentTitle('Nope', notes)).toEqual({ kind: 'missing' })
        expect(matchParentTitle('  ', notes)).toEqual({ kind: 'missing' })
    })
})

describe('planParentLink', () => {
    const project = notes[0] ?? { path: '', basename: '' }
    const base: PlanParentLinkInput = {
        term: { field: 'parent', title: 'AI Tooling (Project)' },
        match: { kind: 'found', note: project },
        parentTypeId: 'projects',
        rules: [
            { property: 'related_projects', cardinality: 'many', targetTypeIds: ['projects'] },
            { property: 'related_goals', cardinality: 'many', targetTypeIds: ['goals'] }
        ],
        link: '[[AI Tooling (Project)]]'
    }

    it('no term: nothing to do', () => {
        expect(planParentLink({ ...base, term: null })).toEqual({ kind: 'none' })
        expect(parentLinkSubtitle({ kind: 'none' })).toBe('')
        expect(parentLinkUnmet({ kind: 'none' })).toBeNull()
    })

    it('picks the property by the parent type and says so', () => {
        const plan = planParentLink(base)
        expect(plan).toEqual({
            kind: 'link',
            term: 'AI Tooling (Project)',
            property: 'related_projects',
            cardinality: 'many',
            link: '[[AI Tooling (Project)]]'
        })
        expect(parentLinkSubtitle(plan)).toBe(
            'Linked to [[AI Tooling (Project)]] via related_projects.'
        )
        expect(parentLinkUnmet(plan)).toBeNull()
    })

    it('a goal parent goes to the goal property', () => {
        const plan = planParentLink({ ...base, parentTypeId: 'goals' })
        expect(plan.kind === 'link' && plan.property).toBe('related_goals')
    })

    it('a single unscoped rule links any parent (0/1 candidate rule)', () => {
        const plan = planParentLink({
            ...base,
            parentTypeId: null,
            rules: [{ property: 'parent', cardinality: 'many', targetTypeIds: [] }]
        })
        expect(plan.kind === 'link' && plan.property).toBe('parent')
    })

    it('no rule fits the parent type: blocked, with the reason', () => {
        const plan = planParentLink({ ...base, parentTypeId: 'plans' })
        expect(plan.kind).toBe('blocked')
        expect(parentLinkSubtitle(plan)).toContain('no parent property is configured')
        expect(parentLinkUnmet(plan)).toContain('parent "AI Tooling (Project)"')
    })

    it('several rules fit: blocked as ambiguous', () => {
        const plan = planParentLink({
            ...base,
            rules: [
                { property: 'a', cardinality: 'many', targetTypeIds: [] },
                { property: 'b', cardinality: 'many', targetTypeIds: [] }
            ]
        })
        expect(plan.kind === 'blocked' && plan.reason).toContain('a, b')
    })

    it('an unresolved or ambiguous parent note is blocked, never linked', () => {
        const missing = planParentLink({ ...base, match: { kind: 'missing' } })
        expect(parentLinkSubtitle(missing)).toContain('no note is named')
        const ambiguous = planParentLink({ ...base, match: { kind: 'ambiguous', count: 3 } })
        expect(parentLinkSubtitle(ambiguous)).toContain('3 notes match')
    })

    it('ancestor: is never written', () => {
        const plan = planParentLink({ ...base, term: { field: 'ancestor', title: 'AI Tooling' } })
        expect(plan.kind).toBe('blocked')
        expect(parentLinkUnmet(plan)).toContain('ancestor "AI Tooling"')
        expect(parentLinkSubtitle(plan)).toContain('whole subtree')
    })
})
