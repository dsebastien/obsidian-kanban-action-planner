import { describe, expect, it } from 'bun:test'
import {
    basesPropToName,
    normalizeLaneValue,
    readIdArray,
    readLaneGroupingOverride,
    readSortMode,
    readStringArray
} from './view-config'

/** A config whose `get` returns values from a plain record. */
function config(values: Record<string, unknown>): { get(key: string): unknown } {
    return { get: (key: string): unknown => values[key] }
}

describe('readSortMode', () => {
    it('accepts name/property and defaults everything else to order', () => {
        expect(readSortMode('name')).toBe('name')
        expect(readSortMode('property')).toBe('property')
        expect(readSortMode('order')).toBe('order')
        expect(readSortMode(undefined)).toBe('order')
        expect(readSortMode('bogus')).toBe('order')
    })
})

describe('readStringArray', () => {
    it('keeps non-empty strings from an array', () => {
        expect(readStringArray(['a', '', '  ', 'b'])).toEqual(['a', 'b'])
        expect(readStringArray(['a', 1, null])).toEqual(['a'])
    })

    it('splits a string on newlines and commas', () => {
        expect(readStringArray('a, b\nc')).toEqual(['a', 'b', 'c'])
    })

    it('returns empty for blanks and non-string/array input', () => {
        expect(readStringArray('')).toEqual([])
        expect(readStringArray('   ')).toEqual([])
        expect(readStringArray(42)).toEqual([])
        expect(readStringArray(undefined)).toEqual([])
    })
})

describe('readIdArray', () => {
    it('keeps non-empty strings from an array without splitting', () => {
        expect(readIdArray(['a', '', '  ', 'b'])).toEqual(['a', 'b'])
        expect(readIdArray(['a, b', 'c'])).toEqual(['a, b', 'c'])
        expect(readIdArray(['x', 1, null])).toEqual(['x'])
    })

    it('returns empty for non-array input', () => {
        expect(readIdArray('a,b')).toEqual([])
        expect(readIdArray(undefined)).toEqual([])
        expect(readIdArray(null)).toEqual([])
    })
})

describe('readLaneGroupingOverride', () => {
    it('maps none / note-type kinds directly', () => {
        expect(readLaneGroupingOverride(config({ laneGrouping: 'none' }))).toEqual({ kind: 'none' })
        expect(readLaneGroupingOverride(config({ laneGrouping: 'note-type' }))).toEqual({
            kind: 'note-type'
        })
    })

    it('resolves a property grouping via the (Bases-id) property', () => {
        expect(
            readLaneGroupingOverride(
                config({ laneGrouping: 'property', laneGroupingProperty: 'note.area' })
            )
        ).toEqual({ kind: 'property', property: 'area' })
    })

    it('defers (null) for an unset kind or a property grouping with no property', () => {
        expect(readLaneGroupingOverride(config({}))).toBeNull()
        expect(readLaneGroupingOverride(config({ laneGrouping: '__profile__' }))).toBeNull()
        expect(readLaneGroupingOverride(config({ laneGrouping: 'property' }))).toBeNull()
    })
})

describe('normalizeLaneValue', () => {
    it('trims strings and maps blanks/objects to null', () => {
        expect(normalizeLaneValue('  Work ')).toBe('Work')
        expect(normalizeLaneValue('   ')).toBeNull()
        expect(normalizeLaneValue(null)).toBeNull()
        expect(normalizeLaneValue({})).toBeNull()
    })

    it('stringifies numbers and booleans', () => {
        expect(normalizeLaneValue(3)).toBe('3')
        expect(normalizeLaneValue(false)).toBe('false')
    })
})

describe('basesPropToName', () => {
    it('returns a bare name unchanged', () => {
        expect(basesPropToName('status')).toBe('status')
    })

    it('strips the note. prefix and rejects non-note namespaces', () => {
        expect(basesPropToName('note.status')).toBe('status')
        expect(basesPropToName('file.name')).toBeNull()
        expect(basesPropToName('formula.x')).toBeNull()
    })

    it('returns null for empty / non-string input', () => {
        expect(basesPropToName('')).toBeNull()
        expect(basesPropToName(undefined)).toBeNull()
        expect(basesPropToName(42)).toBeNull()
    })
})
