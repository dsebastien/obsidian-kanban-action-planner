import { describe, expect, it } from 'bun:test'
import { buildBoard, buildSingleLaneBoard } from './board-model'
import type { BoardCardBase } from './board-model'
import type { ColumnDef } from './profile'
import { splitStatusValue } from './status'
import { UNGROUPED_LANE_ID, UNMAPPED_COLUMN_ID } from '../constants'

function column(statusValue: string): ColumnDef {
    const { sortKey, label } = splitStatusValue(statusValue)
    return {
        id: statusValue,
        statusValue,
        label,
        sortKey,
        color: { kind: 'palette', token: 'slate' }
    }
}

const columns: ColumnDef[] = ['10 Todo', '20 Doing', '30 Done'].map(column)

function card(key: string, statusValue: string | null, order: number | null): BoardCardBase {
    return { key, statusValue, order }
}

describe('buildSingleLaneBoard', () => {
    it('buckets cards into their status columns', () => {
        const board = buildSingleLaneBoard(
            [card('a', '10 Todo', 1), card('b', '20 Doing', 1), card('c', '10 Todo', 2)],
            columns
        )
        expect(board.columns.map((c) => c.column.id)).toEqual(['10 Todo', '20 Doing', '30 Done'])
        expect(board.columns[0]?.cards.map((c) => c.key)).toEqual(['a', 'c'])
        expect(board.columns[1]?.cards.map((c) => c.key)).toEqual(['b'])
        expect(board.columns[2]?.cards).toEqual([])
    })

    it('sorts within a column by order, unset last, tie-broken by key', () => {
        const board = buildSingleLaneBoard(
            [
                card('z', '10 Todo', 20),
                card('a', '10 Todo', null),
                card('m', '10 Todo', 10),
                card('b', '10 Todo', null)
            ],
            columns
        )
        expect(board.columns[0]?.cards.map((c) => c.key)).toEqual(['m', 'z', 'a', 'b'])
    })

    it('collects unknown/missing status into Unmapped, placed first by default', () => {
        const board = buildSingleLaneBoard(
            [card('a', 'Mystery', 1), card('b', null, 2), card('c', '10 Todo', 1)],
            columns
        )
        const first = board.columns[0]
        expect(first?.column.id).toBe(UNMAPPED_COLUMN_ID)
        expect(first?.cards.map((c) => c.key)).toEqual(['a', 'b'])
    })

    it('can place Unmapped last when requested', () => {
        const board = buildSingleLaneBoard([card('a', 'Mystery', 1)], columns, 'last')
        const last = board.columns[board.columns.length - 1]
        expect(last?.column.id).toBe(UNMAPPED_COLUMN_ID)
    })

    it('hides the Unmapped column when empty', () => {
        const board = buildSingleLaneBoard([card('a', '10 Todo', 1)], columns)
        expect(board.columns.some((c) => c.column.id === UNMAPPED_COLUMN_ID)).toBe(false)
    })
})

function lcard(
    key: string,
    statusValue: string | null,
    order: number | null,
    laneValue: string | null
): BoardCardBase {
    return { key, statusValue, order, laneValue }
}

describe('buildBoard', () => {
    it('builds a single chrome-free lane when grouping is off', () => {
        const board = buildBoard([card('a', '10 Todo', 1), card('b', '20 Doing', 1)], columns, {
            grouped: false
        })
        expect(board.isMultiLane).toBe(false)
        expect(board.lanes).toHaveLength(1)
        expect(board.lanes[0]?.lane.id).toBe('')
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual([
            '10 Todo',
            '20 Doing',
            '30 Done'
        ])
    })

    it('splits cards into one lane per distinct grouping value, ordered by prefix', () => {
        const board = buildBoard(
            [
                lcard('a', '10 Todo', 1, '20 Project B'),
                lcard('b', '10 Todo', 1, '10 Project A'),
                lcard('c', '20 Doing', 1, '10 Project A')
            ],
            columns,
            { grouped: true }
        )
        expect(board.isMultiLane).toBe(true)
        expect(board.lanes.map((l) => l.lane.label)).toEqual(['Project A', 'Project B'])
        expect(board.lanes[0]?.cardCount).toBe(2)
        expect(board.lanes[1]?.cardCount).toBe(1)
    })

    it('collects missing grouping values into the Ungrouped lane, placed last', () => {
        const board = buildBoard(
            [lcard('a', '10 Todo', 1, 'Alpha'), lcard('b', '10 Todo', 1, null)],
            columns,
            { grouped: true }
        )
        const last = board.lanes[board.lanes.length - 1]
        expect(last?.lane.id).toBe(UNGROUPED_LANE_ID)
        expect(last?.lane.isUngrouped).toBe(true)
        expect(last?.cardCount).toBe(1)
    })

    it('can place the Ungrouped lane first', () => {
        const board = buildBoard(
            [lcard('a', '10 Todo', 1, 'Alpha'), lcard('b', '10 Todo', 1, null)],
            columns,
            { grouped: true, ungroupedPosition: 'first' }
        )
        expect(board.lanes[0]?.lane.id).toBe(UNGROUPED_LANE_ID)
    })

    it('stays chrome-free when grouping resolves to a single lane', () => {
        const board = buildBoard(
            [lcard('a', '10 Todo', 1, 'Solo'), lcard('b', '20 Doing', 1, 'Solo')],
            columns,
            { grouped: true }
        )
        expect(board.isMultiLane).toBe(false)
        expect(board.lanes).toHaveLength(1)
    })

    it('treats empty-string grouping values as Ungrouped', () => {
        const board = buildBoard(
            [lcard('a', '10 Todo', 1, ''), lcard('b', '10 Todo', 1, 'Alpha')],
            columns,
            { grouped: true }
        )
        const ungrouped = board.lanes.find((l) => l.lane.id === UNGROUPED_LANE_ID)
        expect(ungrouped?.cardCount).toBe(1)
    })
})
