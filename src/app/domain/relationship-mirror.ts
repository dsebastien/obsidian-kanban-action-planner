import type { RelationshipRule } from './note-type'

/**
 * Mirror of a Starter Kit note type's relationship rules (business rule 71).
 *
 * Pure: the service reads `getNoteTypeRelationships` and hands the normalized
 * rules here. Mirrored rules carry `mirrored: true`; the type's
 * `relationshipsMirrored` flag says the Starter Kit's declaration is complete.
 * Local rules are never dropped, so a Starter Kit that stops declaring its
 * relationships hands back the config the person had before.
 */

export interface MirroredRelationshipSource {
    role: RelationshipRule['role']
    property: string
    targetTypeIds: string[]
    /** Absent when the Starter Kit does not say (older versions): the plugin infers it. */
    cardinality?: 'one' | 'many'
}

export interface RelationshipState {
    relationships: RelationshipRule[]
    relationshipsMirrored: boolean
}

/** The Starter Kit's rules as mirrored (read-only) rules. */
export function mirroredRelationshipRules(
    source: ReadonlyArray<MirroredRelationshipSource>
): RelationshipRule[] {
    return source.map((rule) => ({
        role: rule.role,
        linkProperty: rule.property,
        ...(rule.targetTypeIds.length > 0 ? { targetTypeIds: [...rule.targetTypeIds] } : {}),
        ...(rule.cardinality ? { cardinality: rule.cardinality } : {}),
        mirrored: true
    }))
}

/**
 * Reconcile a type's stored rules with the Starter Kit's: `source` null (not
 * configured, or an installed Starter Kit without the API) hands back the
 * local rules; any array (even empty) is the one declaration of the type's
 * link-properties.
 */
export function reconcileRelationships(
    current: ReadonlyArray<RelationshipRule>,
    source: ReadonlyArray<MirroredRelationshipSource> | null
): RelationshipState {
    const local = current.filter((rule) => rule.mirrored !== true)
    if (source === null) return { relationships: local, relationshipsMirrored: false }
    return {
        relationships: [...mirroredRelationshipRules(source), ...local],
        relationshipsMirrored: true
    }
}
