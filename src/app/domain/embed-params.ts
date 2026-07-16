/**
 * Pure parser for the markdown-embed override syntax (issue #103):
 *
 *     ![[<file>.base#<View>|mode=<mode> height=<px> filter=<query…>]]
 *
 * The wikilink alias (the text after `|`) lands verbatim in the embed
 * wrapper's `alt` attribute and never affects view resolution, so it is a
 * free channel for per-embed overrides. All parts are optional; a plain
 * human alias ("My tasks") yields zero params. No Obsidian/DOM deps so it
 * is fully unit-testable.
 *
 * Grammar: whitespace-separated `key=value` tokens. Recognized keys
 * (case-insensitive): `mode`, `height`, `filter`. `filter=` consumes the
 * REMAINDER of the alias verbatim — the filter language itself contains
 * spaces/colons/quotes. Note it uses `|` as OR, which a wikilink alias
 * cannot carry — write `OR` in embeds. Invalid values and unrecognized
 * tokens are ignored (never throws).
 */

/** The five mutually-exclusive view modes (Board / Calendar / Timeline / Triage / WBS). */
export const VIEW_MODES = ['board', 'calendar', 'timeline', 'triage', 'wbs'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/** Height clamp bounds (px) for the `height=` param. */
export const EMBED_MIN_HEIGHT_PX = 200
export const EMBED_MAX_HEIGHT_PX = 2000

/** Per-embed overrides parsed from the wikilink alias. All optional. */
export interface EmbedParams {
    /** View mode override, or null (fall back to the saved view config). */
    mode: ViewMode | null
    /** Embed height in px, clamped to [200, 2000], or null (CSS default). */
    heightPx: number | null
    /** Initial filter query, or null (fall back to the saved query). */
    filter: string | null
}

function isViewMode(value: string): value is ViewMode {
    return (VIEW_MODES as readonly string[]).includes(value)
}

/** `height=` value: positive integer px (optional `px` suffix), clamped. */
function parseHeight(value: string): number | null {
    const match = /^(\d+)(?:px)?$/i.exec(value)
    const digits = match?.[1]
    if (!digits) return null
    const px = Number.parseInt(digits, 10)
    if (!Number.isFinite(px) || px <= 0) return null
    return Math.min(EMBED_MAX_HEIGHT_PX, Math.max(EMBED_MIN_HEIGHT_PX, px))
}

/**
 * Parse the embed alias into overrides. Best-effort: invalid values are
 * ignored (a later valid repeat of a key wins), unknown tokens are skipped,
 * and any alias without recognized keys yields all-null params.
 */
export function parseEmbedParams(alias: string): EmbedParams {
    const params: EmbedParams = { mode: null, heightPx: null, filter: null }
    const tokenRe = /\S+/g
    let match: RegExpExecArray | null
    while ((match = tokenRe.exec(alias)) !== null) {
        const token = match[0]
        if (/^filter=/i.test(token)) {
            // Everything after `filter=` is the query, verbatim (spaces,
            // colons, quotes, even `key=value`-looking text).
            const rest = alias.slice(match.index + 'filter='.length).trim()
            if (rest.length > 0) params.filter = rest
            break
        }
        const eq = token.indexOf('=')
        if (eq <= 0) continue
        const key = token.slice(0, eq).toLowerCase()
        const value = token.slice(eq + 1)
        if (key === 'mode') {
            const mode = value.toLowerCase()
            if (isViewMode(mode)) params.mode = mode
        } else if (key === 'height') {
            const px = parseHeight(value)
            if (px !== null) params.heightPx = px
        }
    }
    return params
}
