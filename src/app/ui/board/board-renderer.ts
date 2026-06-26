import type { Board, BoardColumn } from '../../domain/board-model'
import { columnHeaderShade, columnShade, resolveColor } from '../../services/colors.service'
import type { KanbanCard } from './types'
import { renderCard } from './card-renderer'

export interface BoardRenderCallbacks {
    onOpen: (card: KanbanCard, newTab: boolean) => void
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
    /** Toggle a swimlane's collapsed state (multi-lane boards only). */
    onToggleLane?: (laneId: string) => void
}

/**
 * Render the board into `rootEl`. A single-lane board (grouping off, or grouping
 * that resolves to one lane) draws columns chrome-free; a multi-lane board draws
 * one collapsible swimlane per lane, each with its own column row.
 *
 * Column `data-column-id` + `data-lane-id` and card `data-card-key` attributes
 * are the contract the DnD controller relies on to compute drop targets.
 */
export function renderBoard(
    rootEl: HTMLElement,
    board: Board<KanbanCard>,
    callbacks: BoardRenderCallbacks,
    collapsedLanes: ReadonlySet<string> = new Set()
): void {
    rootEl.empty()

    const hasColumns = board.lanes.some((l) => l.columns.length > 0)
    if (!hasColumns) {
        rootEl.createDiv({ cls: 'kap-empty', text: 'No notes match this view.' })
        return
    }

    if (!board.isMultiLane) {
        const lane = board.lanes[0]
        const boardEl = rootEl.createDiv({ cls: 'kap-board' })
        if (lane) renderColumns(boardEl, lane.columns, callbacks, lane.lane.id)
        return
    }

    const lanesEl = rootEl.createDiv({ cls: 'kap-lanes' })
    for (const lane of board.lanes) {
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
}

/** Render one lane's columns (with cards) into `boardEl`. */
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

        for (const card of cards) {
            const cardEl = renderCard(listEl, card, accent)
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
        }
    }
}
