import { describe, expect, it } from 'bun:test'
import { archiveConfigSchema, noteTypeSchema, timeTrackingConfigSchema } from './note-type'
import { createDefaultNoteType } from '../services/note-type.service'

describe('archiveConfigSchema (Starter Kit mirror fields)', () => {
    it('carries graceDays and mirrored only when set, so plugin-owned configs stay as before', () => {
        expect(
            archiveConfigSchema.parse({
                archiveFolder: 'A',
                triggerStatuses: ['d'],
                graceDays: 7,
                mirrored: true
            })
        ).toEqual({
            archiveFolder: 'A',
            triggerStatuses: ['d'],
            doneDateProperties: [],
            graceDays: 7,
            mirrored: true
        })
        const plain = archiveConfigSchema.parse({ archiveFolder: 'A', mirrored: false })
        expect('mirrored' in plain).toBe(false)
        expect('graceDays' in plain).toBe(false)
    })
})

describe('archiveConfigSchema (issue #32 migration)', () => {
    it('keeps an explicit triggerStatuses list', () => {
        const parsed = archiveConfigSchema.parse({
            archiveFolder: 'Archive',
            triggerStatuses: ['80 - Done', '70 - Abandoned']
        })
        expect(parsed).toEqual({
            archiveFolder: 'Archive',
            triggerStatuses: ['80 - Done', '70 - Abandoned'],
            doneDateProperties: []
        })
    })

    it('migrates a legacy single triggerStatus into the list', () => {
        const parsed = archiveConfigSchema.parse({
            archiveFolder: 'Archive',
            triggerStatus: '80 - Done'
        })
        expect(parsed.triggerStatuses).toEqual(['80 - Done'])
        expect('triggerStatus' in parsed).toBe(false)
    })

    it('treats a null/absent legacy trigger as off (empty list)', () => {
        expect(archiveConfigSchema.parse({ archiveFolder: '', triggerStatus: null })).toEqual({
            archiveFolder: '',
            triggerStatuses: [],
            doneDateProperties: []
        })
        expect(archiveConfigSchema.parse({ archiveFolder: '' }).triggerStatuses).toEqual([])
    })

    it('prefers triggerStatuses over a legacy triggerStatus when both present', () => {
        const parsed = archiveConfigSchema.parse({
            archiveFolder: 'A',
            triggerStatuses: ['done'],
            triggerStatus: 'abandoned'
        })
        expect(parsed.triggerStatuses).toEqual(['done'])
    })

    it('keeps doneDateProperties, defaulting older stored types to none', () => {
        expect(
            archiveConfigSchema.parse({
                archiveFolder: 'A',
                doneDateProperties: ['date_completed', 'date_abandoned']
            }).doneDateProperties
        ).toEqual(['date_completed', 'date_abandoned'])
        expect(archiveConfigSchema.parse({ archiveFolder: 'A' }).doneDateProperties).toEqual([])
    })

    it('dedupes repeated statuses', () => {
        expect(
            archiveConfigSchema.parse({
                archiveFolder: 'A',
                triggerStatuses: ['done', 'done', 'abandoned']
            }).triggerStatuses
        ).toEqual(['done', 'abandoned'])
    })
})

describe('noteTypeSchema (null-tolerant optional blocks)', () => {
    it('reads estimate / done / creation stored as null as absent', () => {
        const base = createDefaultNoteType('nt-1', 'X', 'local')
        const parsed = noteTypeSchema.parse({ ...base, estimate: null, done: null, creation: null })
        expect(parsed.estimate).toBeUndefined()
        expect(parsed.done).toBeUndefined()
        expect(parsed.creation).toBeUndefined()
        expect(noteTypeSchema.parse(base)).toEqual(base)
    })
})

describe('timeTrackingConfigSchema (time from linked notes)', () => {
    it('a block stored before linked notes existed parses without one (off)', () => {
        const parsed = timeTrackingConfigSchema.parse({
            durationProperty: 'time_spent',
            totalDurationProperty: '',
            entriesProperty: '',
            lastSessionProperty: ''
        })
        expect(parsed.linkedNotes).toBeUndefined()
        expect(timeTrackingConfigSchema.parse({ linkedNotes: null }).linkedNotes).toBeUndefined()
    })

    it('a partial linkedNotes block gets the stored defaults', () => {
        expect(
            timeTrackingConfigSchema.parse({ linkedNotes: { enabled: true } }).linkedNotes
        ).toEqual({
            enabled: true,
            linkProperty: 'related_activities',
            minutesProperty: 'time_spent',
            dateProperty: 'date',
            requiredTag: 'type/session'
        })
    })

    it('round-trips inside a note type', () => {
        const noteType = {
            ...createDefaultNoteType('activity', 'Activity', 'local'),
            timeTracking: {
                durationProperty: '',
                totalDurationProperty: '',
                entriesProperty: '',
                lastSessionProperty: '',
                linkedNotes: {
                    enabled: true,
                    linkProperty: 'activities',
                    minutesProperty: 'minutes',
                    dateProperty: 'day',
                    requiredTag: '#log/session'
                }
            }
        }
        const reparsed = noteTypeSchema.parse(JSON.parse(JSON.stringify(noteType)))
        expect(reparsed.timeTracking).toEqual(noteType.timeTracking)
    })
})
