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
 * The written value is preferred while the cache still holds the exact value
 * the write superseded — or holds NOTHING. Around every write to the note
 * (the status itself, then the manual-order write and any automation on the
 * same file), Obsidian briefly drops the file's cache entry and can let the
 * pre-write value linger (measured live on a 1200-card board: `getFileCache()`
 * null for ~40ms, the old value lingering for 300ms+). A missing value is not
 * evidence that the cache moved on, so it keeps the mask; and agreement does
 * NOT settle the write, because the follow-up writes reopen those windows —
 * a rebuild landing in one rendered the card status-less (or, with the old
 * value lingering, back in its source column) until the next echo. The mask
 * therefore lives until its deadline. Only a DIFFERENT, present cached value
 * settles it early: the cache moved on to a change made elsewhere, which
 * must not be masked. The deadline bounds the wait when no re-parse ever
 * arrives (a write that silently failed must not pin the board to a value
 * that is not on disk).
 */
export function resolvePendingWrite(
    pending: PendingWrite | undefined,
    cached: string | null,
    now: number
): ResolvedWrite {
    if (!pending) return { value: cached, settled: true }
    if (now >= pending.until) return { value: cached, settled: true }
    if (cached === null || cached === pending.previous || cached === pending.value) {
        return { value: pending.value, settled: false }
    }
    return { value: cached, settled: true }
}
