/**
 * Optimistic writes the metadata cache has not re-parsed yet.
 *
 * A card move mutates the in-memory model, renders at once, and only then
 * writes the note's frontmatter (issue #64). Obsidian re-parses the file on
 * its own schedule, so any rebuild landing between the write and that re-parse
 * re-derives the note from a cache that STILL HOLDS THE OLD VALUE — and the
 * card visibly snaps back to the column it came from, even though the write
 * succeeded (the same staleness the triage override handles, issue #105
 * finding 4.2).
 *
 * A pending write records what was written and what the cache held before it,
 * so a render can prefer the written value for exactly as long as the cache is
 * still showing the superseded one — and not a moment longer.
 */

/** A property value written but not yet observed in the metadata cache. */
export interface PendingWrite {
    /** The value that was written. */
    value: string | null
    /** The value the cache held immediately before the write. */
    previous: string | null
    /** Clock reading (ms) after which the cache wins regardless. */
    until: number
}

/** What a render should show for a property, and whether the write has settled. */
export interface ResolvedWrite {
    value: string | null
    /** True when the pending write can be forgotten (the cache is authoritative again). */
    settled: boolean
}

/**
 * Reconcile a cached property value with a write that may still be in flight.
 *
 * The written value is only preferred while the cache still holds the exact
 * value the write superseded. Any other cached value means the cache has moved
 * on — to our write, or to a change made elsewhere, which must not be masked —
 * and the deadline bounds the wait when no re-parse ever arrives (a write that
 * silently failed must not pin the board to a value that is not on disk).
 */
export function resolvePendingWrite(
    pending: PendingWrite | undefined,
    cached: string | null,
    now: number
): ResolvedWrite {
    if (!pending) return { value: cached, settled: true }
    if (cached !== pending.previous) return { value: cached, settled: true }
    if (now >= pending.until) return { value: cached, settled: true }
    return { value: pending.value, settled: false }
}
