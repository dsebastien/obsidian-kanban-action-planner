import { describe, expect, test } from 'bun:test'
import {
    ageInDays,
    doneDateProperties,
    graceDecision,
    isArchiveTrigger,
    isoDate,
    resolveDoneDate,
    stampProperty
} from './archive-grace'
import type { AutomationRule } from './note-type'
import type { ArchiveConfig } from './note-type'

const archive: ArchiveConfig = {
    archiveFolder: 'Archive/{{year}}',
    triggerStatuses: ['80 - Done'],
    doneDateProperties: ['date_completed', ' date_abandoned ', '']
}
const today = new Date(2026, 8, 9) // 2026-09-09
const reader = (fm: Record<string, unknown>) => (name: string) => fm[name]

describe('doneDateProperties / isArchiveTrigger', () => {
    test('trims and drops blanks', () => {
        expect(doneDateProperties(archive)).toEqual(['date_completed', 'date_abandoned'])
    })
    test('trigger needs a folder AND a listed status', () => {
        expect(isArchiveTrigger(archive, '80 - Done')).toBe(true)
        expect(isArchiveTrigger(archive, '10 - Backlog')).toBe(false)
        expect(isArchiveTrigger(archive, null)).toBe(false)
        expect(isArchiveTrigger({ ...archive, archiveFolder: ' ' }, '80 - Done')).toBe(false)
    })
})

describe('resolveDoneDate', () => {
    test('first present property wins, later ones ignored', () => {
        const done = resolveDoneDate(
            ['date_completed', 'date_abandoned'],
            reader({ date_completed: '2026-09-01', date_abandoned: '2026-01-01' })
        )
        expect(done).toEqual({ property: 'date_completed', date: new Date(2026, 8, 1) })
    })
    test('skips missing / empty values', () => {
        const done = resolveDoneDate(
            ['date_completed', 'date_abandoned'],
            reader({ date_completed: '', date_abandoned: '2026-09-01T18:35' })
        )
        expect(done).toEqual({ property: 'date_abandoned', date: new Date(2026, 8, 1) })
    })
    test('null when nothing is set', () => {
        expect(resolveDoneDate(['date_completed'], reader({}))).toBeNull()
    })
    test('a present but unparseable value is invalid (stops the scan)', () => {
        expect(resolveDoneDate(['a', 'b'], reader({ a: 'soon', b: '2026-09-01' }))).toEqual({
            property: 'a',
            invalid: true
        })
    })
})

describe('ageInDays / isoDate', () => {
    test('whole local days, time-of-day ignored', () => {
        expect(ageInDays(new Date(2026, 8, 2, 23, 59), new Date(2026, 8, 9, 0, 1))).toBe(7)
        expect(ageInDays(today, today)).toBe(0)
    })
    test('isoDate pads', () => {
        expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    })
})

describe('graceDecision', () => {
    const decide = (
        fm: Record<string, unknown>,
        graceDays = 7,
        status: string | null = '80 - Done',
        cfg: ArchiveConfig = archive
    ) => graceDecision({ archive: cfg, status, graceDays, read: reader(fm), today })

    test('none outside a trigger status', () => {
        expect(decide({ date_completed: '2020-01-01' }, 7, '10 - Backlog')).toEqual({
            kind: 'none'
        })
    })
    test('immediate when the grace period is 0', () => {
        expect(decide({}, 0)).toEqual({ kind: 'immediate' })
    })
    test('immediate when the type has no done-date properties (no clock source)', () => {
        expect(decide({}, 7, '80 - Done', { ...archive, doneDateProperties: [' '] })).toEqual({
            kind: 'immediate'
        })
    })
    test('stamp the first property when no done date is set', () => {
        expect(decide({})).toEqual({ kind: 'stamp', property: 'date_completed' })
        expect(decide({ date_completed: '' })).toEqual({
            kind: 'stamp',
            property: 'date_completed'
        })
    })
    test('wait while the done date is younger than the grace period', () => {
        expect(decide({ date_completed: '2026-09-03' })).toEqual({ kind: 'wait' })
        expect(decide({ date_completed: '2026-09-09' })).toEqual({ kind: 'wait' })
    })
    test('aged once the done date is at least the grace period old', () => {
        expect(decide({ date_completed: '2026-09-02' })).toEqual({
            kind: 'aged',
            property: 'date_completed',
            ageDays: 7
        })
        expect(decide({ date_abandoned: '2026-07-04T18:35' })).toEqual({
            kind: 'aged',
            property: 'date_abandoned',
            ageDays: 67
        })
    })
    test('unparseable done date waits (never stamps over it)', () => {
        expect(decide({ date_completed: 'whenever' })).toEqual({ kind: 'wait' })
    })
})

describe('stampProperty', () => {
    const cfg: ArchiveConfig = {
        archiveFolder: 'Archive',
        triggerStatuses: ['60 - Completed', '70 - Abandoned'],
        doneDateProperties: ['date_completed', 'date_abandoned']
    }
    const rules: AutomationRule[] = [
        {
            id: 'a',
            name: 'Abandoned',
            enabled: true,
            trigger: { kind: 'status-entered', statuses: ['70 - Abandoned'] },
            actions: [{ kind: 'set-property', property: 'Date_Abandoned', value: '{{date}}' }]
        },
        {
            id: 'd',
            name: 'Done',
            enabled: true,
            trigger: { kind: 'done-entered' },
            actions: [{ kind: 'set-property', property: 'date_completed', value: '{{date}}' }]
        }
    ]
    const done = { property: 'status', values: ['60 - Completed', '70 - Abandoned'] }

    test('prefers the property a matching status rule writes', () => {
        expect(stampProperty(cfg, '70 - Abandoned', rules, done)).toBe('date_abandoned')
    })
    test('a done-entered rule applies to any done value', () => {
        expect(stampProperty(cfg, '60 - Completed', rules, done)).toBe('date_completed')
        expect(stampProperty(cfg, '60 - Completed', rules.slice(1), null)).toBe('date_completed')
    })
    test('falls back to the first listed property', () => {
        expect(stampProperty(cfg, '70 - Abandoned', [], done)).toBe('date_completed')
        expect(
            stampProperty(
                cfg,
                '70 - Abandoned',
                rules.map((r) => ({ ...r, enabled: false })),
                done
            )
        ).toBe('date_completed')
    })
    test('null without done-date properties', () => {
        expect(
            stampProperty({ ...cfg, doneDateProperties: [] }, '70 - Abandoned', rules, done)
        ).toBeNull()
    })
})
