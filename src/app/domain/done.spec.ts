import { describe, expect, it } from 'bun:test'
import { isDoneValue, resolveDoneConfig } from './done'
import type { NoteType } from './note-type'

function noteTypeWith(done: NoteType['done'], statusProperty = 'status'): NoteType {
    return {
        id: 'task',
        name: 'Task',
        source: 'local',
        typeRecognition: { mappings: [] },
        statusProperty,
        orderProperty: 'order',
        columns: [],
        laneGrouping: { kind: 'none' },
        colors: { autoAssign: true, overrides: {} },
        archive: { archiveFolder: '', triggerStatuses: [] },
        relationships: [],
        calendar: {
            enabled: false,
            scheduledDateProperty: 'scheduled',
            dueDateProperty: 'due',
            dateFormat: 'YYYY-MM-DD',
            defaultRange: 'month',
            tabSort: 'order'
        },
        wipLimits: {},
        enumProperties: {},
        automations: [],
        ...(done ? { done } : {})
    }
}

describe('resolveDoneConfig (issue #56)', () => {
    it('returns null without a done config (older stored types)', () => {
        expect(resolveDoneConfig(noteTypeWith(undefined))).toBeNull()
        expect(resolveDoneConfig(undefined)).toBeNull()
        expect(resolveDoneConfig(null)).toBeNull()
    })

    it('returns null when disabled', () => {
        expect(
            resolveDoneConfig(
                noteTypeWith({ enabled: false, property: 'status', values: ['80 - Done'] })
            )
        ).toBeNull()
    })

    it('resolves an explicit property', () => {
        expect(
            resolveDoneConfig(noteTypeWith({ enabled: true, property: 'completed', values: [] }))
        ).toEqual({ property: 'completed', values: [] })
    })

    it('falls back to the status property when the property is blank', () => {
        expect(
            resolveDoneConfig(noteTypeWith({ enabled: true, property: '  ', values: ['done'] }))
        ).toEqual({ property: 'status', values: ['done'] })
    })

    it('returns null when neither a property nor a status property exists', () => {
        expect(
            resolveDoneConfig(noteTypeWith({ enabled: true, property: '', values: ['done'] }, ''))
        ).toBeNull()
    })
})

describe('isDoneValue (issue #56)', () => {
    it('matches configured values case-insensitively and trimmed', () => {
        expect(isDoneValue('80 - Done', ['80 - Done'])).toBe(true)
        expect(isDoneValue('  80 - done  ', ['80 - Done'])).toBe(true)
        expect(isDoneValue('80 - Done', ['60 - Completed', '80 - Done'])).toBe(true)
        expect(isDoneValue('30 - In progress', ['80 - Done'])).toBe(false)
    })

    it('matches any element of a list property', () => {
        expect(isDoneValue(['other', '80 - Done'], ['80 - Done'])).toBe(true)
        expect(isDoneValue(['other'], ['80 - Done'])).toBe(false)
        expect(isDoneValue([], ['80 - Done'])).toBe(false)
    })

    it('treats booleans and numbers via their string form', () => {
        expect(isDoneValue(true, ['true'])).toBe(true)
        expect(isDoneValue(100, ['100'])).toBe(true)
        expect(isDoneValue(false, ['true'])).toBe(false)
    })

    it('uses checkbox semantics when no values are configured', () => {
        expect(isDoneValue(true, [])).toBe(true)
        expect(isDoneValue('true', [])).toBe(true)
        expect(isDoneValue('Yes', [])).toBe(true)
        expect(isDoneValue(false, [])).toBe(false)
        expect(isDoneValue('done', [])).toBe(false)
    })

    it('is never done on missing or blank values', () => {
        expect(isDoneValue(null, ['80 - Done'])).toBe(false)
        expect(isDoneValue(undefined, ['80 - Done'])).toBe(false)
        expect(isDoneValue('', ['80 - Done'])).toBe(false)
        expect(isDoneValue('   ', [])).toBe(false)
    })
})
