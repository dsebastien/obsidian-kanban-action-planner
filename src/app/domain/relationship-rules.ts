import {
    DEFAULT_BLOCKED_BY_PROPERTY,
    DEFAULT_CHILD_PROPERTY,
    DEFAULT_PARENT_PROPERTY,
    DEFAULT_SIBLING_PROPERTY
} from '../constants'
import type { NoteType, RelationshipRole, RelationshipRule } from './note-type'

/**
 * Pure model of a note type's relationship rules (business rules 70-72).
 *
 * A role may carry several link rules, each optionally scoped to target note
 * types. READS take the union of every rule's property; WRITES pick the one
 * property that fits the TARGET note's recognized type ({@link selectLinkProperty}).
 */

export const ROLES: ReadonlyArray<RelationshipRole> = ['parent', 'sibling', 'child', 'blocked_by']

/** The per-role default link property (a role with no rule at all uses it). */
export const DEFAULT_ROLE_PROPERTY: Record<RelationshipRole, string> = {
    parent: DEFAULT_PARENT_PROPERTY,
    child: DEFAULT_CHILD_PROPERTY,
    sibling: DEFAULT_SIBLING_PROPERTY,
    blocked_by: DEFAULT_BLOCKED_BY_PROPERTY
}

/** One effective link rule: a property, optionally scoped to target types. */
export interface LinkRule {
    property: string
    /** This plugin's note type ids the rule applies to; empty = any type. */
    targetTypeIds: string[]
}

export type RoleLinkRules = Record<RelationshipRole, LinkRule[]>

type RuleSource = Pick<NoteType, 'relationships' | 'relationshipsMirrored'>

function emptyRoleRules(): RoleLinkRules {
    return { parent: [], sibling: [], child: [], blocked_by: [] }
}

function toLinkRule(rule: RelationshipRule): LinkRule | null {
    const property = rule.linkProperty.trim()
    if (property.length === 0) return null
    return { property, targetTypeIds: [...new Set(rule.targetTypeIds ?? [])] }
}

/**
 * The effective link rules per role.
 *
 * - **Local config:** a role with no rule uses its default property; a role
 *   with rules uses their non-empty properties verbatim, so an explicit empty
 *   `linkProperty` (the "None" marker) turns link detection off for the role.
 * - **Mirrored from the Starter Kit** (`relationshipsMirrored`): ONLY the
 *   mirrored rules count, with no defaults (the Starter Kit's declaration is
 *   complete: a role it does not mention is off). Local rules are kept in
 *   storage for the hand-back and contribute their heuristic only.
 */
export function roleLinkRules(noteType: RuleSource): RoleLinkRules {
    const out = emptyRoleRules()
    const mirrored = noteType.relationshipsMirrored === true
    for (const role of ROLES) {
        const own = noteType.relationships.filter((r) => r.role === role)
        if (mirrored) {
            for (const rule of own) {
                const link = rule.mirrored === true ? toLinkRule(rule) : null
                if (link) out[role].push(link)
            }
            continue
        }
        if (own.length === 0) {
            out[role].push({ property: DEFAULT_ROLE_PROPERTY[role], targetTypeIds: [] })
            continue
        }
        for (const rule of own) {
            const link = toLinkRule(rule)
            if (link) out[role].push(link)
        }
    }
    return out
}

/** Distinct property names of a role's rules (case-insensitive), first casing kept. */
export function distinctProperties(rules: ReadonlyArray<LinkRule>): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const rule of rules) {
        const key = rule.property.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(rule.property)
    }
    return out
}

/** Every role's distinct link properties (what READS union over). */
export function roleProperties(noteType: RuleSource): Record<RelationshipRole, string[]> {
    const rules = roleLinkRules(noteType)
    return {
        parent: distinctProperties(rules.parent),
        sibling: distinctProperties(rules.sibling),
        child: distinctProperties(rules.child),
        blocked_by: distinctProperties(rules.blocked_by)
    }
}

/** Outcome of picking the property to write a link into. */
export type LinkPropertyChoice =
    | { kind: 'property'; property: string }
    /** The role has no link property for this target (none configured, or none fits its type). */
    | { kind: 'none' }
    /** Several properties fit the target type: the write is refused, never guessed. */
    | { kind: 'ambiguous'; properties: string[] }

/**
 * Pick the property for a link to a target of `targetTypeId` (null = the target
 * has no recognized type): the rules whose targets include that type; else the
 * rules with no targets; exactly one distinct property writes, none or several
 * do not. A rule scoped to other types never matches an unrecognized target.
 */
export function selectLinkProperty(
    rules: ReadonlyArray<LinkRule>,
    targetTypeId: string | null
): LinkPropertyChoice {
    const scoped =
        targetTypeId === null ? [] : rules.filter((r) => r.targetTypeIds.includes(targetTypeId))
    const candidates =
        scoped.length > 0 ? scoped : rules.filter((r) => r.targetTypeIds.length === 0)
    const properties = distinctProperties(candidates)
    const [only] = properties
    if (properties.length === 1 && only !== undefined) return { kind: 'property', property: only }
    if (properties.length === 0) return { kind: 'none' }
    return { kind: 'ambiguous', properties }
}

/** The user-facing reason a {@link LinkPropertyChoice} is not writable. */
export function choiceProblem(
    choice: LinkPropertyChoice,
    role: RelationshipRole,
    targetLabel: string
): string {
    const roleLabel = role.replace('_', ' ')
    if (choice.kind === 'ambiguous') {
        return `several ${roleLabel} properties fit ${targetLabel} (${choice.properties.join(', ')}); scope the rules to note types`
    }
    return `no ${roleLabel} property is configured for ${targetLabel}`
}

/** The property to write, or '' when the choice is not writable. */
export function chosenProperty(choice: LinkPropertyChoice): string {
    return choice.kind === 'property' ? choice.property : ''
}
