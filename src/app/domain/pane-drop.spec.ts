import { describe, expect, test } from 'bun:test'
import { UNMAPPED_COLUMN_ID } from '../constants'
import { resolvePaneGroupDrop } from './pane-drop'
import type { ColumnDef } from './note-type'

const col = (id: string, statusValue: string): ColumnDef => ({
    id,
    statusValue,
    label: statusValue,
    sortKey: statusValue,
    color: { kind: 'palette', token: 'teal' }
})

const COLUMNS = [col('30 - Active', '30 - Active'), col('40 - Back Burner', '40 - Back Burner')]

describe('resolvePaneGroupDrop', () => {
    test('same type, different mapped status → resolves to that column', () => {
        const r = resolvePaneGroupDrop(
            { typeId: 'goals', statusValue: '30 - Active' },
            { typeId: 'goals', status: '40 - Back Burner' },
            COLUMNS
        )
        expect(r).toEqual({ statusValue: '40 - Back Burner', columnId: '40 - Back Burner' })
    })

    test('cross-type drops never commit', () => {
        const r = resolvePaneGroupDrop(
            { typeId: 'tasks', statusValue: '10 - Backlog' },
            { typeId: 'goals', status: '30 - Active' },
            COLUMNS
        )
        expect(r).toBeNull()
    })

    test('dropping on the current group is a no-op', () => {
        const r = resolvePaneGroupDrop(
            { typeId: 'goals', statusValue: '30 - Active' },
            { typeId: 'goals', status: '30 - Active' },
            COLUMNS
        )
        expect(r).toBeNull()
    })

    test('the No-status group clears the status (Unmapped semantics)', () => {
        const r = resolvePaneGroupDrop(
            { typeId: 'goals', statusValue: '30 - Active' },
            { typeId: 'goals', status: '' },
            COLUMNS
        )
        expect(r).toEqual({ statusValue: null, columnId: UNMAPPED_COLUMN_ID })
    })

    test('a status-less card can move into a mapped group', () => {
        const r = resolvePaneGroupDrop(
            { typeId: 'goals', statusValue: null },
            { typeId: 'goals', status: '30 - Active' },
            COLUMNS
        )
        expect(r).toEqual({ statusValue: '30 - Active', columnId: '30 - Active' })
    })

    test('an unmapped raw status is not a valid destination', () => {
        const r = resolvePaneGroupDrop(
            { typeId: 'goals', statusValue: '30 - Active' },
            { typeId: 'goals', status: '15 - Rogue' },
            COLUMNS
        )
        expect(r).toBeNull()
    })
})
