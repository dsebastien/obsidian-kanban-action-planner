import { test, expect, describe } from 'bun:test'
import { resolvePendingWrite } from './pending-write'
import type { PendingWrite } from './pending-write'

const pending = (overrides: Partial<PendingWrite> = {}): PendingWrite => ({
    value: '20 - This Year',
    previous: '10 - Backlog',
    until: 1000,
    ...overrides
})

describe('resolvePendingWrite', () => {
    test('passes the cached value through when nothing is in flight', () => {
        expect(resolvePendingWrite(undefined, '10 - Backlog', 0)).toEqual({
            value: '10 - Backlog',
            settled: true
        })
    })

    test('prefers the written value while the cache still shows the old one', () => {
        expect(resolvePendingWrite(pending(), '10 - Backlog', 0)).toEqual({
            value: '20 - This Year',
            settled: false
        })
    })

    test('keeps the mask alive once the cache agrees (follow-up writes reopen the window)', () => {
        expect(resolvePendingWrite(pending(), '20 - This Year', 0)).toEqual({
            value: '20 - This Year',
            settled: false
        })
    })

    test('never masks a value changed elsewhere', () => {
        expect(resolvePendingWrite(pending(), '80 - Done', 0)).toEqual({
            value: '80 - Done',
            settled: true
        })
    })

    test('gives up at the deadline, so a lost write cannot pin the board', () => {
        expect(resolvePendingWrite(pending(), '10 - Backlog', 1000)).toEqual({
            value: '10 - Backlog',
            settled: true
        })
    })

    test('keeps masking while the cache entry is missing (mid re-parse)', () => {
        // Obsidian briefly drops the file cache between the write and the
        // re-parse; an absent value is not the cache moving on.
        expect(resolvePendingWrite(pending(), null, 0)).toEqual({
            value: '20 - This Year',
            settled: false
        })
        // …but the deadline still wins over a cache that never comes back.
        expect(resolvePendingWrite(pending(), null, 1000)).toEqual({
            value: null,
            settled: true
        })
    })

    test('a cleared write keeps masking on an empty cache', () => {
        expect(resolvePendingWrite(pending({ value: null }), null, 0)).toEqual({
            value: null,
            settled: false
        })
    })

    test('handles a cleared status on both sides', () => {
        expect(resolvePendingWrite(pending({ value: null }), '10 - Backlog', 0)).toEqual({
            value: null,
            settled: false
        })
        expect(
            resolvePendingWrite(pending({ previous: null, value: '10 - Backlog' }), null, 0)
        ).toEqual({ value: '10 - Backlog', settled: false })
    })
})
