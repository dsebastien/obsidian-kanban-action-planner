import type { ColorSpec, ColumnDef } from './note-type'
import { compareStatusValues, resolveColumnId, splitStatusValue } from './status'
import { UNGROUPED_LANE_ID, UNMAPPED_COLUMN_ID } from '../constants'

/**
 * Pure board assembly: bucket cards into lanes/columns and sort within each.
 *
 * Generic over the card type so it can be unit-tested with plain objects; the
 * view passes runtime cards that also carry a `TFile`. Only `statusValue`,
 * `order`, and `laneValue` are read here.
 */
export interface BoardCardBase {
    /** Stable per-card key (the note path). */
    key: string
    statusValue: string | null
    /** Manual order from the note, or `null` when unset. */
    order: number | null
    /**
     * The swimlane grouping value (a note-type name or a property value), or
     * `null`/absent when the card has no grouping value (→ Ungrouped lane) or
     * grouping is off.
     */
    laneValue?: string | null
}

export interface BoardColumn<T extends BoardCardBase> {
    column: ColumnDef
    cards: T[]
}

export interface SingleLaneBoard<T extends BoardCardBase> {
    columns: BoardColumn<T>[]
}

/** A swimlane: a grouping value plus its own bucketed columns. */
export interface LaneDef {
    /** The lane's grouping value, or `UNGROUPED_LANE_ID` for the catch-all lane. */
    id: string
    label: string
    isUngrouped: boolean
}

export interface BoardLane<T extends BoardCardBase> {
    lane: LaneDef
    columns: BoardColumn<T>[]
    cardCount: number
}

/**
 * The rendered board. With grouping off (or when grouping resolves to a single
 * lane) `isMultiLane` is `false` and the renderer draws the lane chrome-free;
 * otherwise it draws one swimlane per lane.
 */
export interface Board<T extends BoardCardBase> {
    lanes: BoardLane<T>[]
    isMultiLane: boolean
}

/** The implicit single-lane id used when grouping is off. */
const SINGLE_LANE_ID = ''

const UNMAPPED_COLOR: ColorSpec = { kind: 'palette', token: 'unmapped' }

/** The synthetic column collecting cards with missing/unknown status. */
function unmappedColumn(): ColumnDef {
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

/** Where the Unmapped column sits relative to the status columns. */
export type UnmappedPosition = 'first' | 'last'

/**
 * Bucket cards into one column per known column (in column order), plus an
 * Unmapped bucket included ONLY when it has cards. The Unmapped column goes
 * first by default (left-to-right flow: Unmapped → Todo → … → Done).
 */
function bucketColumns<T extends BoardCardBase>(
    cards: ReadonlyArray<T>,
    columns: ReadonlyArray<ColumnDef>,
    unmappedPosition: UnmappedPosition,
    compare: (a: T, b: T) => number
): BoardColumn<T>[] {
    const knownIds = new Set(columns.map((c) => c.id))
    const buckets = new Map<string, T[]>()
    for (const c of columns) buckets.set(c.id, [])
    const unmapped: T[] = []

    for (const card of cards) {
        const columnId = resolveColumnId(card.statusValue, knownIds)
        if (columnId === UNMAPPED_COLUMN_ID) unmapped.push(card)
        else (buckets.get(columnId) as T[]).push(card)
    }

    const mapped: BoardColumn<T>[] = columns.map((column) => ({
        column,
        cards: (buckets.get(column.id) as T[]).slice().sort(compare)
    }))

    if (unmapped.length === 0) return mapped

    const unmappedBucket: BoardColumn<T> = {
        column: unmappedColumn(),
        cards: unmapped.slice().sort(compare)
    }
    return unmappedPosition === 'first' ? [unmappedBucket, ...mapped] : [...mapped, unmappedBucket]
}

/**
 * Build a single-lane board (grouping off). Kept as the primitive the
 * multi-lane builder reuses for each lane.
 */
export function buildSingleLaneBoard<T extends BoardCardBase>(
    cards: ReadonlyArray<T>,
    columns: ReadonlyArray<ColumnDef>,
    unmappedPosition: UnmappedPosition = 'first',
    compare: (a: T, b: T) => number = compareCards
): SingleLaneBoard<T> {
    return { columns: bucketColumns(cards, columns, unmappedPosition, compare) }
}

/** Where the Ungrouped lane sits relative to the real lanes. */
export type UngroupedPosition = 'first' | 'last'

export interface BuildBoardOptions<T extends BoardCardBase = BoardCardBase> {
    /** When false, a single chrome-free lane holds every card. */
    grouped: boolean
    unmappedPosition?: UnmappedPosition
    ungroupedPosition?: UngroupedPosition
    /**
     * In-column card comparator. Defaults to manual order (issue #4); the view
     * passes a property/name comparator for non-manual sorts (issue #17).
     */
    compare?: (a: T, b: T) => number
}

/**
 * Build the board. With `grouped: false`, every card lands in one implicit lane
 * (`isMultiLane: false`). With `grouped: true`, cards are split into one lane per
 * distinct `laneValue` (ordered by numeric/lexical prefix), plus an `Ungrouped`
 * lane for missing values — included only when non-empty and placed last by
 * default. Grouping that yields a single lane stays chrome-free
 * (`isMultiLane: false`).
 */
export function buildBoard<T extends BoardCardBase>(
    cards: ReadonlyArray<T>,
    columns: ReadonlyArray<ColumnDef>,
    options: BuildBoardOptions<T>
): Board<T> {
    const unmappedPosition = options.unmappedPosition ?? 'first'
    const compare = options.compare ?? compareCards

    if (!options.grouped) {
        return {
            isMultiLane: false,
            lanes: [
                singleLane(SINGLE_LANE_ID, '', false, cards, columns, unmappedPosition, compare)
            ]
        }
    }

    const groups = new Map<string, T[]>()
    const ungrouped: T[] = []
    for (const card of cards) {
        const value = card.laneValue
        if (value === null || value === undefined || value === '') ungrouped.push(card)
        else {
            const bucket = groups.get(value)
            if (bucket) bucket.push(card)
            else groups.set(value, [card])
        }
    }

    const orderedValues = Array.from(groups.keys()).sort(compareStatusValues)
    const lanes: BoardLane<T>[] = orderedValues.map((value) =>
        singleLane(
            value,
            splitStatusValue(value).label,
            false,
            groups.get(value) as T[],
            columns,
            unmappedPosition,
            compare
        )
    )

    if (ungrouped.length > 0) {
        const ungroupedLane = singleLane(
            UNGROUPED_LANE_ID,
            'Ungrouped',
            true,
            ungrouped,
            columns,
            unmappedPosition,
            compare
        )
        if (options.ungroupedPosition === 'first') lanes.unshift(ungroupedLane)
        else lanes.push(ungroupedLane)
    }

    return { isMultiLane: lanes.length > 1, lanes }
}

function singleLane<T extends BoardCardBase>(
    id: string,
    label: string,
    isUngrouped: boolean,
    cards: ReadonlyArray<T>,
    columns: ReadonlyArray<ColumnDef>,
    unmappedPosition: UnmappedPosition,
    compare: (a: T, b: T) => number
): BoardLane<T> {
    return {
        lane: { id, label, isUngrouped },
        columns: bucketColumns(cards, columns, unmappedPosition, compare),
        cardCount: cards.length
    }
}
