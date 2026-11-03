import { describe, expect, test } from 'bun:test'
import type { TFile } from 'obsidian'
import { weekBudgetOf } from './week-budget.service'
import type { WeekBudgetContext } from './week-budget.service'
import { LinkedNotesIndex, linkedNotesOf } from './linked-time.service'
import type { LinkedTimeConfig } from '../domain/linked-time'
import type { KanbanCard } from '../ui/board/types'
import { fakeVault } from './linked-time.fixture'
import type { FakeVault } from './linked-time.fixture'

const CONFIG: LinkedTimeConfig = {
    linkProperty: 'related_activities',
    minutesProperty: 'time_spent',
    dateProperty: 'date',
    requiredTag: 'type/session'
}
const RUN = 'Run (Activity).md'
/** Wednesday of the ISO week 2026-11-02 … 2026-11-08. */
const NOW = new Date(2026, 10, 4, 12, 0, 0)

function card(file: TFile, children: string[] = []): KanbanCard {
    return {
        file,
        key: file.path,
        title: file.path,
        statusValue: null,
        order: null,
        display: {
            title: file.path,
            fields: [],
            coverUrl: null,
            cardColor: null,
            accentColor: null,
            wrap: false,
            dueState: 'none',
            countdown: null,
            budget: null
        },
        relationships: {
            parent: [],
            sibling: [],
            child: children.map((key) => ({ key, label: key })),
            blocked_by: []
        },
        contexts: [],
        deferred: false
    }
}

function context(v: FakeVault, cards: KanbanCard[], linked: boolean): WeekBudgetContext {
    const index = new LinkedNotesIndex(v.app)
    const byKey = new Map(cards.map((c) => [c.key, c]))
    return {
        app: v.app,
        weekPropertiesFor: () => ({
            timeBlocks: 'time_blocks',
            plannedMinutes: 'minutes_planned_per_week',
            targetMinutes: 'minutes_per_week',
            alarmMinutes: 'minutes_alarm_per_week',
            areas: 'areas'
        }),
        trackingPropertiesFor: () => ({
            duration: 'time_spent',
            totalDuration: 'total_time_spent',
            entries: 'time_entries',
            lastSession: 'date_last_session'
        }),
        cardForKey: (key) => byKey.get(key),
        linkedNotesFor: (c) => (linked ? linkedNotesOf(index, c.file, CONFIG) : [])
    }
}

const session = (day: string, minutes: unknown): Record<string, unknown> => ({
    tags: ['type/session/sport/running'],
    related_activities: ['[[Run (Activity)]]'],
    date: day,
    time_spent: minutes
})

describe('weekBudgetOf with time from linked notes', () => {
    test('adds the linked notes dated this ISO week, on top of the entries', () => {
        const v = fakeVault({
            [RUN]: {
                minutes_per_week: 180,
                time_entries: [{ startTime: '2026-11-03T10:00:00', endTime: '2026-11-03T10:30:00' }]
            },
            'last-sunday.md': session('2026-11-01', 60),
            'monday.md': session('2026-11-02', 40),
            'sunday.md': session('2026-11-08T21:00', 20),
            'next-monday.md': session('2026-11-09', 90),
            'undated.md': session('', 50),
            'zero.md': session('2026-11-04', 0)
        })
        const run = card(v.file(RUN))
        const budget = weekBudgetOf(context(v, [run], true), run, NOW)
        expect(budget?.ownTracked).toBe(30)
        expect(budget?.linkedNotesTracked).toBe(60)
        expect(budget?.tracked).toBe(90)
    })

    test('off for the type: entries only, as before', () => {
        const v = fakeVault({
            [RUN]: { minutes_per_week: 180 },
            'monday.md': session('2026-11-02', 40)
        })
        const run = card(v.file(RUN))
        const budget = weekBudgetOf(context(v, [run], false), run, NOW)
        expect(budget?.tracked).toBe(0)
        expect(budget?.linkedNotesTracked).toBe(0)
    })

    test('a linked note that is also a child counts once, as a linked note', () => {
        const v = fakeVault({
            [RUN]: { minutes_per_week: 180 },
            'monday.md': {
                ...session('2026-11-02', 40),
                time_entries: [{ startTime: '2026-11-02T08:00:00', endTime: '2026-11-02T08:40:00' }]
            },
            'task.md': {
                time_entries: [{ startTime: '2026-11-03T08:00:00', endTime: '2026-11-03T08:15:00' }]
            }
        })
        const monday = card(v.file('monday.md'))
        const task = card(v.file('task.md'))
        const run = card(v.file(RUN), ['monday.md', 'task.md'])
        const budget = weekBudgetOf(context(v, [run, monday, task], true), run, NOW)
        expect(budget?.tracked).toBe(55)
        expect(budget?.linked).toEqual(['task.md'])
    })

    test("an own entry linking to a counted note is skipped (the note's minutes count)", () => {
        const v = fakeVault({
            [RUN]: {
                minutes_per_week: 180,
                time_entries: [
                    {
                        startTime: '2026-11-02T07:00:00',
                        endTime: '2026-11-02T08:00:00',
                        description: '[[monday|Morning run]]'
                    },
                    {
                        startTime: '2026-11-03T07:00:00',
                        endTime: '2026-11-03T07:10:00',
                        description: 'stretching'
                    }
                ]
            },
            'monday.md': session('2026-11-02', 40)
        })
        const run = card(v.file(RUN))
        const budget = weekBudgetOf(context(v, [run], true), run, NOW)
        expect(budget?.ownTracked).toBe(10)
        expect(budget?.tracked).toBe(50)
    })

    test('an own entry is kept when its note has 0 minutes or is dated another week', () => {
        const entry = (day: string, link: string): Record<string, string> => ({
            startTime: `${day}T07:00:00`,
            endTime: `${day}T07:20:00`,
            description: `[[${link}]]`
        })
        const v = fakeVault({
            [RUN]: {
                minutes_per_week: 180,
                time_entries: [
                    entry('2026-11-03', 'zero'),
                    // The note is dated last week; its entry falls in this one.
                    entry('2026-11-02', 'last-week')
                ]
            },
            'zero.md': session('2026-11-03', 0),
            'last-week.md': session('2026-10-30', 40)
        })
        const run = card(v.file(RUN))
        const budget = weekBudgetOf(context(v, [run], true), run, NOW)
        expect(budget?.ownTracked).toBe(40)
        expect(budget?.linkedNotesTracked).toBe(0)
        expect(budget?.tracked).toBe(40)
    })

    test("a child's entry linking to a note linked to the card is skipped", () => {
        const v = fakeVault({
            [RUN]: { minutes_per_week: 180 },
            'Tasks/task.md': {
                time_entries: [
                    {
                        startTime: '2026-11-02T07:00:00',
                        endTime: '2026-11-02T08:00:00',
                        description: '[[monday]]'
                    },
                    { startTime: '2026-11-03T08:00:00', endTime: '2026-11-03T08:15:00' }
                ]
            },
            'monday.md': session('2026-11-02', 40)
        })
        const task = card(v.file('Tasks/task.md'))
        const run = card(v.file(RUN), ['Tasks/task.md'])
        const budget = weekBudgetOf(context(v, [run, task], true), run, NOW)
        expect(budget?.linkedNotesTracked).toBe(40)
        expect(budget?.tracked).toBe(55)
    })

    test('ISO week edges: Monday 00:00 is in, the next Monday is out (Sunday counts)', () => {
        const v = fakeVault({
            [RUN]: { minutes_per_week: 180 },
            'sun-before.md': session('2026-11-01', 1),
            'mon.md': session('2026-11-02T00:00', 2),
            'sun.md': session('2026-11-08T23:59', 4),
            'mon-after.md': session('2026-11-09T00:00', 8)
        })
        const run = card(v.file(RUN))
        const ctx = context(v, [run], true)
        // From Monday 00:00 and from Sunday 23:59, the same week.
        expect(weekBudgetOf(ctx, run, new Date(2026, 10, 2, 0, 0, 0))?.tracked).toBe(6)
        expect(weekBudgetOf(ctx, run, new Date(2026, 10, 8, 23, 59, 59))?.tracked).toBe(6)
        // A Sunday belongs to the week that started six days earlier.
        expect(weekBudgetOf(ctx, run, new Date(2026, 10, 1, 12, 0, 0))?.tracked).toBe(1)
        expect(weekBudgetOf(ctx, run, new Date(2026, 10, 9, 0, 0, 0))?.tracked).toBe(8)
    })
})

describe("weekBudgetOf: children's linked notes and the count-once rule", () => {
    const PLAN = 'Plan.md'

    test("adds a child's linked notes dated this week, each once; the own ring matches the child's", () => {
        const v = fakeVault({
            [PLAN]: { minutes_per_week: 300 },
            [RUN]: {
                minutes_per_week: 180,
                time_entries: [
                    {
                        startTime: '2026-11-02T07:00:00',
                        endTime: '2026-11-02T08:00:00',
                        description: '[[monday]]'
                    },
                    { startTime: '2026-11-03T08:00:00', endTime: '2026-11-03T08:15:00' }
                ]
            },
            'monday.md': session('2026-11-02', 40),
            // Linked to both the plan and the run: counts once.
            'both.md': {
                ...session('2026-11-04', 20),
                related_activities: ['[[Run (Activity)]]', '[[Plan]]']
            },
            'next-week.md': session('2026-11-10', 90)
        })
        const run = card(v.file(RUN))
        const plan = card(v.file(PLAN), [RUN])
        const ctx = context(v, [plan, run], true)
        const own = weekBudgetOf(ctx, plan, NOW)
        expect(own?.linkedNotesTracked).toBe(60)
        expect(own?.tracked).toBe(75)
        expect(own?.linked).toEqual([RUN])
        // The child's own ring (what the derived ring and the WBS add up).
        expect(weekBudgetOf(ctx, run, NOW)?.tracked).toBe(75)
    })

    test('a child session note with 0 minutes or dated another week still adds its entries', () => {
        const entry = (day: string, minutes: number): Record<string, string> => ({
            startTime: `${day}T08:00:00`,
            endTime: `${day}T08:${String(minutes).padStart(2, '0')}:00`
        })
        const v = fakeVault({
            [RUN]: { minutes_per_week: 180 },
            'zero.md': { ...session('2026-11-03', 0), time_entries: [entry('2026-11-03', 15)] },
            'old.md': { ...session('2026-10-30', 40), time_entries: [entry('2026-11-04', 20)] }
        })
        const zero = card(v.file('zero.md'))
        const old = card(v.file('old.md'))
        const run = card(v.file(RUN), ['zero.md', 'old.md'])
        const budget = weekBudgetOf(context(v, [run, zero, old], true), run, NOW)
        expect(budget?.linkedNotesTracked).toBe(0)
        expect(budget?.tracked).toBe(35)
        expect(budget?.linked).toEqual(['zero.md', 'old.md'])
    })
})
