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
        linkedNotesFor: (c) => (linked ? linkedNotesOf(v.app, index, c.file, CONFIG) : [])
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
})
