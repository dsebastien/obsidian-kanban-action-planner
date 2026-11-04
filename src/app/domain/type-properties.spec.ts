import { describe, expect, it } from 'bun:test'
import {
    dateFormatForType,
    datePropertiesForType,
    estimateConfigForType,
    plannedPropertiesForType,
    type TypePropertyDefaults
} from './type-properties'
import { createDefaultNoteType } from '../services/note-type.service'

const settings: TypePropertyDefaults = {
    defaultOrderProperty: 'manual_order',
    defaultScheduledDateProperty: 'date_scheduled',
    defaultDueDateProperty: 'date_due',
    defaultDeferDateProperty: 'date_defer',
    defaultEstimateProperty: 'estimate',
    defaultMilestonesProperty: 'milestones',
    defaultProgressProperty: 'progress',
    defaultDurationProperty: 'time_spent',
    defaultTotalDurationProperty: 'total_time_spent',
    defaultTimeEntriesProperty: 'time_entries',
    defaultLastSessionProperty: 'date_last_session',
    defaultTimeBlocksProperty: 'time_blocks',
    defaultPlannedMinutesProperty: 'minutes_planned_per_week',
    defaultTargetMinutesProperty: 'minutes_per_week'
}

describe('datePropertiesForType (issue #232)', () => {
    it('uses the type’s own date properties; blank = global', () => {
        const projects = createDefaultNoteType('projects', 'Projects', 'starter-kit')
        projects.calendar.scheduledDateProperty = 'date_started'
        expect(datePropertiesForType(settings, projects)).toEqual({
            start: 'date_started',
            due: 'date_due',
            defer: 'date_defer'
        })
    })

    it('an untyped card gets the globals', () => {
        expect(datePropertiesForType(settings, undefined).start).toBe('date_scheduled')
    })
})

describe('estimateConfigForType (issue #232)', () => {
    const type = createDefaultNoteType('t', 'T', 'starter-kit')

    it('an override wins; mode none means no estimate', () => {
        expect(
            estimateConfigForType(settings, {
                ...type,
                estimate: { property: 'time_estimate', unit: 'minutes' }
            })
        ).toEqual({ property: 'time_estimate', unit: 'minutes' })
        expect(
            estimateConfigForType(settings, {
                ...type,
                estimate: { property: '', unit: 'days', mode: 'none' }
            })
        ).toBeNull()
        expect(
            estimateConfigForType(settings, { ...type, estimate: { property: ' ', unit: 'days' } })
        ).toEqual({ property: 'estimate', unit: 'days' })
    })

    it('without an override, Starter Kit declarations decide', () => {
        const withDeclared = (names: string[]) => ({
            ...type,
            declaredProperties: names.map((name) => ({ name, type: 'number' }))
        })
        expect(estimateConfigForType(settings, withDeclared(['time_estimate']))).toEqual({
            property: 'time_estimate',
            unit: 'minutes'
        })
        expect(estimateConfigForType(settings, withDeclared(['time_estimate_days']))).toEqual({
            property: 'time_estimate_days',
            unit: 'days'
        })
        expect(estimateConfigForType(settings, withDeclared(['estimate']))).toEqual({
            property: 'estimate',
            unit: 'days'
        })
        // An activity, an idea or a movie: not estimated.
        expect(estimateConfigForType(settings, withDeclared(['status']))).toBeNull()
    })

    it('unknown declarations (local type, untyped card) keep the global estimate', () => {
        expect(estimateConfigForType(settings, undefined)).toEqual({
            property: 'estimate',
            unit: 'days'
        })
        expect(estimateConfigForType(settings, createDefaultNoteType('l', 'L', 'local'))).toEqual({
            property: 'estimate',
            unit: 'days'
        })
    })
})

describe('plannedPropertiesForType', () => {
    it('lists every property the planner uses, relationships included', () => {
        const type = createDefaultNoteType('t', 'T', 'local')
        const planned = plannedPropertiesForType(settings, type)
        const names = planned.map((p) => p.name)
        expect(names).toContain('date_scheduled')
        expect(names).toContain('estimate')
        expect(names).toContain('time_spent')
        expect(names).toContain('time_blocks')
        expect(planned.find((p) => p.name === 'children')?.role).toBe('Relationship (child)')
    })

    it('leaves out the estimate of a type without one', () => {
        const type = {
            ...createDefaultNoteType('t', 'T', 'local'),
            estimate: { property: '', unit: 'days' as const, mode: 'none' as const }
        }
        expect(plannedPropertiesForType(settings, type).some((p) => p.role === 'Estimate')).toBe(
            false
        )
    })
})

describe('dateFormatForType (issue #232)', () => {
    it('a typed date property is written in ISO, whatever the board format', () => {
        expect(dateFormatForType('date', 'DD/MM/YYYY HH:mm')).toBe('YYYY-MM-DD')
        expect(dateFormatForType('datetime', 'DD/MM/YYYY')).toBe('YYYY-MM-DDTHH:mm')
    })

    it('an untyped or other property keeps the configured format', () => {
        expect(dateFormatForType(null, 'DD/MM/YYYY')).toBe('DD/MM/YYYY')
        expect(dateFormatForType('text', 'YYYY-MM-DD')).toBe('YYYY-MM-DD')
    })
})
