import { describe, expect, it } from 'bun:test'
import { isLifecycleDate, pickScheduledProperty, stampedDatesOf } from './stamped-dates'

const planRules = [
    {
        id: 'osk-stamp:30 - Applied',
        enabled: true,
        trigger: { kind: 'status-entered', statuses: ['30 - Applied'] },
        actions: [
            { kind: 'set-property', property: 'date_started', value: '{{date}}', onlyIfEmpty: true }
        ]
    },
    {
        id: 'off',
        enabled: false,
        trigger: { kind: 'status-entered', statuses: ['10 - Idea'] },
        actions: [{ kind: 'set-property', property: 'date_idea', value: '{{date}}' }]
    },
    {
        id: 'task-done',
        enabled: true,
        trigger: { kind: 'done-entered' },
        actions: [
            { kind: 'set-property', property: 'progress', value: '100' },
            { kind: 'remove-property', property: 'date_scheduled' },
            { kind: 'set-property', property: 'Date_Completed', value: '{{ now }}' }
        ]
    }
]

describe('stampedDatesOf (issue #232)', () => {
    it('collects the enabled rules that stamp a date token, with their statuses', () => {
        expect(stampedDatesOf(planRules)).toEqual([
            { property: 'date_started', when: ['30 - Applied'] },
            { property: 'Date_Completed', when: ['done'] }
        ])
    })

    it('adds the status values that stamp a date, merged case-insensitively', () => {
        expect(
            stampedDatesOf(planRules, [
                { value: '40 - Retired', stampsDate: 'date_completed' },
                { value: '20 - Ready', stampsDate: null }
            ])
        ).toEqual([
            { property: 'date_started', when: ['30 - Applied'] },
            { property: 'Date_Completed', when: ['done', '40 - Retired'] }
        ])
    })

    it('tolerates any shape', () => {
        expect(stampedDatesOf(null)).toEqual([])
        expect(stampedDatesOf([null, 3, { actions: 'x' }])).toEqual([])
    })
})

describe('pickScheduledProperty (issue #232)', () => {
    const stamped = stampedDatesOf(planRules)
    const declared = [{ name: 'date_scheduled' }, { name: 'date_started' }]

    it('keeps an explicit per-type value, even a stamped one (an informed choice)', () => {
        expect(pickScheduledProperty('date_started', 'date_scheduled', declared, stamped)).toBe(
            'date_started'
        )
    })

    it('keeps inheriting a global default that is a planning date', () => {
        expect(pickScheduledProperty('', 'date_scheduled', declared, stamped)).toBe('')
    })

    it('never inherits a lifecycle date: pins date_scheduled when the type declares it', () => {
        expect(pickScheduledProperty('', 'date_started', declared, stamped)).toBe('date_scheduled')
        expect(pickScheduledProperty('', 'date_completed', declared, [])).toBe('date_scheduled')
        // Nothing better declared: stays empty (inherit), the check reports it.
        expect(pickScheduledProperty('', 'date_started', [{ name: 'x' }], stamped)).toBe('')
    })

    it('date_started and date_completed are lifecycle dates even without automations', () => {
        expect(isLifecycleDate([], 'Date_Started')).toBe(true)
        expect(isLifecycleDate([], 'date_scheduled')).toBe(false)
    })
})
