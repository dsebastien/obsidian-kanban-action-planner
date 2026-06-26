import { BasesView, debounce, Menu, Notice, TFile } from 'obsidian'
import type { Debouncer, QueryController } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../../plugin'
import {
    CSS_ROOT_CLASS,
    KANBAN_VIEW_TYPE,
    UNGROUPED_LANE_ID,
    UNMAPPED_COLUMN_ID
} from '../../constants'
import type { ColumnDef, LaneGrouping, Profile, RelationshipRole } from '../../domain/profile'
import { buildBoard } from '../../domain/board-model'
import type { Board, UnmappedPosition } from '../../domain/board-model'
import { detectStatusProperty, normalizeStatusValue } from '../../domain/status'
import { passesFilter } from '../../domain/filtering'
import type { BlockedFilter, RelationalFilter } from '../../domain/filtering'
import type { RelationshipSet } from '../../domain/relationships'
import { recognizeNoteType } from '../../services/starter-kit.service'
import {
    resolveBoardRelationships,
    toCardRelationships
} from '../../services/relationships.service'
import type { RelatedNote } from '../../services/relationships.service'
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
import { archiveNote } from '../../services/archive.service'
import {
    bucketByDay,
    buildCalendar,
    parseFrontmatterDate,
    shiftAnchor,
    startOfDay
} from '../../domain/calendar'
import type { CalendarRange, DateDimension } from '../../domain/calendar'
import { renderCalendar } from '../../ui/calendar/calendar-renderer'
import { CalendarDnd } from '../../ui/calendar/calendar-dnd'
import type { CalendarDropTarget } from '../../ui/calendar/calendar-dnd'
import { formatDate } from '../../utils/momentjs'
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
    private calendarDnd: CalendarDnd | null = null
    private readonly debouncedRebuild: Debouncer<[], void>

    private statusProperty: string | null = null
    private orderProperty = 'manual_order'
    private dueDateProperty = 'date_due'
    private availableProperties: string[] = []
    private profile: Profile = createDefaultProfile(DEFAULT_PROFILE_ID, 'Default', 'local')
    private profileStatusValues: string[] | null = null
    private columns: ColumnDef[] = []
    private laneGrouping: LaneGrouping = { kind: 'none' }
    private laneValueByPath = new Map<string, string | null>()
    private relationshipsByPath = new Map<string, RelationshipSet>()
    private readonly collapsedLanes = new Set<string>()
    private board: Board<KanbanCard> = { lanes: [], isMultiLane: false }
    private cardsByKey = new Map<string, KanbanCard>()

    // Calendar mode (Milestone 5) — in-memory per-session view state.
    private scheduledDateProperty = 'date_scheduled'
    private calendarRangeOverride: CalendarRange | null = null
    private calendarTab: DateDimension = 'scheduled'
    private calendarAnchor: Date | null = null
    private calendarPanelCollapsed = false

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
        this.calendarDnd = new CalendarDnd(this.boardEl, {
            onDrop: (cardKey, target) => void this.handleCalendarDrop(cardKey, target)
        })
        void this.resolveAndRebuild()
    }

    override onunload(): void {
        this.dnd?.destroy()
        this.dnd = null
        this.calendarDnd?.destroy()
        this.calendarDnd = null
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

    /** Resolve the profile + lane values (may hit the async Starter Kit API), then render. */
    private async resolveAndRebuild(): Promise<void> {
        const files = this.files()
        const resolved = await resolveActiveProfile(this.app, this.plugin, files)
        this.profile = resolved.profile
        this.profileStatusValues = resolved.statusValues
        this.laneGrouping = this.resolveLaneGrouping()
        this.laneValueByPath = await this.computeLaneValues(files, this.laneGrouping)
        this.rebuild()
    }

    /** Per-view grouping override (when set) else the profile's grouping. */
    private resolveLaneGrouping(): LaneGrouping {
        return readLaneGroupingOverride(this.config) ?? this.profile.laneGrouping
    }

    /**
     * Resolve each file's swimlane value: the recognized note-type name for
     * `note-type` grouping, or the chosen property's scalar value for `property`
     * grouping. Empty for `none`.
     */
    private async computeLaneValues(
        files: TFile[],
        grouping: LaneGrouping
    ): Promise<Map<string, string | null>> {
        const map = new Map<string, string | null>()
        if (grouping.kind === 'none') return map
        if (grouping.kind === 'property') {
            for (const file of files) {
                map.set(
                    file.path,
                    normalizeLaneValue(getFrontmatterValue(this.app, file, grouping.property))
                )
            }
            return map
        }
        for (const file of files) {
            const type = await recognizeNoteType(this.app, file)
            map.set(file.path, type?.name ?? null)
        }
        return map
    }

    private rebuild(): void {
        if (!this.boardEl) return
        const files = this.files()

        this.availableProperties = this.collectPropertyNames(files)
        this.statusProperty = this.resolveStatusProperty(files)
        this.orderProperty = this.resolveOrderProperty()
        this.dueDateProperty = this.resolveDueDateProperty()
        this.scheduledDateProperty = this.resolveScheduledDateProperty()

        this.relationshipsByPath = resolveBoardRelationships(this.app, files, this.profile)

        const filter = this.relationalFilter()
        const cards = files
            .map((file) => this.toCard(file))
            .filter((card) => passesFilter(this.relationshipsByPath.get(card.key), filter))
        this.cardsByKey = new Map(cards.map((c) => [c.key, c]))

        if (this.calendarMode()) {
            this.renderCalendarFrame(cards)
            return
        }

        const values = this.resolveColumnValues()
        this.columns = columnsFromValues(values, this.profile, true)

        let board = buildBoard(cards, this.columns, {
            grouped: this.laneGrouping.kind !== 'none',
            unmappedPosition: this.unmappedPosition()
        })
        if (!this.showEmptyColumns()) {
            board = {
                isMultiLane: board.isMultiLane,
                lanes: board.lanes.map((lane) => ({
                    ...lane,
                    columns: lane.columns.filter(
                        (c) => c.cards.length > 0 || c.column.id === UNMAPPED_COLUMN_ID
                    )
                }))
            }
        }
        this.board = board

        log(
            `Kanban rebuild: ${String(cards.length)} cards, ${String(this.columns.length)} columns, ${String(board.lanes.length)} lane(s), profile "${this.profile.name}"`,
            'debug'
        )

        renderBoard(
            this.boardEl,
            this.board,
            {
                onOpen: (card, newTab) => this.openCard(card, newTab),
                onContextMenu: (card, event) => this.showCardMenu(card, event),
                onToggleLane: (laneId) => this.toggleLane(laneId),
                onRelationship: (card, role, event) => this.showRelatedMenu(card, role, event)
            },
            this.collapsedLanes
        )
    }

    private relationalFilter(): RelationalFilter {
        const value = this.config.get('blockedFilter')
        const blocked: BlockedFilter = value === 'only' || value === 'hide' ? value : 'all'
        return { blocked }
    }

    private toggleLane(laneId: string): void {
        if (this.collapsedLanes.has(laneId)) this.collapsedLanes.delete(laneId)
        else this.collapsedLanes.add(laneId)
        this.rebuild()
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

    private resolveDueDateProperty(): string {
        return (
            basesPropToName(this.config.get('dueDateProperty')) ??
            this.profile.calendar.dueDateProperty ??
            this.plugin.settings.defaultDueDateProperty
        )
    }

    private resolveScheduledDateProperty(): string {
        return (
            basesPropToName(this.config.get('scheduledDateProperty')) ??
            this.profile.calendar.scheduledDateProperty ??
            this.plugin.settings.defaultScheduledDateProperty
        )
    }

    /**
     * The column status values, from a STRONG definition only (never inferred
     * from observed values, which would create stale columns from typos):
     * the per-view `statuses` list, else the Starter Kit note type's allowed
     * values, else the global default statuses. When none are defined the board
     * has no columns and every card sits in Unmapped.
     */
    private resolveColumnValues(): string[] {
        const viewStatuses = readStringArray(this.config.get('statuses'))
        if (viewStatuses.length > 0) return viewStatuses
        if (this.profileStatusValues && this.profileStatusValues.length > 0) {
            return this.profileStatusValues
        }
        return this.plugin.settings.defaultStatuses
    }

    private showEmptyColumns(): boolean {
        const value = this.config.get('showEmptyColumns')
        return value === undefined ? true : value === true
    }

    private unmappedPosition(): UnmappedPosition {
        return this.config.get('unmappedPosition') === 'last' ? 'last' : 'first'
    }

    private toCard(file: TFile): KanbanCard {
        const statusValue =
            this.statusProperty === null
                ? null
                : normalizeStatusValue(getFrontmatterValue(this.app, file, this.statusProperty))
        const order = coerceOrder(getFrontmatterValue(this.app, file, this.orderProperty))
        const display = buildCardDisplay(this.app, file, this.profile.card, this.dueDateProperty)
        const laneValue =
            this.laneGrouping.kind === 'none' ? null : (this.laneValueByPath.get(file.path) ?? null)
        const relationships = toCardRelationships(this.relationshipsByPath.get(file.path))
        return {
            key: file.path,
            file,
            title: file.basename,
            statusValue,
            order,
            laneValue,
            display,
            relationships
        }
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

    private openCard(card: KanbanCard, newTab: boolean): void {
        void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(card.file)
    }

    private openConfigureModal(): void {
        const statusValues = this.columns.map((c) => c.statusValue)
        new ConfigureBoardModal(
            this.app,
            this.plugin,
            this.profile,
            statusValues,
            this.availableProperties,
            () => void this.resolveAndRebuild()
        ).open()
    }

    private async handleDrop(cardKey: string, target: DropTarget): Promise<void> {
        const card = this.cardsByKey.get(cardKey)
        if (!card) return

        // Cross-lane drag: reassign the grouping value to the target lane (for
        // property grouping) before applying the in-column move. Note-type lanes
        // cannot be safely reassigned, so a cross-lane drop there is ignored.
        if (this.board.isMultiLane && target.laneId !== this.laneIdOf(card)) {
            const reassigned = await this.applyLaneChange(card, target.laneId)
            if (!reassigned) return
        }

        const newStatus =
            target.columnId === UNMAPPED_COLUMN_ID
                ? null
                : (this.columnStatusValue(target.columnId) ?? card.statusValue)
        await this.applyMove(card, newStatus, target.laneId, target.columnId, target.index)
    }

    /**
     * Reassign a card's swimlane by writing the grouping property to the target
     * lane's value (or clearing it for the Ungrouped lane). Returns false when
     * the change can't be applied (note-type grouping), so the caller aborts the
     * whole move and the card snaps back.
     */
    private async applyLaneChange(card: KanbanCard, targetLaneId: string): Promise<boolean> {
        if (this.laneGrouping.kind !== 'property') {
            log('Cross-lane drag is only supported for property swimlanes; ignoring.', 'warn')
            return false
        }
        const property = this.laneGrouping.property
        if (targetLaneId === UNGROUPED_LANE_ID) {
            await deleteProperty(this.app, card.file, property)
        } else {
            await setProperty(this.app, card.file, property, targetLaneId)
        }
        return true
    }

    /** The lane id a card currently sits in (`''` for single-lane boards). */
    private laneIdOf(card: KanbanCard): string {
        if (!this.board.isMultiLane) return ''
        const value = card.laneValue
        return value === null || value === undefined || value === '' ? UNGROUPED_LANE_ID : value
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
        destLaneId: string,
        destColumnId: string,
        index: number
    ): Promise<void> {
        if (this.statusProperty && newStatus !== card.statusValue) {
            if (newStatus === null) await deleteProperty(this.app, card.file, this.statusProperty)
            else await setProperty(this.app, card.file, this.statusProperty, newStatus)
        }

        // Status-triggered archiving: once the status is written, if this is a
        // transition INTO the configured trigger status, archive and stop (the
        // note leaves the board, so there's no order to persist).
        if (await this.maybeAutoArchive(card, newStatus)) return

        const destCards = this.columnCards(destLaneId, destColumnId).filter(
            (c) => c.key !== card.key
        )
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

    private columnCards(laneId: string, columnId: string): KanbanCard[] {
        const lane = this.board.lanes.find((l) => l.lane.id === laneId) ?? this.board.lanes[0]
        return lane?.columns.find((c) => c.column.id === columnId)?.cards ?? []
    }

    private showCardMenu(card: KanbanCard, event: MouseEvent): void {
        const menu = new Menu()
        menu.addItem((item) =>
            item
                .setTitle('Open note')
                .setIcon('file')
                .onClick(() => this.openCard(card, false))
        )
        menu.addItem((item) =>
            item
                .setTitle('Open in new tab')
                .setIcon('lucide-external-link')
                .onClick(() => this.openCard(card, true))
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
        if (this.archivingConfigured()) {
            menu.addSeparator()
            menu.addItem((item) =>
                item
                    .setTitle('Archive')
                    .setIcon('archive')
                    .onClick(() => void this.archiveCard(card))
            )
        }
        this.addRelationshipMenuItems(menu, card)
        menu.showAtMouseEvent(event)
    }

    /** Add "open related note" items (blockers first) when the card has any. */
    private addRelationshipMenuItems(menu: Menu, card: KanbanCard): void {
        let separated = false
        for (const { role, label, icon } of RELATIONSHIP_MENU) {
            const related = card.relationships[role]
            if (related.length === 0) continue
            if (!separated) {
                menu.addSeparator()
                separated = true
            }
            for (const note of related) {
                menu.addItem((item) =>
                    item
                        .setTitle(`${label}: ${note.label}`)
                        .setIcon(icon)
                        .onClick((evt) => this.openRelated(note, isNewTabEvent(evt)))
                )
            }
        }
    }

    /**
     * Navigate from a relationship badge: open the single related note, or list
     * them. Ctrl/Cmd-click (on the badge, or on a menu item) opens in a new tab.
     */
    private showRelatedMenu(card: KanbanCard, role: RelationshipRole, event: MouseEvent): void {
        const related = card.relationships[role]
        if (related.length === 0) return
        const newTab = isNewTabEvent(event)
        if (related.length === 1 && related[0]) {
            this.openRelated(related[0], newTab)
            return
        }
        const menu = new Menu()
        for (const note of related) {
            menu.addItem((item) =>
                item
                    .setTitle(note.label)
                    .setIcon('file')
                    .onClick((evt) => this.openRelated(note, newTab || isNewTabEvent(evt)))
            )
        }
        menu.showAtMouseEvent(event)
    }

    private openRelated(note: RelatedNote, newTab: boolean): void {
        const file = this.app.vault.getFileByPath(note.key)
        if (file) void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file)
    }

    private async setCardStatus(
        card: KanbanCard,
        statusValue: string | null,
        columnId: string
    ): Promise<void> {
        const laneId = this.laneIdOf(card)
        const destCards = this.columnCards(laneId, columnId).filter((c) => c.key !== card.key)
        await this.applyMove(card, statusValue, laneId, columnId, destCards.length)
    }

    // ── Calendar mode ─────────────────────────────────────────

    private calendarMode(): boolean {
        return this.config.get('calendarMode') === true
    }

    private effectiveRange(): CalendarRange {
        if (this.calendarRangeOverride) return this.calendarRangeOverride
        const configured = this.config.get('calendarRange')
        return configured === 'week' ||
            configured === 'month' ||
            configured === 'quarter' ||
            configured === 'year'
            ? configured
            : 'month'
    }

    private effectiveAnchor(): Date {
        return this.calendarAnchor ?? startOfDay(new Date())
    }

    /** Compute the calendar/scheduling model and render it into the board host. */
    private renderCalendarFrame(cards: KanbanCard[]): void {
        if (!this.boardEl) return
        const range = this.effectiveRange()
        const anchor = this.effectiveAnchor()
        const today = startOfDay(new Date())
        const dimension = this.calendarTab

        const dateFor = (card: KanbanCard, dim: DateDimension): Date | null => {
            const prop = dim === 'scheduled' ? this.scheduledDateProperty : this.dueDateProperty
            return parseFrontmatterDate(getFrontmatterValue(this.app, card.file, prop))
        }

        const unplanned = cards.filter((c) => dateFor(c, 'scheduled') === null)
        const noDeadline = cards.filter((c) => dateFor(c, 'deadline') === null)
        const panelCards = dimension === 'scheduled' ? unplanned : noDeadline
        const placed = cards.filter((c) => dateFor(c, dimension) !== null)
        const cardsByDay = bucketByDay(placed, (c) => dateFor(c, dimension))

        renderCalendar(
            this.boardEl,
            {
                range,
                activeTab: dimension,
                anchorLabel: this.anchorLabel(anchor, range),
                blocks: buildCalendar(anchor, range, today),
                panelCards,
                cardsByDay,
                panelCollapsed: this.calendarPanelCollapsed,
                counts: { unplanned: unplanned.length, noDeadline: noDeadline.length }
            },
            {
                onOpen: (card, newTab) => this.openCard(card, newTab),
                onContextMenu: (card, event) => this.showCardMenu(card, event),
                onSwitchTab: (dim) => {
                    this.calendarTab = dim
                    this.rebuild()
                },
                onSetRange: (r) => {
                    this.calendarRangeOverride = r
                    this.rebuild()
                },
                onShiftAnchor: (direction) => {
                    this.calendarAnchor = shiftAnchor(this.effectiveAnchor(), range, direction)
                    this.rebuild()
                },
                onToday: () => {
                    this.calendarAnchor = null
                    this.rebuild()
                },
                onTogglePanel: () => {
                    this.calendarPanelCollapsed = !this.calendarPanelCollapsed
                    this.rebuild()
                }
            }
        )
    }

    /** The frontmatter property for the active scheduling dimension. */
    private activeDateProperty(): string {
        return this.calendarTab === 'scheduled' ? this.scheduledDateProperty : this.dueDateProperty
    }

    /**
     * Handle a calendar drag drop: dropping on a day writes the active
     * dimension's date (formatted with the profile's momentjs format); dropping
     * back on the panel clears it. The frontmatter write triggers a rebuild.
     */
    private async handleCalendarDrop(cardKey: string, target: CalendarDropTarget): Promise<void> {
        const card = this.cardsByKey.get(cardKey)
        if (!card) return
        const property = this.activeDateProperty()

        if (target.kind === 'panel') {
            await deleteProperty(this.app, card.file, property)
            return
        }

        const date = parseFrontmatterDate(target.dayKey)
        if (!date) return
        const dateFormat =
            this.profile.calendar.dateFormat || this.plugin.settings.defaultDateFormat
        await setProperty(this.app, card.file, property, formatDate(date, dateFormat))
    }

    private anchorLabel(anchor: Date, range: CalendarRange): string {
        const year = anchor.getFullYear()
        if (range === 'quarter') {
            return `Q${String(Math.floor(anchor.getMonth() / 3) + 1)} ${String(year)}`
        }
        if (range === 'year') return String(year)
        // week / month: the single block's own label is the clearest.
        return buildCalendar(anchor, range, anchor)[0]?.label ?? ''
    }

    // ── Archiving ─────────────────────────────────────────────

    /** Whether the active profile has a (non-blank) archive folder configured. */
    private archivingConfigured(): boolean {
        return this.profile.archive.archiveFolder.trim().length > 0
    }

    /**
     * Auto-archive when a card transitions INTO the configured trigger status.
     * Returns true when the note was archived (caller then skips order writes).
     * Opt-in: no trigger status, no archive folder, or a non-transition is a no-op.
     */
    private async maybeAutoArchive(card: KanbanCard, newStatus: string | null): Promise<boolean> {
        const trigger = this.profile.archive.triggerStatus
        if (!trigger || newStatus !== trigger) return false
        if (card.statusValue === newStatus) return false // already there — not a transition
        if (!this.archivingConfigured()) return false
        const result = await archiveNote(this.app, card.file, this.profile.archive)
        if (result.ok) {
            new Notice(`Archived "${card.title}" to ${result.destPath}`)
            return true
        }
        if (result.reason === 'error') {
            new Notice(`Archive failed: ${result.message ?? 'unknown error'}`)
        }
        return false
    }

    /** Manual archive (context menu). Warns about active relationships, then moves. */
    private async archiveCard(card: KanbanCard): Promise<void> {
        if (!this.archivingConfigured()) {
            new Notice('No archive folder configured. Set one in Configure board → Archiving.')
            return
        }
        this.warnActiveRelationships(card)
        const result = await archiveNote(this.app, card.file, this.profile.archive)
        if (result.ok) new Notice(`Archived "${card.title}" to ${result.destPath}`)
        else if (result.reason === 'error') {
            new Notice(`Archive failed: ${result.message ?? 'unknown error'}`)
        }
        // The moved note no longer matches the Base filter → onDataUpdated rebuilds.
    }

    /** Non-blocking heads-up when archiving a note with active children/blockers. */
    private warnActiveRelationships(card: KanbanCard): void {
        const children = card.relationships.child.length
        const blockers = card.relationships.blocked_by.length
        if (children === 0 && blockers === 0) return
        const parts: string[] = []
        if (children > 0) parts.push(`${String(children)} child note(s)`)
        if (blockers > 0) parts.push(`${String(blockers)} blocker(s)`)
        new Notice(
            `Archiving "${card.title}" — it still has ${parts.join(' and ')}. Links are kept.`
        )
    }
}

/** Relationship roles shown in the card context menu (blockers first). */
const RELATIONSHIP_MENU: Array<{ role: RelationshipRole; label: string; icon: string }> = [
    { role: 'blocked_by', label: 'Blocked by', icon: 'ban' },
    { role: 'parent', label: 'Parent', icon: 'corner-left-up' },
    { role: 'child', label: 'Child', icon: 'corner-right-down' },
    { role: 'sibling', label: 'Sibling', icon: 'arrow-left-right' }
]

/** Whether an event asks to open in a new tab (Ctrl/Cmd held). */
function isNewTabEvent(evt: MouseEvent | KeyboardEvent): boolean {
    return evt.ctrlKey || evt.metaKey
}

/** Read a stored multitext option into a clean string array. */
function readStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return value
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
    }
    return []
}

/**
 * Read the per-view swimlane grouping override. `__profile__` (or unset) means
 * "defer to the profile"; a `property` choice with no property picked also
 * defers (so the view never silently groups by nothing).
 */
function readLaneGroupingOverride(config: { get: (key: string) => unknown }): LaneGrouping | null {
    const kind = config.get('laneGrouping')
    if (kind === 'none') return { kind: 'none' }
    if (kind === 'note-type') return { kind: 'note-type' }
    if (kind === 'property') {
        const property = basesPropToName(config.get('laneGroupingProperty'))
        return property ? { kind: 'property', property } : null
    }
    return null
}

/** Normalize a raw frontmatter value into a swimlane key, or `null` (→ Ungrouped). */
function normalizeLaneValue(raw: unknown): string | null {
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        return trimmed.length > 0 ? trimmed : null
    }
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
    return null
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
