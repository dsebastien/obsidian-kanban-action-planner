import { BasesView, debounce, Menu, TFile } from 'obsidian'
import type { Debouncer, QueryController } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../../plugin'
import { CSS_ROOT_CLASS, KANBAN_VIEW_TYPE, UNMAPPED_COLUMN_ID } from '../../constants'
import type { ColumnDef } from '../../domain/profile'
import { buildSingleLaneBoard } from '../../domain/board-model'
import type { SingleLaneBoard } from '../../domain/board-model'
import { deriveColumns, detectStatusProperty, normalizeStatusValue } from '../../domain/status'
import { planInsertion } from '../../domain/ordering'
import {
    coerceOrder,
    deleteProperty,
    getFrontmatterValue,
    setProperty
} from '../../services/frontmatter.service'
import { renderBoard } from '../../ui/board/board-renderer'
import { BoardDnd } from '../../ui/board/dnd-controller'
import type { DropTarget } from '../../ui/board/dnd-controller'
import type { KanbanCard } from '../../ui/board/types'
import { log } from '../../../utils/log'

/**
 * The Kanban Bases view (Milestone 1: core single-lane board).
 *
 * Reads the filtered notes, derives columns from a detected status property,
 * renders a draggable board, and persists status + manual order back to the
 * notes on drop / context-menu actions. `data` is replaced on every update, so
 * it is always re-read in {@link onDataUpdated}.
 */
export class KanbanActionPlannerView extends BasesView {
    override readonly type = KANBAN_VIEW_TYPE

    private readonly containerEl: HTMLElement
    private readonly plugin: KanbanActionPlannerPlugin
    private rootEl: HTMLElement | null = null
    private dnd: BoardDnd | null = null
    private readonly debouncedRebuild: Debouncer<[], void>

    private statusProperty: string | null = null
    private orderProperty = 'manual_order'
    private columns: ColumnDef[] = []
    private board: SingleLaneBoard<KanbanCard> = { columns: [] }
    private cardsByKey = new Map<string, KanbanCard>()

    constructor(
        controller: QueryController,
        containerEl: HTMLElement,
        plugin: KanbanActionPlannerPlugin
    ) {
        super(controller)
        this.containerEl = containerEl
        this.plugin = plugin
        // Coalesce indexing storms (and our own frontmatter writes) into one rebuild.
        this.debouncedRebuild = debounce(() => this.rebuild(), 250)
    }

    override onload(): void {
        this.rootEl = this.containerEl.createDiv({ cls: CSS_ROOT_CLASS })
        this.dnd = new BoardDnd(this.rootEl, {
            onDrop: (cardKey, target) => void this.handleDrop(cardKey, target)
        })
        this.rebuild()
    }

    override onunload(): void {
        this.dnd?.destroy()
        this.dnd = null
        this.rootEl?.remove()
        this.rootEl = null
    }

    override onDataUpdated(): void {
        this.debouncedRebuild()
    }

    // ── Build ─────────────────────────────────────────────────

    private rebuild(): void {
        if (!this.rootEl) return

        const settings = this.plugin.settings
        this.orderProperty = settings.defaultOrderProperty

        const entries = this.data?.data ?? []
        const files = entries.map((e) => e.file).filter((f): f is TFile => f instanceof TFile)

        this.statusProperty = detectStatusProperty(
            this.collectPropertyNames(files),
            settings.defaultStatusProperty
        )

        const cards = files.map((file) => this.toCard(file))
        this.cardsByKey = new Map(cards.map((c) => [c.key, c]))
        this.columns = deriveColumns(cards.map((c) => c.statusValue))
        this.board = buildSingleLaneBoard(cards, this.columns)

        log(
            `Kanban rebuild: ${String(cards.length)} cards, ${String(this.columns.length)} columns`,
            'debug'
        )

        renderBoard(this.rootEl, this.board, {
            onOpen: (card) => this.openCard(card),
            onContextMenu: (card, event) => this.showCardMenu(card, event)
        })
    }

    private toCard(file: TFile): KanbanCard {
        const statusValue =
            this.statusProperty === null
                ? null
                : normalizeStatusValue(getFrontmatterValue(this.app, file, this.statusProperty))
        const order = coerceOrder(getFrontmatterValue(this.app, file, this.orderProperty))
        return { key: file.path, file, title: file.basename, statusValue, order }
    }

    private collectPropertyNames(files: TFile[]): string[] {
        const names = new Set<string>()
        for (const file of files) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
            if (fm) for (const key of Object.keys(fm)) names.add(key)
        }
        return Array.from(names)
    }

    // ── Actions ───────────────────────────────────────────────

    private openCard(card: KanbanCard): void {
        void this.app.workspace.getLeaf(false).openFile(card.file)
    }

    private async handleDrop(cardKey: string, target: DropTarget): Promise<void> {
        const card = this.cardsByKey.get(cardKey)
        if (!card) return

        const newStatus =
            target.columnId === UNMAPPED_COLUMN_ID
                ? null
                : (this.columnStatusValue(target.columnId) ?? card.statusValue)

        await this.applyMove(card, newStatus, target.columnId, target.index)
    }

    private columnStatusValue(columnId: string): string | null {
        return this.columns.find((c) => c.id === columnId)?.statusValue ?? null
    }

    /**
     * Persist a move: set the status (when changed) and the manual order. Order
     * uses a single midpoint write when possible, else renumbers the column.
     */
    private async applyMove(
        card: KanbanCard,
        newStatus: string | null,
        destColumnId: string,
        index: number
    ): Promise<void> {
        if (this.statusProperty && newStatus !== card.statusValue) {
            if (newStatus === null) await deleteProperty(this.app, card.file, this.statusProperty)
            else await setProperty(this.app, card.file, this.statusProperty, newStatus)
        }

        const destCards = this.columnCards(destColumnId).filter((c) => c.key !== card.key)
        const clamped = Math.max(0, Math.min(index, destCards.length))
        const plan = planInsertion(
            destCards.map((c) => c.order),
            clamped
        )

        if (plan.kind === 'single') {
            await setProperty(this.app, card.file, this.orderProperty, plan.order)
        } else {
            const arrangement = [...destCards.slice(0, clamped), card, ...destCards.slice(clamped)]
            for (let i = 0; i < arrangement.length; i++) {
                const c = arrangement[i]
                const o = plan.orders[i]
                if (c && o !== undefined && c.order !== o) {
                    await setProperty(this.app, c.file, this.orderProperty, o)
                }
            }
        }
        // Frontmatter writes trigger onDataUpdated -> debounced rebuild.
    }

    private columnCards(columnId: string): KanbanCard[] {
        return this.board.columns.find((c) => c.column.id === columnId)?.cards ?? []
    }

    private showCardMenu(card: KanbanCard, event: MouseEvent): void {
        const menu = new Menu()
        menu.addItem((item) =>
            item
                .setTitle('Open note')
                .setIcon('file')
                .onClick(() => this.openCard(card))
        )
        menu.addSeparator()
        for (const col of this.columns) {
            menu.addItem((item) =>
                item
                    .setTitle(`Set status: ${col.label}`)
                    .setChecked(card.statusValue === col.statusValue)
                    .onClick(() => void this.setCardStatus(card, col.statusValue, col.id))
            )
        }
        if (card.statusValue !== null) {
            menu.addItem((item) =>
                item
                    .setTitle('Clear status')
                    .setIcon('x')
                    .onClick(() => void this.setCardStatus(card, null, UNMAPPED_COLUMN_ID))
            )
        }
        menu.showAtMouseEvent(event)
    }

    private async setCardStatus(
        card: KanbanCard,
        statusValue: string | null,
        columnId: string
    ): Promise<void> {
        // Append to the bottom of the destination column.
        const destCards = this.columnCards(columnId).filter((c) => c.key !== card.key)
        await this.applyMove(card, statusValue, columnId, destCards.length)
    }
}
