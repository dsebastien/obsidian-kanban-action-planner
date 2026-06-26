import { getAllTags } from 'obsidian'
import type { App, TFile } from 'obsidian'
import type { Profile, RelationshipRole } from '../domain/profile'
import {
    RELATIONSHIP_ROLES,
    emptyRelationshipSet,
    normalizeTag,
    resolveRelationships
} from '../domain/relationships'
import type { HeuristicRule, NoteRecord, RelationshipSet } from '../domain/relationships'
import {
    DEFAULT_BLOCKED_BY_PROPERTY,
    DEFAULT_CHILD_PROPERTY,
    DEFAULT_PARENT_PROPERTY,
    DEFAULT_SIBLING_PROPERTY
} from '../constants'

/**
 * Bridges Obsidian's metadata cache to the pure relationship domain.
 *
 * For each board file it reads tags (`getAllTags`), the resolved targets of each
 * role's link-property (`frontmatterLinks` + `getFirstLinkpathDest`), and all
 * outgoing links (`metadataCache.resolvedLinks`), then runs
 * {@link resolveRelationships}. Role link-property names come from the profile's
 * relationship rules, falling back to per-role defaults so it works out of the
 * box. Nothing here is written — relationships are read-only this milestone.
 */

const DEFAULT_ROLE_PROPERTY: Record<RelationshipRole, string> = {
    parent: DEFAULT_PARENT_PROPERTY,
    child: DEFAULT_CHILD_PROPERTY,
    sibling: DEFAULT_SIBLING_PROPERTY,
    blocked_by: DEFAULT_BLOCKED_BY_PROPERTY
}

/**
 * Effective link-property name per role. A missing rule uses the per-role
 * default; a present rule uses its value verbatim — so an explicit empty value
 * disables link-based detection for that role (heuristics still apply).
 */
export function roleProperties(profile: Profile): Record<RelationshipRole, string> {
    const map = { ...DEFAULT_ROLE_PROPERTY }
    for (const rule of profile.relationships) {
        map[rule.role] = rule.linkProperty.trim()
    }
    return map
}

/** Heuristic rules declared on the profile, normalized for the domain. */
function heuristicRules(profile: Profile): HeuristicRule[] {
    const rules: HeuristicRule[] = []
    for (const rule of profile.relationships) {
        if (!rule.heuristic) continue
        rules.push({
            role: rule.role,
            allowedTypeTags: rule.heuristic.allowedTypeTags.map(normalizeTag),
            requiresLinkToSource: rule.heuristic.requiresLinkToSource
        })
    }
    return rules
}

/** Resolve the targets of one frontmatter link-property (case-insensitive key match). */
function linkPropertyTargets(app: App, file: TFile, property: string): string[] {
    const links = app.metadataCache.getFileCache(file)?.frontmatterLinks
    if (!links) return []
    const prop = property.toLowerCase()
    const out: string[] = []
    for (const link of links) {
        const key = link.key.toLowerCase()
        if (key !== prop && !key.startsWith(`${prop}.`)) continue
        const linkpath = link.link.split('#')[0] ?? link.link
        const dest = app.metadataCache.getFirstLinkpathDest(linkpath, file.path)
        if (dest && !out.includes(dest.path)) out.push(dest.path)
    }
    return out
}

/** Build a {@link NoteRecord} for one file. */
function toRecord(app: App, file: TFile, props: Record<RelationshipRole, string>): NoteRecord {
    const cache = app.metadataCache.getFileCache(file)
    const tags = (cache ? (getAllTags(cache) ?? []) : [])
        .map(normalizeTag)
        .filter((t) => t.length > 0)
    const roleLinks: Partial<Record<RelationshipRole, string[]>> = {}
    for (const role of RELATIONSHIP_ROLES) {
        const targets = linkPropertyTargets(app, file, props[role])
        if (targets.length > 0) roleLinks[role] = targets
    }
    const resolved = app.metadataCache.resolvedLinks[file.path] ?? {}
    return { key: file.path, tags, roleLinks, outgoingLinks: Object.keys(resolved) }
}

/**
 * Resolve relationships for every board file under the active profile. Returns a
 * map keyed by file path; missing files default to an empty set.
 */
export function resolveBoardRelationships(
    app: App,
    files: ReadonlyArray<TFile>,
    profile: Profile
): Map<string, RelationshipSet> {
    const props = roleProperties(profile)
    const records = files.map((file) => toRecord(app, file, props))
    return resolveRelationships(records, heuristicRules(profile))
}

/** A related note resolved for display/navigation. */
export interface RelatedNote {
    key: string
    label: string
}

export type CardRelationships = Record<RelationshipRole, RelatedNote[]>

/** Turn a resolved {@link RelationshipSet} into display-ready related notes. */
export function toCardRelationships(set: RelationshipSet | undefined): CardRelationships {
    const out: CardRelationships = {
        parent: [],
        sibling: [],
        child: [],
        blocked_by: []
    }
    if (!set) return out
    for (const role of RELATIONSHIP_ROLES) {
        out[role] = set[role].map((key) => ({ key, label: basenameOf(key) }))
    }
    return out
}

/** True when a card has any related note across all roles. */
export function hasAnyRelationship(rels: CardRelationships): boolean {
    return RELATIONSHIP_ROLES.some((role) => rels[role].length > 0)
}

/** The empty card-relationships value (no related notes). */
export function emptyCardRelationships(): CardRelationships {
    return toCardRelationships(emptyRelationshipSet())
}

/** Display label for a vault path: the file's base name without extension. */
function basenameOf(path: string): string {
    const file = path.split('/').pop() ?? path
    return file.endsWith('.md') ? file.slice(0, -3) : file
}
