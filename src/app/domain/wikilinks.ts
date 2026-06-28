/**
 * Pure helpers for reading/writing frontmatter wikilink lists (issue #14).
 *
 * Relationship roles store their targets as a frontmatter property holding
 * wikilink strings (`"[[Note]]"`, a single string or a YAML list). Resolving a
 * link to an actual file needs the metadata cache (the service layer); the
 * string parsing/formatting here is pure and unit-tested.
 */

/** Normalize a frontmatter value into a clean list of non-empty link strings. */
export function toLinkStringList(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    }
    if (typeof raw === 'string' && raw.trim().length > 0) return [raw]
    return []
}

/**
 * Extract the link **target** (linkpath) from a wikilink string: strips the
 * `[[ ]]`, any `|alias`, and any `#subpath`. A non-wikilink string is returned
 * trimmed (some vaults store a bare path). Empty string when nothing usable.
 */
export function parseWikiLinkTarget(raw: string): string {
    const match = /\[\[([^\]]+)\]\]/.exec(raw)
    const inner = match?.[1] ?? raw
    const beforeAlias = inner.split('|')[0] ?? inner
    const beforeSubpath = beforeAlias.split('#')[0] ?? beforeAlias
    return beforeSubpath.trim()
}

/** Wrap a linktext as a wikilink string for storage in frontmatter. */
export function formatWikiLink(linktext: string): string {
    return `[[${linktext}]]`
}
