import { describe, expect, test } from 'bun:test'
import {
    isDeletedPath,
    newTrackingCommandId,
    orderPickerPaths,
    pushRecentPath,
    renameRecentPaths,
    renameTrackingCommands,
    renamedPath,
    trackingCommandName
} from './tracking-commands'

describe('trackingCommandName (issue #228)', () => {
    test('names the command after the note, without folder or extension', () => {
        expect(trackingCommandName('Work/Inbox zero (Task).md')).toBe(
            'Start time tracking: Inbox zero (Task)'
        )
    })
})

describe('newTrackingCommandId', () => {
    test('is prefixed and avoids ids already taken', () => {
        const values = [0, 0, 0.5]
        const random = () => values.shift() ?? 0.5
        const first = newTrackingCommandId([], () => 0)
        const id = newTrackingCommandId([{ id: first, path: 'a.md' }], random)
        expect(first).toBe('track-00000000')
        expect(id).not.toBe(first)
        expect(id.startsWith('track-')).toBe(true)
    })
})

describe('renamedPath', () => {
    test('follows the note itself', () => {
        expect(renamedPath('A/Note.md', 'A/Note.md', 'Archive/Note.md')).toBe('Archive/Note.md')
    })

    test('follows a note inside a renamed folder', () => {
        expect(renamedPath('A/B/Note.md', 'A/B', 'Archive/B')).toBe('Archive/B/Note.md')
    })

    test('ignores a sibling sharing a name prefix', () => {
        expect(renamedPath('A/Notes.md', 'A/Note', 'X')).toBeNull()
        expect(renamedPath('A/Note 2.md', 'A/Note.md', 'X.md')).toBeNull()
    })
})

describe('isDeletedPath', () => {
    test('matches the note and the notes of a deleted folder only', () => {
        expect(isDeletedPath('A/Note.md', 'A/Note.md')).toBe(true)
        expect(isDeletedPath('A/B/Note.md', 'A/B')).toBe(true)
        expect(isDeletedPath('A/Bc/Note.md', 'A/B')).toBe(false)
    })
})

describe('renameTrackingCommands', () => {
    test('rewrites the moved paths and keeps the ids (hotkeys stay bound)', () => {
        const next = renameTrackingCommands(
            [
                { id: 'track-1', path: 'Tasks/Mail.md' },
                { id: 'track-2', path: 'Tasks/Review.md' }
            ],
            'Tasks/Mail.md',
            'Archive/2026/Mail.md'
        )
        expect(next).toEqual([
            { id: 'track-1', path: 'Archive/2026/Mail.md' },
            { id: 'track-2', path: 'Tasks/Review.md' }
        ])
    })

    test('returns null when nothing moved', () => {
        expect(renameTrackingCommands([{ id: 't', path: 'a.md' }], 'b.md', 'c.md')).toBeNull()
    })
})

describe('renameRecentPaths', () => {
    test('rewrites moved entries in place, null when nothing moved', () => {
        expect(renameRecentPaths(['a.md', 'b.md'], 'b.md', 'c.md')).toEqual(['a.md', 'c.md'])
        expect(renameRecentPaths(['a.md'], 'b.md', 'c.md')).toBeNull()
    })
})

describe('pushRecentPath', () => {
    test('moves the path to the front, once, within the cap', () => {
        expect(pushRecentPath(['a.md', 'b.md', 'c.md'], 'b.md')).toEqual(['b.md', 'a.md', 'c.md'])
        expect(pushRecentPath(['a.md', 'b.md'], 'c.md', 2)).toEqual(['c.md', 'a.md'])
    })
})

describe('orderPickerPaths', () => {
    test('recently tracked, then recently opened, then the rest, each once', () => {
        expect(
            orderPickerPaths(
                ['c.md', 'gone.md'],
                ['b.md', 'c.md'],
                ['a.md', 'b.md', 'c.md', 'd.md']
            )
        ).toEqual(['c.md', 'b.md', 'a.md', 'd.md'])
    })
})
