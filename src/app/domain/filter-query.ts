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
 * - Comma in a value = OR (`status:active,done`).
 * - Leading `-` or a standalone `NOT` negates the next clause.
 * - Reserved names (`title`, `status`, `parent`, `child`, `sibling`, `blocked`,
 *   `tag`, `due`) win over a same-named frontmatter property; any other name is a
 *   frontmatter property lookup.
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

/** Split a value on top-level commas (OR), unless it is a single quoted value. */
function splitValues(raw: string): string[] {
    const v = raw.trim()
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        return [v.slice(1, -1).toLowerCase()]
    }
    return v
        .split(',')
        .map((s) => unquote(s.trim()).toLowerCase())
        .filter((s) => s.length > 0)
}

/** Peel a leading comparison operator off a `due:` value. */
function parseDueOp(raw: string): { op: CompareOp; rest: string } {
    const v = raw.trim()
    if (v.startsWith('>=')) return { op: '>=', rest: v.slice(2) }
    if (v.startsWith('<=')) return { op: '<=', rest: v.slice(2) }
    if (v.startsWith('>')) return { op: '>', rest: v.slice(1) }
    if (v.startsWith('<')) return { op: '<', rest: v.slice(1) }
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
        return { negated: neg, name: null, op: '=', values: [value] }
    }
    const name = body.slice(0, colon).toLowerCase()
    const rawValue = body.slice(colon + 1)
    if (name === 'due') {
        const { op, rest } = parseDueOp(rawValue)
        const values = splitValues(rest)
        if (values.length === 0) return null
        return { negated: neg, name, op, values }
    }
    const values = splitValues(rawValue)
    if (values.length === 0) return null
    return { negated: neg, name, op: '=', values }
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

/** Whether a qualifier clause matches the record (any candidate value, OR). */
function matchQualifier(rec: CardSearchRecord, clause: FilterClause, ctx: FilterContext): boolean {
    const name = clause.name ?? ''
    if (name === 'due') {
        return clause.values.some((v) => matchDueValue(rec.due, clause.op, v, ctx))
    }
    if (name === 'title') {
        return clause.values.some((v) => rec.title.includes(v))
    }
    if (name === 'status') {
        return clause.values.some((v) => rec.statusText.some((s) => s.includes(v)))
    }
    if (name === 'tag' || name === 'tags') {
        return clause.values.some((v) => rec.tags.some((t) => t.includes(v)))
    }
    const role = ROLE_ALIASES[name]
    if (role) {
        return clause.values.some((v) => rec.rels[role].some((r) => r.includes(v)))
    }
    const propValues = rec.props.get(name)
    if (!propValues) return false
    return clause.values.some((v) => propValues.some((pv) => pv.includes(v)))
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
