import { describe, expect, it } from 'bun:test'
import {
    compareStatusValues,
    configurableStatusValues,
    detectStatusProperty,
    normalizeStatusValue,
    resolveColumnId,
    resolveWriteStatusProperty,
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

describe('resolveWriteStatusProperty (issue #188)', () => {
    const base = {
        viewOverride: null,
        typeProperty: null,
        isDefaultType: false,
        boardProperty: null
    }

    it('prefers the per-view override over everything', () => {
        expect(
            resolveWriteStatusProperty({
                ...base,
                viewOverride: 'phase',
                typeProperty: 'status',
                boardProperty: 'urgency'
            })
        ).toBe('phase')
    })

    it("uses a recognized type's own property over the board property", () => {
        expect(
            resolveWriteStatusProperty({ ...base, typeProperty: 'stage', boardProperty: 'urgency' })
        ).toBe('stage')
    })

    it("ignores the Default type's stale snapshot and writes the board property", () => {
        expect(
            resolveWriteStatusProperty({
                ...base,
                typeProperty: 'status',
                isDefaultType: true,
                boardProperty: 'urgency'
            })
        ).toBe('urgency')
    })

    it('treats blank names as unset', () => {
        expect(
            resolveWriteStatusProperty({
                ...base,
                viewOverride: '  ',
                typeProperty: '',
                boardProperty: 'status'
            })
        ).toBe('status')
        expect(resolveWriteStatusProperty(base)).toBeNull()
    })
})

describe('configurableStatusValues (issue #200)', () => {
    const all = {
        starterKitExplicit: ['10 - Todo', '80 - Done'],
        starterKitDetected: ['detected'],
        storedColumns: ['stored'],
        globalDefaults: ['global']
    }

    it("prefers the Starter Kit's explicit status declaration", () => {
        expect(configurableStatusValues(all)).toEqual(['10 - Todo', '80 - Done'])
    })

    it('falls back to the property heuristic when there is no explicit status', () => {
        expect(configurableStatusValues({ ...all, starterKitExplicit: [] })).toEqual(['detected'])
    })

    it('falls back to the stored columns when the Starter Kit says nothing', () => {
        expect(
            configurableStatusValues({ ...all, starterKitExplicit: [], starterKitDetected: [] })
        ).toEqual(['stored'])
    })

    it('falls back to the global defaults for a type with no columns yet', () => {
        expect(configurableStatusValues({ globalDefaults: ['global'] })).toEqual(['global'])
    })

    it('is empty only when every source is', () => {
        expect(configurableStatusValues({})).toEqual([])
        expect(
            configurableStatusValues({
                starterKitExplicit: [],
                starterKitDetected: [],
                storedColumns: [],
                globalDefaults: []
            })
        ).toEqual([])
    })

    it('copies rather than aliasing the winning source', () => {
        const stored = ['stored']
        const result = configurableStatusValues({ storedColumns: stored })
        result.push('mutated')
        expect(stored).toEqual(['stored'])
    })
})
