import { describe, expect, it } from 'bun:test'
import type { App, TFile } from 'obsidian'
import { createDefaultNoteType, recognizeLocalNoteType } from './note-type.service'
import type { NoteType } from '../domain/note-type'
import type { KanbanActionPlannerPlugin } from '../plugin'

function typeWithFolder(id: string, name: string, folder: string): NoteType {
    const noteType = createDefaultNoteType(id, name, 'local')
    return {
        ...noteType,
        typeRecognition: {
            mappings: [{ type: 'folder', value: folder, enabled: true }]
        }
    }
}

function fakePlugin(noteTypes: NoteType[]): KanbanActionPlannerPlugin {
    return { settings: { noteTypes } } as unknown as KanbanActionPlannerPlugin
}

// getAllTags is mocked to return [] in test-setup, so these cover path/folder rules.
const app = { metadataCache: { getFileCache: () => null } } as unknown as App
const file = (path: string): TFile => ({ path }) as unknown as TFile

describe('recognizeLocalNoteType (issue #31)', () => {
    it('matches a file to a local type by folder rule', () => {
        const plugin = fakePlugin([
            createDefaultNoteType('__default__', 'Default', 'local'),
            typeWithFolder('widget', 'Widget', 'Widgets')
        ])
        expect(recognizeLocalNoteType(app, plugin, file('Widgets/A.md'))).toEqual({
            id: 'widget',
            name: 'Widget'
        })
    })

    it('returns null when nothing matches', () => {
        const plugin = fakePlugin([typeWithFolder('widget', 'Widget', 'Widgets')])
        expect(recognizeLocalNoteType(app, plugin, file('Other/A.md'))).toBeNull()
    })

    it('ignores the Default note type and noteTypes with no mappings', () => {
        const empty = createDefaultNoteType('empty', 'Empty', 'local') // no mappings
        const plugin = fakePlugin([
            { ...createDefaultNoteType('__default__', 'Default', 'local') },
            empty
        ])
        expect(recognizeLocalNoteType(app, plugin, file('Widgets/A.md'))).toBeNull()
    })

    it('returns the first matching type', () => {
        const plugin = fakePlugin([
            typeWithFolder('a', 'A', 'Shared'),
            typeWithFolder('b', 'B', 'Shared')
        ])
        expect(recognizeLocalNoteType(app, plugin, file('Shared/X.md'))?.id).toBe('a')
    })
})
