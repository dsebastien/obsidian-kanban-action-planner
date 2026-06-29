/**
 * Pure triage logic (issues #53, #57): deciding which cards are "unclarified" /
 * "due for review" and the order of the triage queue. No Obsidian dependencies —
 * callers resolve each property's value and pass it in, so this is fully
 * unit-testable.
 */
import { startOfDay } from '../../domain/calendar'

/** Which cards make up the triage queue. */
export type TriageScope = 'clarify' | 'all' | 'review'

const DAY_MS = 24 * 60 * 60 * 1000

/** A card's review weight + whether it's due (issue #57). */
export interface ReviewState {
    /** Worst-first weight: days overdue, or a max sentinel when never reviewed. */
    weight: number
    /** Whether the card is due for review (overdue ≥ 0, or never reviewed). */
    due: boolean
}

/**
 * Compute a card's review state (issue #57): due when `lastReviewed +
 * intervalDays` is on/before `today`, or when it was never reviewed (the most
 * due). The weight is whole days overdue (never-reviewed → a max sentinel so it
 * sorts first). Pure.
 */
export function reviewState(
    lastReviewed: Date | null,
    intervalDays: number,
    today: Date
): ReviewState {
    if (!lastReviewed) return { weight: Number.MAX_SAFE_INTEGER, due: true }
    const dueTime = startOfDay(lastReviewed).getTime() + intervalDays * DAY_MS
    const overdueDays = Math.floor((startOfDay(today).getTime() - dueTime) / DAY_MS)
    return { weight: overdueDays, due: overdueDays >= 0 }
}

/** A single gating property's resolved state for one card. */
export interface TriageGateInput {
    /** The card's value for this property (null when absent/empty). */
    value: string | number | null
    /** The property's known allowed values, or null when unknown (free value). */
    allowedValues: string[] | null
}

/**
 * Whether a gating property counts as **unset** (convention-agnostic): the value
 * is empty/absent, OR it contains one of the needs-triage `tokens`
 * (case-insensitive substring — e.g. `TBD`), OR — when allowed values are known —
 * it is **not among them** (a stale/invalid value).
 */
export function isPropUnset(
    value: string | number | null,
    tokens: string[],
    allowedValues: string[] | null
): boolean {
    if (value === null || value === '') return true
    const str = String(value)
    const lower = str.toLowerCase()
    for (const token of tokens) {
        const t = token.trim().toLowerCase()
        if (t.length > 0 && lower.includes(t)) return true
    }
    if (allowedValues && allowedValues.length > 0 && !allowedValues.includes(str)) return true
    return false
}

/** Count a card's unset gating properties (0 ⇒ clarified). */
export function unsetCount(gates: TriageGateInput[], tokens: string[]): number {
    let count = 0
    for (const gate of gates) {
        if (isPropUnset(gate.value, tokens, gate.allowedValues)) count += 1
    }
    return count
}

/** A card's queue ranking: whether to include it, and its worst-first weight. */
export interface TriageRank {
    include: boolean
    weight: number
}

/**
 * Build the ordered triage queue from an already text-filtered card list. Each
 * card is ranked (scope-specific, computed by the caller): `include` decides
 * membership, `weight` orders **worst-first** (higher first), ties broken by the
 * view's own card comparator (`viewCompare`). Stable for equal keys.
 */
export function buildTriageQueue<T>(
    cards: ReadonlyArray<T>,
    rankOf: (card: T) => TriageRank,
    viewCompare: (a: T, b: T) => number
): T[] {
    const kept = cards.map((card) => ({ card, rank: rankOf(card) })).filter((i) => i.rank.include)
    kept.sort((a, b) => b.rank.weight - a.rank.weight || viewCompare(a.card, b.card))
    return kept.map((i) => i.card)
}
