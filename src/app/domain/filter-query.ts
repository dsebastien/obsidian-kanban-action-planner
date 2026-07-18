import type { RelationshipRole } from './note-type'
import { parseFrontmatterDate, startOfDay, toDateKey } from './calendar'

/**
 * Pure "JQL-lite" filter query: parse + match. No Obsidian/DOM deps so it is
 * fully unit-testable; the view builds a {@link CardSearchRecord} per card from
 * the metadata cache and evaluates the parsed query against it.
 *
 * Grammar (flat, no recursion):
 *
 *   query  := group (OR group)*        # OR-separated; `OR`/`or`/`|`
 *   group  := clause (clause)*         # whitespace = AND; AND binds tighter than OR
 *   clause := ['-' | NOT] (term | qualifier)
 *   term   := word | "quoted words"
 *   qualifier := name ':' value        # value may be quoted; comma = OR within the field
 *
 * - Case-insensitive **substring** matching everywhere except `due:` comparisons.
 * - `name:=value` (exact operator) matches the **whole** value case-insensitively
 *   instead of a substring — works for every qualifier (`due:=` = same-day `=`).
 * - Comma in a value = OR (`status:active,done`).
 * - Leading `-` or a standalone `NOT` negates the next clause.
 * - Reserved names (`title`, `status`, `parent`, `ancestor`, `child`, `sibling`,
 *   `blocked`, `tag`, `due`) win over a same-named frontmatter property; any
 *   other name is a frontmatter property lookup.
 * - `due:` is the only qualifier with comparison operators and date keywords.
 * - Best-effort: malformed input never throws.
 */

/** Comparison operator (only meaningful for `due:`). */
export type CompareOp = '=' | '<' | '>' | '<=' | '>='

/** One parsed clause: a bare term (`name === null`) or a `name:value` qualifier. */
export interface FilterClause {
    negated: boolean
    /** Lowercased qualifier name, or `null` for a bare term. */
    name: string | null
    /** Comparison operator; `'='` for everything except explicit `due:` ops. */
    op: CompareOp
    /** OR-ed candidate values, lowercased (empty values dropped). */
    values: string[]
    /** `name:=value` — match the whole value, not a substring. */
    exact: boolean
}

/** A parsed query: an OR of AND-groups. Empty `groups` matches everything. */
export interface FilterQuery {
    groups: FilterClause[][]
}

/** Inclusive day range for a calendar period (see `periodRange`). */
export interface DayRange {
    start: Date
    end: Date
}

/** Context for evaluating `due:` clauses (kept out of the pure parse step). */
export interface FilterContext {
    today: Date
    periods: Record<'week' | 'month' | 'quarter' | 'year', DayRange>
}

/** Per-card searchable data, all text lowercased. */
export interface CardSearchRecord {
    /** Lowercased card title. */
    title: string
    /** Combined lowercased text for bare-term search (title + rels + tags + frontmatter values). */
    haystack: string
    /** Status value and its column label, lowercased. */
    statusText: string[]
    /** Related note names per role, lowercased. */
    rels: Record<RelationshipRole, string[]>
    /**
     * Names of ALL transitive parents (direct parents, their parents, …),
     * lowercased — climbed through the board's notes. Backs the `ancestor:`
     * qualifier (issue #74 descendants zoom); not part of the bare-term haystack.
     */
    ancestors: string[]
    /** Note tags, lowercased, without the leading `#`. */
    tags: string[]
    /** Parsed due date (local midnight) or null. */
    due: Date | null
    /** Frontmatter property name (lowercased) → its value(s), lowercased. */
    props: Map<string, string[]>
}

// ── Parsing ───────────────────────────────────────────────────

/**
 * Split input into tokens on whitespace, keeping quoted runs (including the
 * quotes) intact so `parent:"PKM Library"` stays a single token.
 */
function tokenize(input: string): string[] {
    const tokens: string[] = []
    let i = 0
    const n = input.length
    while (i < n) {
        while (i < n && /\s/.test(input[i] ?? '')) i++
        if (i >= n) break
        let tok = ''
        while (i < n && !/\s/.test(input[i] ?? '')) {
            const ch = input[i] ?? ''
            if (ch === '"') {
                tok += '"'
                i++
                while (i < n && input[i] !== '"') {
                    tok += input[i] ?? ''
                    i++
                }
                if (i < n) {
                    tok += '"'
                    i++
                }
            } else {
                tok += ch
                i++
            }
        }
        tokens.push(tok)
    }
    return tokens
}

/** Strip a single pair of surrounding double quotes, if present. */
function unquote(s: string): string {
    return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
}

/**
 * Split a value on **top-level** commas (OR), respecting quotes so a comma
 * inside a `"quoted value"` is not a boundary. `"@work","@home"` → two OR-ed
 * values; `"Deep, Focus"` stays a single value. Each part is unquoted, trimmed,
 * lowercased; blanks dropped.
 */
function splitValues(raw: string): string[] {
    const parts: string[] = []
    let buf = ''
    let inQuotes = false
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i] ?? ''
        if (ch === '"') {
            inQuotes = !inQuotes
            buf += ch
            continue
        }
        if (ch === ',' && !inQuotes) {
            parts.push(buf)
            buf = ''
            continue
        }
        buf += ch
    }
    parts.push(buf)
    return parts.map((s) => unquote(s.trim()).toLowerCase()).filter((s) => s.length > 0)
}

/** Peel a leading comparison operator off a `due:` value. */
function parseDueOp(raw: string): { op: CompareOp; rest: string } {
    const v = raw.trim()
    if (v.startsWith('>=')) return { op: '>=', rest: v.slice(2) }
    if (v.startsWith('<=')) return { op: '<=', rest: v.slice(2) }
    if (v.startsWith('>')) return { op: '>', rest: v.slice(1) }
    if (v.startsWith('<')) return { op: '<', rest: v.slice(1) }
    if (v.startsWith('=')) return { op: '=', rest: v.slice(1) }
    return { op: '=', rest: v }
}

/** Turn a single non-separator token into a clause, or `null` to skip it. */
function toClause(token: string, negated: boolean): FilterClause | null {
    let body = token
    let neg = negated
    if (body.startsWith('-') && body.length > 1) {
        neg = true
        body = body.slice(1)
    }
    const colon = body.indexOf(':')
    if (colon <= 0) {
        const value = unquote(body).toLowerCase()
        if (!value) return null
        return { negated: neg, name: null, op: '=', values: [value], exact: false }
    }
    const name = body.slice(0, colon).toLowerCase()
    let rawValue = body.slice(colon + 1)
    if (name === 'due') {
        const { op, rest } = parseDueOp(rawValue)
        const values = splitValues(rest)
        if (values.length === 0) return null
        return { negated: neg, name, op, values, exact: false }
    }
    let exact = false
    if (rawValue.startsWith('=')) {
        exact = true
        rawValue = rawValue.slice(1)
    }
    const values = splitValues(rawValue)
    if (values.length === 0) return null
    return { negated: neg, name, op: '=', values, exact }
}

/** Parse a filter string into a {@link FilterQuery}. Never throws. */
export function parseFilterQuery(input: string): FilterQuery {
    const groups: FilterClause[][] = []
    let current: FilterClause[] = []
    let pendingNegate = false
    const flush = (): void => {
        if (current.length > 0) {
            groups.push(current)
            current = []
        }
    }
    for (const token of tokenize(input)) {
        const lower = token.toLowerCase()
        if (lower === 'or' || token === '|') {
            flush()
            pendingNegate = false
            continue
        }
        if (lower === 'not') {
            pendingNegate = true
            continue
        }
        const clause = toClause(token, pendingNegate)
        pendingNegate = false
        if (clause) current.push(clause)
    }
    flush()
    return { groups }
}

/** True when the query has no clauses (matches everything). */
export function isEmptyQuery(query: FilterQuery): boolean {
    return query.groups.length === 0
}

// ── Matching ──────────────────────────────────────────────────

/** Same calendar day? */
function sameDay(a: Date, b: Date): boolean {
    return toDateKey(a) === toDateKey(b)
}

/** Whether `date` falls within an inclusive day range. */
function inRange(date: Date, range: DayRange): boolean {
    const t = startOfDay(date).getTime()
    return t >= startOfDay(range.start).getTime() && t <= startOfDay(range.end).getTime()
}

/** Compare two dates by day under an operator. */
function compareDay(due: Date, target: Date, op: CompareOp): boolean {
    const a = startOfDay(due).getTime()
    const b = startOfDay(target).getTime()
    switch (op) {
        case '=':
            return a === b
        case '<':
            return a < b
        case '>':
            return a > b
        case '<=':
            return a <= b
        case '>=':
            return a >= b
    }
}

/** Evaluate a single `due:` candidate value (keyword or date). */
function matchDueValue(
    due: Date | null,
    op: CompareOp,
    value: string,
    ctx: FilterContext
): boolean {
    switch (value) {
        case 'none':
            return due === null
        case 'today':
            return due !== null && sameDay(due, ctx.today)
        case 'overdue':
            return due !== null && startOfDay(due).getTime() < startOfDay(ctx.today).getTime()
        case 'week':
        case 'month':
        case 'quarter':
        case 'year':
            return due !== null && inRange(due, ctx.periods[value])
        default: {
            const target = parseFrontmatterDate(value)
            return due !== null && target !== null && compareDay(due, target, op)
        }
    }
}

/** Roles addressable by a `name:` qualifier (aliases included). */
const ROLE_ALIASES: Record<string, RelationshipRole> = {
    parent: 'parent',
    child: 'child',
    children: 'child',
    sibling: 'sibling',
    siblings: 'sibling',
    blocked: 'blocked_by',
    blocked_by: 'blocked_by',
    blockedby: 'blocked_by'
}

/**
 * Every lowercased qualifier name that {@link matchQualifier} special-cases
 * (reserved names + relationship-role aliases). Centralized here so the parser
 * and the settings-time reserved-name guard (a contexts property must not be a
 * reserved qualifier, or `setContextTerms`/`removeZoomTerm` fight over the same
 * tokens) cannot drift. Derived from {@link ROLE_ALIASES} plus the names
 * handled inline (`due`/`title`/`status`/`tag(s)`/`ancestor(s)`).
 */
export const RESERVED_QUALIFIER_NAMES: ReadonlySet<string> = new Set<string>([
    'due',
    'title',
    'status',
    'tag',
    'tags',
    'ancestor',
    'ancestors',
    ...Object.keys(ROLE_ALIASES)
])

/** Whether a qualifier clause matches the record (any candidate value, OR). */
function matchQualifier(rec: CardSearchRecord, clause: FilterClause, ctx: FilterContext): boolean {
    const name = clause.name ?? ''
    // Substring by default; whole-value (still case-insensitive — both sides
    // are lowercased) for the `:=` exact operator.
    const hits = (haystack: string, v: string): boolean =>
        clause.exact ? haystack === v : haystack.includes(v)
    if (name === 'due') {
        return clause.values.some((v) => matchDueValue(rec.due, clause.op, v, ctx))
    }
    if (name === 'title') {
        return clause.values.some((v) => hits(rec.title, v))
    }
    if (name === 'status') {
        return clause.values.some((v) => rec.statusText.some((s) => hits(s, v)))
    }
    if (name === 'tag' || name === 'tags') {
        return clause.values.some((v) => rec.tags.some((t) => hits(t, v)))
    }
    if (name === 'ancestor' || name === 'ancestors') {
        return clause.values.some((v) => rec.ancestors.some((a) => hits(a, v)))
    }
    const role = ROLE_ALIASES[name]
    if (role) {
        return clause.values.some((v) => rec.rels[role].some((r) => hits(r, v)))
    }
    const propValues = rec.props.get(name)
    if (!propValues) return false
    return clause.values.some((v) => propValues.some((pv) => hits(pv, v)))
}

/** Whether one clause matches (respecting negation). */
function matchClause(rec: CardSearchRecord, clause: FilterClause, ctx: FilterContext): boolean {
    const hit =
        clause.name === null
            ? clause.values.some((v) => rec.haystack.includes(v))
            : matchQualifier(rec, clause, ctx)
    return clause.negated ? !hit : hit
}

/** Whether a card matches the query (OR of AND-groups; empty query → true). */
export function matchesFilterQuery(
    rec: CardSearchRecord,
    query: FilterQuery,
    ctx: FilterContext
): boolean {
    if (query.groups.length === 0) return true
    return query.groups.some((group) => group.every((clause) => matchClause(rec, clause, ctx)))
}

// ── Zoom / focus helpers (issue #74) ──────────────────────────
//
// Zoom is not separate state: focusing a card's children writes a
// `parent:="Title"` term (direct children) or an `ancestor:="Title"` term
// (all descendants) into the raw filter query and rides the normal filter
// path. These helpers edit that term at the raw-string level so the rest of
// what the user typed survives untouched (and the chip label keeps the
// original casing, which the lowercasing parser would lose).

/** Which relationship the zoom term filters on. */
export type ZoomField = 'parent' | 'ancestor'

/** The parsed zoom term backing the chip. */
export interface ZoomTerm {
    field: ZoomField
    /** Focused note title, original casing, unquoted. */
    title: string
}

/** A non-negated `parent:` / `ancestor:` (`:=` included) token — the zoom term. */
function isZoomToken(token: string): boolean {
    return /^(parent|ancestor):/i.test(token)
}

/** Serialize a zoom term for `title`, always quoted (quotes stripped — the tokenizer has no escapes). */
function zoomToken(title: string, field: ZoomField): string {
    return `${field}:="${title.replace(/"/g, '').trim()}"`
}

/**
 * Append a `parent:="title"` / `ancestor:="title"` exact term to `query`,
 * replacing any existing (non-negated) zoom term — of either field — so
 * repeated zooms drill down or re-scope instead of stacking.
 */
export function setZoomTerm(query: string, title: string, field: ZoomField): string {
    const kept = tokenize(query).filter((t) => !isZoomToken(t))
    return [...kept, zoomToken(title, field)].join(' ').trim()
}

/** Remove the zoom term(s) from `query`, keeping everything else. */
export function removeZoomTerm(query: string): string {
    return tokenize(query)
        .filter((t) => !isZoomToken(t))
        .join(' ')
        .trim()
}

/**
 * The zoom term (field + title in its original casing), or `null` when the
 * query has no non-negated `parent:` / `ancestor:` term. Drives the chip.
 */
export function getZoomTerm(query: string): ZoomTerm | null {
    for (const token of tokenize(query)) {
        if (!isZoomToken(token)) continue
        const colon = token.indexOf(':')
        const raw = token.slice(colon + 1)
        const title = unquote(raw.startsWith('=') ? raw.slice(1) : raw).trim()
        if (title.length === 0) continue
        const field = token.slice(0, colon).toLowerCase() === 'ancestor' ? 'ancestor' : 'parent'
        return { field, title }
    }
    return null
}

// ── Context term helpers (GTD contexts) ───────────────────────
//
// The active context is not separate state: the selected context values live as
// a single managed `<prop>:="@work","@home"` term inside the raw filter query,
// exactly like the zoom term. All selected values serialize into ONE
// comma-separated exact token so `matchQualifier` ORs them (splitValues splits
// the interior `","` back into an OR-of-exacts). Emitting two same-name tokens
// would put them in the same AND-group and match only cards tagged with BOTH —
// the opposite of the intended semantics. These helpers edit that one token at
// the raw-string level so everything else the user typed (and any coexisting
// zoom term) survives untouched, and the chip labels keep their original casing
// (the parser lowercases values).

/** A non-negated `<prop>:` token (case-insensitive name match) — the context term. */
function isContextToken(token: string, prop: string): boolean {
    const lower = token.toLowerCase()
    return lower.startsWith(`${prop.toLowerCase()}:`)
}

/**
 * Serialize ALL selected `values` into ONE exact token with comma-separated
 * quoted values: `contexts:="@work","@home"`. Each value is quoted so spaces and
 * a leading `@` survive the whitespace tokenizer; embedded quotes are stripped
 * (the tokenizer has no escapes, like {@link zoomToken}). Empty/blank values are
 * dropped; returns `''` when nothing survives.
 */
function contextToken(prop: string, values: string[]): string {
    const parts = values
        .map((v) => v.replace(/"/g, '').trim())
        .filter((v) => v.length > 0)
        .map((v) => `"${v}"`)
    if (parts.length === 0) return ''
    return `${prop}:=${parts.join(',')}`
}

/**
 * Replace the managed `<prop>:` term in `query` with one carrying `values`
 * (OR-ed exact matches in a single token). Empty `values` (or all-blank) removes
 * the term. Any coexisting zoom term and typed query survive untouched.
 */
export function setContextTerms(query: string, prop: string, values: string[]): string {
    const token = contextToken(prop, values)
    const kept = tokenize(query).filter((t) => !isContextToken(t, prop))
    if (token.length === 0) return kept.join(' ').trim()
    return [...kept, token].join(' ').trim()
}

/** Remove the managed `<prop>:` context term(s) from `query`, keeping everything else. */
export function removeContextTerms(query: string, prop: string): string {
    return tokenize(query)
        .filter((t) => !isContextToken(t, prop))
        .join(' ')
        .trim()
}

/**
 * The selected context values in their ORIGINAL casing, parsed from the RAW
 * managed token (not the parsed {@link FilterClause}, whose values are already
 * lowercased). Comma-splits the single token respecting quotes and unquotes each
 * value. Returns `[]` when the query has no managed `<prop>:` term.
 */
export function getContextTerms(query: string, prop: string): string[] {
    for (const token of tokenize(query)) {
        if (!isContextToken(token, prop)) continue
        const colon = token.indexOf(':')
        let raw = token.slice(colon + 1)
        if (raw.startsWith('=')) raw = raw.slice(1)
        return splitContextValues(raw)
    }
    return []
}

/**
 * Split the raw remainder of a context token into original-cased values,
 * respecting quotes (so a comma inside `"a,b"` does not split) and unquoting +
 * trimming each. Blank values are dropped. Mirrors the tokenizer's quote
 * handling but at the comma level.
 */
function splitContextValues(raw: string): string[] {
    const values: string[] = []
    let buf = ''
    let inQuotes = false
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i] ?? ''
        if (ch === '"') {
            inQuotes = !inQuotes
            continue
        }
        if (ch === ',' && !inQuotes) {
            const trimmed = buf.trim()
            if (trimmed.length > 0) values.push(trimmed)
            buf = ''
            continue
        }
        buf += ch
    }
    const last = buf.trim()
    if (last.length > 0) values.push(last)
    return values
}
