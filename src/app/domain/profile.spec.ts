import { describe, expect, it } from 'bun:test'
import { archiveConfigSchema } from './profile'

describe('archiveConfigSchema (issue #32 migration)', () => {
    it('keeps an explicit triggerStatuses list', () => {
        const parsed = archiveConfigSchema.parse({
            archiveFolder: 'Archive',
            triggerStatuses: ['80 - Done', '70 - Abandoned']
        })
        expect(parsed).toEqual({
            archiveFolder: 'Archive',
            triggerStatuses: ['80 - Done', '70 - Abandoned']
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
            triggerStatuses: []
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

    it('dedupes repeated statuses', () => {
        expect(
            archiveConfigSchema.parse({
                archiveFolder: 'A',
                triggerStatuses: ['done', 'done', 'abandoned']
            }).triggerStatuses
        ).toEqual(['done', 'abandoned'])
    })
})
