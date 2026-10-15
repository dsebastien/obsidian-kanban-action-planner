/**
 * Background manual-order normalizer queue (plugin-wide).
 *
 * Repairing a column's `manual_order` values (unset, tied, too close) writes
 * notes, and every write is a metadata re-parse for Obsidian and each
 * indexing plugin: a burst of hundreds floods the cache for tens of seconds.
 * So repairs never run on a drop's critical path: views schedule a JOB per
 * column here, and ONE queue for the whole plugin runs them one write at a
 * time with a pause between writes.
 *
 * A job is a `step` that re-plans from the view's CURRENT state and performs
 * at most one write. Re-planning every step makes a job robust to everything
 * that can happen meanwhile (a newer move, a rebuild, another open view of the
 * same Base having fixed the same notes — pending order writes are shared
 * plugin-wide, so its plan comes back empty), and it ends on its own when the
 * plan is empty.
 */

/** What a job's step did: wrote one note (more may follow), found nothing to do, or must stop. */
export type NormalizeStepResult = 'wrote' | 'idle' | 'stop'

/** How a job ended, for summaries. */
export interface NormalizeJobOutcome {
    writes: number
    cancelled: boolean
}

interface Job {
    key: string
    owner: object
    step: () => Promise<NormalizeStepResult>
    onDone: ((outcome: NormalizeJobOutcome) => void) | undefined
    cancelled: boolean
}

/** Pause between two normalizer writes (ms). */
export const NORMALIZE_WRITE_INTERVAL_MS = 200

/**
 * Safety cap on the writes of one job. A plan converges in as many writes as
 * it lists; the cap only guards against a step that keeps reporting a write
 * without the plan ever shrinking.
 */
export const NORMALIZE_MAX_WRITES_PER_JOB = 5000

export class OrderNormalizerQueue {
    private readonly queue: Job[] = []
    private current: Job | null = null
    private running = false

    constructor(
        private readonly sleep: (ms: number) => Promise<void> = (ms) =>
            new Promise((resolve) => window.setTimeout(resolve, ms)),
        private readonly intervalMs = NORMALIZE_WRITE_INTERVAL_MS
    ) {}

    /**
     * Queue a job for `key` (one per column per view). Deduplicated: a job
     * already queued for the key takes the new step and callback; a job
     * already running for it keeps running (it re-plans every step) and the
     * callback is chained to its end.
     */
    schedule(
        key: string,
        owner: object,
        step: () => Promise<NormalizeStepResult>,
        onDone?: (outcome: NormalizeJobOutcome) => void
    ): void {
        const queued = this.queue.find((job) => job.key === key)
        if (queued) {
            queued.step = step
            queued.onDone = chain(queued.onDone, onDone)
            return
        }
        const current = this.current
        if (current && current.key === key && !current.cancelled) {
            current.onDone = chain(current.onDone, onDone)
            return
        }
        this.queue.push({ key, owner, step, onDone, cancelled: false })
        void this.drain()
    }

    /** Whether a job for `key` is queued or running. */
    has(key: string): boolean {
        return (
            this.queue.some((job) => job.key === key) ||
            (this.current?.key === key && !this.current.cancelled)
        )
    }

    /** Cancel the job for `key` (a running one stops after its in-flight write). */
    cancel(key: string): void {
        this.cancelWhere((job) => job.key === key)
    }

    /** Cancel every job of `owner` (its view unloaded, or its sort changed). */
    cancelOwner(owner: object): void {
        this.cancelWhere((job) => job.owner === owner)
    }

    private cancelWhere(matches: (job: Job) => boolean): void {
        for (let k = this.queue.length - 1; k >= 0; k--) {
            const job = this.queue[k]
            if (job && matches(job)) {
                this.queue.splice(k, 1)
                job.cancelled = true
                job.onDone?.({ writes: 0, cancelled: true })
            }
        }
        if (this.current && matches(this.current)) this.current.cancelled = true
    }

    private async drain(): Promise<void> {
        if (this.running) return
        this.running = true
        try {
            let job = this.queue.shift()
            while (job) {
                this.current = job
                let writes = 0
                while (writes < NORMALIZE_MAX_WRITES_PER_JOB) {
                    // Yield BEFORE every write: scheduling never runs a step
                    // synchronously (off the caller's critical path), and the
                    // pause lets Obsidian (and every indexing plugin) re-parse
                    // the previous write before the next one.
                    await this.sleep(this.intervalMs)
                    if (job.cancelled) break
                    let result: NormalizeStepResult
                    try {
                        result = await job.step()
                    } catch {
                        result = 'stop'
                    }
                    if (result !== 'wrote') break
                    writes++
                }
                this.current = null
                job.onDone?.({ writes, cancelled: job.cancelled })
                job = this.queue.shift()
            }
        } finally {
            this.running = false
        }
    }
}

function chain<T>(
    first: ((value: T) => void) | undefined,
    second: ((value: T) => void) | undefined
): ((value: T) => void) | undefined {
    if (!first) return second
    if (!second) return first
    return (value) => {
        first(value)
        second(value)
    }
}
