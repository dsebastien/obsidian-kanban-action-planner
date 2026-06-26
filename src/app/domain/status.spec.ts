import { describe, expect, it } from 'bun:test'
import {
    compareStatusValues,
    deriveColumns,
    detectStatusProperty,
    normalizeStatusValue,
    resolveColumnId,
    splitStatusValue
} from './status'
import { UNMAPPED_COLUMN_ID } from '../constants'

describe('detectStatusProperty', () => {
    it('prefers an exact configured property (case-insensitive)', () => {
        expect(detectStatusProperty(['Title', 'Stage'], 'stage')).toBe('Stage')
    })

    it('ignores a configured name that is absent and falls back', () => {
        expect(detectStatusProperty(['title', 'status'], 'stage')).toBe('status')
    })

    it('prefers a property literally named status', () => {
        expect(detectStatusProperty(['task_status', 'status', 'x'])).toBe('status')
    })

    it('falls back to a name containing status', () => {
        expect(detectStatusProperty(['title', 'task_status'])).toBe('task_status')
    })

    it('returns null when nothing matches', () => {
        expect(detectStatusProperty(['title', 'author'])).toBeNull()
    })
})

describe('splitStatusValue', () => {
    it('splits a numeric prefix and zero-pads the sort key', () => {
        expect(splitStatusValue('10 Todo')).toEqual({ sortKey: '000000000010', label: 'Todo' })
    })

    it('handles separators after the number', () => {
        expect(splitStatusValue('20 - In Progress').label).toBe('In Progress')
    })

    it('uses the lowercased value when there is no numeric prefix', () => {
        expect(splitStatusValue('Done')).toEqual({ sortKey: 'done', label: 'Done' })
    })
})

describe('compareStatusValues', () => {
    it('orders numeric prefixes numerically, not lexically', () => {
        const values = ['30 Done', '100 Archived', '9 Backlog', '20 Doing']
        const sorted = [...values].sort(compareStatusValues)
        expect(sorted).toEqual(['9 Backlog', '20 Doing', '30 Done', '100 Archived'])
    })
})

describe('normalizeStatusValue', () => {
    it('trims strings and rejects empty', () => {
        expect(normalizeStatusValue('  Doing ')).toBe('Doing')
        expect(normalizeStatusValue('   ')).toBeNull()
    })

    it('coerces numbers and booleans', () => {
        expect(normalizeStatusValue(3)).toBe('3')
        expect(normalizeStatusValue(true)).toBe('true')
    })

    it('rejects nullish / objects', () => {
        expect(normalizeStatusValue(null)).toBeNull()
        expect(normalizeStatusValue(undefined)).toBeNull()
        expect(normalizeStatusValue({})).toBeNull()
    })
})

describe('deriveColumns', () => {
    it('produces sorted, de-duplicated columns with stripped labels', () => {
        const cols = deriveColumns(['20 Doing', '10 Todo', '20 Doing', null, '30 Done'])
        expect(cols.map((c) => c.statusValue)).toEqual(['10 Todo', '20 Doing', '30 Done'])
        expect(cols.map((c) => c.label)).toEqual(['Todo', 'Doing', 'Done'])
    })

    it('uses the injected color assigner', () => {
        const cols = deriveColumns(['a', 'b'], (_v, i) => ({ kind: 'hex', value: `#00000${i}` }))
        expect(cols[0]?.color).toEqual({ kind: 'hex', value: '#000000' })
        expect(cols[1]?.color).toEqual({ kind: 'hex', value: '#000001' })
    })
})

describe('resolveColumnId', () => {
    const known = new Set(['10 Todo', '20 Doing'])

    it('maps a known status to its column', () => {
        expect(resolveColumnId('20 Doing', known)).toBe('20 Doing')
    })

    it('maps unknown or null status to Unmapped', () => {
        expect(resolveColumnId('Other', known)).toBe(UNMAPPED_COLUMN_ID)
        expect(resolveColumnId(null, known)).toBe(UNMAPPED_COLUMN_ID)
    })
})
