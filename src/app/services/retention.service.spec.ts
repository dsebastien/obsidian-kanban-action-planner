import { describe, expect, test } from 'bun:test'
import { TFile } from 'obsidian'
import { KanbanActionPlannerPlugin } from '../plugin'
import { createDefaultSettings } from '../types/plugin-settings.intf'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { createDefaultNoteType } from './note-type.service'
import {
    backlinkCounts,
    deleteExpiredNotes,
    retentionPaused,
    scanRetention,
    stampCompletionDates,
    unattendedPlan
} from './retention.service'
import type { NoteType } from '../domain/note-type'

const today = new Date(2026, 10, 17) // 2026-11-17

interface Folder {
    path: string
    name: string
    children: unknown[]
    isRoot: () => boolean
}

/**
 * A plugin double over an in-memory vault: notes by path with their
 * frontmatter, `links` as resolved links (source → targets), and a `task`
 * type (folder Tasks) whose done state is `status: Done`.
 */
function setup(
    notes: Record<string, Record<string, unknown>>,
    options: {
        settings?: Partial<PluginSettings>
        links?: Record<string, string[]>
        defaultDays?: number
        withDone?: boolean
        declared?: string[]
        /** Extra stored note types (a Default type, a Starter Kit type). */
        types?: NoteType[]
        /** Last change per path; every other note was last changed long ago. */
        modified?: Record<string, Date>
        /** Changes to the `task` type (done-date properties, automations). */
        task?: Partial<NoteType>
    } = {}
) {
    const files = new Map<string, TFile>()
    const frontmatter = new Map<string, Record<string, unknown>>()
    const folders = new Map<string, Folder>()
    const folderOf = (path: string): Folder => {
        const folderPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        let folder = folders.get(folderPath)
        if (!folder) {
            folder = {
                path: folderPath,
                name: folderPath.split('/').pop() ?? '',
                children: [],
                isRoot: () => folderPath === ''
            }
            folders.set(folderPath, folder)
        }
        return folder
    }
    for (const [path, fm] of Object.entries(notes)) {
        const name = path.split('/').pop() ?? path
        const parent = folderOf(path)
        const file = Object.assign(new TFile(), {
            path,
            name,
            basename: name.replace(/\.md$/, ''),
            extension: 'md',
            parent,
            stat: { mtime: (options.modified?.[path] ?? new Date(2026, 0, 1)).getTime() }
        })
        parent.children.push(file)
        files.set(path, file)
        frontmatter.set(path, fm)
    }
    const trashed: string[] = []
    const resolvedLinks: Record<string, Record<string, number>> = {}
    for (const [source, targets] of Object.entries(options.links ?? {})) {
        resolvedLinks[source] = Object.fromEntries(targets.map((t) => [t, 1]))
    }
    const app = {
        plugins: { plugins: {} },
        vault: {
            getMarkdownFiles: () => [...files.values()],
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            getFolderByPath: (path: string) => folders.get(path) ?? null
        },
        metadataCache: {
            getFileCache: (file: TFile) => {
                const fm = frontmatter.get(file.path)
                return fm ? { frontmatter: fm } : null
            },
            resolvedLinks
        },
        fileManager: {
            trashFile: (file: TFile) => {
                if (file.path.includes('locked')) return Promise.reject(new Error('locked'))
                trashed.push(file.path)
                files.delete(file.path)
                return Promise.resolve()
            },
            processFrontMatter: (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
                fn(frontmatter.get(file.path) ?? {})
                return Promise.resolve()
            }
        }
    }
    const base = createDefaultNoteType('task', 'Task', 'local')
    const task = {
        ...base,
        typeRecognition: {
            mappings: [{ type: 'folder' as const, value: 'Tasks', enabled: true }]
        },
        ...(options.withDone === false
            ? {}
            : { done: { enabled: true, property: 'status', values: ['Done'] } }),
        ...(options.defaultDays ? { retention: { defaultDays: options.defaultDays } } : {}),
        ...(options.declared
            ? { declaredProperties: options.declared.map((name) => ({ name })) }
            : {}),
        ...options.task
    }
    const plugin = Object.assign(
        Object.create(KanbanActionPlannerPlugin.prototype) as KanbanActionPlannerPlugin,
        {
            app,
            settings: {
                ...createDefaultSettings(),
                retentionEnabled: true,
                noteTypes: [task, ...(options.types ?? [])],
                ...options.settings
            }
        }
    )
    const file = (path: string): TFile => {
        const found = files.get(path)
        if (!found) throw new Error(`no note ${path}`)
        return found
    }
    return { plugin, trashed, frontmatter, file }
}

const OLD = { status: 'Done', date_completed: '2026-11-01' }

describe('backlinkCounts', () => {
    test('counts the other notes linking to a note, never the note itself', () => {
        const counts = backlinkCounts({
            metadataCache: {
                resolvedLinks: {
                    'a.md': { 'b.md': 3, 'a.md': 1 },
                    'c.md': { 'b.md': 1 }
                }
            }
        })
        expect(counts.get('b.md')).toBe(2)
        expect(counts.has('a.md')).toBe(false)
    })
})

describe('backlinkCounts with ignored folders', () => {
    const app = {
        metadataCache: {
            resolvedLinks: {
                'Journal/2026-11-17.md': { 'Tasks/a.md': 1, 'Tasks/b.md': 1 },
                'Journals/other.md': { 'Tasks/b.md': 1 },
                'Projects/P.md': { 'Tasks/a.md': 1 }
            }
        }
    }
    test('a source under an ignored folder does not count', () => {
        const counts = backlinkCounts(app, [' /Journal/ '])
        expect(counts.get('Tasks/a.md')).toBe(1)
        // `Journals/` is another folder: a prefix must end at a folder boundary.
        expect(counts.get('Tasks/b.md')).toBe(1)
    })
    test('blank entries ignore nothing', () => {
        expect(backlinkCounts(app, ['', '  ']).get('Tasks/a.md')).toBe(2)
    })
})

describe('scanRetention', () => {
    test('only done notes that ask for a period and are old enough are due', async () => {
        const { plugin } = setup({
            'Tasks/due.md': { ...OLD, retention_days: 7 },
            'Tasks/young.md': { status: 'Done', date_completed: '2026-11-15', retention_days: 7 },
            'Tasks/keep-forever.md': { ...OLD, retention_days: 0 },
            'Tasks/no-period.md': { ...OLD },
            'Tasks/reopened.md': {
                status: 'Todo',
                date_completed: '2026-01-01',
                retention_days: 1
            },
            'Other/plain.md': { title: 'x' }
        })
        const scan = await scanRetention(plugin, today)
        expect(scan.due.map((d) => d.file.path)).toEqual(['Tasks/due.md'])
        expect(scan.due[0]).toMatchObject({ days: 7, completed: '2026-11-01', ageDays: 16 })
        expect(scan.kept).toEqual([])
        expect(scan.stamp).toEqual([])
    })

    test('the type default reaches notes without their own value, wherever they are', async () => {
        const { plugin } = setup(
            {
                'Tasks/by-default.md': { ...OLD },
                'Tasks/own-wins.md': { ...OLD, retention_days: 90 },
                'Tasks/opted-out.md': { ...OLD, retention_days: 0 }
            },
            { defaultDays: 7 }
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.due.map((d) => d.file.path)).toEqual(['Tasks/by-default.md'])
    })

    test('a note of another type never takes a type default', async () => {
        const { plugin } = setup({ 'Other/done.md': { ...OLD } }, { defaultDays: 7 })
        const scan = await scanRetention(plugin, today)
        expect(scan.due).toEqual([])
        expect(scan.kept).toEqual([])
    })

    test('a linked note is kept by default, and due when the setting is off', async () => {
        const notes = { 'Tasks/linked.md': { ...OLD, retention_days: 7 }, 'Hub.md': {} }
        const links = { 'Hub.md': ['Tasks/linked.md'] }
        const kept = await scanRetention(setup(notes, { links }).plugin, today)
        expect(kept.due).toEqual([])
        expect(kept.kept).toMatchObject([{ reason: 'linked', detail: 'another note links to it' }])
        const due = await scanRetention(
            setup(notes, { links, settings: { retentionKeepLinked: false } }).plugin,
            today
        )
        expect(due.due).toMatchObject([{ backlinks: 1 }])
    })

    test('a link from an ignored folder does not keep a note', async () => {
        const notes = {
            'Tasks/listed.md': { ...OLD, retention_days: 7 },
            'Journal/2026-11-01.md': {}
        }
        const links = { 'Journal/2026-11-01.md': ['Tasks/listed.md'] }
        const scan = await scanRetention(
            setup(notes, { links, settings: { retentionIgnoreLinksFrom: ['Journal'] } }).plugin,
            today
        )
        expect(scan.due).toMatchObject([{ backlinks: 0 }])
        expect(scan.kept).toEqual([])
    })

    test('a folder note with other files beside it is kept', async () => {
        const { plugin } = setup(
            {
                'Tasks/Trip/Trip.md': { ...OLD, retention_days: 7 },
                'Tasks/Trip/Tickets.md': {},
                'Tasks/Solo/Solo.md': { ...OLD, retention_days: 7 }
            },
            {}
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.due.map((d) => d.file.path)).toEqual(['Tasks/Solo/Solo.md'])
        expect(scan.kept).toMatchObject([{ reason: 'folder-note' }])
    })

    test('a note with a running time-tracking session is kept', async () => {
        const { plugin } = setup(
            { 'Tasks/tracked.md': { ...OLD, retention_days: 7 } },
            { settings: { activeTimeSession: { path: 'Tasks/tracked.md', startedAt: 1 } } }
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.due).toEqual([])
        expect(scan.kept).toMatchObject([{ reason: 'tracking' }])
    })

    test('an invalid period and a type without a done state are reported, not deleted', async () => {
        const invalid = await scanRetention(
            setup({ 'Tasks/bad.md': { ...OLD, retention_days: 'a week' } }).plugin,
            today
        )
        expect(invalid.due).toEqual([])
        expect(invalid.kept).toMatchObject([{ reason: 'invalid' }])
        const noDone = await scanRetention(
            setup({ 'Tasks/x.md': { ...OLD, retention_days: 7 } }, { withDone: false }).plugin,
            today
        )
        expect(noDone.due).toEqual([])
        expect(noDone.kept).toMatchObject([{ reason: 'no-done-state' }])
    })

    test('a note of no known type and no default type is reported, not deleted', async () => {
        const { plugin } = setup({ 'Other/x.md': { ...OLD, retention_days: 7 } })
        const scan = await scanRetention(plugin, today)
        expect(scan.due).toEqual([])
        expect(scan.kept).toMatchObject([{ reason: 'no-done-state' }])
    })

    test('a done note without a completion date is stamped, and the fallback property is used', async () => {
        const { plugin, frontmatter } = setup({
            'Tasks/undated.md': { status: 'Done', retention_days: 7 }
        })
        const scan = await scanRetention(plugin, today)
        expect(scan.due).toEqual([])
        expect(scan.stamp).toMatchObject([{ property: 'date_completed' }])
        expect(await stampCompletionDates(plugin, scan.stamp, today)).toBe(1)
        expect(frontmatter.get('Tasks/undated.md')?.['date_completed']).toBe('2026-11-17')
        // The clock started today: nothing is due yet.
        expect((await scanRetention(plugin, today)).stamp).toEqual([])
    })

    test('a Starter Kit type that does not declare the date property is not stamped', async () => {
        const { plugin } = setup(
            { 'Tasks/undated.md': { status: 'Done', retention_days: 7 } },
            { declared: ['status', 'retention_days'] }
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.stamp).toEqual([])
        expect(scan.due).toEqual([])
    })

    test('the retention property name is a setting, matched without case', async () => {
        const { plugin } = setup(
            { 'Tasks/custom.md': { ...OLD, Keep_Days: 7, retention_days: 0 } },
            { settings: { retentionProperty: 'keep_days' } }
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.due.map((d) => d.file.path)).toEqual(['Tasks/custom.md'])
    })
})

describe('safety rules from the review', () => {
    const defaultType = (defaultDays: number): NoteType => ({
        ...createDefaultNoteType('__default__', 'Default', 'local'),
        done: { enabled: true, property: 'status', values: ['Done'] },
        retention: { defaultDays }
    })

    test('the Default type never gives its default period to unrecognized notes', async () => {
        const { plugin } = setup(
            {
                'Books/Dune.md': { status: 'Done' },
                'Books/Old.md': { ...OLD }
            },
            { types: [defaultType(30)] }
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.due).toEqual([])
        expect(scan.stamp).toEqual([])
        expect(scan.kept).toEqual([])
    })

    test('an unrecognized note with its own period uses the Default type done state', async () => {
        const { plugin } = setup(
            { 'Books/Own.md': { ...OLD, retention_days: 7 } },
            { types: [defaultType(0)] }
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.due.map((d) => d.file.path)).toEqual(['Books/Own.md'])
    })

    test('a note changed during its period is not due, even with an old completion date', async () => {
        const { plugin } = setup(
            {
                'Tasks/redone.md': {
                    status: 'Done',
                    date_completed: '2025-01-01',
                    retention_days: 7
                },
                'Tasks/quiet.md': {
                    status: 'Done',
                    date_completed: '2025-01-01',
                    retention_days: 7
                }
            },
            { modified: { 'Tasks/redone.md': new Date(2026, 10, 17, 8, 0) } }
        )
        const scan = await scanRetention(plugin, today)
        expect(scan.due.map((d) => d.file.path)).toEqual(['Tasks/quiet.md'])
    })

    test('a note with a folder of its name beside it is kept', async () => {
        const { plugin } = setup({
            'Tasks/Trip.md': { ...OLD, retention_days: 7 },
            'Tasks/Trip/Tickets.md': {}
        })
        const scan = await scanRetention(plugin, today)
        expect(scan.due).toEqual([])
        expect(scan.kept).toMatchObject([{ reason: 'folder-note' }])
    })

    test('with several date properties, only a rule of the type picks the one to stamp', async () => {
        const notes = { 'Tasks/undated.md': { status: 'Done', retention_days: 7 } }
        const archive = {
            archiveFolder: '',
            triggerStatuses: [],
            doneDateProperties: ['date_rejected', 'date_completed']
        }
        const ambiguous = await scanRetention(setup(notes, { task: { archive } }).plugin, today)
        expect(ambiguous.stamp).toEqual([])
        const ruled = await scanRetention(
            setup(notes, {
                task: {
                    archive,
                    automations: [
                        {
                            id: 'r',
                            name: '',
                            enabled: true,
                            trigger: { kind: 'done-entered' },
                            actions: [
                                {
                                    kind: 'set-property',
                                    property: 'date_completed',
                                    value: '{{date}}'
                                }
                            ]
                        }
                    ]
                }
            }).plugin,
            today
        )
        expect(ruled.stamp).toMatchObject([{ property: 'date_completed' }])
    })

    test('a stamp never replaces a date set since the scan, nor touches a reopened note', async () => {
        const { plugin, frontmatter } = setup({
            'Tasks/raced.md': { status: 'Done', retention_days: 7 },
            'Tasks/reopened.md': { status: 'Done', retention_days: 7 }
        })
        const scan = await scanRetention(plugin, today)
        expect(scan.stamp).toHaveLength(2)
        frontmatter.set('Tasks/raced.md', {
            status: 'Done',
            retention_days: 7,
            date_completed: '2026-11-16'
        })
        frontmatter.set('Tasks/reopened.md', { status: 'Todo', retention_days: 7 })
        expect(await stampCompletionDates(plugin, scan.stamp, today)).toBe(0)
        expect(frontmatter.get('Tasks/raced.md')?.['date_completed']).toBe('2026-11-16')
        expect(frontmatter.get('Tasks/reopened.md')?.['date_completed']).toBeUndefined()
    })

    test('retention pauses while Starter Kit types are stored and the Starter Kit is not loaded', () => {
        const kitType: NoteType = {
            ...createDefaultNoteType('nt-1', 'Kit task', 'starter-kit')
        }
        expect(retentionPaused(setup({}, { types: [kitType] }).plugin)).toBe(true)
        expect(retentionPaused(setup({}).plugin)).toBe(false)
    })

    test('a stop request ends a delete run before the next note', async () => {
        const { plugin, trashed, file } = setup({
            'Tasks/a.md': { ...OLD, retention_days: 7 },
            'Tasks/b.md': { ...OLD, retention_days: 7 }
        })
        const result = await deleteExpiredNotes(
            plugin,
            [file('Tasks/a.md'), file('Tasks/b.md')],
            today,
            () => trashed.length > 0
        )
        expect(result.deleted).toBe(1)
        expect(trashed).toEqual(['Tasks/a.md'])
    })
})

describe('unattendedPlan', () => {
    const plan = (due: string[], seen: string[], confirm = false, limit = 10) =>
        unattendedPlan({ due, seenBefore: new Set(seen), confirm, limit })

    test('nothing due: nothing', () => {
        expect(plan([], ['a'])).toEqual({ kind: 'nothing' })
    })
    test('with the confirmation on, a sweep only announces', () => {
        expect(plan(['a'], ['a'], true)).toEqual({ kind: 'announce' })
    })
    test('a first sighting is never deleted', () => {
        expect(plan(['a', 'b'], [])).toEqual({ kind: 'nothing' })
    })
    test('only notes the previous sweep already found due are deleted', () => {
        expect(plan(['a', 'b'], ['a'])).toEqual({ kind: 'delete', paths: ['a'] })
    })
    test('above the limit the sweep asks instead of deleting', () => {
        expect(plan(['a', 'b', 'c'], ['a', 'b', 'c'], false, 2)).toEqual({ kind: 'announce' })
        expect(plan(['a', 'b'], ['a', 'b'], false, 2)).toEqual({
            kind: 'delete',
            paths: ['a', 'b']
        })
    })
})

describe('deleteExpiredNotes', () => {
    test('trashes due notes and reports the count', async () => {
        const { plugin, trashed, file } = setup({
            'Tasks/a.md': { ...OLD, retention_days: 7 },
            'Tasks/b.md': { ...OLD, retention_days: 7 }
        })
        const result = await deleteExpiredNotes(
            plugin,
            [file('Tasks/a.md'), file('Tasks/b.md')],
            today
        )
        expect(result).toEqual({ deleted: 2, skipped: 0, failed: 0 })
        expect(trashed).toEqual(['Tasks/a.md', 'Tasks/b.md'])
    })

    test('a note reopened or gone since the scan is left alone', async () => {
        const { plugin, trashed, file, frontmatter } = setup({
            'Tasks/reopened.md': { ...OLD, retention_days: 7 },
            'Tasks/gone.md': { ...OLD, retention_days: 7 },
            'Tasks/still.md': { ...OLD, retention_days: 7 }
        })
        const scan = await scanRetention(plugin, today)
        expect(scan.due).toHaveLength(3)
        const targets = scan.due.map((d) => d.file)
        // Between the scan and the confirmation: one is reopened, one deleted.
        frontmatter.set('Tasks/reopened.md', { status: 'Todo', retention_days: 7 })
        await plugin.app.fileManager.trashFile(file('Tasks/gone.md'))
        trashed.length = 0
        const result = await deleteExpiredNotes(plugin, targets, today)
        expect(result).toEqual({ deleted: 1, skipped: 2, failed: 0 })
        expect(trashed).toEqual(['Tasks/still.md'])
    })

    test('a failed delete is counted and the others still go', async () => {
        const { plugin, trashed, file } = setup({
            'Tasks/locked.md': { ...OLD, retention_days: 7 },
            'Tasks/ok.md': { ...OLD, retention_days: 7 }
        })
        const result = await deleteExpiredNotes(
            plugin,
            [file('Tasks/locked.md'), file('Tasks/ok.md')],
            today
        )
        expect(result).toEqual({ deleted: 1, skipped: 0, failed: 1 })
        expect(trashed).toEqual(['Tasks/ok.md'])
    })
})
