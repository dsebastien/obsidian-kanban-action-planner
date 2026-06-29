/**
 * Pure triage logic (issue #53): deciding which cards are "unclarified" and the
 * order of the triage queue. No Obsidian dependencies — callers resolve each
 * gating property's value + allowed-values and pass them in, so this is fully
 * unit-testable.
 */

/** Which cards make up the triage queue. */
export type TriageScope = 'clarify' | 'all'

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
 * Build the ordered triage queue from an already text-filtered card list:
 * - `clarify` scope keeps only cards with ≥1 unset gating prop; `all` keeps every
 *   card (re-prioritization).
 * - Order is **worst-first** (most unset props), ties broken by the view's own
 *   card comparator (`viewCompare`). Stable for equal keys.
 */
export function buildTriageQueue<T>(
    cards: ReadonlyArray<T>,
    scope: TriageScope,
    unsetOf: (card: T) => number,
    viewCompare: (a: T, b: T) => number
): T[] {
    const items = cards.map((card) => ({ card, unset: unsetOf(card) }))
    const kept = scope === 'all' ? items : items.filter((i) => i.unset > 0)
    kept.sort((a, b) => b.unset - a.unset || viewCompare(a.card, b.card))
    return kept.map((i) => i.card)
}
