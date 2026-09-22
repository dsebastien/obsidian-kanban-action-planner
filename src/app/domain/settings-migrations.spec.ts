import { describe, expect, it } from 'bun:test'
import { migrateCalendarDateSeeds, migrateSettings } from './settings-migrations'
import type { MigratableSettings } from './settings-migrations'

const settingsWith = (
    calendar: Partial<MigratableSettings['noteTypes'][number]['calendar']>,
    schemaVersion = 1
): MigratableSettings => ({
    schemaVersion,
    noteTypes: [
        {
            calendar: {
                scheduledDateProperty: 'date_scheduled',
                dueDateProperty: 'date_due',
                dateFormat: 'YYYY-MM-DD',
                ...calendar
            }
        }
    ]
})

describe('migrateCalendarDateSeeds (issue #201)', () => {
    it('clears seeds that are still the built-in defaults', () => {
        expect(migrateCalendarDateSeeds(settingsWith({})).noteTypes[0]?.calendar).toEqual({
            scheduledDateProperty: '',
            dueDateProperty: '',
            dateFormat: ''
        })
    })

    it('keeps a value that is not the built-in default (a deliberate override)', () => {
        const result = migrateCalendarDateSeeds(
            settingsWith({ scheduledDateProperty: 'start_on', dueDateProperty: 'deadline' })
        )
        expect(result.noteTypes[0]?.calendar.scheduledDateProperty).toBe('start_on')
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('deadline')
        // The untouched field is still a seed and still goes.
        expect(result.noteTypes[0]?.calendar.dateFormat).toBe('')
    })

    it('leaves an already-blank field blank', () => {
        expect(
            migrateCalendarDateSeeds(settingsWith({ dueDateProperty: '' })).noteTypes[0]?.calendar
                .dueDateProperty
        ).toBe('')
    })

    it('does not mutate the input', () => {
        const input = settingsWith({})
        migrateCalendarDateSeeds(input)
        expect(input.noteTypes[0]?.calendar.dueDateProperty).toBe('date_due')
    })

    it('handles settings with no note types', () => {
        expect(migrateCalendarDateSeeds({ schemaVersion: 1, noteTypes: [] }).noteTypes).toEqual([])
    })
})

describe('migrateSettings', () => {
    it('runs the v1 migration and stamps the target version', () => {
        const result = migrateSettings(settingsWith({}), 2)
        expect(result.schemaVersion).toBe(2)
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('')
    })

    it('leaves settings already at the target version untouched', () => {
        const current = settingsWith({ dueDateProperty: 'date_due' }, 2)
        const result = migrateSettings(current, 2)
        expect(result).toBe(current)
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('date_due')
    })

    it('returns a NEW object when it migrated, so the caller can detect the change', () => {
        const current = settingsWith({}, 1)
        expect(migrateSettings(current, 2)).not.toBe(current)
    })
})
