/**
 * Session guard (issue #197): idle detection, a session cap, and the
 * recovery of a session found running after a restart. Pure: every instant
 * comes in as epoch ms so the decisions are unit-testable.
 *
 * A session left running overnight silently records the whole night into the
 * entries ledger and inflates every roll-up (budget ring, WBS totals, targets
 * table). Nothing here ever blocks a stop: the guard only decides WHEN to ask
 * and WHAT to offer.
 */

export interface GuardSettings {
    /** Minutes without activity before the session is considered idle; 0 = off. */
    idleMinutes: number
    /** Longest session the tracker will write without asking; 0 = no cap. */
    maxMinutes: number
}

/** What the tracker should do about the running session right now. */
export type GuardVerdict =
    | { kind: 'ok' }
    /** No activity since `idleSince`: offer to end the session there. */
    | { kind: 'idle'; idleSince: number; idleMinutes: number }
    /** The session ran past the cap: warn, offer to end at the cap. */
    | { kind: 'capped'; capAt: number; elapsedMinutes: number }

const MINUTE_MS = 60_000

/**
 * The verdict for a session started at `startedAt`, given the last activity
 * instant and `now`. The cap wins over idleness: a session both idle and over
 * the cap is first of all too long. Activity BEFORE the session started
 * counts from the session's start, so a fresh session is never idle at once.
 */
export function guardVerdict(
    session: { startedAt: number },
    lastActivityAt: number,
    now: number,
    settings: GuardSettings
): GuardVerdict {
    const elapsed = now - session.startedAt
    if (settings.maxMinutes > 0 && elapsed >= settings.maxMinutes * MINUTE_MS) {
        return {
            kind: 'capped',
            capAt: session.startedAt + settings.maxMinutes * MINUTE_MS,
            elapsedMinutes: Math.round(elapsed / MINUTE_MS)
        }
    }
    if (settings.idleMinutes > 0) {
        const since = Math.max(session.startedAt, lastActivityAt)
        const idle = now - since
        if (idle >= settings.idleMinutes * MINUTE_MS) {
            return { kind: 'idle', idleSince: since, idleMinutes: Math.round(idle / MINUTE_MS) }
        }
    }
    return { kind: 'ok' }
}

/** The choices offered when a session is found running after a restart. */
export interface RecoveryChoices {
    /** Minutes the session has been running by `now`. */
    elapsedMinutes: number
    /** End it at the cap (present only when a cap applies and was exceeded). */
    trimTo: number | null
    /** Whether the session is long enough to be worth asking about at all. */
    suspicious: boolean
}

/**
 * What to offer for a session that survived a restart: keep it running, trim
 * it (end at the cap), or discard it. A short session is not worth a prompt —
 * it simply keeps running, exactly as before the restart.
 */
export function recoveryChoices(
    session: { startedAt: number },
    now: number,
    settings: GuardSettings
): RecoveryChoices {
    const elapsed = now - session.startedAt
    const elapsedMinutes = Math.round(elapsed / MINUTE_MS)
    const overCap = settings.maxMinutes > 0 && elapsed >= settings.maxMinutes * MINUTE_MS
    const overIdle = settings.idleMinutes > 0 && elapsed >= settings.idleMinutes * MINUTE_MS
    return {
        elapsedMinutes,
        trimTo: overCap ? session.startedAt + settings.maxMinutes * MINUTE_MS : null,
        suspicious: overCap || overIdle
    }
}
