import { z } from 'zod'
import { resolvePlaceholders, type ExpressionContext } from '../utils/expressions'

/**
 * Pure planning for quick capture (issue #46): decide a new note's name, folder,
 * and template from the layered configuration, with no Obsidian API in sight so
 * every rule is unit-testable.
 *
 * Layering (first non-empty wins), see `documentation/plans/quick-capture.md`:
 *   note-type override → Starter Kit note type → the Base's filters → fallback.
 */

/**
 * Per-note-type creation config. Every field is "empty means inherit", so a
 * Starter Kit type needs no configuration at all and a stored note type written
 * before this feature existed (no backfill) simply inherits everything.
 */
export const creationConfigSchema = z.object({
    /** Target folder; placeholders allowed (`{{year}}`, …). */
    folder: z.string(),
    /** Template file path (vault-relative). */
    templatePath: z.string(),
    /** Name prefix / suffix; placeholders allowed. */
    namePrefix: z.string(),
    nameSuffix: z.string(),
    /** Open the created note after creating it. */
    openAfterCreate: z.boolean()
})
export type CreationConfig = z.infer<typeof creationConfigSchema>

export function defaultCreationConfig(): CreationConfig {
    return { folder: '', templatePath: '', namePrefix: '', nameSuffix: '', openAfterCreate: true }
}

/** The creation-relevant fields a Starter Kit note type exposes. */
export interface InheritedCreationDefaults {
    folder: string
    templatePath: string
    namePrefix: string
    nameSuffix: string
}

export function emptyInheritedDefaults(): InheritedCreationDefaults {
    return { folder: '', templatePath: '', namePrefix: '', nameSuffix: '' }
}

/** The resolved plan, before any placeholder expansion. */
export interface ResolvedCreationConfig {
    folder: string
    templatePath: string
    namePrefix: string
    nameSuffix: string
    openAfterCreate: boolean
}

/**
 * Layer the note-type override over the Starter Kit defaults and the Base's
 * filter-implied folder. `fallbackFolder` is Obsidian's default new-note folder,
 * used only when nothing else names one.
 */
export function resolveCreationConfig(
    override: CreationConfig | undefined,
    inherited: InheritedCreationDefaults,
    filterFolder: string | null,
    fallbackFolder: string
): ResolvedCreationConfig {
    const config = override ?? defaultCreationConfig()
    return {
        folder: firstNonEmpty(config.folder, inherited.folder, filterFolder ?? '', fallbackFolder),
        templatePath: firstNonEmpty(config.templatePath, inherited.templatePath),
        namePrefix: firstNonEmpty(config.namePrefix, inherited.namePrefix),
        nameSuffix: firstNonEmpty(config.nameSuffix, inherited.nameSuffix),
        openAfterCreate: config.openAfterCreate
    }
}

/**
 * The first value that isn't blank — returned VERBATIM. Trimming only decides
 * emptiness: a name prefix/suffix's surrounding space is meaningful (the Starter
 * Kit's suffixes are written `" (Task)"`, and its regex recognition mappings
 * expect exactly that spacing).
 */
function firstNonEmpty(...values: Array<string | undefined>): string {
    for (const value of values) {
        if (value !== undefined && value.trim().length > 0) return value
    }
    return ''
}

/**
 * Characters Obsidian rejects in a file name. Stripped rather than substituted so
 * the resulting name stays close to what was typed.
 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g

/** Make `title` safe to use as a note basename (never returns leading/trailing dots). */
export function sanitizeNoteName(title: string): string {
    return title
        .replace(ILLEGAL_NAME_CHARS, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')
        .replace(/\.+$/, '')
        .trim()
}

/**
 * Strip only the characters Obsidian rejects, keeping whitespace intact — used
 * for name prefixes/suffixes, whose leading/trailing space is part of the value.
 */
function stripIllegalNameChars(value: string): string {
    return value.replace(ILLEGAL_NAME_CHARS, '')
}

/**
 * The note's basename: `prefix + title + suffix`, each part placeholder-expanded.
 * A suffix already present on the typed title is not repeated — the Starter Kit's
 * suffixes double as regex recognition mappings (`.* \(Task\)$`), so "Foo (Task)"
 * typed by hand must not become "Foo (Task) (Task)".
 */
export function buildNoteBasename(
    title: string,
    config: Pick<ResolvedCreationConfig, 'namePrefix' | 'nameSuffix'>,
    ctx: ExpressionContext
): string {
    const clean = sanitizeNoteName(title)
    // A title with nothing usable left must not produce a note named after its
    // decoration alone ("(Task).md").
    if (clean.length === 0) return ''
    const prefix = stripIllegalNameChars(resolvePlaceholders(config.namePrefix, ctx))
    const suffix = stripIllegalNameChars(resolvePlaceholders(config.nameSuffix, ctx))
    const head = prefix.trim().length > 0 && !clean.startsWith(prefix) ? prefix : ''
    const tail = suffix.trim().length > 0 && !clean.endsWith(suffix) ? suffix : ''
    // Only the ENDS are tidied here — the title's own whitespace was already
    // collapsed above, and re-collapsing would eat deliberate spacing inside a
    // prefix/suffix that a Starter Kit recognition regex may depend on.
    return `${head}${clean}${tail}`.trim().replace(/\.+$/, '').trim()
}

/**
 * Collapse separators and trim each segment; `''` for an empty/vault-root folder.
 * `.` and `..` segments are DROPPED, not resolved: nothing this plugin creates may
 * escape the vault, and `normalizePath` does not collapse them either.
 */
export function normalizeCreationFolder(folder: string): string {
    return folder
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
        .join('/')
}

/**
 * The vault path for a new note, suffixing the basename (`Note 1.md`, …) until it
 * is free. `exists` reports whether a path is already taken.
 */
export function buildUniquePath(
    folder: string,
    basename: string,
    exists: (path: string) => boolean
): string {
    const dir = normalizeCreationFolder(folder)
    const at = (name: string): string => (dir.length > 0 ? `${dir}/${name}.md` : `${name}.md`)
    let candidate = at(basename)
    let n = 1
    while (exists(candidate)) {
        candidate = at(`${basename} ${String(n)}`)
        n += 1
    }
    return candidate
}

/**
 * Substitute the core **Templates** plugin's placeholders. Only used on the
 * fallback path (no Templater): `{{title}}`, `{{date}}`, `{{time}}`, and their
 * `:format` variants — the format itself is applied by the caller, which owns the
 * date formatter.
 */
export function applyCoreTemplatePlaceholders(
    content: string,
    values: { title: string; date: string; time: string; format: (token: string) => string }
): string {
    return content.replace(
        /\{\{\s*(title|date|time)\s*(?::\s*([^}]*?)\s*)?\}\}/gi,
        (_match, rawName: string, rawFormat: string | undefined) => {
            const name = rawName.toLowerCase()
            if (name === 'title') return values.title
            if (rawFormat !== undefined && rawFormat.length > 0) return values.format(rawFormat)
            return name === 'date' ? values.date : values.time
        }
    )
}
