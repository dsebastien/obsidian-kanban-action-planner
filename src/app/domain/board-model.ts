import type { ColorSpec, ColumnDef } from './profile'
import { resolveColumnId } from './status'
import { UNMAPPED_COLUMN_ID } from '../constants'

/**
 * Pure board assembly: bucket cards into columns and sort within each.
 *
 * Generic over the card type so it can be unit-tested with plain objects; the
 * view passes runtime cards that also carry a `TFile`. Only `statusValue` and
 * `order` are read here.
 */
export interface BoardCardBase {
    /** Stable per-card key (the note path). */
    key: string
    statusValue: string | null
    /** Manual order from the note, or `null` when unset. */
    order: number | null
}

export interface BoardColumn<T extends BoardCardBase> {
    column: ColumnDef
    cards: T[]
}

export interface SingleLaneBoard<T extends BoardCardBase> {
    columns: BoardColumn<T>[]
}

const UNMAPPED_COLOR: ColorSpec = { kind: 'palette', token: 'unmapped' }

/** The synthetic column collecting cards with missing/unknown status. */
export function unmappedColumn(): ColumnDef {
    return {
        id: UNMAPPED_COLUMN_ID,
        statusValue: '',
        label: 'Unmapped',
        sortKey: '￿', // always sorts last among real columns if ever mixed
        color: UNMAPPED_COLOR
    }
}

/** Cards sort by `order` ascending (unset last), tie-broken by key. */
function compareCards<T extends BoardCardBase>(a: T, b: T): number {
    if (a.order === null && b.order === null) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    if (a.order === null) return 1
    if (b.order === null) return -1
    if (a.order !== b.order) return a.order - b.order
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Build a single-lane board: one bucket per known column (in column order),
 * plus an Unmapped bucket appended ONLY when it has cards.
 */
export function buildSingleLaneBoard<T extends BoardCardBase>(
    cards: ReadonlyArray<T>,
    columns: ReadonlyArray<ColumnDef>
): SingleLaneBoard<T> {
    const knownIds = new Set(columns.map((c) => c.id))
    const buckets = new Map<string, T[]>()
    for (const c of columns) buckets.set(c.id, [])
    const unmapped: T[] = []

    for (const card of cards) {
        const columnId = resolveColumnId(card.statusValue, knownIds)
        if (columnId === UNMAPPED_COLUMN_ID) unmapped.push(card)
        else (buckets.get(columnId) as T[]).push(card)
    }

    const result: BoardColumn<T>[] = columns.map((column) => ({
        column,
        cards: (buckets.get(column.id) as T[]).slice().sort(compareCards)
    }))

    if (unmapped.length > 0) {
        result.push({ column: unmappedColumn(), cards: unmapped.slice().sort(compareCards) })
    }

    return { columns: result }
}
