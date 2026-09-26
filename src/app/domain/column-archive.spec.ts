import { describe, expect, test } from 'bun:test'
import { columnArchivable } from './column-archive'

const done = { property: 'status', values: ['Done', 'Cancelled'] }

describe('columnArchivable', () => {
    test('done column with an archive folder qualifies', () => {
        expect(columnArchivable('done', done, 'Status', 'Archive/{{year}}')).toBe(true)
        expect(columnArchivable('Cancelled', done, 'status', 'Archive')).toBe(true)
    })

    test('non-done column does not', () => {
        expect(columnArchivable('Doing', done, 'status', 'Archive')).toBe(false)
    })

    test('no archive folder does not', () => {
        expect(columnArchivable('Done', done, 'status', '  ')).toBe(false)
    })

    test('no done config does not', () => {
        expect(columnArchivable('Done', null, 'status', 'Archive')).toBe(false)
    })

    test('done config on another property does not', () => {
        const other = { property: 'completed', values: ['Done'] }
        expect(columnArchivable('Done', other, 'status', 'Archive')).toBe(false)
    })

    test('checkbox-style done (no values) does not', () => {
        expect(columnArchivable('true', { property: 'status', values: [] }, 'status', 'A')).toBe(
            false
        )
    })

    test('unmapped column (null status) does not', () => {
        expect(columnArchivable(null, done, 'status', 'Archive')).toBe(false)
    })
})
