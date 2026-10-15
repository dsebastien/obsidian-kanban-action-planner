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

/** The kinds of value a pending write tracks: a status, or a manual order. */
export type PendingValue = string | number | null

/** A property value written but not yet observed in the metadata cache. */
export interface PendingWrite<T extends PendingValue = string | null> {
    /** The value that was written. */
    value: T
    /** The value the cache held immediately before the write. */
    previous: T
    /**
     * Clock reading (ms) after which the file on disk decides (see
     * {@link ResolvedWrite.confirmOnDisk}). Ignored while
     * {@link activeWrites} is non-zero: the caller refreshes it when the
     * sequence ends, so a long sequence cannot outlive its own mask.
     */
    until: number
    /**
     * How many of the move's own write sequences are still running: the move
     * itself (status, manual order, automations, done stamps) and a
     * verification re-apply, which can overlap it. Their writes on the note
     * reopen the cache's null / pre-write windows, so while any runs the mask
     * holds unconditionally. A counter, not a flag, so the first sequence to
     * end cannot clear the other's hold.
     */
    activeWrites: number
    /** The value on disk was verified to be {@link value} after the write. */
    verified: boolean
    /** The metadata cache has been seen holding {@link value} (the re-parse arrived). */
    observed: boolean
}

/** What a render should show for a property, and whether the write has settled. */
export interface ResolvedWrite<T extends PendingValue = string | null> {
    value: T
    /** True when the pending write can be forgotten (the cache is authoritative again). */
    settled: boolean
    /** The new {@link PendingWrite.observed}; the caller stores it back. */
    observed: boolean
    /**
     * The cache shows nothing or the superseded value where lag alone no
     * longer explains it: the deadline passed, or the cache had already shown
     * the written value (a later return to `previous` may be another writer
     * reverting the note: an editor undo, a sync, another plugin). The written
     * value stays shown; the caller reads the FILE and settles only when disk
     * disagrees with the written value (else re-arms the deadline: the cache
     * is just slow).
     */
    confirmOnDisk: boolean
}

/**
 * Reconcile a cached property value with a write that may still be in flight.
 *
 * The written value is preferred while the cache still holds the exact value
 * the write superseded — or holds NOTHING. Around every write to the note
 * (the status itself, then the manual-order write and any automation on the
 * same file), Obsidian briefly drops the file's cache entry and can let the
 * pre-write value linger (measured live on a 1200-card board: `getFileCache()`
 * null for ~40ms, the old value lingering for 300ms+; and under a burst of
 * writes with indexing plugins installed, the re-parse of a written note
 * arrived a median 27s late, up to 37s). A missing value is not evidence that
 * the cache moved on, so it keeps the mask; and agreement does NOT settle the
 * write before the deadline, because the follow-up writes reopen those
 * windows — a rebuild landing in one rendered the card status-less (or, with
 * the old value lingering, back in its source column) until the next echo.
 * Only a DIFFERENT, present cached value settles it early: the cache moved on
 * to a change made elsewhere, which must not be masked.
 *
 * A null or superseded cached value is ambiguous (lag, or a real change back)
 * once lag no longer explains it: after the deadline, or after the cache
 * already showed the written value and the write was verified on disk. Then
 * {@link ResolvedWrite.confirmOnDisk} asks the caller to read the file. A
 * fixed deadline alone cannot tell: it expired while the cache still lagged
 * and snapped cards back, and it kept masking a real revert until it ran out.
 * While the move's own writes run, everything is lag.
 */
export function resolvePendingWrite<T extends PendingValue>(
    pending: PendingWrite<T> | undefined,
    cached: T,
    now: number
): ResolvedWrite<T> {
    if (!pending) return { value: cached, settled: true, observed: false, confirmOnDisk: false }
    const observed = pending.observed || cached === pending.value
    const show = (value: T, settled: boolean, confirmOnDisk = false): ResolvedWrite<T> => ({
        value,
        settled,
        observed,
        confirmOnDisk
    })
    if (pending.activeWrites > 0) return show(pending.value, false)
    const expired = now >= pending.until
    if (cached === pending.value) return show(cached, expired)
    if (cached !== null && cached !== pending.previous) return show(cached, true)
    return show(pending.value, false, expired || (observed && pending.verified))
}
