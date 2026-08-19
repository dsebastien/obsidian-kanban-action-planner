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
    /**
     * Per-lane column sets (mixed-type boards): given a lane id (the grouping
     * value, or `UNGROUPED_LANE_ID` for the catch-all lane), return that lane's
     * columns. Falls back to the shared `columns` argument when absent or when
     * grouping is off. Unmapped bucketing is evaluated against each lane's own
     * column set.
     */
    columnsForLane?: (laneId: string) => ReadonlyArray<ColumnDef>
}

/**
 * Build the board. With `grouped: false`, every card lands in one implicit lane
 * (`isMultiLane: false`). With `grouped: true`, cards are split into one lane per
 * distinct `laneValue` (ordered by numeric/lexical prefix), plus an `Ungrouped`
 * lane for missing values — included only when non-empty and placed last by
 * default. Grouping that yields a single lane stays chrome-free
 * (`isMultiLane: false`). When `columnsForLane` is provided, each grouped lane
 * gets its own column set (mixed-type boards); otherwise every lane shares
 * `columns`.
 */
export function buildBoard<T extends BoardCardBase>(
    cards: ReadonlyArray<T>,
    columns: ReadonlyArray<ColumnDef>,
    options: BuildBoardOptions<T>
): Board<T> {
    const unmappedPosition = options.unmappedPosition ?? 'first'
    const compare = options.compare ?? compareCards
    const columnsFor = (laneId: string): ReadonlyArray<ColumnDef> =>
        options.columnsForLane?.(laneId) ?? columns

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
            columnsFor(value),
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
            columnsFor(UNGROUPED_LANE_ID),
            unmappedPosition,
            compare
        )
        if (options.ungroupedPosition === 'first') lanes.unshift(ungroupedLane)
        else lanes.push(ungroupedLane)
    }

    return { isMultiLane: lanes.length > 1, lanes }
}

/**
 * One name term used to restrict a board's columns or swimlanes.
 *
 * `exact: false` (the default, written `doing`) matches the name as a
 * case-insensitive SUBSTRING — convenient, but `do` then matches both "Todo"
 * and "Doing". `exact: true` (written `=doing` in an embed alias) requires the
 * whole status value or label to be equal, case-insensitively, which is the
 * way to disambiguate names that contain one another.
 */
export interface NameMatcher {
    /** The name to match, with its original casing and no `=` prefix. */
    text: string
    /** Whole-name equality instead of substring containment. */
    exact: boolean
}

/** Case-insensitive match of one already-lowercased candidate against a term. */
function matchesTerm(candidate: string, term: NameMatcher, needle: string): boolean {
    return term.exact ? candidate === needle : candidate.includes(needle)
}

/**
 * Restrict a built board to the columns matching any of `terms` (issue #128:
 * embedding a single column or a column subset). A term matches
 * case-insensitively against the column's status value or label — as a
 * substring by default (`todo` matches a "10 TODO" column, `unmapped` matches
 * the synthetic Unmapped bucket), or as a whole-name equality when
 * `exact` is set (issue #134), so `10 TODO` can be selected without also
 * pulling in "10 TODO REVIEW". Applied per lane; lane `cardCount` keeps
 * counting the lane's full card set — only the rendered columns shrink. Empty
 * `terms` returns the board unchanged; terms matching nothing yield empty
 * lanes (visible feedback for a typo rather than a silently ignored override).
 */
export function restrictBoardColumns<T extends BoardCardBase>(
    board: Board<T>,
    terms: ReadonlyArray<NameMatcher>
): Board<T> {
    if (terms.length === 0) return board
    const needles = terms.map((t) => t.text.toLowerCase())
    const matches = (column: ColumnDef): boolean => {
        const value = column.statusValue.toLowerCase()
        const label = column.label.toLowerCase()
        return terms.some((term, i) => {
            const needle = needles[i] ?? ''
            return matchesTerm(value, term, needle) || matchesTerm(label, term, needle)
        })
    }
    return {
        isMultiLane: board.isMultiLane,
        lanes: board.lanes.map((lane) => ({
            ...lane,
            columns: lane.columns.filter((c) => matches(c.column))
        }))
    }
}

/**
 * Restrict a built board to the swimlanes matching any of `terms` (issue
 * #131: embedding a single lane or a lane subset). A term is matched
 * case-insensitively against the lane label (`ungrouped` matches the
 * catch-all lane's label) — as a substring by default, or as a whole-label
 * equality when `exact` is set (issue #134). `isMultiLane` is recomputed, so
 * a restriction resolving to a single lane renders chrome-free like a
 * naturally single-lane board. Empty `terms` returns the board unchanged;
 * terms matching nothing yield an empty board (visible feedback for a typo).
 */
export function restrictBoardLanes<T extends BoardCardBase>(
    board: Board<T>,
    terms: ReadonlyArray<NameMatcher>
): Board<T> {
    if (terms.length === 0) return board
    const needles = terms.map((t) => t.text.toLowerCase())
    const lanes = board.lanes.filter((lane) => {
        const label = lane.lane.label.toLowerCase()
        return terms.some((term, i) => matchesTerm(label, term, needles[i] ?? ''))
    })
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
