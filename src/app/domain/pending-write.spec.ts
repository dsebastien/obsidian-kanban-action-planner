import { test, expect, describe } from 'bun:test'
import { resolvePendingWrite } from './pending-write'
import type { PendingWrite, ResolvedWrite } from './pending-write'

const pending = (overrides: Partial<PendingWrite> = {}): PendingWrite => ({
    value: '20 - This Year',
    previous: '10 - Backlog',
    until: 1000,
    activeWrites: 0,
    verified: false,
    observed: false,
    ...overrides
})

/** The render-facing part of a resolution. */
const shown = (r: ResolvedWrite): { value: string | null; settled: boolean } => ({
    value: r.value,
    settled: r.settled
})

describe('resolvePendingWrite', () => {
    test('passes the cached value through when nothing is in flight', () => {
        expect(resolvePendingWrite(undefined, '10 - Backlog', 0)).toEqual({
            value: '10 - Backlog',
            settled: true,
            observed: false,
            confirmOnDisk: false
        })
    })

    test('prefers the written value while the cache still shows the old one', () => {
        expect(resolvePendingWrite(pending(), '10 - Backlog', 0)).toEqual({
            value: '20 - This Year',
            settled: false,
            observed: false,
            confirmOnDisk: false
        })
    })

    test('keeps the mask alive once the cache agrees (follow-up writes reopen the window)', () => {
        expect(shown(resolvePendingWrite(pending(), '20 - This Year', 0))).toEqual({
            value: '20 - This Year',
            settled: false
        })
    })

    test('settles at the deadline once the cache agrees', () => {
        expect(shown(resolvePendingWrite(pending(), '20 - This Year', 1000))).toEqual({
            value: '20 - This Year',
            settled: true
        })
    })

    test('never masks a value changed elsewhere', () => {
        expect(shown(resolvePendingWrite(pending(), '80 - Done', 0))).toEqual({
            value: '80 - Done',
            settled: true
        })
    })

    test('keeps masking while the cache entry is missing (mid re-parse)', () => {
        // Obsidian briefly drops the file cache between the write and the
        // re-parse; an absent value is not the cache moving on.
        expect(resolvePendingWrite(pending(), null, 0)).toEqual({
            value: '20 - This Year',
            settled: false,
            observed: false,
            confirmOnDisk: false
        })
    })

    test('a cleared write keeps masking on an empty cache', () => {
        expect(shown(resolvePendingWrite(pending({ value: null }), null, 0))).toEqual({
            value: null,
            settled: false
        })
    })

    test('handles a cleared status on both sides', () => {
        expect(shown(resolvePendingWrite(pending({ value: null }), '10 - Backlog', 0))).toEqual({
            value: null,
            settled: false
        })
        expect(
            shown(resolvePendingWrite(pending({ previous: null, value: '10 - Backlog' }), null, 0))
        ).toEqual({ value: '10 - Backlog', settled: false })
    })

    test('tracks numeric (manual order) writes the same way', () => {
        const order: PendingWrite<number | null> = {
            value: 2.5,
            previous: 7,
            until: 1000,
            activeWrites: 0,
            verified: true,
            observed: false
        }
        expect(resolvePendingWrite(order, 7, 0).value).toBe(2.5)
        expect(resolvePendingWrite(order, 2.5, 0).observed).toBe(true)
        expect(resolvePendingWrite(order, 3, 0)).toEqual({
            value: 3,
            settled: true,
            observed: false,
            confirmOnDisk: false
        })
    })
})

describe('resolvePendingWrite: the deadline asks the disk instead of giving up', () => {
    test('a cache still lagging at the deadline keeps the written value, pending a disk read', () => {
        // Live: re-parses arrived ~30s late under a write burst; giving up at
        // a fixed deadline snapped the card back to its old column.
        expect(resolvePendingWrite(pending(), '10 - Backlog', 1000)).toEqual({
            value: '20 - This Year',
            settled: false,
            observed: false,
            confirmOnDisk: true
        })
        expect(resolvePendingWrite(pending(), null, 1000)).toEqual({
            value: '20 - This Year',
            settled: false,
            observed: false,
            confirmOnDisk: true
        })
    })

    test('the deadline does not run out while the move is still writing', () => {
        // A long write sequence can outlast the deadline; the caller refreshes
        // `until` when it ends.
        expect(resolvePendingWrite(pending({ activeWrites: 1 }), '10 - Backlog', 99_999)).toEqual({
            value: '20 - This Year',
            settled: false,
            observed: false,
            confirmOnDisk: false
        })
    })

    test('a value changed elsewhere still settles after the deadline', () => {
        expect(shown(resolvePendingWrite(pending(), '80 - Done', 1000))).toEqual({
            value: '80 - Done',
            settled: true
        })
    })
})

describe('resolvePendingWrite: revert detection', () => {
    test('records that the cache has shown the written value', () => {
        expect(resolvePendingWrite(pending(), '20 - This Year', 0).observed).toBe(true)
        expect(resolvePendingWrite(pending(), '10 - Backlog', 0).observed).toBe(false)
        expect(resolvePendingWrite(pending(), null, 0).observed).toBe(false)
        // Sticky once seen.
        expect(resolvePendingWrite(pending({ observed: true }), null, 0).observed).toBe(true)
    })

    test('a return to the previous value after the write was seen and verified asks the disk', () => {
        // Still shown as written: the caller settles only if the file agrees
        // the move was reverted.
        expect(
            resolvePendingWrite(pending({ observed: true, verified: true }), '10 - Backlog', 0)
        ).toEqual({
            value: '20 - This Year',
            settled: false,
            observed: true,
            confirmOnDisk: true
        })
        // So does a vanished value (the property deleted, or a cache drop).
        expect(
            resolvePendingWrite(pending({ observed: true, verified: true }), null, 0).confirmOnDisk
        ).toBe(true)
    })

    test('an observation arms the detection for the next pass', () => {
        const first = resolvePendingWrite(pending({ verified: true }), '20 - This Year', 0)
        expect(first.confirmOnDisk).toBe(false)
        const next = resolvePendingWrite(
            pending({ verified: true, observed: first.observed }),
            '10 - Backlog',
            0
        )
        expect(next.confirmOnDisk).toBe(true)
    })

    test('treats the previous value as lag before the cache ever showed the write', () => {
        expect(
            resolvePendingWrite(pending({ verified: true }), '10 - Backlog', 0).confirmOnDisk
        ).toBe(false)
    })

    test('treats the previous value as lag while the move is still writing', () => {
        // The manual-order write and automations on the same note reopen the
        // pre-write window.
        expect(
            resolvePendingWrite(
                pending({ observed: true, verified: true, activeWrites: 1 }),
                '10 - Backlog',
                0
            ).confirmOnDisk
        ).toBe(false)
    })

    test('does not ask before the disk verification passed (it re-applies a clobber)', () => {
        expect(
            resolvePendingWrite(pending({ observed: true }), '10 - Backlog', 0).confirmOnDisk
        ).toBe(false)
    })
})
