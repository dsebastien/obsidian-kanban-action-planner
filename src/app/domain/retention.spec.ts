import { describe, expect, test } from 'bun:test'
import {
    parseCompletionDate,
    parseRetentionDays,
    retentionDateProperties,
    retentionDecision,
    retentionGuard
} from './retention'
import type { ResolvedDoneConfig } from './done'

const today = new Date(2026, 10, 17) // 2026-11-17
const done: ResolvedDoneConfig = { property: 'status', values: ['Done'] }
const reader = (fm: Record<string, unknown>) => (name: string) => fm[name]

const decide = (
    fm: Record<string, unknown>,
    over: Partial<Parameters<typeof retentionDecision>[0]> = {}
): ReturnType<typeof retentionDecision> =>
    retentionDecision({
        retention: fm['retention_days'],
        defaultDays: 0,
        done,
        dateProperties: ['date_completed'],
        read: reader(fm),
        today,
        ...over
    })

describe('parseRetentionDays', () => {
    test('nothing, null and blank text are unset', () => {
        expect(parseRetentionDays(undefined)).toEqual({ kind: 'unset' })
        expect(parseRetentionDays(null)).toEqual({ kind: 'unset' })
        expect(parseRetentionDays('  ')).toEqual({ kind: 'unset' })
    })
    test('whole numbers, as numbers or text', () => {
        expect(parseRetentionDays(7)).toEqual({ kind: 'days', days: 7 })
        expect(parseRetentionDays(0)).toEqual({ kind: 'days', days: 0 })
        expect(parseRetentionDays(' 30 ')).toEqual({ kind: 'days', days: 30 })
    })
    test('anything else is invalid, never a period', () => {
        expect(parseRetentionDays(-1)).toEqual({ kind: 'invalid', raw: '-1' })
        expect(parseRetentionDays(1.5)).toEqual({ kind: 'invalid', raw: '1.5' })
        expect(parseRetentionDays('7 days')).toEqual({ kind: 'invalid', raw: '7 days' })
        expect(parseRetentionDays('1e3')).toEqual({ kind: 'invalid', raw: '1e3' })
        expect(parseRetentionDays(true)).toEqual({ kind: 'invalid', raw: 'true' })
        expect(parseRetentionDays([7])).toEqual({ kind: 'invalid', raw: 'a list' })
        expect(parseRetentionDays({ days: 7 })).toEqual({ kind: 'invalid', raw: 'an object' })
    })
})

describe('retentionDateProperties', () => {
    test('the type list wins, trimmed, blanks dropped', () => {
        expect(retentionDateProperties([' date_completed ', '', 'date_abandoned'], 'x')).toEqual([
            'date_completed',
            'date_abandoned'
        ])
    })
    test('an empty type list falls back to the global property', () => {
        expect(retentionDateProperties([], ' date_completed ')).toEqual(['date_completed'])
        expect(retentionDateProperties([' '], '')).toEqual([])
    })
})

describe('retentionDecision', () => {
    test('no value and no type default: nothing', () => {
        expect(decide({ status: 'Done', date_completed: '2020-01-01' })).toEqual({ kind: 'none' })
    })
    test('0 keeps the note, even when the type has a default', () => {
        const fm = { retention_days: 0, status: 'Done', date_completed: '2020-01-01' }
        expect(decide(fm, { defaultDays: 7 })).toEqual({ kind: 'none' })
    })
    test('a note that is not done is never touched', () => {
        const fm = { retention_days: 7, status: 'Doing', date_completed: '2020-01-01' }
        expect(decide(fm)).toEqual({ kind: 'none' })
    })
    test('a reopened note drops out although its old completion date stays', () => {
        const fm = { retention_days: 1, status: 'Todo', date_completed: '2026-01-01' }
        expect(decide(fm)).toEqual({ kind: 'none' })
    })
    test('expired once the completion date is at least the period old', () => {
        const fm = { retention_days: 7, status: 'Done', date_completed: '2026-11-10' }
        expect(decide(fm)).toEqual({
            kind: 'expired',
            days: 7,
            property: 'date_completed',
            completed: new Date(2026, 10, 10),
            ageDays: 7
        })
    })
    test('one day short waits', () => {
        const fm = { retention_days: 7, status: 'Done', date_completed: '2026-11-11' }
        expect(decide(fm)).toEqual({ kind: 'wait', days: 7 })
    })
    test('the type default applies to a note without its own value', () => {
        const fm = { status: 'Done', date_completed: '2026-11-01' }
        expect(decide(fm, { defaultDays: 14 })).toMatchObject({ kind: 'expired', days: 14 })
        expect(decide(fm, { defaultDays: 30 })).toEqual({ kind: 'wait', days: 30 })
    })
    test('the note value wins over the type default', () => {
        const fm = { retention_days: 60, status: 'Done', date_completed: '2026-11-01' }
        expect(decide(fm, { defaultDays: 1 })).toEqual({ kind: 'wait', days: 60 })
    })
    test('done without a completion date: stamp, never delete', () => {
        expect(decide({ retention_days: 7, status: 'Done' })).toEqual({ kind: 'stamp', days: 7 })
        expect(decide({ retention_days: 7, status: 'Done', date_completed: ' ' })).toEqual({
            kind: 'stamp',
            days: 7
        })
    })
    test('no completion date property at all: wait', () => {
        expect(decide({ retention_days: 7, status: 'Done' }, { dateProperties: [] })).toEqual({
            kind: 'wait',
            days: 7
        })
    })
    test('an unreadable completion date waits', () => {
        const fm = { retention_days: 7, status: 'Done', date_completed: 'last week' }
        expect(decide(fm)).toEqual({ kind: 'wait', days: 7 })
    })
    test('an invalid retention value on a done note is reported, never a period', () => {
        const fm = { retention_days: '7 days', status: 'Done', date_completed: '2020-01-01' }
        expect(decide(fm)).toEqual({ kind: 'invalid', raw: '7 days' })
        // Not done: nothing to report.
        expect(decide({ ...fm, status: 'Todo' })).toEqual({ kind: 'none' })
    })
    test('a type without a done state cannot be aged', () => {
        const fm = { retention_days: 7, status: 'Done', date_completed: '2020-01-01' }
        expect(decide(fm, { done: null })).toEqual({ kind: 'no-done-state' })
        // No retention asked for: still nothing.
        expect(decide({ status: 'Done' }, { done: null })).toEqual({ kind: 'none' })
    })
    test('the latest completion date wins, never a stale earlier one', () => {
        const fm = {
            retention_days: 7,
            status: 'Done',
            date_completed: '2020-01-01',
            date_abandoned: '2026-11-16'
        }
        const both = { dateProperties: ['date_completed', 'date_abandoned'] }
        expect(decide(fm, both)).toEqual({ kind: 'wait', days: 7 })
        expect(decide({ ...fm, date_abandoned: '2026-11-01' }, both)).toMatchObject({
            kind: 'expired',
            property: 'date_abandoned',
            ageDays: 16
        })
    })
    test('one unreadable date among several makes the note wait', () => {
        const fm = {
            retention_days: 7,
            status: 'Done',
            date_completed: '2020-01-01',
            date_abandoned: 'soon'
        }
        expect(decide(fm, { dateProperties: ['date_completed', 'date_abandoned'] })).toEqual({
            kind: 'wait',
            days: 7
        })
    })
    test('a note changed during the period waits, whatever its completion date', () => {
        const fm = { retention_days: 7, status: 'Done', date_completed: '2025-01-01' }
        expect(decide(fm, { modified: new Date(2026, 10, 15, 9, 30) })).toEqual({
            kind: 'wait',
            days: 7
        })
        expect(decide(fm, { modified: new Date(2026, 10, 10, 23, 59) })).toMatchObject({
            kind: 'expired'
        })
        expect(decide(fm, { modified: null })).toMatchObject({ kind: 'expired' })
    })
    test('dates that are not strict YYYY-MM-DD never count', () => {
        const base = { retention_days: 7, status: 'Done' }
        for (const bad of ['05/12/2020', '0000-00-00', '0001-01-01', '2026-02-31', '20200101']) {
            expect(decide({ ...base, date_completed: bad })).toEqual({ kind: 'wait', days: 7 })
        }
        expect(decide({ ...base, date_completed: 20200101 })).toEqual({ kind: 'wait', days: 7 })
        expect(decide({ ...base, date_completed: '2026-11-01T08:30' })).toMatchObject({
            kind: 'expired'
        })
    })
    test('a completion date in the future waits', () => {
        const fm = { retention_days: 7, status: 'Done', date_completed: '2027-01-01' }
        expect(decide(fm)).toEqual({ kind: 'wait', days: 7 })
    })
    test('checkbox done definitions work', () => {
        const fm = { retention_days: 1, done: true, date_completed: '2026-11-01' }
        expect(decide(fm, { done: { property: 'done', values: [] } })).toMatchObject({
            kind: 'expired'
        })
    })
})

describe('retentionGuard', () => {
    const free = { tracking: false, folderNoteWithSiblings: false, backlinks: 0, keepLinked: true }
    test('nothing in the way: the note may go', () => {
        expect(retentionGuard(free)).toBeNull()
    })
    test('a linked note is kept only when the setting says so', () => {
        expect(retentionGuard({ ...free, backlinks: 2 })).toBe('linked')
        expect(retentionGuard({ ...free, backlinks: 2, keepLinked: false })).toBeNull()
    })
    test('a running session and a folder note with siblings always keep the note', () => {
        expect(retentionGuard({ ...free, tracking: true, keepLinked: false })).toBe('tracking')
        expect(retentionGuard({ ...free, folderNoteWithSiblings: true, keepLinked: false })).toBe(
            'folder-note'
        )
    })
})

describe('parseCompletionDate', () => {
    test('a real calendar date, with or without a time', () => {
        expect(parseCompletionDate('2026-11-01')).toEqual(new Date(2026, 10, 1))
        expect(parseCompletionDate(' 2026-11-01T23:30-05:00 ')).toEqual(new Date(2026, 10, 1))
        expect(parseCompletionDate('2026-11-01 08:00')).toEqual(new Date(2026, 10, 1))
    })
    test('everything else is not a date', () => {
        for (const bad of ['2026-13-01', '2026-11-31', '2026-11-1', '2026-11-011', 'Nov 1, 2026']) {
            expect(parseCompletionDate(bad)).toBeNull()
        }
        expect(parseCompletionDate(new Date())).toBeNull()
        expect(parseCompletionDate(null)).toBeNull()
    })
})
