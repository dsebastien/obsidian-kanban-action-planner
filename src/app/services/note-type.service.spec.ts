import { describe, expect, it } from 'bun:test'
import {
    colorForStatus,
    columnsFromValues,
    createDefaultNoteType,
    DEFAULT_NOTE_TYPE_ID
} from './note-type.service'
import { noteTypeSchema } from '../domain/note-type'
import { autoAssignColor } from './colors.service'

describe('createDefaultNoteType', () => {
    it('produces a fully-populated, schema-valid noteType', () => {
        const noteType = createDefaultNoteType(DEFAULT_NOTE_TYPE_ID, 'Default', 'local')
        expect(() => noteTypeSchema.parse(noteType)).not.toThrow()
        expect(noteType.colors.autoAssign).toBe(true)
        expect(noteType.laneGrouping).toEqual({ kind: 'none' })
    })
})

describe('colorForStatus', () => {
    const base = createDefaultNoteType('p', 'P', 'local')

    it('uses an explicit override when present', () => {
        const noteType = {
            ...base,
            colors: {
                autoAssign: true,
                overrides: { Done: { kind: 'hex', value: '#123456' } as const }
            }
        }
        expect(colorForStatus(noteType, 'Done')).toEqual({ kind: 'hex', value: '#123456' })
    })

    it('auto-assigns when enabled and no override', () => {
        expect(colorForStatus(base, 'Doing')).toEqual(autoAssignColor('Doing'))
    })

    it('uses a neutral when auto-assign is off', () => {
        const noteType = { ...base, colors: { autoAssign: false, overrides: {} } }
        expect(colorForStatus(noteType, 'Doing')).toEqual({ kind: 'palette', token: 'slate' })
    })
})

describe('columnsFromValues', () => {
    const noteType = createDefaultNoteType('p', 'P', 'local')

    it('preserves order when asked (e.g. Starter Kit allowed values)', () => {
        const cols = columnsFromValues(['30 Done', '10 Todo', '20 Doing'], noteType, true)
        expect(cols.map((c) => c.statusValue)).toEqual(['30 Done', '10 Todo', '20 Doing'])
    })

    it('sorts by numeric/lexical prefix when not preserving order', () => {
        const cols = columnsFromValues(['30 Done', '10 Todo', '20 Doing'], noteType, false)
        expect(cols.map((c) => c.statusValue)).toEqual(['10 Todo', '20 Doing', '30 Done'])
        expect(cols.map((c) => c.label)).toEqual(['Todo', 'Doing', 'Done'])
    })

    it('de-duplicates values', () => {
        const cols = columnsFromValues(['a', 'a', 'b'], noteType, true)
        expect(cols.map((c) => c.statusValue)).toEqual(['a', 'b'])
    })

    it('attaches WIP limits from the note type, omitting unset/zero ones (issue #16)', () => {
        const withLimits = { ...noteType, wipLimits: { '10 Todo': 3, '20 Doing': 0 } }
        const cols = columnsFromValues(['10 Todo', '20 Doing', '30 Done'], withLimits, true)
        expect(cols.find((c) => c.statusValue === '10 Todo')?.wipLimit).toBe(3)
        expect(cols.find((c) => c.statusValue === '20 Doing')?.wipLimit).toBeUndefined()
        expect(cols.find((c) => c.statusValue === '30 Done')?.wipLimit).toBeUndefined()
    })
})
