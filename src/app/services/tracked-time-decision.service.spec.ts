import { describe, expect, test } from 'bun:test'
import type { TFile } from 'obsidian'
import { KanbanActionPlannerPlugin } from '../plugin'
import { createDefaultSettings } from '../types/plugin-settings.intf'
import { createDefaultNoteType } from './note-type.service'
import { fakeVault } from './linked-time.fixture'
import {
    LOWER_CHECK_DELAY_MS,
    LowerTimeWatch,
    lowerTimeNoticeText,
    recomputeNoticeText,
    recomputeTrackedTimeWithDecisions
} from './tracked-time-decision.service'
import type { LowerTimeWatchDeps } from './tracked-time-decision.service'
import { TrackedTimeDecisionSession } from '../ui/tracked-time-decision-session'
import type { TrackedTimeDecisionRow } from '../ui/tracked-time-decision-session'
import type { LowerChoice, TrackedTimeDecision } from '../domain/tracked-time-decision'

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

/** Manual timers and a notice log for the watch. */
function fakeDeps() {
    const timers = new Map<number, { run: () => void; ms: number }>()
    const notices: string[] = []
    let next = 1
    const deps: LowerTimeWatchDeps = {
        setTimer: (run, ms) => {
            timers.set(next, { run, ms })
            return next++
        },
        clearTimer: (id) => {
            timers.delete(id)
        },
        notify: (text) => {
            notices.push(text)
        }
    }
    /** The quiet period ends: run the check the timer would start, and wait for it. */
    const flush = async (watch: LowerTimeWatch): Promise<void> => {
        expect(timers.size).toBe(1)
        timers.clear()
        await watch.check()
    }
    return { deps, timers, notices, flush }
}

describe('LowerTimeWatch debounce, notice and lifecycle', () => {
    test('changes are debounced into one check after the quiet period', async () => {
        const { plugin } = setup({ [RUN]: { time_spent: 120 }, 's.md': session(50) })
        const f = fakeDeps()
        const watch = new LowerTimeWatch(plugin, f.deps)
        watch.note([RUN])
        watch.note([RUN])
        watch.note(['other.md'])
        expect(f.timers.size).toBe(1)
        expect([...f.timers.values()][0]?.ms).toBe(LOWER_CHECK_DELAY_MS)
        await f.flush(watch)
        expect(watch.isFlagged(RUN)).toBe(true)
        expect(f.notices).toEqual([lowerTimeNoticeText(1)])
    })

    test('one notice per newly flagged batch; none when nothing new', async () => {
        const { v, plugin } = setup({
            [RUN]: { time_spent: 120 },
            'Activities/Swim (Activity).md': { time_spent: 100 },
            's.md': session(50),
            'w.md': { ...session(30), related_activities: ['[[Swim (Activity)]]'] }
        })
        const f = fakeDeps()
        const watch = new LowerTimeWatch(plugin, f.deps)
        watch.note([RUN, 'Activities/Swim (Activity).md'])
        await f.flush(watch)
        expect(f.notices).toEqual([lowerTimeNoticeText(2)])
        watch.note([RUN])
        await f.flush(watch)
        expect(f.notices).toHaveLength(1)
        expect(v.frontmatter.get(RUN)?.['time_spent']).toBe(120)
    })

    test('a flagged note changing by itself is checked again', async () => {
        const { v, plugin } = setup({ [RUN]: { time_spent: 120 }, 's.md': session(50) })
        const f = fakeDeps()
        const watch = new LowerTimeWatch(plugin, f.deps)
        watch.noteChanged(RUN)
        expect(f.timers.size).toBe(0) // not flagged: ignored
        watch.note([RUN])
        await f.flush(watch)
        v.set(RUN, { time_spent: 50 }) // typed down by hand to the sessions' time
        watch.noteChanged(RUN)
        expect(f.timers.size).toBe(1)
        await f.flush(watch)
        expect(watch.isFlagged(RUN)).toBe(false)
    })

    test('a rename moves the flag', async () => {
        const { plugin } = setup({ [RUN]: { time_spent: 120 }, 's.md': session(50) })
        const f = fakeDeps()
        const watch = new LowerTimeWatch(plugin, f.deps)
        watch.note([RUN])
        await f.flush(watch)
        watch.rename(RUN, 'Activities/Running (Activity).md')
        expect(watch.isFlagged(RUN)).toBe(false)
        expect(watch.isFlagged('Activities/Running (Activity).md')).toBe(true)
    })

    test('one check at a time: a call during a run re-runs for the notes that arrived', async () => {
        const { plugin } = setup({
            [RUN]: { time_spent: 120 },
            'Activities/Swim (Activity).md': { time_spent: 100 },
            's.md': session(50),
            'w.md': { ...session(30), related_activities: ['[[Swim (Activity)]]'] }
        })
        const f = fakeDeps()
        const watch = new LowerTimeWatch(plugin, f.deps)
        watch['pending'].add(RUN)
        const first = watch.check()
        watch['pending'].add('Activities/Swim (Activity).md')
        const second = watch.check()
        expect(second).toBe(first)
        await first
        expect(watch.isFlagged(RUN)).toBe(true)
        expect(watch.isFlagged('Activities/Swim (Activity).md')).toBe(true)
        expect(watch['running']).toBeNull()
    })

    test('dispose cancels the pending check; no notice after unload', async () => {
        const { plugin } = setup({ [RUN]: { time_spent: 120 }, 's.md': session(50) })
        const f = fakeDeps()
        const watch = new LowerTimeWatch(plugin, f.deps)
        watch.note([RUN])
        watch.dispose()
        expect(f.timers.size).toBe(0)
        watch.note([RUN])
        expect(f.timers.size).toBe(0)
        await watch.check()
        expect(f.notices).toEqual([])
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

describe('recomputeNoticeText', () => {
    test('says whether anything changed', () => {
        expect(recomputeNoticeText(['Run'], 0)).toBe('Tracked time of Run: nothing to change')
        expect(recomputeNoticeText(['Run', 'Swim'], 0)).toBe(
            'Tracked time of 2 notes: nothing to change'
        )
        expect(recomputeNoticeText(['Run'], 1)).toBe('Tracked time recomputed: Run')
        expect(recomputeNoticeText(['Run', 'Swim', 'Walk'], 2)).toBe(
            'Tracked time recomputed: 2 of 3 notes changed'
        )
    })
})

describe('TrackedTimeDecisionSession (the Keep / Drop dialog)', () => {
    const d = (stored: number, computed: number): TrackedTimeDecision => ({
        stored,
        computed,
        difference: stored - computed
    })
    /** A row recording its choices; `refreshTo` is what its numbers become after any choice. */
    const row = (title: string, decision: TrackedTimeDecision) => {
        const applied: LowerChoice[] = []
        let current: TrackedTimeDecision | null = decision
        const r: TrackedTimeDecisionRow & {
            applied: LowerChoice[]
            set(x: TrackedTimeDecision | null): void
        } = {
            title,
            decision,
            applied,
            set: (x) => {
                current = x
            },
            apply: (choice) => {
                applied.push(choice)
                return Promise.resolve({
                    minutes: choice === 'keep' ? decision.stored : decision.computed,
                    adjusted: choice === 'keep' ? decision.difference : 0
                })
            },
            refresh: () => Promise.resolve(current)
        }
        return r
    }
    const fmt = (m: number): string => `${m}m`

    test('keep writes one row and shows what was written', async () => {
        const a = row('A', d(120, 80))
        const b = row('B', d(90, 60))
        let renders = 0
        const session = new TrackedTimeDecisionSession([a, b], fmt, () => renders++)
        await session.decide(0, 'keep')
        expect(a.applied).toEqual(['keep'])
        expect(b.applied).toEqual([])
        expect(session.states[0]?.status).toBe('done')
        expect(session.states[0]?.message).toBe('Kept 120m: 40m added as a manual adjustment')
        expect(session.openCount).toBe(1)
        expect(renders).toBeGreaterThan(0)
        await session.decide(0, 'drop') // already decided: ignored
        expect(a.applied).toEqual(['keep'])
    })

    test('a keep that added nothing says so', async () => {
        const a = row('A', d(120, 80))
        a.apply = () => Promise.resolve({ minutes: 120, adjusted: 0 })
        const session = new TrackedTimeDecisionSession([a], fmt, () => {})
        await session.decide(0, 'keep')
        expect(session.states[0]?.message).toBe('Nothing to decide any more')
    })

    test('Keep all / Drop all answer every open row', async () => {
        const a = row('A', d(120, 80))
        const b = row('B', d(90, 60))
        const keep = new TrackedTimeDecisionSession([a, b], fmt, () => {})
        await keep.decideAll('keep')
        expect([a.applied, b.applied]).toEqual([['keep'], ['keep']])
        expect(keep.openCount).toBe(0)

        const c = row('C', d(120, 80))
        const e = row('E', d(90, 60))
        const drop = new TrackedTimeDecisionSession([c, e], fmt, () => {})
        await drop.decide(1, 'keep')
        await drop.decideAll('drop')
        expect([c.applied, e.applied]).toEqual([['drop'], ['keep']])
        expect(drop.states[0]?.message).toBe('Set to 80m')
    })

    test('closing without a choice writes nothing', () => {
        const a = row('A', d(120, 80))
        const session = new TrackedTimeDecisionSession([a], fmt, () => {})
        expect(session.openCount).toBe(1)
        expect(a.applied).toEqual([])
    })

    test('after a choice the other rows show fresh numbers, or close when settled', async () => {
        const a = row('A', d(120, 80))
        const b = row('B', d(90, 60))
        const c = row('C', d(50, 40))
        b.set(d(90, 70))
        c.set(null)
        const session = new TrackedTimeDecisionSession([a, b, c], fmt, () => {})
        await session.decide(0, 'drop')
        expect(session.states[1]?.decision).toEqual(d(90, 70))
        expect(session.states[1]?.status).toBe('open')
        expect(session.states[2]?.status).toBe('resolved')
        expect(session.states[2]?.message).toBe('Nothing to decide any more')
    })

    test('a failed write is shown and not retried', async () => {
        const a = row('A', d(120, 80))
        a.apply = () => Promise.reject(new Error('locked'))
        const session = new TrackedTimeDecisionSession([a], fmt, () => {})
        await session.decide(0, 'keep')
        expect(session.states[0]?.status).toBe('failed')
        expect(session.openCount).toBe(0)
    })
})
