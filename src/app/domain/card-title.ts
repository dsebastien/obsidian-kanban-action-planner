import { z } from 'zod'

/**
 * Card-title filtering: strip the note type's name decoration from what a card
 * shows, without touching the note on disk.
 *
 * Note types routinely decorate their file names so recognition rules can key
 * off them — the Obsidian Starter Kit writes `" (Task)"`, `" (Project)"`,
 * `"AI Wiki - "` and friends. That decoration is noise on a board where every
 * card is already of the same type, so by default a card shows `Ship the plugin`
 * rather than `Ship the plugin (Task)`. Purely presentational: the file name,
 * search, links and every write path keep the full name.
 *
 * Everything here is pure so the matching rules are unit-testable.
 */

/**
 * Per-note-type card-title filtering. Both toggles default to **on** so every
 * note type — including ones stored before this feature existed, which carry no
 * `titleDisplay` block at all — filters its own decoration out of the box.
 * `extraPrefixes` / `extraSuffixes` add affixes the type itself doesn't declare
 * (a hand-rolled `"TODO - "` convention, a legacy suffix).
 */
export const titleDisplaySchema = z.object({
    /** Strip the type's name prefix from card titles. */
    stripPrefix: z.boolean().default(true),
    /** Strip the type's name suffix from card titles. */
    stripSuffix: z.boolean().default(true),
    /** Extra prefixes to strip, beyond the type's own. */
    extraPrefixes: z.array(z.string()).default([]),
    /** Extra suffixes to strip, beyond the type's own. */
    extraSuffixes: z.array(z.string()).default([])
})
export type TitleDisplayConfig = z.infer<typeof titleDisplaySchema>

export function defaultTitleDisplayConfig(): TitleDisplayConfig {
    return { stripPrefix: true, stripSuffix: true, extraPrefixes: [], extraSuffixes: [] }
}

/**
 * The note type's own name decoration, mirrored from the Starter Kit when it
 * owns the type. Plugin-side types leave it empty and rely on their `creation`
 * config instead.
 */
export const namingConfigSchema = z.object({
    prefix: z.string().default(''),
    suffix: z.string().default(''),
    /**
     * The Starter Kit (≥ 1.22) marks the affix OPTIONAL: notes created from the
     * board do not get it, while cards still strip it when a note carries it.
     * Absent in older Starter Kits and in every stored note type = required.
     */
    prefixOptional: z.boolean().default(false),
    suffixOptional: z.boolean().default(false)
})
export type NamingConfig = z.infer<typeof namingConfigSchema>

export function defaultNamingConfig(): NamingConfig {
    return { prefix: '', suffix: '', prefixOptional: false, suffixOptional: false }
}

/** The affixes to strip from a card title, longest-first. */
export interface CardTitleAffixes {
    prefixes: readonly string[]
    suffixes: readonly string[]
}

export const NO_TITLE_AFFIXES: CardTitleAffixes = { prefixes: [], suffixes: [] }

/** The inputs that decide a note type's card-title affixes. */
export interface TitleAffixSource {
    titleDisplay: TitleDisplayConfig
    /** The type's own decoration (Starter Kit mirror, or a live lookup). */
    naming: NamingConfig
    /** The plugin-side creation override, which wins over `naming` when set. */
    creation?: { namePrefix: string; nameSuffix: string } | undefined
}

/**
 * Resolve the affixes to strip for a note type: its creation override first
 * (that is the decoration the plugin itself applies when creating notes), else
 * the type's own naming, plus the configured extras. A disabled toggle drops
 * that whole side, extras included. Sorted longest-first so `" (Meeting Note)"`
 * is preferred over a shorter `" (Meeting)"` that also matches.
 */
export function cardTitleAffixes(source: TitleAffixSource): CardTitleAffixes {
    const { titleDisplay, naming, creation } = source
    const own = (override: string, mirrored: string): string[] => {
        const value = override.trim().length > 0 ? override : mirrored
        return value.length > 0 ? [value] : []
    }
    return {
        prefixes: titleDisplay.stripPrefix
            ? order([
                  ...own(creation?.namePrefix ?? '', naming.prefix),
                  ...titleDisplay.extraPrefixes
              ])
            : [],
        suffixes: titleDisplay.stripSuffix
            ? order([
                  ...own(creation?.nameSuffix ?? '', naming.suffix),
                  ...titleDisplay.extraSuffixes
              ])
            : []
    }
}

/** Drop blanks + duplicates, longest first (longest match wins). */
function order(values: string[]): string[] {
    return [...new Set(values.filter((value) => value.length > 0))].sort(
        (a, b) => b.length - a.length
    )
}

/**
 * Strip at most one prefix and one suffix from `title`. Returns the original
 * when nothing matches, and never returns an empty string — a note literally
 * named `"(Task)"` keeps its name rather than showing a blank card.
 */
export function stripTitleAffixes(title: string, affixes: CardTitleAffixes): string {
    const start = longestMatch(title, affixes.prefixes, matchPrefix)
    const end = longestMatch(title, affixes.suffixes, matchSuffix)
    if (start === 0 && end === 0) return title
    // Overlapping matches (a short name that is prefix + suffix and nothing
    // else) would slice past each other — keep the name instead.
    if (start + end >= title.length) return title
    const stripped = title.slice(start, title.length - end).trim()
    return stripped.length > 0 ? stripped : title
}

function longestMatch(
    title: string,
    affixes: readonly string[],
    match: (title: string, affix: string) => number
): number {
    let best = 0
    for (const affix of affixes) {
        const length = match(title, affix)
        if (length > best) best = length
    }
    return best
}

/** Matched prefix length in `title`, or 0. */
function matchPrefix(title: string, affix: string): number {
    if (!hasPlaceholder(affix)) return title.startsWith(affix) ? affix.length : 0
    return matchedLength(new RegExp(`^(?:${affixPattern(affix)})`), title)
}

/** Matched suffix length in `title`, or 0. */
function matchSuffix(title: string, affix: string): number {
    if (!hasPlaceholder(affix)) return title.endsWith(affix) ? affix.length : 0
    return matchedLength(new RegExp(`(?:${affixPattern(affix)})$`), title)
}

function matchedLength(re: RegExp, title: string): number {
    const m = re.exec(title)
    return m?.[0] !== undefined ? m[0].length : 0
}

function hasPlaceholder(affix: string): boolean {
    return affix.includes('{{')
}

const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g

/**
 * The regex source matching an affix template. A prefix/suffix may carry the
 * same placeholders note creation expands (`{{date}}`, `{{year}}`, …), so the
 * value on disk is never the stored template — match its SHAPE instead. Unknown
 * tokens stay literal, exactly as `resolvePlaceholders` leaves them.
 */
function affixPattern(affix: string): string {
    let out = ''
    let last = 0
    TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null = TOKEN_RE.exec(affix)
    while (m !== null) {
        out += escapeRegex(affix.slice(last, m.index))
        const token = m[1]?.toLowerCase() ?? ''
        out += tokenPattern(token) ?? escapeRegex(m[0])
        last = m.index + m[0].length
        m = TOKEN_RE.exec(affix)
    }
    return out + escapeRegex(affix.slice(last))
}

/** The shape each supported placeholder produces (see `utils/expressions.ts`). */
function tokenPattern(token: string): string | null {
    switch (token) {
        case 'year':
        case 'isoyear':
            return '\\d{4}'
        case 'month':
        case 'day':
        case 'week':
            return '\\d{2}'
        case 'quarter':
            return 'Q[1-4]'
        case 'date':
            return '\\d{4}-\\d{2}-\\d{2}'
        case 'datetime':
            return '\\d{4}-\\d{2}-\\d{2}-\\d{6}'
        case 'uuid':
            return '[0-9a-zA-Z-]+'
        default:
            return null
    }
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
