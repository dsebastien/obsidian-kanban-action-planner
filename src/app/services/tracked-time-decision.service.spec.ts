import { describe, expect, test } from 'bun:test'
import type { TFile } from 'obsidian'
import { KanbanActionPlannerPlugin } from '../plugin'
import { createDefaultSettings } from '../types/plugin-settings.intf'
import { createDefaultNoteType } from './note-type.service'
import { fakeVault } from './linked-time.fixture'
import {
    LowerTimeWatch,
    lowerTimeNoticeText,
    recomputeTrackedTimeWithDecisions
} from './tracked-time-decision.service'

const RUN = 'Activities/Run (Activity).md'
const GAME = 'Games/Chess.md'

/** A plugin double: `activity` (folder Activities) takes linked time, `Games` notes do not. */
function setup(notes: Record<string, Record<string, unknown>>) {
    const v = fakeVault(notes)
    const writes = { count: 0 }
    const app = {
        ...v.app,
        plugins: { plugins: {} },
        fileManager: {
            processFrontMatter: (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
                writes.count++
                fn(v.frontmatter.get(f.path) ?? {})
                return Promise.resolve()
            }
        }
    }
    const activity = {
        ...createDefaultNoteType('activity', 'Activity', 'local'),
        typeRecognition: {
            mappings: [{ type: 'folder' as const, value: 'Activities', enabled: true }]
        },
        timeTracking: {
            durationProperty: '',
            totalDurationProperty: '',
            entriesProperty: '',
            lastSessionProperty: '',
            linkedNotes: {
                enabled: true,
                linkProperty: 'related_activities',
                minutesProperty: 'time_spent',
                dateProperty: 'date',
                requiredTag: 'type/session'
            }
        }
    }
    const plugin = Object.assign(
        Object.create(KanbanActionPlannerPlugin.prototype) as KanbanActionPlannerPlugin,
        {
            app,
            settings: {
                ...createDefaultSettings(),
                noteTypes: [activity],
                defaultDurationProperty: 'time_spent'
            },
            saveSettings: (): Promise<void> => Promise.resolve()
        }
    )
    return { v, plugin, writes }
}

const session = (minutes: number): Record<string, unknown> => ({
    tags: ['type/session'],
    related_activities: ['[[Run (Activity)]]'],
    date: '2026-10-02',
    time_spent: minutes
})

describe('lowerTimeNoticeText', () => {
    test('one notice text, singular and plural', () => {
        expect(lowerTimeNoticeText(1)).toBe(
            '1 note holds more time than its entries and sessions: run Recompute tracked time to decide'
        )
        expect(lowerTimeNoticeText(3)).toBe(
            '3 notes hold more time than their entries and sessions: run Recompute tracked time to decide'
        )
    })
})

describe('LowerTimeWatch (background, rule 79)', () => {
    test('flags a linked-time note whose stored time is above the computed one; writes nothing', async () => {
        const { v, plugin, writes } = setup({
            [RUN]: { time_spent: 120 },
            's.md': session(50)
        })
        const watch = new LowerTimeWatch(plugin)
        watch['pending'].add(RUN)
        await watch.check()
        expect(watch.flaggedFiles().map((f) => f.path)).toEqual([RUN])
        expect(v.frontmatter.get(RUN)?.['time_spent']).toBe(120)
        expect(writes.count).toBe(0)
    })

    test('unflags once the stored time is no longer above', async () => {
        const { v, plugin } = setup({ [RUN]: { time_spent: 120 }, 's.md': session(50) })
        const watch = new LowerTimeWatch(plugin)
        watch['pending'].add(RUN)
        await watch.check()
        plugin.linkedNotesIndex.update(v.set('s.md', session(150)))
        watch['pending'].add(RUN)
        await watch.check()
        expect(watch.flaggedFiles()).toEqual([])
    })

    test('ignores notes whose type does not take linked time', async () => {
        const { plugin } = setup({
            [GAME]: { time_spent: 120, related_activities: ['[[Run (Activity)]]'] },
            's.md': { ...session(50), related_activities: ['[[Chess]]'] }
        })
        const watch = new LowerTimeWatch(plugin)
        watch['pending'].add(GAME)
        await watch.check()
        expect(watch.flaggedFiles()).toEqual([])
    })
})

describe('recomputeTrackedTimeWithDecisions', () => {
    test('writes what does not lower; leaves the higher one for the modal', async () => {
        const { v, plugin } = setup({
            [RUN]: { time_spent: 120 },
            'Activities/Swim (Activity).md': { time_spent: 10 },
            's.md': session(50),
            'w.md': { ...session(30), related_activities: ['[[Swim (Activity)]]'] }
        })
        await recomputeTrackedTimeWithDecisions(plugin, [
            v.file(RUN),
            v.file('Activities/Swim (Activity).md')
        ])
        expect(v.frontmatter.get(RUN)?.['time_spent']).toBe(120)
        expect(v.frontmatter.get('Activities/Swim (Activity).md')?.['time_spent']).toBe(30)
    })

    test('a note with nothing to decide leaves the flagged list', async () => {
        const { v, plugin } = setup({ [RUN]: { time_spent: 120 }, 's.md': session(50) })
        plugin.lowerTimeWatch['flagged'].add(RUN)
        v.set('s.md', session(200))
        await recomputeTrackedTimeWithDecisions(plugin, [v.file(RUN)])
        expect(plugin.lowerTimeWatch.flaggedFiles()).toEqual([])
        expect(v.frontmatter.get(RUN)?.['time_spent']).toBe(200)
    })
})
