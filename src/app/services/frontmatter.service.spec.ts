import { describe, expect, it } from 'bun:test'
import type { App, TFile } from 'obsidian'
import {
    coerceOrder,
    findKeyCaseInsensitive,
    queueFrontmatterWrite,
    replaceInListProperty,
    setProperties
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

describe('setProperties', () => {
    /** A stub App whose processFrontMatter hands the callback the given object. */
    const appFor = (fm: Record<string, unknown>): { app: App; calls: () => number } => {
        let calls = 0
        const app = {
            fileManager: {
                processFrontMatter: (
                    _file: TFile,
                    cb: (frontmatter: Record<string, unknown>) => void
                ): Promise<void> => {
                    calls += 1
                    cb(fm)
                    return Promise.resolve()
                }
            }
        } as unknown as App
        return { app, calls: () => calls }
    }
    const file = { path: 'Notes/Card.md' } as unknown as TFile

    it('writes every entry in ONE processFrontMatter transaction', async () => {
        const fm: Record<string, unknown> = {}
        const { app, calls } = appFor(fm)
        await setProperties(app, file, { date_scheduled: '2026-07-14', estimate: 3 })
        expect(fm).toEqual({ date_scheduled: '2026-07-14', estimate: 3 })
        expect(calls()).toBe(1)
    })

    it('reuses an existing differently-cased key instead of duplicating', async () => {
        const fm: Record<string, unknown> = { Estimate: 5 }
        const { app } = appFor(fm)
        await setProperties(app, file, { estimate: 2 })
        expect(fm).toEqual({ Estimate: 2 })
    })

    describe('replaceInListProperty', () => {
        it('replaces the matching entry in place, keeping its position', async () => {
            const fm: Record<string, unknown> = {
                milestones: ['2026-09-01 Beta', '2026-10-15 GA', '2026-12-01 Sunset']
            }
            const { app } = appFor(fm)
            await replaceInListProperty(app, file, 'milestones', '2026-10-15 GA', '2026-10-22 GA')
            expect(fm['milestones']).toEqual([
                '2026-09-01 Beta',
                '2026-10-22 GA',
                '2026-12-01 Sunset'
            ])
        })

        it('replaces a scalar equal to the entry', async () => {
            const fm: Record<string, unknown> = { milestones: '2026-09-01 Beta' }
            const { app } = appFor(fm)
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
            const { app } = appFor(fm)
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
    const file = (path: string): TFile => ({ path }) as TFile
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
        const b = queueFrontmatterWrite(file('same.md'), async () => {
            order.push('b:start')
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
        const b = queueFrontmatterWrite(file('b.md'), async () => {
            order.push('b:start')
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
