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

describe('plannedPropertiesForType: only the features a type uses (issue #232)', () => {
    const names = (type: Parameters<typeof plannedPropertiesForType>[1]): string[] =>
        plannedPropertiesForType(settings, type).map((p) => `${p.role}=${p.name}`)

    it('a type that uses nothing is only checked for its relationship links', () => {
        const anime = createDefaultNoteType('anime', 'Anime', 'starter-kit')
        expect(names(anime)).toEqual([
            'Relationship (parent)=parent',
            'Relationship (sibling)=siblings',
            'Relationship (child)=children',
            'Relationship (blocked by)=blocked_by'
        ])
        anime.relationships = []
        expect(names(anime)).toEqual([])
    })

    it('board columns bring status and order', () => {
        const type = createDefaultNoteType('t', 'T', 'local')
        type.relationships = []
        type.columns = [
            {
                id: 'c',
                statusValue: 'Open',
                label: 'Open',
                sortKey: '0',
                color: { kind: 'palette', token: 'blue' }
            }
        ]
        expect(names(type)).toEqual(['Status=status', 'Manual order=manual_order'])
    })

    it('a calendar brings start, due, milestones and progress; an own date property alone brings that date', () => {
        const projects = createDefaultNoteType('p', 'Projects', 'starter-kit')
        projects.relationships = []
        projects.calendar.enabled = true
        projects.calendar.scheduledDateProperty = 'date_started'
        expect(names(projects)).toEqual([
            'Start date=date_started',
            'Due date=date_due',
            'Milestones=milestones',
            'Progress=progress'
        ])
        const own = createDefaultNoteType('o', 'O', 'starter-kit')
        own.relationships = []
        own.calendar.dueDateProperty = 'deadline'
        own.calendar.deferDateProperty = 'not_before'
        expect(names(own)).toEqual(['Due date=deadline', 'Defer date=not_before'])
    })

    it('an explicit estimate brings the estimate, milestones and progress; No estimate brings nothing', () => {
        const tasks = createDefaultNoteType('t', 'Tasks', 'starter-kit')
        tasks.relationships = []
        tasks.estimate = { property: 'time_estimate', unit: 'minutes' }
        expect(names(tasks)).toEqual([
            'Estimate=time_estimate',
            'Milestones=milestones',
            'Progress=progress'
        ])
        tasks.estimate = { property: '', unit: 'days', mode: 'none' }
        expect(names(tasks)).toEqual([])
    })

    it('time tracking and the week planner only when the type takes part', () => {
        const activities = createDefaultNoteType('a', 'Activities', 'starter-kit')
        activities.relationships = []
        activities.timeTracking = {
            durationProperty: '',
            totalDurationProperty: '',
            entriesProperty: '',
            lastSessionProperty: ''
        }
        activities.declaredProperties = [{ name: 'time_blocks', type: 'list' }]
        expect(names(activities)).toEqual([
            'Tracked time=time_spent',
            'Total tracked time=total_time_spent',
            'Time entries=time_entries',
            'Last session=date_last_session',
            'Time blocks=time_blocks',
            'Planned minutes=minutes_planned_per_week',
            'Target minutes=minutes_per_week'
        ])
    })

    it('lists a relationship property once, even when mirrored and local rules share it', () => {
        const type = createDefaultNoteType('t', 'T', 'starter-kit')
        type.relationships = [
            { role: 'parent', linkProperty: 'related_projects', mirrored: true },
            { role: 'parent', linkProperty: 'related_projects' }
        ]
        expect(names(type)).toEqual(['Relationship (parent)=related_projects'])
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
