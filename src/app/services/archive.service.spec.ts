import { describe, expect, test } from 'bun:test'
import { App, TFile } from 'obsidian'
import {
    archiveNote,
    isNamesake,
    normalizeFolderPath,
    planMove,
    resolveArchiveFolder
} from './archive.service'
import type { ArchiveConfig } from '../domain/note-type'
import type { ExpressionContext } from '../utils/expressions'

const ctx: ExpressionContext = {
    now: new Date(2026, 5, 26, 14, 30, 15),
    uuid: () => 'fixed-uuid'
}

describe('normalizeFolderPath', () => {
    test('trims segments and collapses separators', () => {
        expect(normalizeFolderPath(' Archive / 2026 ')).toBe('Archive/2026')
        expect(normalizeFolderPath('Archive//2026/')).toBe('Archive/2026')
        expect(normalizeFolderPath('/Archive/')).toBe('Archive')
    })

    test('empty / whitespace-only becomes empty', () => {
        expect(normalizeFolderPath('')).toBe('')
        expect(normalizeFolderPath('  /  ')).toBe('')
    })
})

describe('resolveArchiveFolder', () => {
    test('resolves placeholders and normalizes', () => {
        expect(resolveArchiveFolder('Archive/{{year}}/{{month}}', ctx)).toBe('Archive/2026/06')
    })

    test('blank template disables archiving (null)', () => {
        expect(resolveArchiveFolder('', ctx)).toBeNull()
        expect(resolveArchiveFolder('   ', ctx)).toBeNull()
    })
})

describe('planMove', () => {
    const taken = (paths: string[]) => (path: string) => paths.includes(path)
    const note = {
        path: 'Tasks/Write docs.md',
        name: 'Write docs.md',
        basename: 'Write docs',
        parent: { path: 'Tasks', name: 'Tasks', parentPath: '' }
    }
    const folderNote = {
        path: 'Projects/Foo/Foo (Project).md',
        name: 'Foo (Project).md',
        basename: 'Foo (Project)',
        parent: { path: 'Projects/Foo', name: 'Foo', parentPath: 'Projects' }
    }
    const namesake = {
        path: 'Projects/Foo/Foo.md',
        name: 'Foo.md',
        basename: 'Foo',
        parent: { path: 'Projects/Foo', name: 'Foo', parentPath: 'Projects' }
    }

    test('a plain note moves alone', () => {
        expect(planMove(note, 'Archive/2026', taken([]))).toEqual({
            kind: 'file',
            destPath: 'Archive/2026/Write docs.md'
        })
    })

    test('a note in a non-namesake folder moves alone (siblings stay)', () => {
        const other = {
            ...folderNote,
            name: 'Notes.md',
            basename: 'Notes',
            path: 'Projects/Foo/Notes.md'
        }
        expect(planMove(other, 'Archive', taken([])).kind).toBe('file')
    })

    test('a folder note with a parenthesised type suffix takes its folder too', () => {
        expect(planMove(folderNote, 'Archive/2026', taken([]))).toEqual({
            kind: 'folder',
            folderFrom: 'Projects/Foo',
            folderDest: 'Archive/2026/Foo',
            destPath: 'Archive/2026/Foo/Foo (Project).md'
        })
    })

    test('isNamesake accepts exact and one parenthesised suffix only', () => {
        expect(isNamesake('Foo', 'Foo')).toBe(true)
        expect(isNamesake('Foo (Project)', 'Foo')).toBe(true)
        expect(isNamesake('Foo bar', 'Foo')).toBe(false)
        expect(isNamesake('Foo - Plan', 'Foo')).toBe(false)
        expect(isNamesake('Foo (Project) notes', 'Foo')).toBe(false)
    })

    test('a namesake folder note takes its folder along', () => {
        expect(planMove(namesake, 'Archive/2026', taken([]))).toEqual({
            kind: 'folder',
            folderFrom: 'Projects/Foo',
            folderDest: 'Archive/2026/Foo',
            destPath: 'Archive/2026/Foo/Foo.md'
        })
    })

    test('a collision at the destination is reported and nothing moves, file or folder', () => {
        expect(planMove(note, 'Archive', taken(['Archive/Write docs.md']))).toEqual({
            kind: 'collision',
            path: 'Archive/Write docs.md'
        })
        expect(planMove(namesake, 'Archive', taken(['Archive/Foo']))).toEqual({
            kind: 'collision',
            path: 'Archive/Foo'
        })
    })

    test('already in place is a no-op (file and folder forms)', () => {
        expect(planMove({ ...note, path: 'Archive/Write docs.md' }, 'Archive', taken([]))).toEqual({
            kind: 'noop'
        })
        expect(
            planMove(
                {
                    ...namesake,
                    path: 'Archive/Foo/Foo.md',
                    parent: { path: 'Archive/Foo', name: 'Foo', parentPath: 'Archive' }
                },
                'Archive',
                taken(['Archive/Foo'])
            )
        ).toEqual({ kind: 'noop' })
    })

    test('a root-level note (no parent) moves alone', () => {
        expect(
            planMove({ ...note, path: 'Write docs.md', parent: null }, 'Archive', taken([]))
        ).toEqual({
            kind: 'file',
            destPath: 'Archive/Write docs.md'
        })
    })
})

describe('archiveNote: the Starter Kit archive tag (OSK ≥ 1.50, Archive Tag Rule)', () => {
    interface Options {
        path?: string
        parent?: { path: string; name: string; parentPath: string } | null
        exists?: (path: string) => boolean
        failTagWrite?: boolean
        fm?: Record<string, unknown>
    }
    /** A vault with one note; records frontmatter writes and moves, in order. */
    function vault(
        tags: unknown,
        o: Options = {}
    ): {
        app: App
        file: TFile
        fm: Record<string, unknown>
        events: string[]
    } {
        const fm: Record<string, unknown> = o.fm ?? { tags }
        const events: string[] = []
        const path = o.path ?? 'Tasks/Do it.md'
        const name = path.slice(path.lastIndexOf('/') + 1)
        const parent = o.parent
            ? {
                  path: o.parent.path,
                  name: o.parent.name,
                  isRoot: () => false,
                  parent: { path: o.parent.parentPath }
              }
            : null
        const file = Object.assign(new TFile(), {
            path,
            name,
            basename: name.replace(/\.md$/, ''),
            parent
        })
        const app: App = Object.assign(new App(), {
            fileManager: {
                processFrontMatter: (_f: TFile, cb: (x: Record<string, unknown>) => void) => {
                    if (o.failTagWrite) return Promise.reject(new Error('locked'))
                    events.push('frontmatter')
                    cb(fm)
                    return Promise.resolve()
                },
                renameFile: (_f: unknown, to: string) => {
                    events.push(`move ${to}`)
                    return Promise.resolve()
                }
            },
            vault: {
                getAbstractFileByPath: (p: string) => (o.exists?.(p) ? {} : null),
                getFolderByPath: () => ({}),
                createFolder: () => Promise.resolve()
            }
        })
        return { app, file, fm, events }
    }
    const archive = (extra: Partial<ArchiveConfig> = {}): ArchiveConfig => ({
        archiveFolder: 'Archives/{{year}}',
        triggerStatuses: ['80 - Done'],
        doneDateProperties: [],
        mirrored: true,
        ...extra
    })
    const tagged = archive({ tag: 'statut/archive' })

    test('adds the tag, then moves the note', async () => {
        const v = vault(['type/task'])
        const result = await archiveNote(v.app, v.file, tagged, ctx)
        expect(result).toEqual({ ok: true, destPath: 'Archives/2026/Do it.md' })
        expect(v.events).toEqual(['frontmatter', 'move Archives/2026/Do it.md'])
        expect(v.fm['tags']).toEqual(['type/task', 'statut/archive'])
    })

    test('a tag already there (any case, with #) is not added twice', async () => {
        const v = vault(['type/task', '#Statut/Archive'])
        await archiveNote(v.app, v.file, tagged, ctx)
        expect(v.fm['tags']).toEqual(['type/task', '#Statut/Archive'])
    })

    test('tags as text, null, a null item, missing, or under another casing', async () => {
        for (const [fm, key, expected] of [
            [{ tags: 'type/task' }, 'tags', ['type/task', 'statut/archive']],
            [{ tags: null }, 'tags', ['statut/archive']],
            [{ tags: [null] }, 'tags', ['statut/archive']],
            [{}, 'tags', ['statut/archive']],
            [{ Tags: ['type/task'] }, 'Tags', ['type/task', 'statut/archive']]
        ] as const) {
            const v = vault(undefined, { fm: { ...fm } })
            await archiveNote(v.app, v.file, tagged, ctx)
            expect(v.fm[key]).toEqual([...expected])
        }
    })

    test('no tag: only the move, as before', async () => {
        const v = vault(['type/task'])
        await archiveNote(v.app, v.file, archive(), ctx)
        expect(v.events).toEqual(['move Archives/2026/Do it.md'])
        expect(v.fm['tags']).toEqual(['type/task'])
    })

    test('a tag on a config the planner owns is ignored (only the Starter Kit tags)', async () => {
        const v = vault(['type/task'])
        await archiveNote(v.app, v.file, archive({ tag: 'statut/archive', mirrored: false }), ctx)
        expect(v.events).toEqual(['move Archives/2026/Do it.md'])
    })

    test('no destination folder: neither tagged nor moved', async () => {
        const v = vault(['type/task'])
        const result = await archiveNote(v.app, v.file, { ...tagged, archiveFolder: ' ' }, ctx)
        expect(result).toEqual({ ok: false, reason: 'no-folder' })
        expect(v.events).toEqual([])
    })

    test('a refused move (collision): not tagged, so the card stays visible', async () => {
        const v = vault(['type/task'], { exists: (p) => p === 'Archives/2026/Do it.md' })
        const result = await archiveNote(v.app, v.file, tagged, ctx)
        expect(result.ok).toBe(false)
        expect(result.ok ? null : result.reason).toBe('collision')
        expect(v.events).toEqual([])
    })

    test('a failed tag write is logged and the note still moves', async () => {
        const v = vault(['type/task'], { failTagWrite: true })
        const original = console.error
        console.error = (): void => {}
        try {
            const result = await archiveNote(v.app, v.file, tagged, ctx)
            expect(result).toEqual({ ok: true, destPath: 'Archives/2026/Do it.md' })
        } finally {
            console.error = original
        }
        expect(v.events).toEqual(['move Archives/2026/Do it.md'])
    })

    test('a folder note: the note is tagged, then its folder moves', async () => {
        const v = vault(['type/project'], {
            path: 'Projects/Foo/Foo (Project).md',
            parent: { path: 'Projects/Foo', name: 'Foo', parentPath: 'Projects' }
        })
        await archiveNote(v.app, v.file, tagged, ctx)
        expect(v.events).toEqual(['frontmatter', 'move Archives/2026/Foo'])
    })

    test('a note already in the archive folder gets the tag, nothing moves', async () => {
        const v = vault(['type/task'], { path: 'Archives/2026/Do it.md' })
        const result = await archiveNote(v.app, v.file, tagged, ctx)
        expect(result).toEqual({ ok: true, destPath: 'Archives/2026/Do it.md' })
        expect(v.events).toEqual(['frontmatter'])
    })
})
