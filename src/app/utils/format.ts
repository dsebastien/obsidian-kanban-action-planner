/**
 * Pure value formatting for card fields (no Obsidian/moment dependency).
 *
 * Date formatting (which needs moment) is layered on top by the caller; this
 * module handles wikilink display text and scalar/array/boolean rendering.
 */

/** Display text for a wikilink/embed string, honouring an alias. `[[A|B]]` -> `B`. */
export function stripWikiLink(value: string): string {
    const match = /^!?\[\[([^\]]+)\]\]$/.exec(value.trim())
    if (!match || match[1] === undefined) return value
    const inner = match[1]
    const pipe = inner.indexOf('|')
    const target = pipe === -1 ? inner : inner.slice(pipe + 1)
    // For a plain link, show the basename rather than a full path.
    const base = target.includes('/') ? (target.split('/').pop() ?? target) : target
    return base.trim()
}

/** Format a non-date frontmatter value to display text (empty string when blank). */
export function formatScalar(raw: unknown): string {
    if (raw === null || raw === undefined) return ''
    if (Array.isArray(raw)) {
        return raw
            .map((v) => formatScalar(v))
            .filter((s) => s.length > 0)
            .join(', ')
    }
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
    if (typeof raw === 'number') return String(raw)
    if (typeof raw === 'string') return stripWikiLink(raw)
    return ''
}
