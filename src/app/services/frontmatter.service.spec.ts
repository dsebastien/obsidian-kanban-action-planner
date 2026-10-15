import { describe, expect, it } from 'bun:test'
import { TFile } from 'obsidian'
import type { App } from 'obsidian'
import {
    appendRecordToListProperty,
    coerceOrder,
    findKeyCaseInsensitive,
    keepListShape,
    queueFrontmatterWrite,
    replaceInListProperty,
    setProperties,
    setStatusProperty
} from './frontmatter.service'

describe('findKeyCaseInsensitive', () => {
    it('returns the exact key when present', () => {
        expect(findKeyCaseInsensitive({ status: 'x' }, 'status')).toBe('status')
    })

    it('matches a differently-cased key', () => {
        expect(findKeyCaseInsensitive({ Status: 'x' }, 'status')).toBe('Status')
        expect(findKeyCaseInsensitive({ MANUAL_ORDER: 1 }, 'manual_order')).toBe('MANUAL_ORDER')
    })

    it('returns null when absent or object is nullish', () => {
        expect(findKeyCaseInsensitive({ a: 1 }, 'status')).toBeNull()
        expect(findKeyCaseInsensitive(null, 'status')).toBeNull()
        expect(findKeyCaseInsensitive(undefined, 'status')).toBeNull()
    })
})

/** A stub App whose processFrontMatter hands the callback the given object. */
const stubApp = (fm: Record<string, unknown>): { app: App; calls: () => number } => {
    let calls = 0
    const fileManager: Pick<App['fileManager'], 'processFrontMatter'> = {
        processFrontMatter: (
            _file: TFile,
            cb: (frontmatter: Record<string, unknown>) => void
        ): Promise<void> => {
            calls += 1
            cb(fm)
            return Promise.resolve()
        }
    }
    return { app: { fileManager } as App, calls: () => calls }
}

describe('setProperties', () => {
    const file = Object.assign(new TFile(), { path: 'Notes/Card.md' })

    it('writes every entry in ONE processFrontMatter transaction', async () => {
        const fm: Record<string, unknown> = {}
        const { app, calls } = stubApp(fm)
        await setProperties(app, file, { date_scheduled: '2026-07-14', estimate: 3 })
        expect(fm).toEqual({ date_scheduled: '2026-07-14', estimate: 3 })
        expect(calls()).toBe(1)
    })

    it('reuses an existing differently-cased key instead of duplicating', async () => {
        const fm: Record<string, unknown> = { Estimate: 5 }
        const { app } = stubApp(fm)
        await setProperties(app, file, { estimate: 2 })
        expect(fm).toEqual({ Estimate: 2 })
    })

    describe('replaceInListProperty', () => {
        it('replaces the matching entry in place, keeping its position', async () => {
            const fm: Record<string, unknown> = {
                milestones: ['2026-09-01 Beta', '2026-10-15 GA', '2026-12-01 Sunset']
            }
            const { app } = stubApp(fm)
            await replaceInListProperty(app, file, 'milestones', '2026-10-15 GA', '2026-10-22 GA')
            expect(fm['milestones']).toEqual([
                '2026-09-01 Beta',
                '2026-10-22 GA',
                '2026-12-01 Sunset'
            ])
        })

        it('replaces a scalar equal to the entry', async () => {
            const fm: Record<string, unknown> = { milestones: '2026-09-01 Beta' }
            const { app } = stubApp(fm)
            await replaceInListProperty(
                app,
                file,
                'milestones',
                '2026-09-01 Beta',
                '2026-09-08 Beta'
            )
            expect(fm['milestones']).toBe('2026-09-08 Beta')
        })

        it('is a no-op on a miss or a missing property', async () => {
            const fm: Record<string, unknown> = { milestones: ['2026-09-01 Beta'] }
            const { app } = stubApp(fm)
            await replaceInListProperty(app, file, 'milestones', 'not there', 'x')
            expect(fm['milestones']).toEqual(['2026-09-01 Beta'])
            await replaceInListProperty(app, file, 'other', '2026-09-01 Beta', 'x')
            expect(fm['other']).toBeUndefined()
        })
    })
})

describe('coerceOrder', () => {
    it('passes through finite numbers', () => {
        expect(coerceOrder(1.5)).toBe(1.5)
        expect(coerceOrder(0)).toBe(0)
    })

    it('parses numeric strings', () => {
        expect(coerceOrder('12')).toBe(12)
        expect(coerceOrder('3.25')).toBe(3.25)
    })

    it('rejects non-numeric / nullish / infinite', () => {
        expect(coerceOrder('abc')).toBeNull()
        expect(coerceOrder('')).toBeNull()
        expect(coerceOrder(null)).toBeNull()
        expect(coerceOrder(undefined)).toBeNull()
        expect(coerceOrder(Infinity)).toBeNull()
    })
})

describe('queueFrontmatterWrite (per-file write serialization)', () => {
    const file = (path: string): TFile => Object.assign(new TFile(), { path })
    const deferred = (): {
        promise: Promise<void>
        resolve: () => void
        reject: (e: Error) => void
    } => {
        let resolve = (): void => undefined
        let reject = (_e: Error): void => undefined
        const promise = new Promise<void>((res, rej) => {
            resolve = res
            reject = rej
        })
        return { promise, resolve, reject }
    }

    it('runs overlapping writes to the same file one after the other', async () => {
        const order: string[] = []
        const first = deferred()
        const a = queueFrontmatterWrite(file('same.md'), async () => {
            order.push('a:start')
            await first.promise
            order.push('a:end')
        })
        const b = queueFrontmatterWrite(file('same.md'), () => {
            order.push('b:start')
            return Promise.resolve()
        })
        // a starts at once (idle file); b must wait while a is still writing.
        expect(order).toEqual(['a:start'])
        first.resolve()
        await Promise.all([a, b])
        expect(order).toEqual(['a:start', 'a:end', 'b:start'])
    })

    it('lets writes to different files overlap', async () => {
        const order: string[] = []
        const first = deferred()
        const a = queueFrontmatterWrite(file('a.md'), async () => {
            order.push('a:start')
            await first.promise
        })
        const b = queueFrontmatterWrite(file('b.md'), () => {
            order.push('b:start')
            return Promise.resolve()
        })
        await b
        expect(order).toEqual(['a:start', 'b:start'])
        first.resolve()
        await a
    })

    it('a failed write neither blocks nor fails the next one on the same file', async () => {
        const boom = new Error('boom')
        const a = queueFrontmatterWrite(file('failing.md'), () => Promise.reject(boom))
        const b = queueFrontmatterWrite(file('failing.md'), () => Promise.resolve())
        let caught: unknown = null
        await a.catch((e: unknown) => {
            caught = e
        })
        expect(caught).toBe(boom)
        await b
    })
})

describe('appendRecordToListProperty (issue #172)', () => {
    const file = Object.assign(new TFile(), { path: 'Daily/2026-09-09.md' })

    it('creates the list, drops a template placeholder, and appends the object', async () => {
        const fm: Record<string, unknown> = { pomodoros: [null] }
        await appendRecordToListProperty(stubApp(fm).app, file, 'pomodoros', {
            id: 'a',
            type: 'work'
        })
        expect(fm['pomodoros']).toEqual([{ id: 'a', type: 'work' }])
        const empty: Record<string, unknown> = {}
        await appendRecordToListProperty(stubApp(empty).app, file, 'pomodoros', { id: 'b' })
        expect(empty['pomodoros']).toEqual([{ id: 'b' }])
    })

    it('keeps existing records, reuses a differently-cased key, and dedupes via matches', async () => {
        const fm: Record<string, unknown> = { Pomodoros: [{ id: 'a' }] }
        const sameId =
            (id: string) =>
            (item: unknown): boolean =>
                (item as { id?: unknown }).id === id
        await appendRecordToListProperty(
            stubApp(fm).app,
            file,
            'pomodoros',
            { id: 'a' },
            sameId('a')
        )
        expect(fm['Pomodoros']).toEqual([{ id: 'a' }])
        expect('pomodoros' in fm).toBe(false)
        await appendRecordToListProperty(
            stubApp(fm).app,
            file,
            'pomodoros',
            { id: 'b' },
            sameId('b')
        )
        expect(fm['Pomodoros']).toEqual([{ id: 'a' }, { id: 'b' }])
    })
})

describe('keepListShape / setStatusProperty (issue #219)', () => {
    const file = Object.assign(new TFile(), { path: 'Notes/Status.md' })

    it('wraps a scalar in a list only when the current value is a list', () => {
        expect(keepListShape(['todo'], 'done')).toEqual(['done'])
        expect(keepListShape([], 'done')).toEqual(['done'])
        expect(keepListShape(['a', 'b'], 'done')).toEqual(['done'])
        expect(keepListShape('todo', 'done')).toBe('done')
        expect(keepListShape(undefined, 'done')).toBe('done')
        expect(keepListShape(null, 'done')).toBe('done')
    })

    it('keeps a list-typed status a list', async () => {
        const fm: Record<string, unknown> = { Progress: ['working-on-it'] }
        await setStatusProperty(stubApp(fm).app, file, 'progress', 'done')
        expect(fm).toEqual({ Progress: ['done'] })
    })

    it('keeps a text status text, and creates a missing one as text', async () => {
        const fm: Record<string, unknown> = { status: 'todo' }
        await setStatusProperty(stubApp(fm).app, file, 'status', 'done')
        expect(fm).toEqual({ status: 'done' })
        const empty: Record<string, unknown> = {}
        await setStatusProperty(stubApp(empty).app, file, 'status', 'done')
        expect(empty).toEqual({ status: 'done' })
    })
})
