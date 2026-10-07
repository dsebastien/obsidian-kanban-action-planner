import { TFile } from 'obsidian'
import type { TAbstractFile } from 'obsidian'

/**
 * What a card-cover property value points at (pure parse, no vault access):
 * - `url` — an `http(s)` URL, used as is;
 * - `link` — a `[[wikilink]]` / `![[embed]]` (alias + `#subpath` stripped),
 *   resolved like Obsidian resolves links;
 * - `path` — a plain vault path, looked up verbatim.
 */
export type CoverReference =
    | { kind: 'url'; url: string }
    | { kind: 'link'; linkpath: string }
    | { kind: 'path'; path: string }

/** First non-empty string of a raw frontmatter / Bases value (lists → first item). */
export function firstCoverText(raw: unknown): string | null {
    if (Array.isArray(raw)) {
        for (const item of raw) {
            const text = firstCoverText(item)
            if (text) return text
        }
        return null
    }
    if (typeof raw !== 'string') return null
    const text = raw.trim()
    // A Bases `NullValue` stringifies as "null".
    return text === '' || text === 'null' ? null : text
}

/**
 * Classify a cover value. Accepts `http(s)://…`, `[[target|alias]]`,
 * `![[target#sub]]`, a Markdown image `![alt](target)` (its target is
 * re-classified), or a plain vault path (a leading `/` is dropped). Anything
 * else (`file://`, `data:`, other schemes) yields null → no cover.
 */
export function parseCoverReference(raw: unknown): CoverReference | null {
    const text = firstCoverText(raw)
    if (!text) return null
    if (/^https?:\/\//i.test(text)) return { kind: 'url', url: text }

    const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(text)
    if (wiki?.[1] !== undefined) {
        const linkpath = stripSubpath(wiki[1].split('|')[0] ?? '')
        return linkpath ? { kind: 'link', linkpath } : null
    }

    const md = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(text)
    if (md?.[1] !== undefined) {
        let target = md[1].trim()
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
        if (/^https?:\/\//i.test(target)) return { kind: 'url', url: target }
        const path = safeDecode(stripSubpath(target))
        return path ? { kind: 'link', linkpath: path } : null
    }

    // Some other URL scheme (file:, data:, app:, …) — not a vault path.
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) return null

    const path = text.replace(/^\/+/, '')
    return path ? { kind: 'path', path } : null
}

function stripSubpath(link: string): string {
    const hash = link.indexOf('#')
    return (hash >= 0 ? link.slice(0, hash) : link).trim()
}

function safeDecode(text: string): string {
    try {
        return decodeURI(text)
    } catch {
        return text
    }
}

/** The vault surface {@link resolveCoverUrl} needs (an `App` satisfies it; kept narrow for testing). */
export interface CoverApp {
    vault: {
        getAbstractFileByPath(path: string): TAbstractFile | null
        getResourcePath(file: TFile): string
    }
    metadataCache: {
        getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null
    }
}

/**
 * Resolve a cover property value to a displayable image URL, or null (no
 * cover). URLs pass through; wikilinks resolve via
 * `metadataCache.getFirstLinkpathDest` relative to `sourcePath`; plain paths via
 * `vault.getAbstractFileByPath` (falling back to link resolution so a bare file
 * name works too); local files go through `vault.getResourcePath`.
 */
export function resolveCoverUrl(app: CoverApp, raw: unknown, sourcePath: string): string | null {
    const ref = parseCoverReference(raw)
    if (!ref) return null
    if (ref.kind === 'url') return ref.url
    let file: unknown = null
    if (ref.kind === 'path') {
        file = app.vault.getAbstractFileByPath(ref.path)
        if (!(file instanceof TFile)) {
            file = app.metadataCache.getFirstLinkpathDest(ref.path, sourcePath)
        }
    } else {
        file = app.metadataCache.getFirstLinkpathDest(ref.linkpath, sourcePath)
    }
    return file instanceof TFile ? app.vault.getResourcePath(file) : null
}
