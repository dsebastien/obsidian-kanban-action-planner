import { describe, expect, test } from 'bun:test'
import { produce } from 'immer'
import type { App, PluginManifest } from 'obsidian'
import { KanbanActionPlannerPlugin } from './plugin'
import { DEFAULT_SETTINGS, createDefaultSettings } from './types/plugin-settings.intf'

const expectDefaultsNotFrozen = (): void => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(false)
    expect(Object.isFrozen(DEFAULT_SETTINGS.weekAlarmNotified)).toBe(false)
    expect(Object.isFrozen(DEFAULT_SETTINGS.weekWorkDays)).toBe(false)
    expect(Object.isFrozen(DEFAULT_SETTINGS.disabledModes)).toBe(false)
    expect(Object.isFrozen(DEFAULT_SETTINGS.defaultStatuses)).toBe(false)
    expect(Object.isFrozen(DEFAULT_SETTINGS.noteTypes)).toBe(false)
}

/** A plugin built without the constructor, backed by the given data.json content. */
const createPlugin = (stored: unknown): KanbanActionPlannerPlugin => {
    // Skip the constructor: its field initializer is the first test's case.
    return Object.assign(
        Object.create(KanbanActionPlannerPlugin.prototype) as KanbanActionPlannerPlugin,
        {
            settings: produce(createDefaultSettings(), () => {}),
            loadData: (): Promise<unknown> => Promise.resolve(stored),
            saveData: (): Promise<void> => Promise.resolve()
        }
    )
}

describe('default settings', () => {
    test('constructing the plugin never freezes the shared defaults', () => {
        const plugin = new KanbanActionPlannerPlugin({} as App, {} as PluginManifest)
        expect(Object.isFrozen(plugin.settings)).toBe(true)
        expectDefaultsNotFrozen()
    })

    test('loadSettings with no stored data never freezes the shared defaults', async () => {
        const plugin = createPlugin(null)

        await plugin.loadSettings()

        // Immer deep-freezes what produce returns, including subtrees shared
        // with its base: producing from DEFAULT_SETTINGS froze the constant
        // for the rest of the process.
        expect(plugin.settings).toEqual(DEFAULT_SETTINGS)
        expect(Object.isFrozen(plugin.settings)).toBe(true)
        expectDefaultsNotFrozen()
    })

    test('loadSettings with invalid stored data never freezes the shared defaults', async () => {
        // Invalid data falls back to the defaults, the same trap.
        const plugin = createPlugin({ minutesPerDay: 'not a number' })

        await plugin.loadSettings()

        expect(plugin.settings).toEqual(DEFAULT_SETTINGS)
        expectDefaultsNotFrozen()
    })

    test('loadSettings with stored data never freezes the shared defaults', async () => {
        // Nothing stored for the arrays: the merge takes them from the
        // defaults. Zod's parse copies them today; this pins that the whole
        // merge, parse and migrate chain keeps the constant out of produce.
        const plugin = createPlugin({ minutesPerDay: 420 })

        await plugin.loadSettings()

        expect(plugin.settings.minutesPerDay).toBe(420)
        expect(Object.isFrozen(plugin.settings.defaultStatuses)).toBe(true)
        expectDefaultsNotFrozen()
    })

    test('each default settings object is an independent copy', () => {
        const one = createDefaultSettings()
        one.weekWorkDays.push(5)
        one.defaultStatuses.push('todo')
        one.weekAlarmNotified['2026-W40'] = 'alarm'
        const two = createDefaultSettings()
        expect(two.weekWorkDays).toEqual([0, 1, 2, 3, 4])
        expect(two.defaultStatuses).toEqual([])
        expect(two.weekAlarmNotified).toEqual({})
        expect(DEFAULT_SETTINGS.weekWorkDays).toEqual([0, 1, 2, 3, 4])
    })
})
