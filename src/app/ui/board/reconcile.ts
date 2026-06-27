/**
 * Pure keyed reconciliation for the board's incremental refresh (Milestone 6).
 *
 * Given the keys+signatures currently in the DOM and the desired keys+signatures,
 * compute the minimal plan to transform one into the other:
 *   - `remove`   — keys present now but not desired (and changed keys, which are
 *                  rebuilt rather than patched in place)
 *   - `ordered`  — the desired items in final order, each flagged `create` (no
 *                  prior node), `update` (prior node but a different signature),
 *                  or neither (reuse the existing node untouched → identity,
 *                  focus, scroll, and in-flight drag are preserved)
 *
 * The DOM applier in `board-renderer.ts` consumes this; keeping the logic pure
 * here makes it unit-testable without a DOM.
 */

export interface KeyedSig {
    key: string
    signature: string
}

export interface ReconcileEntry {
    key: string
    /** No existing node for this key — build a fresh one. */
    create: boolean
    /** An existing node exists but its signature changed — rebuild it. */
    update: boolean
}

export interface ReconcilePlan {
    /** Keys whose existing nodes must be removed (gone or about to be rebuilt). */
    remove: string[]
    /** Desired entries in final render order. */
    ordered: ReconcileEntry[]
}

/** Compute the reconcile plan from current vs desired keyed signatures. */
export function planReconcile(
    existing: ReadonlyArray<KeyedSig>,
    desired: ReadonlyArray<KeyedSig>
): ReconcilePlan {
    const existingByKey = new Map(existing.map((e) => [e.key, e.signature]))
    const desiredByKey = new Map(desired.map((d) => [d.key, d.signature]))

    const ordered: ReconcileEntry[] = desired.map((d) => {
        const prev = existingByKey.get(d.key)
        return {
            key: d.key,
            create: prev === undefined,
            update: prev !== undefined && prev !== d.signature
        }
    })

    const remove: string[] = []
    for (const e of existing) {
        // Remove a node when its key is gone, or when it persists but changed
        // (a changed card is rebuilt to keep the render logic in one place).
        if (desiredByKey.get(e.key) !== e.signature) {
            remove.push(e.key)
        }
    }

    return { remove, ordered }
}
