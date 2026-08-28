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

/**
 * Move within an enum's allowed values (issue #122 keyboard/swipe priority
 * bump): `delta` −1 steps toward the list's start, +1 toward its end (the
 * order the triage buttons render in). An unset current picks the first
 * value; at either edge the value clamps (returns the same value). Null when
 * there is nothing to select (empty list).
 */
export function bumpEnumValue(
    values: ReadonlyArray<string>,
    current: string | null,
    delta: -1 | 1
): string | null {
    if (values.length === 0) return null
    if (current === null) return values[0] ?? null
    const index = values.indexOf(current)
    if (index < 0) return values[0] ?? null
    const next = Math.max(0, Math.min(values.length - 1, index + delta))
    return values[next] ?? null
}

/** A swipe gesture's direction, or null below the threshold (issue #122). */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

/**
 * Classify a drag release as a swipe (issue #122, Tinder-style triage):
 * the dominant axis wins; below `threshold` px it is not a swipe (null).
 */
export function classifySwipe(dx: number, dy: number, threshold: number): SwipeDirection | null {
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (Math.max(ax, ay) < threshold) return null
    if (ax >= ay) return dx > 0 ? 'right' : 'left'
    return dy > 0 ? 'down' : 'up'
}

/**
 * Prune vanished cards from a triage queue WITHOUT skipping anyone (issue
 * #170 v2, review F4): removals before the cursor pull the cursor back in
 * step, so it keeps pointing at the same card — or, when that card itself
 * vanished, at the one that followed it. Pure.
 */
export function pruneTriageQueue(
    queue: ReadonlyArray<string>,
    index: number,
    exists: (key: string) => boolean
): { queue: string[]; index: number } {
    const kept: string[] = []
    let removedBefore = 0
    for (let i = 0; i < queue.length; i++) {
        const key = queue[i]
        if (key === undefined) continue
        if (exists(key)) kept.push(key)
        else if (i < index) removedBefore += 1
    }
    return { queue: kept, index: Math.max(0, index - removedBefore) }
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
