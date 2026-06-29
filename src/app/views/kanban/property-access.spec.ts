import { describe, expect, it } from 'bun:test'
import type { Value } from 'obsidian'
import { parsePropertyRef, unwrapValue } from './property-access'

/** A minimal stand-in for a Bases `Value` (getValue + toString). */
function value(raw: unknown, str?: string): Value {
    return {
        getValue: () => raw,
        toString: () => str ?? String(raw)
    } as unknown as Value
}

describe('parsePropertyRef', () => {
    it('treats a bare name as a note property', () => {
        expect(parsePropertyRef('priority')).toEqual({ kind: 'note', name: 'priority' })
    })

    it('maps note.* to a writeable note ref', () => {
        expect(parsePropertyRef('note.priority')).toEqual({ kind: 'note', name: 'priority' })
    })

    it('maps formula.* / file.* to a read-only computed ref', () => {
        expect(parsePropertyRef('formula.priority_score')).toEqual({
            kind: 'computed',
            id: 'formula.priority_score'
        })
        expect(parsePropertyRef('file.name')).toEqual({ kind: 'computed', id: 'file.name' })
    })

    it('returns null for empty / non-string / unknown prefixes', () => {
        expect(parsePropertyRef('')).toBeNull()
        expect(parsePropertyRef(undefined)).toBeNull()
        expect(parsePropertyRef(42)).toBeNull()
        expect(parsePropertyRef('weird.thing')).toBeNull()
    })
})

describe('unwrapValue', () => {
    it('returns null for null/undefined', () => {
        expect(unwrapValue(null)).toBeNull()
        expect(unwrapValue(undefined)).toBeNull()
    })

    it('keeps finite numbers, rejects non-finite', () => {
        expect(unwrapValue(value(12.5))).toBe(12.5)
        expect(unwrapValue(value(0))).toBe(0)
        expect(unwrapValue(value(Infinity))).toBeNull()
    })

    it('parses numeric strings to numbers, keeps other strings', () => {
        expect(unwrapValue(value('42'))).toBe(42)
        expect(unwrapValue(value('10 - 🎯 Goal'))).toBe('10 - 🎯 Goal')
    })

    it('treats empty / "null" / blank as null', () => {
        expect(unwrapValue(value(''))).toBeNull()
        expect(unwrapValue(value('   '))).toBeNull()
        expect(unwrapValue(value(null, 'null'))).toBeNull()
    })

    it('falls back to toString for object getValue (e.g. a date)', () => {
        expect(unwrapValue(value({ d: 1 }, '2026-06-30'))).toBe('2026-06-30')
    })
})
