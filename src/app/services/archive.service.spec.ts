import { describe, expect, test } from 'bun:test'
import { isNamesake, normalizeFolderPath, planMove, resolveArchiveFolder } from './archive.service'
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

    test('collisions suffix the file, or the folder when it moves', () => {
        expect(planMove(note, 'Archive', taken(['Archive/Write docs.md']))).toMatchObject({
            kind: 'file',
            destPath: 'Archive/Write docs 1.md'
        })
        expect(
            planMove(namesake, 'Archive', taken(['Archive/Foo', 'Archive/Foo 1']))
        ).toMatchObject({ folderDest: 'Archive/Foo 2', destPath: 'Archive/Foo 2/Foo.md' })
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
