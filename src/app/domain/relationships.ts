import type { RelationshipRole } from './profile'

/**
 * Pure relationship resolution.
 *
 * Given per-note records (each carrying its tags, the resolved targets of its
 * role link-properties, and all its outgoing links), resolve every note's
 * related notes per role by combining three sources:
 *
 * - **Direct** — the targets a note names in its own role link-property. May
 *   point outside the known set (e.g. a blocker not on this board).
 * - **Inverse** — reverse lookup within the known set: `parent`/`child` are
 *   inverses, `sibling` is symmetric (`blocked_by` has no modelled inverse).
 * - **Heuristic** — a secondary, link-scoped rule: a note carrying an allowed
 *   type tag and linking to a source note is treated as standing in the rule's
 *   role relative to that source.
 *
 * Everything here is pure and unit-tested with plain objects; the Obsidian
 * metadata bridge lives in `services/relationships.service.ts`.
 */

export const RELATIONSHIP_ROLES: RelationshipRole[] = ['parent', 'sibling', 'child', 'blocked_by']

/** Inverse role for reverse lookup, or `null` when the role has no inverse. */
const INVERSE: Record<RelationshipRole, RelationshipRole | null> = {
    parent: 'child',
    child: 'parent',
    sibling: 'sibling',
    blocked_by: null
}

export interface NoteRecord {
    /** The note's key (its vault path). */
    key: string
    /** All of the note's tags, normalized (lowercase, leading `#`). */
    tags: ReadonlyArray<string>
    /** Resolved target keys of each role link-property the note declares. */
    roleLinks: Partial<Record<RelationshipRole, ReadonlyArray<string>>>
    /** All resolved outgoing link target keys (used by the heuristic). */
    outgoingLinks: ReadonlyArray<string>
}

/** A secondary, tag-and-link-based detection rule for a role. */
export interface HeuristicRule {
    role: RelationshipRole
    /** Allowed type tags, normalized (lowercase, leading `#`). */
    allowedTypeTags: ReadonlyArray<string>
    /** Only link-scoped heuristics are supported; `false` disables the rule. */
    requiresLinkToSource: boolean
}

export type RelationshipSet = Record<RelationshipRole, string[]>

export function emptyRelationshipSet(): RelationshipSet {
    return { parent: [], sibling: [], child: [], blocked_by: [] }
}

/** Normalize a tag to lowercase with a single leading `#`. */
export function normalizeTag(tag: string): string {
    const trimmed = tag.trim().toLowerCase().replace(/^#+/, '')
    return trimmed.length > 0 ? `#${trimmed}` : ''
}

/**
 * Resolve relationships for every record. Returns a map keyed by note key; each
 * value is the note's role sets (deduped, self-references removed). Direct links
 * are kept even when they leave the known set; inverse and heuristic relations
 * are only formed between known records.
 */
export function resolveRelationships(
    records: ReadonlyArray<NoteRecord>,
    heuristics: ReadonlyArray<HeuristicRule> = []
): Map<string, RelationshipSet> {
    const inSet = new Set(records.map((r) => r.key))
    const result = new Map<string, RelationshipSet>()
    for (const r of records) result.set(r.key, emptyRelationshipSet())

    const add = (key: string, role: RelationshipRole, target: string): void => {
        if (target === key) return
        const set = result.get(key)
        if (!set) return
        if (!set[role].includes(target)) set[role].push(target)
    }

    // Direct + inverse from declared role link-properties.
    for (const record of records) {
        for (const role of RELATIONSHIP_ROLES) {
            const targets = record.roleLinks[role]
            if (!targets) continue
            for (const target of targets) {
                add(record.key, role, target)
                const inverse = INVERSE[role]
                if (inverse && inSet.has(target)) add(target, inverse, record.key)
            }
        }
    }

    // Heuristic: a tagged note linking to a known source stands in the role.
    for (const heuristic of heuristics) {
        if (!heuristic.requiresLinkToSource) continue
        const tags = new Set(
            heuristic.allowedTypeTags.map(normalizeTag).filter((t) => t.length > 0)
        )
        if (tags.size === 0) continue
        for (const record of records) {
            if (!record.tags.some((t) => tags.has(t))) continue
            for (const target of record.outgoingLinks) {
                if (!inSet.has(target) || target === record.key) continue
                add(target, heuristic.role, record.key)
                const inverse = INVERSE[heuristic.role]
                if (inverse) add(record.key, inverse, target)
            }
        }
    }

    return result
}
