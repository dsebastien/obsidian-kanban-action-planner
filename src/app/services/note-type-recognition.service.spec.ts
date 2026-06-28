import { describe, expect, it } from 'bun:test'
import type { App, TFile } from 'obsidian'
import { createDefaultProfile, recognizeLocalNoteType } from './profile-service'
import type { Profile } from '../domain/profile'
import type { KanbanActionPlannerPlugin } from '../plugin'

function typeWithFolder(id: string, name: string, folder: string): Profile {
    const profile = createDefaultProfile(id, name, 'local')
    return {
        ...profile,
        typeRecognition: {
            mappings: [{ type: 'folder', value: folder, enabled: true }]
        }
    }
}

function fakePlugin(profiles: Profile[]): KanbanActionPlannerPlugin {
    return { settings: { profiles } } as unknown as KanbanActionPlannerPlugin
}

// getAllTags is mocked to return [] in test-setup, so these cover path/folder rules.
const app = { metadataCache: { getFileCache: () => null } } as unknown as App
// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fake; recognizeLocalNoteType only reads `.path`
const file = (path: string): TFile => ({ path }) as unknown as TFile

describe('recognizeLocalNoteType (issue #31)', () => {
    it('matches a file to a local type by folder rule', () => {
        const plugin = fakePlugin([
            createDefaultProfile('__default__', 'Default', 'local'),
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

    it('ignores the Default profile and profiles with no mappings', () => {
        const empty = createDefaultProfile('empty', 'Empty', 'local') // no mappings
        const plugin = fakePlugin([
            { ...createDefaultProfile('__default__', 'Default', 'local') },
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
