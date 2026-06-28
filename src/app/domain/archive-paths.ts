/**
 * Pure helpers for recognising archived notes by their vault path (issue #13).
 *
 * Archiving MOVES a note into a placeholder-driven archive folder (e.g.
 * `Archive/{{year}}`). To tell whether an arbitrary note is archived we compare
 * its path against the **static prefix** of each configured archive-folder
 * template — everything before the first `{{placeholder}}`. A blocker whose note
 * lives under such a prefix is treated as archived and stops blocking, while
 * active blockers (a project on another board) keep blocking.
 */

/**
 * The static folder prefix of an archive-folder template: everything before the
 * first `{{placeholder}}`, normalized (separators collapsed, slashes/whitespace
 * trimmed). A template that starts with a placeholder yields `''` (no usable
 * prefix → never matches).
 */
export function archiveFolderPrefix(template: string): string {
    const idx = template.indexOf('{{')
    const stat = idx === -1 ? template : template.slice(0, idx)
    return stat
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .join('/')
}

/** Non-empty, de-duplicated archive-folder prefixes from a list of templates. */
export function archiveFolderPrefixes(templates: ReadonlyArray<string>): string[] {
    const out = new Set<string>()
    for (const template of templates) {
        const prefix = archiveFolderPrefix(template)
        if (prefix.length > 0) out.add(prefix)
    }
    return [...out]
}

/** Whether a vault path lives under any of the given archive-folder prefixes. */
export function isArchivedPath(path: string, prefixes: ReadonlyArray<string>): boolean {
    return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}
