import type { App, TFile } from 'obsidian'
import { dailyNotePath, pickDailyNoteSource } from '../domain/daily-note'
import type { DailyNoteSource, DailyNoteSources } from '../domain/daily-note'
import { formatDate } from '../utils/momentjs'

/**
 * Daily-note access for the tracker's pomodoro records (issue #172). The
 * folder and format come from the Periodic Notes plugin, else the core Daily
 * Notes plugin, else the plugin's own fallback settings (`domain/daily-note.ts`
 * decides; this file only reads the plugins' undocumented shapes defensively).
 */

/** Periodic Notes community plugin id. */
const PERIODIC_NOTES_PLUGIN_ID = 'periodic-notes'
/** Core Daily Notes plugin id. */
const DAILY_NOTES_PLUGIN_ID = 'daily-notes'

/**
 * Walk `keys` down an untyped object graph (the plugin registries are not in
 * Obsidian's public typings); undefined as soon as a step is not an object.
 */
function readPath(root: unknown, ...keys: string[]): unknown {
    let current: unknown = root
    for (const key of keys) {
        if (typeof current !== 'object' || current === null) return undefined
        current = Reflect.get(current, key)
    }
    return current
}

/** A `{folder?, format?}` record read from an untyped settings object, or null. */
function sourceFrom(record: unknown): DailyNoteSource | null {
    if (typeof record !== 'object' || record === null) return null
    const folder = readPath(record, 'folder')
    const format = readPath(record, 'format')
    return {
        folder: typeof folder === 'string' ? folder : '',
        format: typeof format === 'string' ? format : ''
    }
}

/** Periodic Notes' `daily` settings when the plugin is loaded and its daily notes are on. */
function periodicNotesSource(app: App): DailyNoteSource | null {
    const daily = readPath(app, 'plugins', 'plugins', PERIODIC_NOTES_PLUGIN_ID, 'settings', 'daily')
    if (readPath(daily, 'enabled') === false) return null
    return sourceFrom(daily)
}

/** The core Daily Notes plugin's options when it is enabled. */
function coreDailyNotesSource(app: App): DailyNoteSource | null {
    const registry = readPath(app, 'internalPlugins')
    const getEnabled = readPath(registry, 'getEnabledPluginById')
    if (typeof getEnabled !== 'function' || typeof registry !== 'object' || registry === null) {
        return null
    }
    let plugin: unknown
    try {
        plugin = Reflect.apply(getEnabled, registry, [DAILY_NOTES_PLUGIN_ID])
    } catch {
        return null
    }
    return sourceFrom(readPath(plugin, 'options'))
}

/** Every daily-note source, in precedence order, for `domain/daily-note.ts`. */
export function dailyNoteSources(
    app: App,
    settings: { dailyNoteFolder: string; dailyNoteFormat: string }
): DailyNoteSources {
    return {
        periodic: periodicNotesSource(app),
        core: coreDailyNotesSource(app),
        fallback: { folder: settings.dailyNoteFolder, format: settings.dailyNoteFormat }
    }
}

/** The vault path of the daily note for `date`. */
export function resolveDailyNotePath(
    app: App,
    settings: { dailyNoteFolder: string; dailyNoteFormat: string },
    date: Date
): string {
    return dailyNotePath(pickDailyNoteSource(dailyNoteSources(app, settings)), date, formatDate)
}

/**
 * The daily note for `date`, created empty (with its folders) when missing —
 * a record has to land somewhere, and an empty note is what a daily-notes
 * plugin's own "open today" would create before templating.
 */
export async function ensureDailyNote(
    app: App,
    settings: { dailyNoteFolder: string; dailyNoteFormat: string },
    date: Date
): Promise<TFile> {
    const path = resolveDailyNotePath(app, settings, date)
    const existing = app.vault.getFileByPath(path)
    if (existing) return existing
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (folder && !app.vault.getFolderByPath(folder)) {
        await app.vault.createFolder(folder)
    }
    return app.vault.create(path, '')
}
