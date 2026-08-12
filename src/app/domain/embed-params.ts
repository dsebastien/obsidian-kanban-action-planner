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
 * Grammar: whitespace-separated `key=value` tokens; a double-quoted run
 * inside a value keeps its spaces (`columns="10 TODO"`). Recognized keys
 * (case-insensitive): `mode`, `height`, `context`, `columns`, `filter`.
 * `filter=` consumes the REMAINDER of the alias verbatim — the filter
 * language itself contains spaces/colons/quotes. Note it uses `|` as OR,
 * which a wikilink alias cannot carry — write `OR` in embeds. `context=`
 * takes a single comma-separated list of context values (no spaces) and
 * `columns=` a comma-separated list of column names (quote names with
 * spaces); both must appear BEFORE `filter=` (which swallows everything
 * after it). Invalid values and unrecognized tokens are ignored (never
 * throws).
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
    /** GTD contexts to pin (folded into the filter query), original casing; empty when none. */
    contexts: string[]
    /**
     * Column names to restrict the board to (issue #128), original casing;
     * empty when the embed shows every column. Matched case-insensitively as
     * substrings of the column's status value or label.
     */
    columns: string[]
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

/** One alias token: its text and its start offset in the alias. */
interface AliasToken {
    text: string
    index: number
}

/**
 * Split the alias into whitespace-separated tokens, keeping double-quoted
 * runs (including their spaces and the quotes themselves) inside a single
 * token so `columns="10 TODO","20 Doing"` scans as ONE token. Value parsers
 * strip the quotes. An unterminated quote runs to the end of the alias.
 */
function tokenizeAlias(alias: string): AliasToken[] {
    const tokens: AliasToken[] = []
    let i = 0
    const n = alias.length
    while (i < n) {
        while (i < n && /\s/.test(alias[i] ?? '')) i++
        if (i >= n) break
        const start = i
        let text = ''
        while (i < n && !/\s/.test(alias[i] ?? '')) {
            const ch = alias[i] ?? ''
            if (ch === '"') {
                text += '"'
                i++
                while (i < n && alias[i] !== '"') {
                    text += alias[i] ?? ''
                    i++
                }
                if (i < n) {
                    text += '"'
                    i++
                }
            } else {
                text += ch
                i++
            }
        }
        tokens.push({ text, index: start })
    }
    return tokens
}

/**
 * `columns=` value: comma-separated items, each optionally double-quoted
 * (quotes carry spaces through tokenization and are stripped here). Commas
 * inside quotes belong to the item.
 */
function parseColumnList(value: string): string[] {
    const items: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of value) {
        if (ch === '"') inQuotes = !inQuotes
        else if (ch === ',' && !inQuotes) {
            items.push(current)
            current = ''
        } else current += ch
    }
    items.push(current)
    return items.map((v) => v.trim()).filter((v) => v.length > 0)
}

/**
 * Parse the embed alias into overrides. Best-effort: invalid values are
 * ignored (a later valid repeat of a key wins), unknown tokens are skipped,
 * and any alias without recognized keys yields all-null params.
 */
export function parseEmbedParams(alias: string): EmbedParams {
    const params: EmbedParams = {
        mode: null,
        heightPx: null,
        contexts: [],
        columns: [],
        filter: null
    }
    for (const { text: token, index } of tokenizeAlias(alias)) {
        if (/^filter=/i.test(token)) {
            // Everything after `filter=` is the query, verbatim (spaces,
            // colons, quotes, even `key=value`-looking text).
            const rest = alias.slice(index + 'filter='.length).trim()
            if (rest.length > 0) params.filter = rest
            break
        }
        const eq = token.indexOf('=')
        if (eq <= 0) continue
        const key = token.slice(0, eq).toLowerCase()
        const value = token.slice(eq + 1)
        if (key === 'mode') {
            // `kanban` is the natural word for the board mode — accept it.
            const raw = value.toLowerCase()
            const mode = raw === 'kanban' ? 'board' : raw
            if (isViewMode(mode)) params.mode = mode
        } else if (key === 'height') {
            const px = parseHeight(value)
            if (px !== null) params.heightPx = px
        } else if (key === 'context' || key === 'contexts') {
            // A single comma-separated list (no spaces); a later valid repeat wins.
            const values = value
                .split(',')
                .map((v) => v.trim())
                .filter((v) => v.length > 0)
            if (values.length > 0) params.contexts = values
        } else if (key === 'column' || key === 'columns') {
            // Comma-separated column names; quote names containing spaces
            // (issue #128). A later valid repeat wins.
            const values = parseColumnList(value)
            if (values.length > 0) params.columns = values
        }
    }
    return params
}
