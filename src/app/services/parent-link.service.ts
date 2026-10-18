import type { App, TFile } from 'obsidian'
import { matchParentTitle } from '../domain/parent-link'
import type { ParentMatch } from '../domain/parent-link'

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
