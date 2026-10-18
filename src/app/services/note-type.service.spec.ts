import { describe, expect, it } from 'bun:test'
import {
    colorForStatus,
    columnsFromValues,
    createDefaultNoteType,
    DEFAULT_NOTE_TYPE_ID,
    mirrorNoteType,
    resolveNaming
} from './note-type.service'
import { roleLinkRules } from '../domain/relationship-rules'
import type { SkNoteType } from './starter-kit.service'
import { defaultNamingConfig } from '../domain/card-title'
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

describe('resolveNaming (mirror refresh, Starter Kit >= 1.22)', () => {
    const live: SkNoteType = {
        id: 'task',
        name: 'Task',
        noteNameSuffix: ' (Task)',
        noteNameSuffixOptional: true
    }

    it('prefers the live Starter Kit decoration and carries its optional flags', () => {
        expect(resolveNaming(live, defaultNamingConfig())).toEqual({
            prefix: '',
            suffix: ' (Task)',
            prefixOptional: false,
            suffixOptional: true
        })
    })

    it('falls back to the stored mirror when the Starter Kit is unavailable', () => {
        const stored = { ...defaultNamingConfig(), suffix: ' (Task)', suffixOptional: true }
        expect(resolveNaming(null, stored)).toEqual(stored)
    })

    it('leaves a type with no decoration untouched', () => {
        expect(resolveNaming({ id: 'a', name: 'A' }, defaultNamingConfig())).toEqual(
            defaultNamingConfig()
        )
    })
})

describe('mirrorNoteType (Starter Kit relationships)', () => {
    const defaults = {
        statusProperty: 'status',
        orderProperty: 'manual_order',
        scheduledDateProperty: '',
        dueDateProperty: '',
        dateFormat: ''
    }
    const skTask: SkNoteType = { id: 'tasks', name: 'Tasks' }
    const rules = [
        { role: 'parent' as const, property: 'related_projects', targetTypeIds: ['projects'] },
        { role: 'parent' as const, property: 'related_goals', targetTypeIds: ['goals'] }
    ]

    it('mirrors the Starter Kit rules (OSK type ids are KAP type ids) and marks the type', () => {
        const base = createDefaultNoteType('tasks', 'Tasks', 'starter-kit')
        const out = mirrorNoteType(base, skTask, null, defaults, null, false, null, rules)
        expect(out.relationshipsMirrored).toBe(true)
        expect(roleLinkRules(out).parent).toEqual([
            { property: 'related_projects', targetTypeIds: ['projects'] },
            { property: 'related_goals', targetTypeIds: ['goals'] }
        ])
        // roles the Starter Kit does not mention are off (its declaration is complete)
        expect(roleLinkRules(out).child).toEqual([])
        expect(noteTypeSchema.parse(out)).toEqual(out)
    })

    it('without the API (null) the local config stays the source, defaults included', () => {
        const base = createDefaultNoteType('tasks', 'Tasks', 'starter-kit')
        const out = mirrorNoteType(base, skTask, null, defaults, null, false, null, null)
        expect(out.relationshipsMirrored).toBeUndefined()
        expect(roleLinkRules(out).parent).toEqual([{ property: 'parent', targetTypeIds: [] }])
    })

    it('hands the local config back when the Starter Kit stops declaring relationships', () => {
        const base = createDefaultNoteType('tasks', 'Tasks', 'starter-kit')
        const mirrored = mirrorNoteType(base, skTask, null, defaults, null, false, null, rules)
        const back = mirrorNoteType(mirrored, skTask, null, defaults, null, false, null, null)
        expect(back.relationshipsMirrored).toBeUndefined()
        expect(back.relationships).toEqual(base.relationships)
    })

    it('keeps the plugin-owned child heuristic while mirrored', () => {
        const heuristic = { allowedTypeTags: ['#task'], requiresLinkToSource: true }
        const base = {
            ...createDefaultNoteType('projects', 'Projects', 'starter-kit'),
            relationships: [{ role: 'child' as const, linkProperty: '', heuristic }]
        }
        const out = mirrorNoteType(
            base,
            { id: 'projects', name: 'Projects' },
            null,
            defaults,
            null,
            false,
            null,
            []
        )
        expect(out.relationshipsMirrored).toBe(true)
        expect(out.relationships.find((r) => r.heuristic)?.heuristic).toEqual(heuristic)
    })
})
