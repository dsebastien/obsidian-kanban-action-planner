import type { SingleLaneBoard } from '../../domain/board-model'
import { columnHeaderShade, columnShade, resolveColor } from '../../services/colors.service'
import type { KanbanCard } from './types'
import { renderCard } from './card-renderer'

export interface BoardRenderCallbacks {
    onOpen: (card: KanbanCard) => void
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
}

/**
 * Render a single-lane board (columns + cards) into `rootEl`, applying each
 * column's color to its header/background and its cards' accent.
 *
 * Column `data-column-id` and card `data-card-key` attributes are the contract
 * the DnD controller relies on to compute drop targets.
 */
export function renderBoard(
    rootEl: HTMLElement,
    board: SingleLaneBoard<KanbanCard>,
    callbacks: BoardRenderCallbacks
): void {
    rootEl.empty()
    const boardEl = rootEl.createDiv({ cls: 'kap-board' })

    if (board.columns.length === 0) {
        boardEl.createDiv({ cls: 'kap-empty', text: 'No notes match this view.' })
        return
    }

    for (const { column, cards } of board.columns) {
        const accent = resolveColor(column.color)
        const colEl = boardEl.createDiv({ cls: 'kap-column' })
        colEl.dataset['columnId'] = column.id
        colEl.style.background = columnShade(accent)

        const header = colEl.createDiv({ cls: 'kap-column-header' })
        header.style.background = columnHeaderShade(accent)
        header.createSpan({ cls: 'kap-column-title', text: column.label })
        header.createSpan({ cls: 'kap-column-count', text: String(cards.length) })

        const listEl = colEl.createDiv({ cls: 'kap-column-cards' })
        listEl.setAttribute('role', 'list')

        for (const card of cards) {
            const cardEl = renderCard(listEl, card, accent)
            cardEl.addEventListener('click', () => callbacks.onOpen(card))
            cardEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    callbacks.onOpen(card)
                }
            })
            cardEl.addEventListener('contextmenu', (e) => {
                e.preventDefault()
                callbacks.onContextMenu(card, e)
            })
        }
    }
}
