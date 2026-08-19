import { describe, expect, it } from 'bun:test'
import {
    buildBoard,
    buildSingleLaneBoard,
    restrictBoardColumns,
    restrictBoardLanes
} from './board-model'
import type { BoardCardBase, NameMatcher } from './board-model'
import type { ColumnDef } from './note-type'
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

    it('sorts in-column cards with a custom comparator when provided (issue #17)', () => {
        // Manual order would give a, b, c; the custom comparator sorts by key desc.
        const board = buildBoard(
            [card('a', '10 Todo', 1), card('b', '10 Todo', 2), card('c', '10 Todo', 3)],
            columns,
            { grouped: false, compare: (x, y) => y.key.localeCompare(x.key) }
        )
        const todo = board.lanes[0]?.columns.find((c) => c.column.id === '10 Todo')
        expect(todo?.cards.map((c) => c.key)).toEqual(['c', 'b', 'a'])
    })

    it('defaults to manual order when no comparator is given', () => {
        const board = buildBoard(
            [card('a', '10 Todo', 3), card('b', '10 Todo', 1), card('c', '10 Todo', 2)],
            columns,
            { grouped: false }
        )
        const todo = board.lanes[0]?.columns.find((c) => c.column.id === '10 Todo')
        expect(todo?.cards.map((c) => c.key)).toEqual(['b', 'c', 'a'])
    })
})

describe('buildBoard per-lane column sets (columnsForLane)', () => {
    const actionColumns: ColumnDef[] = ['10 Todo', '20 Doing', '30 Done'].map(column)
    const ideaColumns: ColumnDef[] = ['10 Raw', '20 Refined'].map(column)
    const columnsForLane = (laneId: string): ReadonlyArray<ColumnDef> =>
        laneId === 'Idea' ? ideaColumns : actionColumns

    it('gives each grouped lane its own column set', () => {
        const board = buildBoard(
            [lcard('a', '10 Todo', 1, 'Action'), lcard('i', '10 Raw', 1, 'Idea')],
            actionColumns,
            { grouped: true, columnsForLane }
        )
        const action = board.lanes.find((l) => l.lane.id === 'Action')
        const idea = board.lanes.find((l) => l.lane.id === 'Idea')
        expect(action?.columns.map((c) => c.column.id)).toEqual(['10 Todo', '20 Doing', '30 Done'])
        expect(idea?.columns.map((c) => c.column.id)).toEqual(['10 Raw', '20 Refined'])
        expect(idea?.columns[0]?.cards.map((c) => c.key)).toEqual(['i'])
    })

    it('falls back to the shared columns when the hook is absent', () => {
        const board = buildBoard(
            [lcard('a', '10 Todo', 1, 'Action'), lcard('i', '10 Raw', 1, 'Idea')],
            actionColumns,
            { grouped: true }
        )
        for (const lane of board.lanes) {
            expect(
                lane.columns.map((c) => c.column.id).filter((id) => id !== UNMAPPED_COLUMN_ID)
            ).toEqual(['10 Todo', '20 Doing', '30 Done'])
        }
        // 'i' has a status foreign to the shared set → Unmapped in its lane.
        const idea = board.lanes.find((l) => l.lane.id === 'Idea')
        expect(idea?.columns[0]?.column.id).toBe(UNMAPPED_COLUMN_ID)
    })

    it("buckets Unmapped against each lane's own column set", () => {
        // '10 Todo' is a real column for Action but unknown to Idea, and vice versa.
        const board = buildBoard(
            [lcard('a', '10 Raw', 1, 'Action'), lcard('i', '10 Todo', 1, 'Idea')],
            actionColumns,
            { grouped: true, columnsForLane }
        )
        const action = board.lanes.find((l) => l.lane.id === 'Action')
        const idea = board.lanes.find((l) => l.lane.id === 'Idea')
        expect(action?.columns[0]?.column.id).toBe(UNMAPPED_COLUMN_ID)
        expect(action?.columns[0]?.cards.map((c) => c.key)).toEqual(['a'])
        expect(idea?.columns[0]?.column.id).toBe(UNMAPPED_COLUMN_ID)
        expect(idea?.columns[0]?.cards.map((c) => c.key)).toEqual(['i'])
    })

    it('consults the hook for the Ungrouped lane via UNGROUPED_LANE_ID', () => {
        const shared: ColumnDef[] = ['10 Shared'].map(column)
        const board = buildBoard(
            [lcard('a', '10 Raw', 1, 'Idea'), lcard('u', '10 Shared', 1, null)],
            shared,
            {
                grouped: true,
                columnsForLane: (laneId) => (laneId === UNGROUPED_LANE_ID ? shared : ideaColumns)
            }
        )
        const ungrouped = board.lanes.find((l) => l.lane.id === UNGROUPED_LANE_ID)
        expect(ungrouped?.columns.map((c) => c.column.id)).toEqual(['10 Shared'])
        expect(ungrouped?.columns[0]?.cards.map((c) => c.key)).toEqual(['u'])
    })

    it('ignores the hook when grouping is off (single shared lane)', () => {
        const board = buildBoard([card('a', '10 Todo', 1)], actionColumns, {
            grouped: false,
            columnsForLane: () => ideaColumns
        })
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual([
            '10 Todo',
            '20 Doing',
            '30 Done'
        ])
    })
})

/** Substring name terms, the default for `columns=` / `lanes=`. */
const sub = (...names: string[]): NameMatcher[] => names.map((text) => ({ text, exact: false }))

/** Whole-name terms, written `=name` in an embed alias. */
const exact = (...names: string[]): NameMatcher[] => names.map((text) => ({ text, exact: true }))

describe('restrictBoardColumns', () => {
    const cards = [card('a', '10 Todo', 1), card('b', '20 Doing', 1), card('c', 'Mystery', 1)]

    it('returns the board unchanged for empty terms', () => {
        const board = buildBoard(cards, columns, { grouped: false })
        expect(restrictBoardColumns(board, [])).toBe(board)
    })

    it('keeps only columns matching a term (case-insensitive substring)', () => {
        const board = restrictBoardColumns(
            buildBoard(cards, columns, { grouped: false }),
            sub('todo')
        )
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual(['10 Todo'])
        expect(board.lanes[0]?.columns[0]?.cards.map((c) => c.key)).toEqual(['a'])
    })

    it('matches the full status value as well as the label', () => {
        const board = restrictBoardColumns(
            buildBoard(cards, columns, { grouped: false }),
            sub('20 Doing')
        )
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual(['20 Doing'])
    })

    it('keeps a set of columns, preserving board order', () => {
        const board = restrictBoardColumns(
            buildBoard(cards, columns, { grouped: false }),
            sub('done', 'todo')
        )
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual(['10 Todo', '30 Done'])
    })

    it('matches the synthetic Unmapped column by label', () => {
        const board = restrictBoardColumns(
            buildBoard(cards, columns, { grouped: false }),
            sub('unmapped')
        )
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual([UNMAPPED_COLUMN_ID])
        expect(board.lanes[0]?.columns[0]?.cards.map((c) => c.key)).toEqual(['c'])
    })

    it('yields empty lanes when nothing matches (typo stays visible)', () => {
        const board = restrictBoardColumns(
            buildBoard(cards, columns, { grouped: false }),
            sub('nope')
        )
        expect(board.lanes[0]?.columns).toEqual([])
    })

    it('matches the whole status value or label for an exact term', () => {
        const board = restrictBoardColumns(
            buildBoard(cards, columns, { grouped: false }),
            exact('20 Doing')
        )
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual(['20 Doing'])
        // The label alone ("Doing", once the numeric prefix is split off) also matches whole.
        expect(
            restrictBoardColumns(
                buildBoard(cards, columns, { grouped: false }),
                exact('doing')
            ).lanes[0]?.columns.map((c) => c.column.id)
        ).toEqual(['20 Doing'])
    })

    it('rejects a partial name for an exact term (the point of the prefix)', () => {
        // `do` as a substring sweeps up every column whose label contains it.
        expect(
            restrictBoardColumns(
                buildBoard(cards, columns, { grouped: false }),
                sub('do')
            ).lanes[0]?.columns.map((c) => c.column.id)
        ).toEqual(['10 Todo', '20 Doing', '30 Done'])
        // Exact keeps nothing: no column is named exactly "do".
        expect(
            restrictBoardColumns(buildBoard(cards, columns, { grouped: false }), exact('do'))
                .lanes[0]?.columns
        ).toEqual([])
    })

    it('mixes exact and substring terms in one restriction', () => {
        const board = restrictBoardColumns(buildBoard(cards, columns, { grouped: false }), [
            ...exact('20 Doing'),
            ...sub('done')
        ])
        expect(board.lanes[0]?.columns.map((c) => c.column.id)).toEqual(['20 Doing', '30 Done'])
    })

    it('applies per lane on a grouped board and keeps lane cardCount intact', () => {
        const grouped = buildBoard(
            [
                { ...card('a', '10 Todo', 1), laneValue: 'L1' },
                { ...card('b', '20 Doing', 1), laneValue: 'L1' },
                { ...card('c', '10 Todo', 1), laneValue: 'L2' }
            ],
            columns,
            { grouped: true }
        )
        const board = restrictBoardColumns(grouped, sub('doing'))
        expect(board.isMultiLane).toBe(true)
        for (const lane of board.lanes) {
            expect(lane.columns.every((c) => c.column.id === '20 Doing')).toBe(true)
        }
        expect(board.lanes[0]?.cardCount).toBe(2)
        expect(board.lanes[1]?.cardCount).toBe(1)
    })
})

describe('restrictBoardLanes', () => {
    const lanedCards = [
        { ...card('a', '10 Todo', 1), laneValue: '10 Work' },
        { ...card('b', '20 Doing', 1), laneValue: '20 Home' },
        { ...card('c', '10 Todo', 1) }
    ]

    it('returns the board unchanged for empty terms', () => {
        const board = buildBoard(lanedCards, columns, { grouped: true })
        expect(restrictBoardLanes(board, [])).toBe(board)
    })

    it('keeps only lanes matching a term (case-insensitive substring on the label)', () => {
        const board = restrictBoardLanes(
            buildBoard(lanedCards, columns, { grouped: true }),
            sub('home')
        )
        expect(board.lanes.map((l) => l.lane.label)).toEqual(['Home'])
        expect(board.isMultiLane).toBe(false) // single remaining lane renders chrome-free
    })

    it('keeps a lane subset and stays multi-lane', () => {
        const board = restrictBoardLanes(
            buildBoard(lanedCards, columns, { grouped: true }),
            sub('work', 'home')
        )
        expect(board.lanes.map((l) => l.lane.label)).toEqual(['Work', 'Home'])
        expect(board.isMultiLane).toBe(true)
    })

    it('matches the Ungrouped catch-all lane by label', () => {
        const board = restrictBoardLanes(
            buildBoard(lanedCards, columns, { grouped: true }),
            sub('ungrouped')
        )
        expect(board.lanes.map((l) => l.lane.id)).toEqual([UNGROUPED_LANE_ID])
    })

    it('matches the whole lane label for an exact term', () => {
        const build = () => buildBoard(lanedCards, columns, { grouped: true })
        expect(restrictBoardLanes(build(), exact('Work')).lanes.map((l) => l.lane.label)).toEqual([
            'Work'
        ])
        // A partial label no longer matches once the term is exact.
        expect(restrictBoardLanes(build(), sub('wor')).lanes.map((l) => l.lane.label)).toEqual([
            'Work'
        ])
        expect(restrictBoardLanes(build(), exact('wor')).lanes).toEqual([])
    })

    it('yields an empty board when nothing matches (typo stays visible)', () => {
        const board = restrictBoardLanes(
            buildBoard(lanedCards, columns, { grouped: true }),
            sub('nope')
        )
        expect(board.lanes).toEqual([])
        expect(board.isMultiLane).toBe(false)
    })
})
