import { describe, expect, it } from 'bun:test'
import { OrderNormalizerQueue } from './order-normalizer.service'
import type { NormalizeJobOutcome, NormalizeStepResult } from './order-normalizer.service'

/** A queue whose pauses are recorded and resolve on the next microtask. */
function queueWithClock(): { queue: OrderNormalizerQueue; pauses: number[] } {
    const pauses: number[] = []
    const queue = new OrderNormalizerQueue((ms) => {
        pauses.push(ms)
        return Promise.resolve()
    }, 200)
    return { queue, pauses }
}

/** A step that "writes" `count` times, then reports nothing left. */
function countingStep(count: number, log: string[], label: string) {
    let left = count
    return (): Promise<NormalizeStepResult> => {
        if (left === 0) return Promise.resolve('idle')
        left--
        log.push(label)
        return Promise.resolve('wrote')
    }
}

const settle = async (): Promise<void> => {
    for (let k = 0; k < 50; k++) await Promise.resolve()
}

describe('OrderNormalizerQueue', () => {
    it('runs one write at a time, pausing between writes', async () => {
        const { queue, pauses } = queueWithClock()
        const log: string[] = []
        const outcomes: NormalizeJobOutcome[] = []
        queue.schedule('a', {}, countingStep(3, log, 'a'), (o) => outcomes.push(o))
        await settle()
        expect(log).toEqual(['a', 'a', 'a'])
        // A pause before every step (the last one finds nothing left).
        expect(pauses).toEqual([200, 200, 200, 200])
        expect(outcomes).toEqual([{ writes: 3, cancelled: false }])
    })

    it('runs jobs one after the other, never interleaved', async () => {
        const { queue } = queueWithClock()
        const log: string[] = []
        queue.schedule('a', {}, countingStep(2, log, 'a'))
        queue.schedule('b', {}, countingStep(2, log, 'b'))
        await settle()
        expect(log).toEqual(['a', 'a', 'b', 'b'])
    })

    it('deduplicates a queued job by key', async () => {
        const { queue } = queueWithClock()
        const log: string[] = []
        const owner = {}
        queue.schedule('first', owner, countingStep(1, log, 'first'))
        queue.schedule('col', owner, countingStep(1, log, 'old'))
        queue.schedule('col', owner, countingStep(1, log, 'new'))
        await settle()
        expect(log).toEqual(['first', 'new'])
    })

    it('cancels a running job after its in-flight write', async () => {
        let release: () => void = () => undefined
        const queue = new OrderNormalizerQueue(
            () => new Promise<void>((resolve) => (release = resolve)),
            200
        )
        const log: string[] = []
        const outcomes: NormalizeJobOutcome[] = []
        queue.schedule('col', {}, countingStep(5, log, 'w'), (o) => outcomes.push(o))
        await settle()
        expect(log).toEqual([]) // nothing runs synchronously
        release()
        await settle()
        expect(log).toEqual(['w'])
        queue.cancel('col')
        release()
        await settle()
        expect(log).toEqual(['w'])
        expect(outcomes).toEqual([{ writes: 1, cancelled: true }])
        expect(queue.has('col')).toBe(false)
    })

    it('cancels every job of an owner (view unload)', async () => {
        let release: () => void = () => undefined
        const queue = new OrderNormalizerQueue(
            () => new Promise<void>((resolve) => (release = resolve)),
            200
        )
        const log: string[] = []
        const view = {}
        queue.schedule('a', view, countingStep(5, log, 'a'))
        queue.schedule('b', view, countingStep(5, log, 'b'))
        queue.schedule('c', {}, countingStep(1, log, 'c'))
        await settle()
        release()
        await settle()
        queue.cancelOwner(view)
        release()
        await settle()
        release()
        await settle()
        expect(log).toEqual(['a', 'c'])
    })

    it('stops a job whose step fails or asks to stop', async () => {
        const { queue } = queueWithClock()
        const outcomes: NormalizeJobOutcome[] = []
        queue.schedule(
            'a',
            {},
            () => Promise.reject(new Error('write failed')),
            (o) => outcomes.push(o)
        )
        queue.schedule(
            'b',
            {},
            () => Promise.resolve('stop'),
            (o) => outcomes.push(o)
        )
        await settle()
        expect(outcomes).toEqual([
            { writes: 0, cancelled: false },
            { writes: 0, cancelled: false }
        ])
    })

    it('can reschedule a key after cancelling it', async () => {
        const { queue } = queueWithClock()
        const log: string[] = []
        queue.schedule('col', {}, countingStep(1, log, 'old'))
        queue.cancel('col')
        queue.schedule('col', {}, countingStep(1, log, 'new'))
        await settle()
        expect(log).toEqual(['new'])
    })
})
