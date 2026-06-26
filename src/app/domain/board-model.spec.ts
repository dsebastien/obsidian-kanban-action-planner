import { describe, expect, it } from 'bun:test'
import { buildSingleLaneBoard } from './board-model'
import type { BoardCardBase } from './board-model'
import { deriveColumns } from './status'
import { UNMAPPED_COLUMN_ID } from '../constants'

const columns = deriveColumns(['10 Todo', '20 Doing', '30 Done'])

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
