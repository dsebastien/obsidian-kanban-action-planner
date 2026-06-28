import { describe, expect, it } from 'bun:test'
import { activeRoles, roleProperties } from './relationships.service'
import { createDefaultNoteType } from './note-type.service'
import type { NoteType, RelationshipRole } from '../domain/note-type'

function noteTypeWith(rules: NoteType['relationships']): NoteType {
    const noteType = createDefaultNoteType('p', 'P', 'local')
    return { ...noteType, relationships: rules }
}

describe('activeRoles', () => {
    it('marks a role active when it has a non-empty link-property', () => {
        const noteType = noteTypeWith([{ role: 'parent', linkProperty: 'parent' }])
        const props = roleProperties(noteType)
        expect(activeRoles(noteType, props).has('parent')).toBe(true)
    })

    it('marks a role inactive when its link-property is empty ("None") and it has no heuristic', () => {
        const noteType = noteTypeWith([
            { role: 'parent', linkProperty: '' },
            { role: 'sibling', linkProperty: '' },
            { role: 'child', linkProperty: '' },
            { role: 'blocked_by', linkProperty: '' }
        ])
        const props = roleProperties(noteType)
        const active = activeRoles(noteType, props)
        expect(active.has('parent')).toBe(false)
        expect(active.has('sibling')).toBe(false)
        expect(active.has('child')).toBe(false)
        expect(active.has('blocked_by')).toBe(false)
    })

    it('keeps a role active when it has a heuristic even with an empty property', () => {
        const noteType = noteTypeWith([
            {
                role: 'child',
                linkProperty: '',
                heuristic: { allowedTypeTags: ['#task'], requiresLinkToSource: true }
            }
        ])
        const props = roleProperties(noteType)
        expect(activeRoles(noteType, props).has('child')).toBe(true)
    })

    it('treats a role with no rule as active (out-of-the-box default property)', () => {
        // A noteType missing a rule for a role falls back to that role's default
        // property in roleProperties, so the role stays on by default.
        const noteType = noteTypeWith([{ role: 'blocked_by', linkProperty: '' }])
        const props = roleProperties(noteType)
        const active = activeRoles(noteType, props)
        const defaulted: RelationshipRole[] = ['parent', 'sibling', 'child']
        for (const role of defaulted) expect(active.has(role)).toBe(true)
        expect(active.has('blocked_by')).toBe(false)
    })
})
