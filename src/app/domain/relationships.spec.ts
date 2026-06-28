import { describe, expect, it } from 'bun:test'
import { normalizeTag, resolveRelationships } from './relationships'
import type { HeuristicRule, NoteRecord } from './relationships'
import type { RelationshipRole } from './note-type'

function record(
    key: string,
    roleLinks: NoteRecord['roleLinks'] = {},
    tags: string[] = [],
    outgoingLinks: string[] = []
): NoteRecord {
    return { key, tags, roleLinks, outgoingLinks }
}

describe('normalizeTag', () => {
    it('lowercases and ensures a single leading #', () => {
        expect(normalizeTag('Task')).toBe('#task')
        expect(normalizeTag('#Action')).toBe('#action')
        expect(normalizeTag('##Foo')).toBe('#foo')
    })

    it('returns empty string for blank input', () => {
        expect(normalizeTag('  ')).toBe('')
        expect(normalizeTag('#')).toBe('')
    })
})

describe('resolveRelationships', () => {
    it('keeps direct links and derives the inverse parent<->child', () => {
        const rels = resolveRelationships([record('a.md', { child: ['b.md'] }), record('b.md')])
        expect(rels.get('a.md')?.child).toEqual(['b.md'])
        expect(rels.get('b.md')?.parent).toEqual(['a.md'])
    })

    it('derives child from a declared parent (reverse lookup)', () => {
        const rels = resolveRelationships([
            record('child.md', { parent: ['parent.md'] }),
            record('parent.md')
        ])
        expect(rels.get('parent.md')?.child).toEqual(['child.md'])
        expect(rels.get('child.md')?.parent).toEqual(['parent.md'])
    })

    it('treats siblings as symmetric', () => {
        const rels = resolveRelationships([record('a.md', { sibling: ['b.md'] }), record('b.md')])
        expect(rels.get('a.md')?.sibling).toEqual(['b.md'])
        expect(rels.get('b.md')?.sibling).toEqual(['a.md'])
    })

    it('keeps blocked_by direct and forms no inverse role', () => {
        const rels = resolveRelationships([
            record('a.md', { blocked_by: ['b.md'] }),
            record('b.md')
        ])
        expect(rels.get('a.md')?.blocked_by).toEqual(['b.md'])
        expect(rels.get('b.md')?.blocked_by).toEqual([])
        expect(rels.get('b.md')?.parent).toEqual([])
    })

    it('keeps direct links that point outside the known set (no inverse)', () => {
        const rels = resolveRelationships([record('a.md', { blocked_by: ['external.md'] })])
        expect(rels.get('a.md')?.blocked_by).toEqual(['external.md'])
        expect(rels.has('external.md')).toBe(false)
    })

    it('ignores self-references', () => {
        const rels = resolveRelationships([record('a.md', { parent: ['a.md'] })])
        expect(rels.get('a.md')?.parent).toEqual([])
    })

    it('dedupes repeated targets', () => {
        const rels = resolveRelationships([
            record('a.md', { child: ['b.md', 'b.md'] }),
            record('b.md', { parent: ['a.md'] })
        ])
        expect(rels.get('a.md')?.child).toEqual(['b.md'])
        expect(rels.get('b.md')?.parent).toEqual(['a.md'])
    })

    it('applies a link-scoped tag heuristic to derive child + inverse parent', () => {
        const heuristic: HeuristicRule = {
            role: 'child',
            allowedTypeTags: ['#task'],
            requiresLinkToSource: true
        }
        const rels = resolveRelationships(
            [record('project.md'), record('task.md', {}, ['#task'], ['project.md'])],
            [heuristic]
        )
        expect(rels.get('project.md')?.child).toEqual(['task.md'])
        expect(rels.get('task.md')?.parent).toEqual(['project.md'])
    })

    it('skips the heuristic when the tagged note does not link to a known source', () => {
        const heuristic: HeuristicRule = {
            role: 'child',
            allowedTypeTags: ['#task'],
            requiresLinkToSource: true
        }
        const rels = resolveRelationships(
            [record('project.md'), record('task.md', {}, ['#task'], ['elsewhere.md'])],
            [heuristic]
        )
        expect(rels.get('project.md')?.child).toEqual([])
    })

    it('ignores an unscoped heuristic (requiresLinkToSource false)', () => {
        const heuristic: HeuristicRule = {
            role: 'child',
            allowedTypeTags: ['#task'],
            requiresLinkToSource: false
        }
        const rels = resolveRelationships(
            [record('project.md'), record('task.md', {}, ['#task'], ['project.md'])],
            [heuristic]
        )
        expect(rels.get('project.md')?.child).toEqual([])
    })

    describe('inactive roles (configured as "None")', () => {
        const active = (...roles: RelationshipRole[]): Set<RelationshipRole> => new Set(roles)

        it('suppresses a direct link for an inactive role', () => {
            const rels = resolveRelationships(
                [record('a.md', { blocked_by: ['b.md'] }), record('b.md')],
                [],
                active('parent', 'sibling', 'child') // blocked_by off
            )
            expect(rels.get('a.md')?.blocked_by).toEqual([])
        })

        it('suppresses the inverse into an inactive role (parent off, child kept)', () => {
            const rels = resolveRelationships(
                [record('a.md', { child: ['b.md'] }), record('b.md')],
                [],
                active('child', 'sibling', 'blocked_by') // parent off
            )
            // The active child link still resolves...
            expect(rels.get('a.md')?.child).toEqual(['b.md'])
            // ...but b never gets a parent badge, since parent is off.
            expect(rels.get('b.md')?.parent).toEqual([])
        })

        it('suppresses both directions of a symmetric inactive role (sibling off)', () => {
            const rels = resolveRelationships(
                [record('a.md', { sibling: ['b.md'] }), record('b.md')],
                [],
                active('parent', 'child', 'blocked_by') // sibling off
            )
            expect(rels.get('a.md')?.sibling).toEqual([])
            expect(rels.get('b.md')?.sibling).toEqual([])
        })

        it('suppresses heuristic-derived relations for an inactive role (child off)', () => {
            const heuristic: HeuristicRule = {
                role: 'child',
                allowedTypeTags: ['#task'],
                requiresLinkToSource: true
            }
            const rels = resolveRelationships(
                [record('project.md'), record('task.md', {}, ['#task'], ['project.md'])],
                [heuristic],
                active('parent', 'sibling', 'blocked_by') // child off
            )
            expect(rels.get('project.md')?.child).toEqual([])
            // The inverse parent is still allowed onto the active 'parent' role.
            expect(rels.get('task.md')?.parent).toEqual(['project.md'])
        })
    })
})
