import { describe, expect, it } from 'bun:test'
import { activeRoles, roleProperties } from './relationships.service'
import { createDefaultProfile } from './profile-service'
import type { Profile, RelationshipRole } from '../domain/profile'

function profileWith(rules: Profile['relationships']): Profile {
    const profile = createDefaultProfile('p', 'P', 'local')
    return { ...profile, relationships: rules }
}

describe('activeRoles', () => {
    it('marks a role active when it has a non-empty link-property', () => {
        const profile = profileWith([{ role: 'parent', linkProperty: 'parent' }])
        const props = roleProperties(profile)
        expect(activeRoles(profile, props).has('parent')).toBe(true)
    })

    it('marks a role inactive when its link-property is empty ("None") and it has no heuristic', () => {
        const profile = profileWith([
            { role: 'parent', linkProperty: '' },
            { role: 'sibling', linkProperty: '' },
            { role: 'child', linkProperty: '' },
            { role: 'blocked_by', linkProperty: '' }
        ])
        const props = roleProperties(profile)
        const active = activeRoles(profile, props)
        expect(active.has('parent')).toBe(false)
        expect(active.has('sibling')).toBe(false)
        expect(active.has('child')).toBe(false)
        expect(active.has('blocked_by')).toBe(false)
    })

    it('keeps a role active when it has a heuristic even with an empty property', () => {
        const profile = profileWith([
            {
                role: 'child',
                linkProperty: '',
                heuristic: { allowedTypeTags: ['#task'], requiresLinkToSource: true }
            }
        ])
        const props = roleProperties(profile)
        expect(activeRoles(profile, props).has('child')).toBe(true)
    })

    it('treats a role with no rule as active (out-of-the-box default property)', () => {
        // A profile missing a rule for a role falls back to that role's default
        // property in roleProperties, so the role stays on by default.
        const profile = profileWith([{ role: 'blocked_by', linkProperty: '' }])
        const props = roleProperties(profile)
        const active = activeRoles(profile, props)
        const defaulted: RelationshipRole[] = ['parent', 'sibling', 'child']
        for (const role of defaulted) expect(active.has(role)).toBe(true)
        expect(active.has('blocked_by')).toBe(false)
    })
})
