import { describe, expect, test } from 'bun:test'
import { localColorStatusValues } from './settings-tab'
import { createDefaultNoteType } from '../services/note-type.service'

describe('localColorStatusValues', () => {
    test('keeps defaults and saved overrides editable after reopening a local type without cached columns', () => {
        const localType = createDefaultNoteType('project', 'Project', 'local')
        localType.colors.overrides['40 Archived'] = { kind: 'hex', value: '#123456' }

        expect(localColorStatusValues(['10 Todo', '20 Doing'], localType)).toEqual([
            '10 Todo',
            '20 Doing',
            '40 Archived'
        ])
    })

    test('preserves source order and removes duplicates across every source', () => {
        const localType = createDefaultNoteType('project', 'Project', 'local')
        localType.columns = [
            {
                id: '20 Doing',
                statusValue: '20 Doing',
                label: 'Doing',
                sortKey: '20',
                color: { kind: 'palette', token: 'blue' }
            },
            {
                id: '30 Done',
                statusValue: '30 Done',
                label: 'Done',
                sortKey: '30',
                color: { kind: 'palette', token: 'green' }
            }
        ]
        localType.colors.overrides['30 Done'] = { kind: 'palette', token: 'green' }
        localType.colors.overrides['40 Archived'] = { kind: 'hex', value: '#654321' }

        expect(localColorStatusValues(['10 Todo', '20 Doing'], localType)).toEqual([
            '10 Todo',
            '20 Doing',
            '30 Done',
            '40 Archived'
        ])
    })
})
