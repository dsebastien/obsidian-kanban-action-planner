import { describe, expect, test } from 'bun:test'
import { UNMAPPED_COLUMN_ID } from '../constants'
import { resolvePaneGroupDrop, resolveRailStatusDrop } from './pane-drop'
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

describe('resolveRailStatusDrop (issue #185)', () => {
    const labelled = (id: string, statusValue: string, label: string): ColumnDef => ({
        id,
        statusValue,
        label,
        sortKey: statusValue,
        color: { kind: 'palette', token: 'teal' }
    })
    const columns: ColumnDef[] = [
        labelled('c1', '10 - Backlog', 'Backlog'),
        labelled('c2', '60 - In Progress', 'In Progress'),
        labelled('c3', '80 - Done', 'Done')
    ]

    test("sets the status when the raw value is one of the note's columns", () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: '10 - Backlog' },
                { statusValue: '60 - In Progress', label: 'In Progress' },
                columns
            )
        ).toEqual({ statusValue: '60 - In Progress', columnId: 'c2' })
    })

    test('falls back to the displayed label when the raw value belongs to another type', () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: '10 - Backlog' },
                { statusValue: '3 - In Progress', label: 'In Progress' },
                columns
            )
        ).toEqual({ statusValue: '60 - In Progress', columnId: 'c2' })
    })

    test("refuses a group the note's type does not define", () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: '10 - Backlog' },
                { statusValue: '55 - Blocked', label: 'Blocked' },
                columns
            )
        ).toBeNull()
    })

    test("is a no-op on the note's own group", () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: '10 - Backlog' },
                { statusValue: '10 - Backlog', label: 'Backlog' },
                columns
            )
        ).toBeNull()
    })

    test('is a no-op when the label resolves back to the current status', () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: '10 - Backlog' },
                { statusValue: 'x - Backlog', label: 'Backlog' },
                columns
            )
        ).toBeNull()
    })

    test('the "No status" group clears the status', () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: '10 - Backlog' },
                { statusValue: '', label: 'No status' },
                columns
            )
        ).toEqual({ statusValue: null, columnId: UNMAPPED_COLUMN_ID })
    })

    test('dropping an already-status-less note on "No status" does nothing', () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: null },
                { statusValue: '', label: 'No status' },
                columns
            )
        ).toBeNull()
    })

    test('refuses everything when the note has no columns', () => {
        expect(
            resolveRailStatusDrop(
                { statusValue: '10 - Backlog' },
                { statusValue: '60 - In Progress', label: 'In Progress' },
                []
            )
        ).toBeNull()
    })
})
