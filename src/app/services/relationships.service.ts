import { getAllTags } from 'obsidian'
import type { App, TFile } from 'obsidian'
import type { NoteType, RelationshipRole } from '../domain/note-type'
import {
    RELATIONSHIP_ROLES,
    emptyRelationshipSet,
    normalizeTag,
    resolveRelationships
} from '../domain/relationships'
import type { HeuristicRule, NoteRecord, RelationshipSet } from '../domain/relationships'
import { isArchivedPath } from '../domain/archive-paths'
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
 * {@link resolveRelationships}. Role link-property names come from the note type's
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
export function roleProperties(noteType: NoteType): Record<RelationshipRole, string> {
    const map = { ...DEFAULT_ROLE_PROPERTY }
    for (const rule of noteType.relationships) {
        map[rule.role] = rule.linkProperty.trim()
    }
    return map
}

/**
 * The roles that are turned on for a note type. A role is active when it has a
 * non-empty link-property or a configured heuristic; a role with neither is
 * "None" and is fully suppressed (no direct, inverse, or heuristic relations).
 */
export function activeRoles(
    noteType: NoteType,
    props: Record<RelationshipRole, string>
): Set<RelationshipRole> {
    const withHeuristic = new Set(
        noteType.relationships.filter((r) => r.heuristic).map((r) => r.role)
    )
    const active = new Set<RelationshipRole>()
    for (const role of RELATIONSHIP_ROLES) {
        if (props[role].length > 0 || withHeuristic.has(role)) active.add(role)
    }
    return active
}

/** Heuristic rules declared on the note type, normalized for the domain. */
function heuristicRules(noteType: NoteType): HeuristicRule[] {
    const rules: HeuristicRule[] = []
    for (const rule of noteType.relationships) {
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
 * Resolve relationships for every board file under the active note type. Returns a
 * map keyed by file path; missing files default to an empty set.
 *
 * `archivePrefixes` are the static folder prefixes of the configured archive
 * folders (across note types). A `blocked_by` target whose note lives under one
 * of them is **archived** and is dropped, so an archived blocker stops blocking
 * the card while active off-board blockers (a project on another board) keep
 * blocking (issue #13).
 */
export function resolveBoardRelationships(
    app: App,
    files: ReadonlyArray<TFile>,
    noteType: NoteType,
    archivePrefixes: ReadonlyArray<string> = []
): Map<string, RelationshipSet> {
    const props = roleProperties(noteType)
    const records = files.map((file) => toRecord(app, file, props))
    const resolved = resolveRelationships(
        records,
        heuristicRules(noteType),
        activeRoles(noteType, props)
    )
    if (archivePrefixes.length > 0) {
        for (const set of resolved.values()) {
            set.blocked_by = set.blocked_by.filter(
                (target) => !isArchivedPath(target, archivePrefixes)
            )
        }
    }
    return resolved
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
