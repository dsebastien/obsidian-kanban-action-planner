/**
 * Optimistic quick capture (issue #223): a note created from the board shows
 * as a pending card at once, until it reaches the Base's results. Pure: the
 * view passes the paths the Base returns and the current instant.
 *
 * The note itself exists as soon as the creation returns; what lags is the
 * metadata cache and the Base's query (measured up to ~37s behind under write
 * load), so the pending card carries the status, order and lane the note was
 * written with rather than what the cache reads back.
 */

/** A created note waiting for the Base to return it. */
export interface PendingCreation {
    path: string
    statusValue: string | null
    order: number | null
    laneValue: string | null
    /** Epoch ms after which the note is assumed filtered out of this view. */
    until: number
}

/** How long a created note may take to reach the Base's results. */
export const PENDING_CREATION_TIMEOUT_MS = 45_000

/** The pending creations split by what the Base now returns. */
export interface SettledCreations {
    /** Still missing from the results, within the deadline: keep showing them. */
    waiting: PendingCreation[]
    /** In the results now: the real card takes over. */
    arrived: PendingCreation[]
    /** Missing past the deadline: drop them and say the note is filtered out. */
    expired: PendingCreation[]
}

export function settlePendingCreations(
    pending: readonly PendingCreation[],
    presentPaths: ReadonlySet<string>,
    now: number
): SettledCreations {
    const settled: SettledCreations = { waiting: [], arrived: [], expired: [] }
    for (const creation of pending) {
        if (presentPaths.has(creation.path)) settled.arrived.push(creation)
        else if (now >= creation.until) settled.expired.push(creation)
        else settled.waiting.push(creation)
    }
    return settled
}
