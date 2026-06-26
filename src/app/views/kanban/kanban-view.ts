import { BasesView, debounce, Menu, TFile } from 'obsidian'
import type { Debouncer, QueryController } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../../plugin'
import { CSS_ROOT_CLASS, KANBAN_VIEW_TYPE, UNMAPPED_COLUMN_ID } from '../../constants'
import type { ColumnDef, Profile } from '../../domain/profile'
import { buildSingleLaneBoard } from '../../domain/board-model'
import type { SingleLaneBoard } from '../../domain/board-model'
import { detectStatusProperty, normalizeStatusValue } from '../../domain/status'
import { planInsertion } from '../../domain/ordering'
import {
    coerceOrder,
    deleteProperty,
    getFrontmatterValue,
    setProperty
} from '../../services/frontmatter.service'
import {
    DEFAULT_PROFILE_ID,
    columnsFromValues,
    createDefaultProfile,
    resolveActiveProfile
} from '../../services/profile-service'
import { buildCardDisplay } from '../../services/card-display.service'
import { renderBoard } from '../../ui/board/board-renderer'
import { BoardDnd } from '../../ui/board/dnd-controller'
import type { DropTarget } from '../../ui/board/dnd-controller'
import type { KanbanCard } from '../../ui/board/types'
import { renderGearButton } from '../../ui/gear-button'
import { ConfigureBoardModal } from '../../ui/configure-board-modal'
import { log } from '../../../utils/log'

/**
 * The Kanban Bases view.
 *
 * Reads the filtered notes, resolves the active note-type profile (mirrored from
 * the Starter Kit when present), derives colored columns, renders a draggable
 * board, and persists status + manual order back to the notes. `data` is
 * replaced on every update, so it is always re-read in {@link onDataUpdated}.
 */
export class KanbanActionPlannerView extends BasesView {
    override readonly type = KANBAN_VIEW_TYPE

    private readonly containerEl: HTMLElement
    private readonly plugin: KanbanActionPlannerPlugin
    private rootEl: HTMLElement | null = null
    private boardEl: HTMLElement | null = null
    private dnd: BoardDnd | null = null
    private readonly debouncedRebuild: Debouncer<[], void>

    private statusProperty: string | null = null
    private orderProperty = 'manual_order'
    private dueDateProperty = 'date_due'
    private availableProperties: string[] = []
    private profile: Profile = createDefaultProfile(DEFAULT_PROFILE_ID, 'Default', 'local')
    private profileStatusValues: string[] | null = null
    private preserveColumnOrder = false
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
        this.debouncedRebuild = debounce(() => void this.resolveAndRebuild(), 250)
    }

    override onload(): void {
        this.rootEl = this.containerEl.createDiv({ cls: CSS_ROOT_CLASS })
        renderGearButton(this.rootEl, () => this.openConfigureModal())
        this.boardEl = this.rootEl.createDiv({ cls: 'kap-board-host' })
        this.dnd = new BoardDnd(this.boardEl, {
            onDrop: (cardKey, target) => void this.handleDrop(cardKey, target)
        })
        void this.resolveAndRebuild()
    }

    override onunload(): void {
        this.dnd?.destroy()
        this.dnd = null
        this.rootEl?.remove()
        this.rootEl = null
        this.boardEl = null
    }

    override onDataUpdated(): void {
        this.debouncedRebuild()
    }

    // ── Build ─────────────────────────────────────────────────

    private files(): TFile[] {
        const entries = this.data?.data ?? []
        return entries.map((e) => e.file).filter((f): f is TFile => f instanceof TFile)
    }

    /** Resolve the profile (may hit the async Starter Kit API), then render. */
    private async resolveAndRebuild(): Promise<void> {
        const files = this.files()
        const resolved = await resolveActiveProfile(this.app, this.plugin, files)
        this.profile = resolved.profile
        this.profileStatusValues = resolved.statusValues
        this.preserveColumnOrder = resolved.preserveOrder
        this.rebuild()
    }

    private rebuild(): void {
        if (!this.boardEl) return
        const files = this.files()

        this.availableProperties = this.collectPropertyNames(files)
        this.statusProperty = this.resolveStatusProperty(files)
        this.orderProperty = this.resolveOrderProperty()
        this.dueDateProperty =
            this.profile.calendar.dueDateProperty || this.plugin.settings.defaultDueDateProperty

        const cards = files.map((file) => this.toCard(file))
        this.cardsByKey = new Map(cards.map((c) => [c.key, c]))

        const observed = cards.map((c) => c.statusValue).filter((v): v is string => v !== null)
        const values = this.profileStatusValues ?? observed
        this.columns = columnsFromValues(values, this.profile, this.preserveColumnOrder)

        let board = buildSingleLaneBoard(cards, this.columns)
        if (!this.showEmptyColumns()) {
            board = {
                columns: board.columns.filter(
                    (c) => c.cards.length > 0 || c.column.id === UNMAPPED_COLUMN_ID
                )
            }
        }
        this.board = board

        log(
            `Kanban rebuild: ${String(cards.length)} cards, ${String(this.columns.length)} columns, profile "${this.profile.name}"`,
            'debug'
        )

        renderBoard(this.boardEl, this.board, {
            onOpen: (card) => this.openCard(card),
            onContextMenu: (card, event) => this.showCardMenu(card, event)
        })
    }

    private resolveStatusProperty(_files: TFile[]): string | null {
        const configured = basesPropToName(this.config.get('statusProperty'))
        if (configured) return configured
        if (this.profile.source === 'starter-kit' && this.profile.statusProperty) {
            return this.profile.statusProperty
        }
        return detectStatusProperty(
            this.availableProperties,
            this.plugin.settings.defaultStatusProperty
        )
    }

    private resolveOrderProperty(): string {
        return (
            basesPropToName(this.config.get('orderProperty')) ??
            this.plugin.settings.defaultOrderProperty
        )
    }

    private showEmptyColumns(): boolean {
        const value = this.config.get('showEmptyColumns')
        return value === undefined ? true : value === true
    }

    private toCard(file: TFile): KanbanCard {
        const statusValue =
            this.statusProperty === null
                ? null
                : normalizeStatusValue(getFrontmatterValue(this.app, file, this.statusProperty))
        const order = coerceOrder(getFrontmatterValue(this.app, file, this.orderProperty))
        const display = buildCardDisplay(this.app, file, this.profile.card, this.dueDateProperty)
        return { key: file.path, file, title: file.basename, statusValue, order, display }
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

    private openConfigureModal(): void {
        const statusValues = this.columns.map((c) => c.statusValue)
        new ConfigureBoardModal(
            this.app,
            this.plugin,
            this.profile,
            statusValues,
            this.availableProperties,
            () => {
                this.profile =
                    this.plugin.settings.profiles.find((p) => p.id === this.profile.id) ??
                    this.profile
                this.rebuild()
            }
        ).open()
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
        const destCards = this.columnCards(columnId).filter((c) => c.key !== card.key)
        await this.applyMove(card, statusValue, columnId, destCards.length)
    }
}

/** Extract a frontmatter property name from a stored Bases property id. */
function basesPropToName(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) return null
    const dot = value.indexOf('.')
    if (dot === -1) return value
    const prefix = value.slice(0, dot)
    // Only note (frontmatter) properties are read/written by name.
    return prefix === 'note' ? value.slice(dot + 1) : null
}
