import { DEFAULT_ROLE_PROPERTY, ROLES } from './relationship-rules'
import type { RelationshipRole, RelationshipRule } from './note-type'

/**
 * Pure edits of a note type's local relationship rules (Configure board ->
 * Relationships, rule 70). A role holds any number of link rules; the marker
 * `{ role, linkProperty: '' }` records "None" (a role with no rule at all uses
 * its default property, so deleting the last row must leave a marker behind).
 * Mirrored rules (from the Starter Kit) are never edited here.
 */

/** A rule that carries a link property the person can edit. */
export function isEditableLinkRule(rule: RelationshipRule): boolean {
    return rule.mirrored !== true && rule.linkProperty.trim().length > 0
}

/**
 * Give every role without any rule its default one, so an edit starts from
 * what the person SEES (the defaults) and never silently drops them.
 */
export function materializeRules(rules: ReadonlyArray<RelationshipRule>): RelationshipRule[] {
    const out = [...rules]
    for (const role of ROLES) {
        if (!out.some((r) => r.role === role)) {
            out.push({ role, linkProperty: DEFAULT_ROLE_PROPERTY[role] })
        }
    }
    return out
}

/** Indices (in `rules`) of a role's editable link rules, in order. */
export function linkRuleIndexes(
    rules: ReadonlyArray<RelationshipRule>,
    role: RelationshipRole
): number[] {
    const out: number[] = []
    rules.forEach((rule, index) => {
        if (rule.role === role && isEditableLinkRule(rule)) out.push(index)
    })
    return out
}

/** Add a link rule for a role, reusing the role's empty "None" marker when it has one. */
export function addLinkRule(
    rules: ReadonlyArray<RelationshipRule>,
    role: RelationshipRole,
    property: string
): RelationshipRule[] {
    const markerIndex = rules.findIndex(
        (r) => r.role === role && r.mirrored !== true && r.linkProperty === '' && !r.heuristic
    )
    const fresh: RelationshipRule = { role, linkProperty: property }
    if (markerIndex >= 0) return rules.map((r, i) => (i === markerIndex ? fresh : r))
    return [...rules, fresh]
}

/** Patch one rule (property and/or target types). Empty targets are stored as absent. */
export function updateLinkRule(
    rules: ReadonlyArray<RelationshipRule>,
    index: number,
    patch: { linkProperty?: string; targetTypeIds?: string[] }
): RelationshipRule[] {
    return rules.map((rule, i) => {
        if (i !== index) return rule
        const { targetTypeIds: _dropped, ...rest } = rule
        const targets = patch.targetTypeIds ?? rule.targetTypeIds ?? []
        return {
            ...rest,
            linkProperty: patch.linkProperty ?? rule.linkProperty,
            ...(targets.length > 0 ? { targetTypeIds: [...new Set(targets)] } : {})
        }
    })
}

/**
 * Remove a link rule. A rule that also carries the tag heuristic keeps the
 * heuristic (its property is just cleared); when it was the role's last rule a
 * "None" marker takes its place so the role does not fall back to its default.
 */
export function removeLinkRule(
    rules: ReadonlyArray<RelationshipRule>,
    index: number
): RelationshipRule[] {
    const target = rules[index]
    if (!target) return [...rules]
    if (target.heuristic) {
        const { targetTypeIds: _dropped, ...rest } = target
        return rules.map((r, i) => (i === index ? { ...rest, linkProperty: '' } : r))
    }
    const remaining = rules.filter((_, i) => i !== index)
    if (remaining.some((r) => r.role === target.role)) return remaining
    return [...remaining, { role: target.role, linkProperty: '' }]
}

/** The tags of the local child heuristic ("detect children by tag"). */
export function childHeuristicTags(rules: ReadonlyArray<RelationshipRule>): string[] {
    const rule = rules.find((r) => r.role === 'child' && r.mirrored !== true && r.heuristic)
    return rule?.heuristic?.allowedTypeTags ?? []
}

/**
 * Set (or clear, with no tags) the child heuristic on the local rules. It lives
 * on the first local child rule that already has it, else on the first local
 * child rule, else on a new one: link-less when the Starter Kit owns the link
 * properties (`mirrored`), the default property otherwise (a role with no rule
 * would otherwise lose its default).
 */
export function setChildHeuristic(
    rules: ReadonlyArray<RelationshipRule>,
    tags: ReadonlyArray<string>,
    mirrored: boolean
): RelationshipRule[] {
    const isLocalChild = (r: RelationshipRule): boolean => r.role === 'child' && r.mirrored !== true
    const heuristic =
        tags.length > 0 ? { allowedTypeTags: [...tags], requiresLinkToSource: true } : undefined
    const holder = rules.findIndex((r) => isLocalChild(r) && r.heuristic)
    const first = rules.findIndex(isLocalChild)
    const at = holder >= 0 ? holder : first
    if (at < 0) {
        if (!heuristic) return [...rules]
        return [
            ...rules,
            {
                role: 'child',
                linkProperty: mirrored ? '' : DEFAULT_ROLE_PROPERTY.child,
                heuristic
            }
        ]
    }
    return rules.map((rule, i) => {
        if (i !== at) return rule
        const { heuristic: _old, ...rest } = rule
        return heuristic ? { ...rest, heuristic } : rest
    })
}
