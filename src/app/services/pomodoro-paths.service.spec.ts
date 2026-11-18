import { describe, expect, test } from 'bun:test'
import type { TFile } from 'obsidian'
import { KanbanActionPlannerPlugin } from '../plugin'
import { createDefaultSettings } from '../types/plugin-settings.intf'
import { fakeVault } from './linked-time.fixture'
import { rewritePomodoroPaths } from './pomodoro-paths.service'

const record = (taskPath: string, id: string): Record<string, unknown> => ({
    id,
    taskPath,
    startTime: '2026-11-18T09:00:00.000+01:00',
    endTime: '2026-11-18T09:25:00.000+01:00',
    plannedDuration: 25,
    type: 'work',
    completed: true
})

function setup(notes: Record<string, Record<string, unknown>>, property = 'pomodoros') {
    const v = fakeVault(notes)
    const written: string[] = []
    const app = {
        ...v.app,
        fileManager: {
            processFrontMatter: (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
                written.push(f.path)
                fn(v.frontmatter.get(f.path) ?? {})
                return Promise.resolve()
            }
        }
    }
    const plugin = Object.assign(
        Object.create(KanbanActionPlannerPlugin.prototype) as KanbanActionPlannerPlugin,
        { app, settings: { ...createDefaultSettings(), pomodorosProperty: property } }
    )
    return { v, plugin, written }
}

describe('rewritePomodoroPaths (issue #231)', () => {
    test('rewrites the matching records of every daily note, and writes only those notes', async () => {
        const { v, plugin, written } = setup({
            'Daily/2026-11-17.md': {
                pomodoros: [record('Tasks/A.md', 'p1'), record('Tasks/B.md', 'p2')]
            },
            'Daily/2026-11-18.md': { pomodoros: [record('Tasks/A.md', 'p3')] },
            'Daily/2026-11-16.md': { pomodoros: [record('Tasks/C.md', 'p4')] },
            'Tasks/A (Task).md': { status: 'open' }
        })
        const count = await rewritePomodoroPaths(plugin, [
            { from: 'Tasks/A.md', to: 'Tasks/A (Task).md' }
        ])
        expect(count).toBe(2)
        expect(written.sort()).toEqual(['Daily/2026-11-17.md', 'Daily/2026-11-18.md'])
        expect(v.frontmatter.get('Daily/2026-11-17.md')?.['pomodoros']).toEqual([
            record('Tasks/A (Task).md', 'p1'),
            record('Tasks/B.md', 'p2')
        ])
        expect(v.frontmatter.get('Daily/2026-11-16.md')?.['pomodoros']).toEqual([
            record('Tasks/C.md', 'p4')
        ])
    })

    test('a moved folder moves the paths inside it; the configured property is used', async () => {
        const { v, plugin } = setup(
            { 'Daily/d.md': { Sessions: [record('Projects/P/T.md', 'p1')] } },
            'sessions'
        )
        await rewritePomodoroPaths(plugin, [{ from: 'Projects/P', to: 'Archive/P' }])
        expect(v.frontmatter.get('Daily/d.md')?.['Sessions']).toEqual([
            record('Archive/P/T.md', 'p1')
        ])
    })

    test('no rename, or no note naming the old path: nothing written', async () => {
        const { plugin, written } = setup({
            'Daily/d.md': { pomodoros: [record('Tasks/B.md', 'p')] }
        })
        expect(await rewritePomodoroPaths(plugin, [])).toBe(0)
        expect(await rewritePomodoroPaths(plugin, [{ from: 'Tasks/A.md', to: 'x.md' }])).toBe(0)
        expect(written).toEqual([])
    })
})
