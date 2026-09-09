import { describe, expect, test } from 'bun:test'
import type { WeekEntry } from './week-planner'
import {
    availableMinutesPerWeek,
    formatShare,
    groupByValue,
    groupValueOf,
    parseAvailableHours,
    raisedTarget,
    repartitionBar,
    subtotalOf,
    targetsGroups,
    totalsOf
} from './week-targets'

const entry = (over: Partial<WeekEntry>): WeekEntry => ({
    path: 'A.md',
    title: 'A',
    contexts: [],
    areas: [],
    blocks: [],
    errors: [],
    targetMinutes: null,
    typeName: null,
    active: true,
    onGrid: true,
    statusLabel: 'Active',
    statusRank: 0,
    ...over
})

describe('available minutes per week (issue #172, phase G)', () => {
    test('the setting wins, in hours; else the grid hours times seven days', () => {
        expect(
            availableMinutesPerWeek({ availableHours: 10.5, gridStartHour: 0, gridEndHour: 24 })
        ).toBe(630)
        expect(
            availableMinutesPerWeek({ availableHours: null, gridStartHour: 0, gridEndHour: 24 })
        ).toBe(168 * 60)
        expect(
            availableMinutesPerWeek({ availableHours: null, gridStartHour: 6, gridEndHour: 22 })
        ).toBe(16 * 60 * 7)
        expect(
            availableMinutesPerWeek({ availableHours: 0, gridStartHour: 8, gridEndHour: 8 })
        ).toBe(60 * 7)
    })

    test('parseAvailableHours: empty clears, decimals and a trailing h parse, junk is ignored', () => {
        expect(parseAvailableHours('')).toBeNull()
        expect(parseAvailableHours('  ')).toBeNull()
        expect(parseAvailableHours('10')).toBe(10)
        expect(parseAvailableHours('37.5')).toBe(37.5)
        expect(parseAvailableHours('10,5')).toBe(10.5)
        expect(parseAvailableHours('40h')).toBe(40)
        expect(parseAvailableHours('40 hours')).toBe(40)
        expect(parseAvailableHours('abc')).toBeUndefined()
        expect(parseAvailableHours('0')).toBeUndefined()
        expect(parseAvailableHours('200')).toBeUndefined()
    })

    test('formatShare rounds to a whole percent', () => {
        expect(formatShare(600, 2400)).toBe('25%')
        expect(formatShare(0, 2400)).toBe('0%')
        expect(formatShare(2600, 2400)).toBe('108%')
        expect(formatShare(60, 0)).toBe('–')
    })
})

describe('target follows planned (issue #172, phase G)', () => {
    test('raises to the planned minutes only above the target; never lowers; leaves a missing target alone', () => {
        expect(raisedTarget(120, 180)).toBe(180)
        expect(raisedTarget(120, 120)).toBeNull()
        expect(raisedTarget(120, 60)).toBeNull()
        expect(raisedTarget(null, 180)).toBeNull()
        expect(raisedTarget(0, 180)).toBeNull()
    })
})

describe('grouping by area / context (issue #172, phase G)', () => {
    const health = entry({
        path: 'Sleep.md',
        title: 'Sleep',
        areas: ['Health'],
        contexts: ['@home']
    })
    const run = entry({
        path: 'Run.md',
        title: 'Run',
        areas: ['Exercise', 'Health'],
        contexts: ['@home']
    })
    const job = entry({ path: 'Job.md', title: 'Day job', areas: ['Work'], contexts: ['@work'] })
    const none = entry({ path: 'Misc.md', title: 'Misc' })

    test('the first value files a note; the empty group comes last; titles sort inside', () => {
        expect(groupValueOf(run, 'area')).toBe('Exercise')
        expect(groupValueOf(none, 'context')).toBeNull()
        const groups = groupByValue([none, job, run, health], 'area')
        expect(groups.map((g) => [g.label, g.entries.map((e) => e.title)])).toEqual([
            ['Exercise', ['Run']],
            ['Health', ['Sleep']],
            ['Work', ['Day job']],
            ['No area', ['Misc']]
        ])
        expect(groups.map((g) => g.key)).toEqual([
            'area:Exercise',
            'area:Health',
            'area:Work',
            'area:'
        ])
    })

    test('by context, and `none` is one anonymous group sorted by title', () => {
        const byContext = groupByValue([none, job, run, health], 'context')
        expect(byContext.map((g) => g.label)).toEqual(['@home', '@work', 'No context'])
        expect(byContext[0]?.entries.map((e) => e.title)).toEqual(['Run', 'Sleep'])
        const flat = targetsGroups([job, none, run], 'none')
        expect(flat).toHaveLength(1)
        expect(flat[0]?.key).toBe('none')
        expect(flat[0]?.entries.map((e) => e.title)).toEqual(['Day job', 'Misc', 'Run'])
        expect(targetsGroups([job, run], 'area').map((g) => g.label)).toEqual(['Exercise', 'Work'])
    })
})

describe('subtotals, totals and the repartition bar (issue #172, phase G)', () => {
    const active = entry({
        path: 'A.md',
        targetMinutes: 300,
        blocks: [{ days: [0, 1], start: 540, end: 600 }]
    })
    const inactive = entry({
        path: 'B.md',
        active: false,
        targetMinutes: 1000,
        blocks: [{ days: [0], start: 0, end: 60 }]
    })
    const noTarget = entry({ path: 'C.md', blocks: [{ days: [2], start: 60, end: 120 }] })

    test('only active entries count; a missing target counts as zero', () => {
        expect(subtotalOf([active, inactive, noTarget])).toEqual({
            target: 300,
            planned: 180,
            counted: 2
        })
    })

    test('totals measure against the available minutes', () => {
        const totals = totalsOf([active, inactive, noTarget], 600)
        expect(totals.available).toBe(600)
        expect(totals.remaining).toBe(300)
        expect(totals.unplanned).toBe(420)
        expect(totalsOf([active], 200).remaining).toBe(-100)
    })

    test('the bar clamps to the available time and flags an overshoot', () => {
        expect(repartitionBar(300, 150, 600)).toEqual({ target: 0.5, planned: 0.25, over: false })
        expect(repartitionBar(900, 150, 600)).toEqual({ target: 1, planned: 0.25, over: true })
        expect(repartitionBar(0, 0, 0)).toEqual({ target: 0, planned: 0, over: false })
        expect(repartitionBar(60, 0, 0).over).toBe(true)
    })
})
