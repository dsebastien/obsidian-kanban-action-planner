import type { App, TFile } from 'obsidian'
import { matchParentTitle } from '../domain/parent-link'
import type { ParentLinkPlan, ParentMatch } from '../domain/parent-link'
import { findKeyCaseInsensitive } from './frontmatter.service'

/**
 * Resolve the note a `parent:` search term names (business rule 72): the link
 * resolution Obsidian itself would give `[[title]]` from `hostPath` first (exact
 * basename, the embedding note's folder winning ties), else a unique vault note
 * by basename (`matchParentTitle`). Never guesses between several candidates.
 */
export function resolveParentNote(
    app: App,
    title: string,
    hostPath: string
): { match: ParentMatch; file: TFile | null } {
    const wanted = title.trim()
    if (wanted.length === 0) return { match: { kind: 'missing' }, file: null }
    const linked = app.metadataCache.getFirstLinkpathDest(wanted, hostPath)
    if (linked) {
        return {
            match: { kind: 'found', note: { path: linked.path, basename: linked.basename } },
            file: linked
        }
    }
    const files = app.vault.getMarkdownFiles()
    const match = matchParentTitle(
        wanted,
        files.map((f) => ({ path: f.path, basename: f.basename }))
    )
    if (match.kind !== 'found') return { match, file: null }
    const { path } = match.note
    return { match, file: files.find((f) => f.path === path) ?? null }
}

/**
 * Add a planned parent link to the new note's creation facts (rule 72 + 73).
 * A 'one' (single-link) property goes into `properties` as the scalar wikilink,
 * REPLACING any value the Base facts put there; a 'many' property joins
 * `listProperties`, appended to the Base's list facts. Both are written in the
 * single post-template frontmatter transaction (rule 44). Mutates the maps.
 */
export function placeParentLink(
    properties: Record<string, unknown>,
    listProperties: Record<string, string[]>,
    plan: ParentLinkPlan
): void {
    if (plan.kind !== 'link') return
    if (plan.cardinality === 'one') {
        properties[findKeyCaseInsensitive(properties, plan.property) ?? plan.property] = plan.link
        return
    }
    const name = findKeyCaseInsensitive(listProperties, plan.property) ?? plan.property
    listProperties[name] = [...(listProperties[name] ?? []), plan.link]
}
