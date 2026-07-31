import { setIcon } from 'obsidian'
import { UNMAPPED_COLUMN_ID } from '../../constants'
import type { Board, BoardColumn, BoardLane } from '../../domain/board-model'
import type { RelationshipRole } from '../../domain/note-type'
import { columnHeaderShade, columnShade, resolveColor } from '../../services/colors.service'
import { cssEscapeAttr } from '../../utils/css-escape'
import type { KanbanCard } from './types'
import { renderCard } from './card-renderer'
import { planReconcile } from './reconcile'
import { cardSignature, structureSignature } from './signatures'

export interface BoardRenderCallbacks {
    onOpen: (card: KanbanCard, newTab: boolean) => void
    /** A mouse click on a card — the view decides open vs. (multi-)select. */
    onCardClick: (card: KanbanCard, event: MouseEvent) => void
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
    /** Toggle a swimlane's collapsed state (multi-lane boards only). */
    onToggleLane?: (laneId: string) => void
    /** Toggle a status column's collapsed state (applies across all lanes). */
    onToggleColumn?: (columnId: string) => void
    /** Activate a card relationship badge. */
    onRelationship?: (card: KanbanCard, role: RelationshipRole, event: MouseEvent) => void
    /** Keyboard: move the card to the adjacent column (−1 left / +1 right). */
    onMoveColumn?: (card: KanbanCard, direction: 1 | -1) => void
    /** Keyboard: reorder the card within its column (−1 up / +1 down). */
    onReorderCard?: (card: KanbanCard, direction: 1 | -1) => void
    /** Keyboard: open the card's context menu, anchored to its element. */
    onKeyboardMenu?: (card: KanbanCard, cardEl: HTMLElement) => void
    /**
     * Quick capture (issue #46): create a note landing in this lane + column.
     * Absent = the affordance is not rendered (turned off, or embedded).
     */
    onAddCard?: (laneId: string, columnId: string) => void
}

/** `data-board-struct` records the rendered lane/column shape for patch vs full-render. */
const STRUCT_ATTR = 'boardStruct'

/**
 * Whether {@link patchBoard} would take the full-render (`rootEl.empty()`)
 * path for `board`: no board DOM mounted yet, or the lane/column shape
 * differs from the recorded one. The view uses this to decide when scroll
 * capture/restore across the teardown is needed (issue #105) — the keyed
 * patch path preserves node identity and therefore scroll by construction.
 */
export function boardStructureWillChange(rootEl: HTMLElement, board: Board<KanbanCard>): boolean {
    const hasBoardDom = rootEl.querySelector(':scope > .kap-board, :scope > .kap-lanes') !== null
    return !hasBoardDom || rootEl.dataset[STRUCT_ATTR] !== structureSignature(board)
}

/**
 * Render the board into `rootEl` (full render). A single-lane board draws columns
 * chrome-free; a multi-lane board draws one collapsible swimlane per lane.
 *
 * Column `data-column-id` + `data-lane-id`, card `data-card-key` + `data-card-sig`
 * attributes are the contract the DnD controller and the incremental
 * {@link patchBoard} reconciler rely on.
 */
function renderBoard(
    rootEl: HTMLElement,
    board: Board<KanbanCard>,
    callbacks: BoardRenderCallbacks,
    collapsedLanes: ReadonlySet<string> = new Set(),
    collapsedColumns: ReadonlySet<string> = new Set()
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
        if (lane) renderColumns(boardEl, lane.columns, callbacks, lane.lane.id, collapsedColumns)
    } else {
        const lanesEl = rootEl.createDiv({ cls: 'kap-lanes' })
        for (const lane of board.lanes)
            renderLane(lanesEl, lane, callbacks, collapsedLanes, collapsedColumns)
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
    collapsedLanes: ReadonlySet<string> = new Set(),
    collapsedColumns: ReadonlySet<string> = new Set()
): void {
    const hasBoardDom = rootEl.querySelector(':scope > .kap-board, :scope > .kap-lanes') !== null
    const hasColumns = board.lanes.some((l) => l.columns.length > 0)
    if (!hasBoardDom || !hasColumns || rootEl.dataset[STRUCT_ATTR] !== structureSignature(board)) {
        renderBoard(rootEl, board, callbacks, collapsedLanes, collapsedColumns)
        return
    }

    if (!board.isMultiLane) {
        const boardEl = rootEl.querySelector<HTMLElement>(':scope > .kap-board')
        const lane = board.lanes[0]
        if (boardEl && lane) patchColumns(boardEl, lane.columns, callbacks, collapsedColumns)
        return
    }

    for (const lane of board.lanes) {
        const laneEl = rootEl.querySelector<HTMLElement>(
            `:scope > .kap-lanes > .kap-lane[data-lane-id="${cssEscapeAttr(lane.lane.id)}"]`
        )
        if (!laneEl) continue
        syncLaneChrome(laneEl, lane, collapsedLanes)
        const boardEl = laneEl.querySelector<HTMLElement>('.kap-board')
        if (boardEl) patchColumns(boardEl, lane.columns, callbacks, collapsedColumns)
    }
}

function renderLane(
    lanesEl: HTMLElement,
    lane: BoardLane<KanbanCard>,
    callbacks: BoardRenderCallbacks,
    collapsedLanes: ReadonlySet<string>,
    collapsedColumns: ReadonlySet<string>
): void {
    const collapsed = collapsedLanes.has(lane.lane.id)
    const laneEl = lanesEl.createDiv({ cls: 'kap-lane' })
    laneEl.dataset['laneId'] = lane.lane.id
    if (collapsed) laneEl.addClass('kap-lane-collapsed')

    const header = laneEl.createDiv({ cls: 'kap-lane-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-lane-toggle',
        attr: { 'aria-label': collapsed ? 'Expand lane' : 'Collapse lane' }
    })
    setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down')
    toggle.addEventListener('click', () => callbacks.onToggleLane?.(lane.lane.id))
    header.createSpan({ cls: 'kap-lane-title', text: lane.lane.label })
    header.createSpan({ cls: 'kap-lane-count', text: String(lane.cardCount) })

    const body = laneEl.createDiv({ cls: 'kap-lane-body' })
    const boardEl = body.createDiv({ cls: 'kap-board' })
    renderColumns(boardEl, lane.columns, callbacks, lane.lane.id, collapsedColumns)
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
        setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down')
        toggle.setAttribute('aria-label', collapsed ? 'Expand lane' : 'Collapse lane')
    }
    laneEl.querySelector('.kap-lane-count')?.setText(String(lane.cardCount))
}

/** Render one lane's columns (with cards) into `boardEl` (full render). */
function renderColumns(
    boardEl: HTMLElement,
    columns: ReadonlyArray<BoardColumn<KanbanCard>>,
    callbacks: BoardRenderCallbacks,
    laneId: string,
    collapsedColumns: ReadonlySet<string>
): void {
    for (const { column, cards } of columns) {
        const accent = resolveColor(column.color)
        const collapsed = collapsedColumns.has(column.id)
        const colEl = boardEl.createDiv({ cls: 'kap-column' })
        colEl.dataset['columnId'] = column.id
        colEl.dataset['laneId'] = laneId
        colEl.style.background = columnShade(accent)
        if (collapsed) colEl.addClass('kap-column-collapsed')

        const header = colEl.createDiv({ cls: 'kap-column-header' })
        header.style.background = columnHeaderShade(accent)
        const toggle = header.createEl('button', {
            cls: 'kap-column-toggle',
            attr: { 'aria-label': collapsed ? 'Expand column' : 'Collapse column' }
        })
        setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down')
        toggle.addEventListener('click', (e) => {
            e.stopPropagation()
            callbacks.onToggleColumn?.(column.id)
        })
        header.createSpan({ cls: 'kap-column-title', text: column.label })
        const countEl = header.createSpan({ cls: 'kap-column-count' })
        setColumnCount(colEl, countEl, cards.length, column.wipLimit)

        const listEl = colEl.createDiv({ cls: 'kap-column-cards' })
        listEl.setAttribute('role', 'list')
        for (const card of cards) listEl.appendChild(buildCardNode(card, accent, callbacks))

        syncAddCardAffordances(colEl, column.id, laneId, callbacks)
    }
}

/** Whether a column offers quick capture (issue #46). */
function canAddCard(columnId: string, callbacks: BoardRenderCallbacks): boolean {
    // The synthetic Unmapped column has no status value to write, so a note
    // created there could not land in it.
    return Boolean(callbacks.onAddCard) && columnId !== UNMAPPED_COLUMN_ID
}

/**
 * Add (or remove) both quick-capture affordances on a column: a **+** in the
 * header, always in reach at the top of the column, and a labelled footer button
 * under the card list — outside the scroller, so a long column keeps it visible.
 *
 * Idempotent, because the keyed card reconcile in {@link patchColumns} never
 * touches column chrome: calling it again after a config change adds or removes
 * the buttons without a full re-render.
 */
function syncAddCardAffordances(
    colEl: HTMLElement,
    columnId: string,
    laneId: string,
    callbacks: BoardRenderCallbacks
): void {
    const onAddCard = callbacks.onAddCard
    const enabled = canAddCard(columnId, callbacks)
    const headerEl = colEl.querySelector<HTMLElement>(':scope > .kap-column-header')
    const existingHeaderBtn = headerEl?.querySelector<HTMLElement>(':scope > .kap-column-add')
    const existingFooter = colEl.querySelector<HTMLElement>(':scope > .kap-column-footer')

    if (!enabled || !onAddCard) {
        existingHeaderBtn?.remove()
        existingFooter?.remove()
        return
    }

    const add = (e: Event): void => {
        e.stopPropagation()
        onAddCard(laneId, columnId)
    }

    if (headerEl && !existingHeaderBtn) {
        // A `<button>` inside the header is already exempt from the column-reorder
        // drag (`column-dnd` bails on `target.closest('button')`).
        const headerBtn = headerEl.createEl('button', {
            cls: 'kap-column-add',
            attr: {
                'type': 'button',
                'aria-label': 'Add a note to this column',
                'title': 'Add a note to this column'
            }
        })
        setIcon(headerBtn, 'plus')
        headerBtn.addEventListener('click', add)
    }

    if (!existingFooter) {
        const footer = colEl.createDiv({ cls: 'kap-column-footer' })
        const button = footer.createEl('button', {
            cls: 'kap-add-card',
            attr: { 'type': 'button', 'aria-label': 'Add a note to this column' }
        })
        setIcon(button.createSpan({ cls: 'kap-add-card-icon' }), 'plus')
        button.createSpan({ text: 'Add card' })
        button.addEventListener('click', add)
    }
}

/** Patch each column's card list in place against the desired cards. */
function patchColumns(
    boardEl: HTMLElement,
    columns: ReadonlyArray<BoardColumn<KanbanCard>>,
    callbacks: BoardRenderCallbacks,
    collapsedColumns: ReadonlySet<string>
): void {
    for (const { column, cards } of columns) {
        const colEl = boardEl.querySelector<HTMLElement>(
            `:scope > .kap-column[data-column-id="${cssEscapeAttr(column.id)}"]`
        )
        const listEl = colEl?.querySelector<HTMLElement>('.kap-column-cards')
        if (!colEl || !listEl) continue
        const accent = resolveColor(column.color)
        patchColumnCards(listEl, cards, accent, callbacks)
        const countEl = colEl.querySelector<HTMLElement>('.kap-column-count')
        if (countEl) setColumnCount(colEl, countEl, cards.length, column.wipLimit)

        syncAddCardAffordances(colEl, column.id, colEl.dataset['laneId'] ?? '', callbacks)

        const collapsed = collapsedColumns.has(column.id)
        colEl.toggleClass('kap-column-collapsed', collapsed)
        const toggle = colEl.querySelector<HTMLElement>('.kap-column-toggle')
        if (toggle) {
            setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down')
            toggle.setAttribute('aria-label', collapsed ? 'Expand column' : 'Collapse column')
        }
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
    cardEl.addEventListener('click', (e) => callbacks.onCardClick(card, e))
    cardEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            callbacks.onOpen(card, e.ctrlKey || e.metaKey)
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            // Move to the adjacent column (writes status).
            e.preventDefault()
            callbacks.onMoveColumn?.(card, e.key === 'ArrowRight' ? 1 : -1)
        } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            // Reorder within the column (writes manual order).
            e.preventDefault()
            callbacks.onReorderCard?.(card, e.key === 'ArrowDown' ? 1 : -1)
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            callbacks.onKeyboardMenu?.(card, cardEl)
        }
    })
    cardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onContextMenu(card, e)
    })
    return cardEl
}

/**
 * Render a column's count, showing `n / limit` when a soft WIP limit is set and
 * flagging the column when it is over its limit (issue #16). The limit never
 * blocks drops — it is a visual warning only.
 */
function setColumnCount(
    colEl: HTMLElement,
    countEl: HTMLElement,
    count: number,
    limit: number | undefined
): void {
    countEl.setText(limit !== undefined ? `${String(count)} / ${String(limit)}` : String(count))
    colEl.toggleClass('kap-column-over-limit', limit !== undefined && count > limit)
}
