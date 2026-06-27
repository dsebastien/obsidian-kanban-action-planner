import type { Board, BoardColumn, BoardLane } from '../../domain/board-model'
import type { RelationshipRole } from '../../domain/profile'
import { columnHeaderShade, columnShade, resolveColor } from '../../services/colors.service'
import type { KanbanCard } from './types'
import { renderCard } from './card-renderer'
import { planReconcile } from './reconcile'

export interface BoardRenderCallbacks {
    onOpen: (card: KanbanCard, newTab: boolean) => void
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
    /** Toggle a swimlane's collapsed state (multi-lane boards only). */
    onToggleLane?: (laneId: string) => void
    /** Activate a card relationship badge. */
    onRelationship?: (card: KanbanCard, role: RelationshipRole, event: MouseEvent) => void
}

/** `data-board-struct` records the rendered lane/column shape for patch vs full-render. */
const STRUCT_ATTR = 'boardStruct'

/**
 * Render the board into `rootEl` (full render). A single-lane board draws columns
 * chrome-free; a multi-lane board draws one collapsible swimlane per lane.
 *
 * Column `data-column-id` + `data-lane-id`, card `data-card-key` + `data-card-sig`
 * attributes are the contract the DnD controller and the incremental
 * {@link patchBoard} reconciler rely on.
 */
export function renderBoard(
    rootEl: HTMLElement,
    board: Board<KanbanCard>,
    callbacks: BoardRenderCallbacks,
    collapsedLanes: ReadonlySet<string> = new Set()
): void {
    rootEl.empty()
    delete rootEl.dataset[STRUCT_ATTR]

    const hasColumns = board.lanes.some((l) => l.columns.length > 0)
    if (!hasColumns) {
        rootEl.createDiv({ cls: 'kap-empty', text: 'No notes match this view.' })
        return
    }

    if (!board.isMultiLane) {
        const lane = board.lanes[0]
        const boardEl = rootEl.createDiv({ cls: 'kap-board' })
        if (lane) renderColumns(boardEl, lane.columns, callbacks, lane.lane.id)
    } else {
        const lanesEl = rootEl.createDiv({ cls: 'kap-lanes' })
        for (const lane of board.lanes) renderLane(lanesEl, lane, callbacks, collapsedLanes)
    }

    rootEl.dataset[STRUCT_ATTR] = structureSignature(board)
}

/**
 * Incrementally update the board in place: when the lane/column **shape** is
 * unchanged, only add/remove/move/rebuild the affected card nodes (so scroll
 * position, focus, in-flight drag, and untouched cards keep their identity).
 * Falls back to a full {@link renderBoard} when the shape changed (config edit,
 * a new status column, calendar↔board switch, the empty state).
 */
export function patchBoard(
    rootEl: HTMLElement,
    board: Board<KanbanCard>,
    callbacks: BoardRenderCallbacks,
    collapsedLanes: ReadonlySet<string> = new Set()
): void {
    const hasBoardDom = rootEl.querySelector(':scope > .kap-board, :scope > .kap-lanes') !== null
    const hasColumns = board.lanes.some((l) => l.columns.length > 0)
    if (!hasBoardDom || !hasColumns || rootEl.dataset[STRUCT_ATTR] !== structureSignature(board)) {
        renderBoard(rootEl, board, callbacks, collapsedLanes)
        return
    }

    if (!board.isMultiLane) {
        const boardEl = rootEl.querySelector<HTMLElement>(':scope > .kap-board')
        const lane = board.lanes[0]
        if (boardEl && lane) patchColumns(boardEl, lane.columns, callbacks)
        return
    }

    for (const lane of board.lanes) {
        const laneEl = rootEl.querySelector<HTMLElement>(
            `:scope > .kap-lanes > .kap-lane[data-lane-id="${cssEscape(lane.lane.id)}"]`
        )
        if (!laneEl) continue
        syncLaneChrome(laneEl, lane, collapsedLanes)
        const boardEl = laneEl.querySelector<HTMLElement>('.kap-board')
        if (boardEl) patchColumns(boardEl, lane.columns, callbacks)
    }
}

/** A stable signature of the board's lane/column shape (not card contents). */
function structureSignature(board: Board<KanbanCard>): string {
    const lanes = board.lanes
        .map((l) => `${l.lane.id}:${l.columns.map((c) => c.column.id).join(',')}`)
        .join(';')
    return `${board.isMultiLane ? 'M' : 'S'}|${lanes}`
}

function renderLane(
    lanesEl: HTMLElement,
    lane: BoardLane<KanbanCard>,
    callbacks: BoardRenderCallbacks,
    collapsedLanes: ReadonlySet<string>
): void {
    const collapsed = collapsedLanes.has(lane.lane.id)
    const laneEl = lanesEl.createDiv({ cls: 'kap-lane' })
    laneEl.dataset['laneId'] = lane.lane.id
    if (collapsed) laneEl.addClass('kap-lane-collapsed')

    const header = laneEl.createDiv({ cls: 'kap-lane-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-lane-toggle',
        text: collapsed ? '▸' : '▾',
        attr: { 'aria-label': collapsed ? 'Expand lane' : 'Collapse lane' }
    })
    toggle.addEventListener('click', () => callbacks.onToggleLane?.(lane.lane.id))
    header.createSpan({ cls: 'kap-lane-title', text: lane.lane.label })
    header.createSpan({ cls: 'kap-lane-count', text: String(lane.cardCount) })

    const body = laneEl.createDiv({ cls: 'kap-lane-body' })
    const boardEl = body.createDiv({ cls: 'kap-board' })
    renderColumns(boardEl, lane.columns, callbacks, lane.lane.id)
}

/** Update a lane's collapse state, toggle glyph, and card count in place. */
function syncLaneChrome(
    laneEl: HTMLElement,
    lane: BoardLane<KanbanCard>,
    collapsedLanes: ReadonlySet<string>
): void {
    const collapsed = collapsedLanes.has(lane.lane.id)
    laneEl.toggleClass('kap-lane-collapsed', collapsed)
    const toggle = laneEl.querySelector<HTMLElement>('.kap-lane-toggle')
    if (toggle) {
        toggle.setText(collapsed ? '▸' : '▾')
        toggle.setAttribute('aria-label', collapsed ? 'Expand lane' : 'Collapse lane')
    }
    laneEl.querySelector('.kap-lane-count')?.setText(String(lane.cardCount))
}

/** Render one lane's columns (with cards) into `boardEl` (full render). */
function renderColumns(
    boardEl: HTMLElement,
    columns: ReadonlyArray<BoardColumn<KanbanCard>>,
    callbacks: BoardRenderCallbacks,
    laneId: string
): void {
    for (const { column, cards } of columns) {
        const accent = resolveColor(column.color)
        const colEl = boardEl.createDiv({ cls: 'kap-column' })
        colEl.dataset['columnId'] = column.id
        colEl.dataset['laneId'] = laneId
        colEl.style.background = columnShade(accent)

        const header = colEl.createDiv({ cls: 'kap-column-header' })
        header.style.background = columnHeaderShade(accent)
        header.createSpan({ cls: 'kap-column-title', text: column.label })
        header.createSpan({ cls: 'kap-column-count', text: String(cards.length) })

        const listEl = colEl.createDiv({ cls: 'kap-column-cards' })
        listEl.setAttribute('role', 'list')
        for (const card of cards) listEl.appendChild(buildCardNode(card, accent, callbacks))
    }
}

/** Patch each column's card list in place against the desired cards. */
function patchColumns(
    boardEl: HTMLElement,
    columns: ReadonlyArray<BoardColumn<KanbanCard>>,
    callbacks: BoardRenderCallbacks
): void {
    for (const { column, cards } of columns) {
        const colEl = boardEl.querySelector<HTMLElement>(
            `:scope > .kap-column[data-column-id="${cssEscape(column.id)}"]`
        )
        const listEl = colEl?.querySelector<HTMLElement>('.kap-column-cards')
        if (!colEl || !listEl) continue
        const accent = resolveColor(column.color)
        patchColumnCards(listEl, cards, accent, callbacks)
        colEl.querySelector('.kap-column-count')?.setText(String(cards.length))
    }
}

/** Keyed reconcile of a single column's card nodes (the heart of the patch). */
function patchColumnCards(
    listEl: HTMLElement,
    cards: ReadonlyArray<KanbanCard>,
    accent: string,
    callbacks: BoardRenderCallbacks
): void {
    const existingEls = Array.from(listEl.querySelectorAll<HTMLElement>(':scope > .kap-card'))
    const nodeByKey = new Map<string, HTMLElement>()
    const existing = existingEls.map((el) => {
        const key = el.dataset['cardKey'] ?? ''
        nodeByKey.set(key, el)
        return { key, signature: el.dataset['cardSig'] ?? '' }
    })
    const desired = cards.map((c) => ({ key: c.key, signature: cardSignature(c, accent) }))
    const cardByKey = new Map(cards.map((c) => [c.key, c]))

    const plan = planReconcile(existing, desired)
    for (const key of plan.remove) nodeByKey.get(key)?.remove()

    // Place desired nodes in order, reusing untouched nodes (React-style cursor).
    let cursor = listEl.firstElementChild
    for (const entry of plan.ordered) {
        let node: HTMLElement | undefined
        if (entry.create || entry.update) {
            const card = cardByKey.get(entry.key)
            if (card) node = buildCardNode(card, accent, callbacks)
        } else {
            node = nodeByKey.get(entry.key)
        }
        if (!node) continue
        if (node === cursor) cursor = cursor.nextElementSibling
        else listEl.insertBefore(node, cursor)
    }
}

/** Build a fully-wired card node and stamp its content signature for diffing. */
function buildCardNode(
    card: KanbanCard,
    accent: string,
    callbacks: BoardRenderCallbacks
): HTMLElement {
    const cardEl = renderCard(card, accent, { onRelationship: callbacks.onRelationship })
    cardEl.dataset['cardSig'] = cardSignature(card, accent)
    cardEl.addEventListener('click', (e) => callbacks.onOpen(card, e.ctrlKey || e.metaKey))
    cardEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            callbacks.onOpen(card, e.ctrlKey || e.metaKey)
        }
    })
    cardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onContextMenu(card, e)
    })
    return cardEl
}

/** A signature of everything that affects a card's rendered content + accent. */
function cardSignature(card: KanbanCard, accent: string): string {
    const d = card.display
    const fields = d.fields.map((f) => `${f.label ?? ''}|${f.text}|${f.emphasis ?? ''}`).join('~')
    const roles: RelationshipRole[] = ['blocked_by', 'parent', 'child', 'sibling']
    const rels = roles
        .map((r) => `${r}:${card.relationships[r].map((x) => x.key).join(',')}`)
        .join(';')
    return [d.title, d.wrap ? 'w' : '', d.coverUrl ?? '', fields, rels, accent].join('§')
}

/** Escape a value for use inside an attribute selector. */
function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/["\\]/g, '\\$&')
}
