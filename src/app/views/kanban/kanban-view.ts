import { BasesView, debounce, getAllTags, Menu, Notice, TFile } from 'obsidian'
import type { Debouncer, QueryController } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../../plugin'
import {
    CSS_ROOT_CLASS,
    KANBAN_VIEW_TYPE,
    UNGROUPED_LANE_ID,
    UNMAPPED_COLUMN_ID
} from '../../constants'
import type {
    ArchiveConfig,
    CardPresentation,
    ColumnDef,
    LaneGrouping,
    Profile,
    RelationshipRole
} from '../../domain/profile'
import { buildBoard } from '../../domain/board-model'
import type { Board, UnmappedPosition } from '../../domain/board-model'
import { detectStatusProperty, normalizeStatusValue, splitStatusValue } from '../../domain/status'
import { passesFilter } from '../../domain/filtering'
import type { BlockedFilter, RelationalFilter } from '../../domain/filtering'
import type { RelationshipSet } from '../../domain/relationships'
import { isStarterKitAvailable, recognizeNoteType } from '../../services/starter-kit.service'
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
    findProfile,
    resolveActiveProfile,
    setCardPresentation
} from '../../services/profile-service'
import { buildCardDisplay } from '../../services/card-display.service'
import { archiveNote } from '../../services/archive.service'
import {
    addDays,
    buildCalendar,
    formatLongDate,
    parseFrontmatterDate,
    periodRange,
    shiftAnchor,
    startOfDay,
    toDateKey,
    weekdayLabels
} from '../../domain/calendar'
import type { CalendarRange, DateDimension } from '../../domain/calendar'
import { isEmptyQuery, matchesFilterQuery, parseFilterQuery } from '../../domain/filter-query'
import type { CardSearchRecord, FilterContext, FilterQuery } from '../../domain/filter-query'
import { compareTabCards } from '../../domain/calendar-tabs'
import type { TabSortKey, TabSortMode } from '../../domain/calendar-tabs'
import { renderCalendar } from '../../ui/calendar/calendar-renderer'
import type { CalendarEntry } from '../../ui/calendar/calendar-renderer'
import { CalendarDnd } from '../../ui/calendar/calendar-dnd'
import type { CalendarDropTarget } from '../../ui/calendar/calendar-dnd'
import { formatDate } from '../../utils/momentjs'
import { patchBoard } from '../../ui/board/board-renderer'
import { applyUniformCardHeight } from '../../ui/board/card-equalize'
import { BoardDnd } from '../../ui/board/dnd-controller'
import type { DropTarget } from '../../ui/board/dnd-controller'
import type { KanbanCard } from '../../ui/board/types'
import { renderViewToolbar } from '../../ui/view-toolbar'
import { FilterBar } from '../../ui/filter-bar'
import { DatePromptModal } from '../../ui/date-prompt-modal'
import { log } from '../../../utils/log'

/** The (untyped) settings controller exposed on `app.setting`. */
interface ObsidianSettings {
    open(): void
    openTabById(id: string): void
}

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
    private toolbarEl: HTMLElement | null = null
    private toolbarLeftEl: HTMLElement | null = null
    private toolbarRightEl: HTMLElement | null = null
    private filterEmptyEl: HTMLElement | null = null
    private filterBar: FilterBar | null = null
    private boardEl: HTMLElement | null = null
    private dnd: BoardDnd | null = null
    private calendarDnd: CalendarDnd | null = null
    private readonly debouncedRebuild: Debouncer<[], void>
    private readonly debouncedFilter: Debouncer<[], void>

    private statusProperty: string | null = null
    private orderProperty = 'manual_order'
    private dueDateProperty = 'date_due'
    private availableProperties: string[] = []
    private profile: Profile = createDefaultProfile(DEFAULT_PROFILE_ID, 'Default', 'local')
    private profileStatusValues: string[] | null = null
    private columns: ColumnDef[] = []
    private laneGrouping: LaneGrouping = { kind: 'none' }
    private laneValueByPath = new Map<string, string | null>()
    // Per-file note type (Starter Kit) and the archive config it resolves to.
    private noteTypeByPath = new Map<string, { id: string; name: string } | null>()
    private archiveByPath = new Map<string, ArchiveConfig>()
    private relationshipsByPath = new Map<string, RelationshipSet>()
    private readonly collapsedLanes = new Set<string>()
    private readonly collapsedColumns = new Set<string>()
    private board: Board<KanbanCard> = { lanes: [], isMultiLane: false }
    private cardsByKey = new Map<string, KanbanCard>()
    // After a keyboard move/reorder rebuild, refocus this card so focus follows it.
    private refocusCardKey: string | null = null

    // Filter bar (issue #34). `allCards`/`searchByKey` are the unfiltered set +
    // per-card search index; the parsed query filters them on each render.
    private allCards: KanbanCard[] = []
    private searchByKey = new Map<string, CardSearchRecord>()
    private filterQuery = ''
    private parsedQuery: FilterQuery = { groups: [] }
    private filterInitialized = false

    // Calendar mode (Milestone 5) — in-memory per-session view state.
    private scheduledDateProperty = 'date_scheduled'
    private calendarRangeOverride: CalendarRange | null = null
    private calendarTab: DateDimension = 'scheduled'
    private calendarAnchor: Date | null = null
    private calendarPanelCollapsed = false
    private calendarFocusedDay: string | null = null
    // Legend toggles: show planned work and/or deadlines on the grid (both on).
    private showScheduled = true
    private showDeadlines = true
    // Auto-collapse the scheduling pane when the container is too narrow.
    private panelAutoCollapsed = false
    private panelLastNarrow: boolean | null = null
    private resizeObserver: ResizeObserver | null = null
    private readonly debouncedResize: Debouncer<[], void>

    constructor(
        controller: QueryController,
        containerEl: HTMLElement,
        plugin: KanbanActionPlannerPlugin
    ) {
        super(controller)
        this.containerEl = containerEl
        this.plugin = plugin
        this.debouncedRebuild = debounce(() => void this.resolveAndRebuild(), 250)
        this.debouncedResize = debounce(() => this.onResize(), 120)
        this.debouncedFilter = debounce(() => this.commitFilter(), 150)
    }

    override onload(): void {
        this.rootEl = this.containerEl.createDiv({ cls: CSS_ROOT_CLASS })
        // Toolbar controls are rendered in rebuild(), once `this.config` is
        // populated — reading it here (onload) would throw. The three slots are
        // created now: left (mode switch) and right (lane nav + gear) are
        // re-rendered each rebuild; the middle filter input is persistent so it
        // never loses focus mid-typing. Its initial value loads on first rebuild.
        this.toolbarEl = this.rootEl.createDiv({ cls: 'kap-toolbar' })
        this.toolbarLeftEl = this.toolbarEl.createDiv({ cls: 'kap-toolbar-left' })
        this.filterBar = new FilterBar(this.toolbarEl, '', {
            onInput: (value) => this.onFilterInput(value),
            onClear: () => this.onFilterClear()
        })
        this.toolbarRightEl = this.toolbarEl.createDiv({ cls: 'kap-toolbar-right' })
        this.filterEmptyEl = this.rootEl.createDiv({
            cls: 'kap-filter-empty kap-hidden',
            text: 'No cards match the filter.'
        })
        this.boardEl = this.rootEl.createDiv({ cls: 'kap-board-host' })
        this.dnd = new BoardDnd(this.boardEl, {
            onDrop: (cardKey, target) => void this.handleDrop(cardKey, target)
        })
        this.calendarDnd = new CalendarDnd(this.boardEl, {
            onDrop: (cardKey, target, dimension) =>
                void this.handleCalendarDrop(cardKey, target, dimension)
        })
        this.resizeObserver = new ResizeObserver(() => this.debouncedResize())
        this.resizeObserver.observe(this.boardEl)
        this.plugin.trackKanbanView(this)
        void this.resolveAndRebuild()
    }

    override onunload(): void {
        this.plugin.untrackKanbanView(this)
        this.resizeObserver?.disconnect()
        this.resizeObserver = null
        this.dnd?.destroy()
        this.dnd = null
        this.calendarDnd?.destroy()
        this.calendarDnd = null
        this.filterBar?.destroy()
        this.filterBar = null
        this.rootEl?.remove()
        this.rootEl = null
        this.toolbarEl = null
        this.toolbarLeftEl = null
        this.toolbarRightEl = null
        this.filterEmptyEl = null
        this.boardEl = null
    }

    override onDataUpdated(): void {
        this.debouncedRebuild()
    }

    // ── Public command surface (issue #27) ───────────────────

    /** Switch between board and calendar mode. */
    toggleMode(): void {
        this.setCalendarMode(!this.calendarMode())
    }

    /** Put the cursor in the filter box. */
    focusFilter(): void {
        this.filterBar?.focus()
    }

    /** Clear the filter query (input + state). */
    clearFilter(): void {
        this.filterBar?.setValue('')
        this.onFilterClear()
    }

    /** Scroll to the next/previous swimlane (multi-lane boards). */
    goToLane(direction: 1 | -1): void {
        this.scrollLane(direction)
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
        // Recognize each file's note type once (Starter Kit only) — shared by
        // swimlanes and per-type archiving.
        this.noteTypeByPath = isStarterKitAvailable(this.app)
            ? await this.recognizeNoteTypes(files)
            : new Map()
        this.laneGrouping = this.resolveLaneGrouping()
        this.laneValueByPath = this.computeLaneValues(files, this.laneGrouping)
        this.archiveByPath = this.computeArchiveByPath(files)
        this.rebuild()
    }

    /** Recognize the Starter Kit note type of every file. */
    private async recognizeNoteTypes(
        files: TFile[]
    ): Promise<Map<string, { id: string; name: string } | null>> {
        const map = new Map<string, { id: string; name: string } | null>()
        for (const file of files) {
            const type = await recognizeNoteType(this.app, file)
            map.set(file.path, type ? { id: type.id, name: type.name } : null)
        }
        return map
    }

    /**
     * Resolve each card's archive config by its note type: a recognized type uses
     * its own profile's archive (so a mixed board files each type where it
     * belongs); untyped cards fall back to the active/default profile.
     */
    private computeArchiveByPath(files: TFile[]): Map<string, ArchiveConfig> {
        const map = new Map<string, ArchiveConfig>()
        const byType = new Map<string, ArchiveConfig>()
        const empty: ArchiveConfig = { archiveFolder: '', triggerStatuses: [] }
        for (const file of files) {
            const type = this.noteTypeByPath.get(file.path) ?? null
            if (!type) {
                map.set(file.path, this.profile.archive)
                continue
            }
            let config = byType.get(type.id)
            if (!config) {
                config = findProfile(this.plugin, type.id)?.archive ?? empty
                byType.set(type.id, config)
            }
            map.set(file.path, config)
        }
        return map
    }

    /** The archive config that applies to a card (by its note type). */
    private archiveConfigFor(card: KanbanCard): ArchiveConfig {
        return this.archiveByPath.get(card.key) ?? this.profile.archive
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
    private computeLaneValues(files: TFile[], grouping: LaneGrouping): Map<string, string | null> {
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
        // note-type grouping reuses the recognition done in resolveAndRebuild.
        for (const file of files) {
            map.set(file.path, this.noteTypeByPath.get(file.path)?.name ?? null)
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
        this.loadFilterQuery()

        const filter = this.relationalFilter()
        this.allCards = files
            .map((file) => this.toCard(file))
            .filter((card) => passesFilter(this.relationshipsByPath.get(card.key), filter))
        this.searchByKey = new Map(this.allCards.map((c) => [c.key, this.buildSearchRecord(c)]))

        this.applyFilterAndRender()
    }

    /**
     * Apply the text filter to the already-built card set and (re-)render the
     * board or calendar. Split out from {@link rebuild} so a filter keystroke
     * re-renders without re-deriving cards/relationships (and without touching
     * the persistent filter input, so focus is never stolen mid-typing).
     */
    private applyFilterAndRender(): void {
        if (!this.boardEl) return

        const active = !isEmptyQuery(this.parsedQuery)
        const ctx = this.filterContext()
        const cards = active
            ? this.allCards.filter((c) => {
                  const rec = this.searchByKey.get(c.key)
                  return rec ? matchesFilterQuery(rec, this.parsedQuery, ctx) : true
              })
            : this.allCards
        this.cardsByKey = new Map(cards.map((c) => [c.key, c]))
        this.filterBar?.setCount(active ? cards.length : null)
        this.filterEmptyEl?.toggleClass('kap-hidden', !(active && cards.length === 0))

        if (this.calendarMode()) {
            this.renderToolbar(false)
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
        this.renderToolbar(this.board.lanes.length > 1)

        log(
            `Kanban rebuild: ${String(cards.length)}/${String(this.allCards.length)} cards, ${String(this.columns.length)} columns, ${String(board.lanes.length)} lane(s), profile "${this.profile.name}"`,
            'debug'
        )

        // Anchor the horizontal scroll on the column the user is looking at, so a
        // structural change (notably the Unmapped column appearing/disappearing at
        // the left edge) doesn't shift the visible columns sideways (issue #12).
        const anchor = this.captureColumnAnchor()
        patchBoard(
            this.boardEl,
            this.board,
            {
                onOpen: (card, newTab) => this.openCard(card, newTab),
                onContextMenu: (card, event) => this.showCardMenu(card, event),
                onToggleLane: (laneId) => this.toggleLane(laneId),
                onToggleColumn: (columnId) => this.toggleColumn(columnId),
                onRelationship: (card, role, event) => this.showRelatedMenu(card, role, event),
                onMoveColumn: (card, direction) => this.moveCardColumn(card, direction),
                onReorderCard: (card, direction) => this.reorderCard(card, direction),
                onKeyboardMenu: (card, cardEl) => this.showCardMenuAt(card, cardEl)
            },
            this.collapsedLanes,
            this.collapsedColumns
        )
        this.restoreColumnAnchor(anchor)
        this.applyRefocus()

        // All cards share one height (the tallest card's), recomputed here since
        // the card set / content just changed. Synchronous (before paint) so
        // cards never flash at uneven heights.
        this.equalizeCardHeights()
    }

    /** Refocus the card a keyboard move/reorder acted on, so focus follows it. */
    private applyRefocus(): void {
        if (!this.refocusCardKey || !this.boardEl) return
        const el = this.boardEl.querySelector<HTMLElement>(
            `.kap-card[data-card-key="${cssEscapeId(this.refocusCardKey)}"]`
        )
        this.refocusCardKey = null
        el?.focus()
    }

    /**
     * Record the leftmost on-screen column and its offset from the scroller's
     * left edge, so the same column can be pinned back to that spot after a
     * re-render. Reads the first column board (columns are identical per lane).
     */
    private captureColumnAnchor(): { id: string; offset: number } | null {
        const scroller = this.boardEl?.querySelector<HTMLElement>('.kap-board')
        if (!scroller) return null
        const sRect = scroller.getBoundingClientRect()
        const cols = Array.from(scroller.querySelectorAll<HTMLElement>(':scope > .kap-column'))
        const anchorEl =
            cols.find((c) => c.getBoundingClientRect().right > sRect.left + 1) ?? cols[0]
        const id = anchorEl?.dataset['columnId']
        if (!anchorEl || !id) return null
        return { id, offset: anchorEl.getBoundingClientRect().left - sRect.left }
    }

    /** Pin the anchored column back to its captured offset, in every lane board. */
    private restoreColumnAnchor(anchor: { id: string; offset: number } | null): void {
        if (!anchor || !this.boardEl) return
        const escaped = cssEscapeId(anchor.id)
        for (const scroller of Array.from(
            this.boardEl.querySelectorAll<HTMLElement>('.kap-board')
        )) {
            const el = scroller.querySelector<HTMLElement>(
                `:scope > .kap-column[data-column-id="${escaped}"]`
            )
            if (!el) continue
            const delta = el.getBoundingClientRect().left - scroller.getBoundingClientRect().left
            scroller.scrollLeft += delta - anchor.offset
        }
    }

    /**
     * Make every card the same size board-wide by sizing them to the tallest
     * card's natural height. Board mode only — the calendar has no cards.
     */
    private equalizeCardHeights(): void {
        if (!this.boardEl || this.calendarMode()) return
        applyUniformCardHeight(this.boardEl)
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

    private toggleColumn(columnId: string): void {
        if (this.collapsedColumns.has(columnId)) this.collapsedColumns.delete(columnId)
        else this.collapsedColumns.add(columnId)
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
        const display = buildCardDisplay(
            this.app,
            file,
            this.cardPresentationFor(file),
            this.dueDateProperty,
            startOfDay(new Date())
        )
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

    /**
     * The profile whose card config drives a file's display: its recognized
     * note-type profile when available, else the board's active profile. This is
     * what makes a mixed board show each note type's own fields, and what the
     * card's "Show fields" menu edits.
     */
    private cardDisplayProfile(file: TFile): Profile {
        const type = this.noteTypeByPath.get(file.path)
        if (type) {
            const typeProfile = findProfile(this.plugin, type.id)
            if (typeProfile) return typeProfile
        }
        return this.profile
    }

    /** The card-presentation config for a file (by its note type). */
    private cardPresentationFor(file: TFile): CardPresentation {
        return this.cardDisplayProfile(file).card
    }

    /**
     * Candidate property names for a card's "Show fields" menu: every frontmatter
     * key found on notes of the same recognized note type (so the list is
     * type-relevant), plus any already-displayed field (so it can be unchecked).
     */
    private displayFieldCandidates(card: KanbanCard, presentation: CardPresentation): string[] {
        const type = this.noteTypeByPath.get(card.key) ?? null
        const names = new Set<string>()
        for (const file of this.files()) {
            if (type && this.noteTypeByPath.get(file.path)?.id !== type.id) continue
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
            if (fm) for (const key of Object.keys(fm)) names.add(key)
        }
        for (const field of presentation.fields) names.add(field.property)
        return Array.from(names)
            .filter((n) => n.length > 0)
            .sort((a, b) => a.localeCompare(b))
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

    /**
     * Open the plugin settings (Note types). Note-type config — colors, cards,
     * relationships, archiving — lives centrally there, not per board, so the
     * board's gear just jumps to it.
     */
    private openSettings(): void {
        const setting = (this.app as unknown as { setting?: ObsidianSettings }).setting
        setting?.open()
        setting?.openTabById(this.plugin.manifest.id)
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
        this.buildCardMenu(card).showAtMouseEvent(event)
    }

    /** Keyboard-triggered card menu, anchored just below the card (issue #20). */
    private showCardMenuAt(card: KanbanCard, cardEl: HTMLElement): void {
        const rect = cardEl.getBoundingClientRect()
        this.buildCardMenu(card).showAtPosition({ x: rect.left, y: rect.bottom })
    }

    private buildCardMenu(card: KanbanCard): Menu {
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
        this.addSchedulingMenuItems(menu, card)
        if (this.archivingConfigured(card)) {
            menu.addSeparator()
            menu.addItem((item) =>
                item
                    .setTitle('Archive')
                    .setIcon('archive')
                    .onClick(() => void this.archiveCard(card))
            )
        }
        this.addDisplayFieldMenuItems(menu, card)
        this.addRelationshipMenuItems(menu, card)
        return menu
    }

    // ── Keyboard move & reorder (issue #20) ───────────────────

    /** Locate a card within the current board (lane, column index, card index). */
    private cardLocation(
        card: KanbanCard
    ): {
        laneId: string
        columns: Board<KanbanCard>['lanes'][number]['columns']
        colIndex: number
        cardIndex: number
    } | null {
        for (const lane of this.board.lanes) {
            for (let colIndex = 0; colIndex < lane.columns.length; colIndex++) {
                const column = lane.columns[colIndex]
                if (!column) continue
                const cardIndex = column.cards.findIndex((c) => c.key === card.key)
                if (cardIndex >= 0) {
                    return { laneId: lane.lane.id, columns: lane.columns, colIndex, cardIndex }
                }
            }
        }
        return null
    }

    /** Keyboard: move a card to the adjacent column (writes status; focus follows). */
    private moveCardColumn(card: KanbanCard, direction: 1 | -1): void {
        const loc = this.cardLocation(card)
        if (!loc) return
        const target = loc.columns[loc.colIndex + direction]
        if (!target) return // at the first/last column
        const newStatus = target.column.id === UNMAPPED_COLUMN_ID ? null : target.column.statusValue
        this.refocusCardKey = card.key
        void this.applyMove(card, newStatus, loc.laneId, target.column.id, target.cards.length)
    }

    /** Keyboard: reorder a card up/down within its column (writes manual order). */
    private reorderCard(card: KanbanCard, direction: 1 | -1): void {
        const loc = this.cardLocation(card)
        if (!loc) return
        const column = loc.columns[loc.colIndex]
        if (!column) return
        const target = loc.cardIndex + direction
        if (target < 0 || target >= column.cards.length) return // at the top/bottom
        this.refocusCardKey = card.key
        void this.applyMove(card, card.statusValue, loc.laneId, column.column.id, target)
    }

    /**
     * "Show fields" submenu: a checkable list of candidate properties for the
     * card's note type. Toggling one adds/removes it from that note type's card
     * config; the change persists and every open board refreshes (via
     * {@link onSettingsChanged}).
     */
    private addDisplayFieldMenuItems(menu: Menu, card: KanbanCard): void {
        const profile = this.cardDisplayProfile(card.file)
        const candidates = this.displayFieldCandidates(card, profile.card)
        if (candidates.length === 0) return

        menu.addSeparator()
        menu.addItem((item) => {
            item.setTitle('Show fields').setIcon('list')
            const submenu = item.setSubmenu()
            for (const property of candidates) {
                const shown = profile.card.fields.some((f) => f.property === property)
                submenu.addItem((sub) =>
                    sub
                        .setTitle(property)
                        .setChecked(shown)
                        .onClick(() => void this.toggleDisplayField(profile.id, property))
                )
            }
        })
    }

    /** Add or remove a property from a note type's displayed card fields. */
    private async toggleDisplayField(profileId: string, property: string): Promise<void> {
        const profile = findProfile(this.plugin, profileId)
        if (!profile) return
        const exists = profile.card.fields.some((f) => f.property === property)
        const fields = exists
            ? profile.card.fields.filter((f) => f.property !== property)
            : [...profile.card.fields, { property, showLabel: false, emphasis: 'normal' as const }]
        await setCardPresentation(this.plugin, profileId, { ...profile.card, fields })
    }

    /**
     * A profile/settings change landed (from this board's menus or the settings
     * tab): re-resolve and re-render so card display reflects the new config.
     */
    onSettingsChanged(): void {
        this.debouncedRebuild()
    }

    /** "Schedule" / "Set deadline" quick dates + precise picker + clear. */
    private addSchedulingMenuItems(menu: Menu, card: KanbanCard): void {
        const todayKey = toDateKey(startOfDay(new Date()))
        const tomorrowKey = toDateKey(addDays(startOfDay(new Date()), 1))
        const scheduled = this.cardDate(card, 'scheduled')
        const deadline = this.cardDate(card, 'deadline')

        menu.addItem((i) =>
            i
                .setTitle('Schedule for today')
                .setIcon('calendar-clock')
                .setSection('kap-schedule')
                .onClick(() => void this.writeCardDate(card, 'scheduled', todayKey))
        )
        menu.addItem((i) =>
            i
                .setTitle('Schedule for tomorrow')
                .setIcon('calendar-clock')
                .setSection('kap-schedule')
                .onClick(() => void this.writeCardDate(card, 'scheduled', tomorrowKey))
        )
        menu.addItem((i) =>
            i
                .setTitle('Schedule on a date…')
                .setIcon('calendar')
                .setSection('kap-schedule')
                .onClick(() => this.promptDate(card, 'scheduled', scheduled))
        )
        if (scheduled) {
            menu.addItem((i) =>
                i
                    .setTitle('Clear scheduled date')
                    .setIcon('x')
                    .setSection('kap-schedule')
                    .onClick(() => void this.writeCardDate(card, 'scheduled', null))
            )
        }

        menu.addItem((i) =>
            i
                .setTitle('Set deadline today')
                .setIcon('alarm-clock')
                .setSection('kap-deadline')
                .onClick(() => void this.writeCardDate(card, 'deadline', todayKey))
        )
        menu.addItem((i) =>
            i
                .setTitle('Set deadline on a date…')
                .setIcon('alarm-clock')
                .setSection('kap-deadline')
                .onClick(() => this.promptDate(card, 'deadline', deadline))
        )
        if (deadline) {
            menu.addItem((i) =>
                i
                    .setTitle('Clear deadline')
                    .setIcon('x')
                    .setSection('kap-deadline')
                    .onClick(() => void this.writeCardDate(card, 'deadline', null))
            )
        }
    }

    /** Read a card's scheduled/deadline date (null when unset). */
    private cardDate(card: KanbanCard, dimension: DateDimension): Date | null {
        const property =
            dimension === 'scheduled' ? this.scheduledDateProperty : this.dueDateProperty
        return parseFrontmatterDate(getFrontmatterValue(this.app, card.file, property))
    }

    /** Open the date picker for a card's scheduled date or deadline. */
    private promptDate(card: KanbanCard, dimension: DateDimension, current: Date | null): void {
        const heading = dimension === 'scheduled' ? 'Schedule date' : 'Deadline'
        new DatePromptModal(this.app, heading, current ? toDateKey(current) : '', (iso) => {
            void this.writeCardDate(card, dimension, iso)
        }).open()
    }

    /** Write (or clear, when `isoDate` is null) a card's scheduled date or deadline. */
    private async writeCardDate(
        card: KanbanCard,
        dimension: DateDimension,
        isoDate: string | null
    ): Promise<void> {
        const property =
            dimension === 'scheduled' ? this.scheduledDateProperty : this.dueDateProperty
        if (isoDate === null) {
            await deleteProperty(this.app, card.file, property)
            return
        }
        const date = parseFrontmatterDate(isoDate)
        if (!date) return
        const dateFormat =
            this.profile.calendar.dateFormat || this.plugin.settings.defaultDateFormat
        await setProperty(this.app, card.file, property, formatDate(date, dateFormat))
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

    /** (Re)render the toolbar's mode + action slots (the filter slot is persistent). */
    private renderToolbar(showLaneNav: boolean): void {
        if (!this.toolbarLeftEl || !this.toolbarRightEl) return
        renderViewToolbar(
            this.toolbarLeftEl,
            this.toolbarRightEl,
            { calendarMode: this.calendarMode(), showLaneNav },
            {
                onSetCalendarMode: (calendar) => this.setCalendarMode(calendar),
                onConfigure: () => this.openSettings(),
                onLanePrev: () => this.scrollLane(-1),
                onLaneNext: () => this.scrollLane(1)
            }
        )
    }

    // ── Filter bar (issue #34) ────────────────────────────────

    /** Load the persisted filter query on first rebuild and sync the input. */
    private loadFilterQuery(): void {
        if (this.filterInitialized) return
        this.filterInitialized = true
        const stored = this.config.get('filterQuery')
        this.filterQuery = typeof stored === 'string' ? stored : ''
        this.parsedQuery = parseFilterQuery(this.filterQuery)
        this.filterBar?.setValue(this.filterQuery)
    }

    /** Keystroke in the filter input: parse now, persist + re-render debounced. */
    private onFilterInput(value: string): void {
        this.filterQuery = value
        this.parsedQuery = parseFilterQuery(value)
        this.debouncedFilter()
    }

    /** Clear button / Esc: reset and re-render immediately. */
    private onFilterClear(): void {
        this.filterQuery = ''
        this.parsedQuery = parseFilterQuery('')
        this.config.set('filterQuery', '')
        this.applyFilterAndRender()
    }

    /** Persist the current query and re-render (debounced target). */
    private commitFilter(): void {
        this.config.set('filterQuery', this.filterQuery)
        this.applyFilterAndRender()
    }

    /** The `due:` evaluation context (today + calendar period ranges). */
    private filterContext(): FilterContext {
        const today = startOfDay(new Date())
        const firstDay = this.plugin.settings.firstDayOfWeek
        return {
            today,
            periods: {
                week: periodRange('week', today, firstDay),
                month: periodRange('month', today, firstDay),
                quarter: periodRange('quarter', today, firstDay),
                year: periodRange('year', today, firstDay)
            }
        }
    }

    /** Build a card's lowercased search index from the metadata cache. */
    private buildSearchRecord(card: KanbanCard): CardSearchRecord {
        const file = card.file
        const cache = this.app.metadataCache.getFileCache(file)
        const frontmatter = cache?.frontmatter ?? {}
        const props = new Map<string, string[]>()
        const haystack: string[] = [card.display.title]

        for (const [key, raw] of Object.entries(frontmatter)) {
            const values = stringifyForSearch(raw)
            if (values.length === 0) continue
            const lowered = values.map((v) => v.toLowerCase())
            props.set(key.toLowerCase(), lowered)
            haystack.push(...lowered)
        }

        const tags = (cache ? (getAllTags(cache) ?? []) : []).map((t) =>
            t.replace(/^#/, '').toLowerCase()
        )
        haystack.push(...tags)

        const rels: Record<RelationshipRole, string[]> = {
            parent: card.relationships.parent.map((r) => r.label.toLowerCase()),
            sibling: card.relationships.sibling.map((r) => r.label.toLowerCase()),
            child: card.relationships.child.map((r) => r.label.toLowerCase()),
            blocked_by: card.relationships.blocked_by.map((r) => r.label.toLowerCase())
        }
        for (const list of Object.values(rels)) haystack.push(...list)

        const statusText: string[] = []
        if (card.statusValue) {
            statusText.push(card.statusValue.toLowerCase())
            statusText.push(splitStatusValue(card.statusValue).label.toLowerCase())
        }

        const due = parseFrontmatterDate(getFrontmatterValue(this.app, file, this.dueDateProperty))

        return {
            title: card.display.title.toLowerCase(),
            haystack: haystack.join('  ').toLowerCase(),
            statusText,
            rels,
            tags,
            due,
            props
        }
    }

    /** Smooth-scroll the swimlane container to the previous/next lane. */
    private scrollLane(direction: number): void {
        const lanesEl = this.boardEl?.querySelector<HTMLElement>(':scope > .kap-lanes')
        if (!lanesEl) return
        const lanes = Array.from(lanesEl.querySelectorAll<HTMLElement>(':scope > .kap-lane'))
        if (lanes.length === 0) return
        const containerTop = lanesEl.getBoundingClientRect().top
        const tops = lanes.map(
            (l) => l.getBoundingClientRect().top - containerTop + lanesEl.scrollTop
        )
        const current = tops.reduce((acc, top, i) => (top <= lanesEl.scrollTop + 4 ? i : acc), 0)
        const target = Math.max(0, Math.min(lanes.length - 1, current + direction))
        const targetTop = tops[target]
        if (targetTop === undefined) return
        // Obsidian's Electron build doesn't honor smooth scrollTo on overflow
        // containers, so jump instantly.
        lanesEl.scrollTo({ top: targetTop, behavior: 'auto' })
    }

    /** Persist the board/calendar mode and re-render in place (rebuild() re-renders the toolbar). */
    private setCalendarMode(calendar: boolean): void {
        if (this.calendarMode() === calendar) return
        this.config.set('calendarMode', calendar)
        this.rebuild()
        // Re-evaluate the auto-collapse for the (now visible) scheduling pane.
        this.panelLastNarrow = null
        this.evaluatePanelAutoCollapse()
    }

    /**
     * Container resized: re-evaluate the calendar pane auto-collapse and re-equalize
     * card heights (a narrower column rewraps titles, changing the tallest card).
     */
    private onResize(): void {
        this.evaluatePanelAutoCollapse()
        this.equalizeCardHeights()
    }

    /**
     * Collapse the scheduling pane automatically when the calendar container is
     * too narrow to show it comfortably, and restore it when there's room again
     * — but only on a width-category change, so a manual toggle is never fought.
     */
    private evaluatePanelAutoCollapse(): void {
        if (!this.boardEl || !this.calendarMode()) {
            this.panelLastNarrow = null
            return
        }
        const width = this.boardEl.clientWidth
        if (width === 0) return
        const root = this.boardEl.ownerDocument.documentElement
        const remPx = parseFloat(getComputedStyle(root).fontSize) || 16
        const narrow = width < 36 * remPx
        if (narrow === this.panelLastNarrow) return
        this.panelLastNarrow = narrow
        if (narrow && !this.calendarPanelCollapsed) {
            this.calendarPanelCollapsed = true
            this.panelAutoCollapsed = true
            this.rebuild()
        } else if (!narrow && this.panelAutoCollapsed) {
            this.calendarPanelCollapsed = false
            this.panelAutoCollapsed = false
            this.rebuild()
        }
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
        const panelCards = this.sortFilterPanel(dimension === 'scheduled' ? unplanned : noDeadline)

        // Unified overlay: every card is placed on BOTH its scheduled day (blue)
        // and its deadline (orange); same-day collapses to one "both" chip.
        const cardsByDay = new Map<string, CalendarEntry[]>()
        const place = (key: string, entry: CalendarEntry): void => {
            const arr = cardsByDay.get(key)
            if (arr) arr.push(entry)
            else cardsByDay.set(key, [entry])
        }
        for (const card of cards) {
            const sched = this.showScheduled ? dateFor(card, 'scheduled') : null
            const due = this.showDeadlines ? dateFor(card, 'deadline') : null
            if (sched && due && toDateKey(sched) === toDateKey(due)) {
                place(toDateKey(sched), { card, kind: 'both', overdue: due < today })
            } else {
                if (sched) place(toDateKey(sched), { card, kind: 'scheduled', overdue: false })
                if (due) place(toDateKey(due), { card, kind: 'deadline', overdue: due < today })
            }
        }
        const firstDay = this.plugin.settings.firstDayOfWeek

        renderCalendar(
            this.boardEl,
            {
                range,
                activeTab: dimension,
                anchorLabel: this.anchorLabel(anchor, range),
                blocks: buildCalendar(anchor, range, today, firstDay),
                panelCards,
                cardsByDay,
                panelCollapsed: this.calendarPanelCollapsed,
                counts: { unplanned: unplanned.length, noDeadline: noDeadline.length },
                showScheduled: this.showScheduled,
                showDeadlines: this.showDeadlines,
                weekdays: weekdayLabels(firstDay),
                focusedDay: this.calendarFocusedDay,
                focusedDayLabel: this.focusedDayLabel()
            },
            {
                onOpen: (card, newTab) => this.openCard(card, newTab),
                onContextMenu: (card, event) => this.showCardMenu(card, event),
                onSwitchTab: (dim) => {
                    this.calendarTab = dim
                    this.rebuild()
                },
                onToggleDimension: (dim) => {
                    if (dim === 'scheduled') this.showScheduled = !this.showScheduled
                    else this.showDeadlines = !this.showDeadlines
                    this.rebuild()
                },
                onSetRange: (r) => {
                    this.calendarRangeOverride = r
                    this.calendarFocusedDay = null // leaving the focused day on a range change
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
                    this.panelAutoCollapsed = false
                    this.rebuild()
                },
                onFocusDay: (dayKey) => {
                    this.calendarFocusedDay = dayKey
                    this.rebuild()
                },
                onClearFocus: () => {
                    this.calendarFocusedDay = null
                    this.rebuild()
                },
                onFocusShift: (direction) => {
                    const current = parseFrontmatterDate(this.calendarFocusedDay)
                    if (current) this.calendarFocusedDay = toDateKey(addDays(current, direction))
                    this.rebuild()
                },
                onFocusToday: () => {
                    this.calendarFocusedDay = toDateKey(startOfDay(new Date()))
                    this.rebuild()
                }
            }
        )
    }

    /** Long label for the focused day (empty when no day is focused). */
    private focusedDayLabel(): string {
        const date = parseFrontmatterDate(this.calendarFocusedDay)
        return date ? formatLongDate(date) : ''
    }

    /** Sort the scheduling-panel cards (the toolbar filter already narrowed them). */
    private sortFilterPanel(cards: KanbanCard[]): KanbanCard[] {
        const mode = readSortMode(this.config.get('calendarTabSort'))
        const sortProperty =
            mode === 'property' ? basesPropToName(this.config.get('calendarSortProperty')) : null
        return cards
            .map((card) => ({ card, key: this.tabSortKey(card, sortProperty) }))
            .sort((a, b) => compareTabCards(a.key, b.key, mode))
            .map((e) => e.card)
    }

    private tabSortKey(card: KanbanCard, sortProperty: string | null): TabSortKey {
        const tags = this.cardTags(card.file)
        const sortValue = sortProperty
            ? coerceSortValue(getFrontmatterValue(this.app, card.file, sortProperty))
            : null
        return {
            title: card.display.title,
            order: card.order,
            sortValue,
            searchText: `${card.display.title} ${tags.join(' ')}`.toLowerCase()
        }
    }

    private cardTags(file: TFile): string[] {
        const cache = this.app.metadataCache.getFileCache(file)
        return cache ? (getAllTags(cache) ?? []) : []
    }

    /**
     * Handle a calendar drag drop: dropping on a day writes the active
     * dimension's date (formatted with the profile's momentjs format); dropping
     * back on the panel clears it. The frontmatter write triggers a rebuild.
     */
    /** The frontmatter date properties a drag of `dimension` writes/clears. */
    private propertiesForDimension(dimension: string): string[] {
        if (dimension === 'deadline') return [this.dueDateProperty]
        if (dimension === 'both') return [this.scheduledDateProperty, this.dueDateProperty]
        return [this.scheduledDateProperty]
    }

    private async handleCalendarDrop(
        cardKey: string,
        target: CalendarDropTarget,
        dimension: string
    ): Promise<void> {
        const card = this.cardsByKey.get(cardKey)
        if (!card) return
        const properties = this.propertiesForDimension(dimension)

        if (target.kind === 'panel') {
            for (const property of properties) await deleteProperty(this.app, card.file, property)
            return
        }

        const date = parseFrontmatterDate(target.dayKey)
        if (!date) return
        const dateFormat =
            this.profile.calendar.dateFormat || this.plugin.settings.defaultDateFormat
        const value = formatDate(date, dateFormat)
        for (const property of properties) await setProperty(this.app, card.file, property, value)
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

    /** Whether the card's note type has a (non-blank) archive folder configured. */
    private archivingConfigured(card: KanbanCard): boolean {
        return this.archiveConfigFor(card).archiveFolder.trim().length > 0
    }

    /**
     * Auto-archive when a card transitions INTO its note type's trigger status.
     * Returns true when the note was archived (caller then skips order writes).
     * Opt-in: no trigger status, no archive folder, or a non-transition is a no-op.
     */
    private async maybeAutoArchive(card: KanbanCard, newStatus: string | null): Promise<boolean> {
        const archive = this.archiveConfigFor(card)
        if (newStatus === null || !archive.triggerStatuses.includes(newStatus)) return false
        if (card.statusValue === newStatus) return false // already there — not a transition
        if (archive.archiveFolder.trim().length === 0) return false
        const result = await archiveNote(this.app, card.file, archive)
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
        const archive = this.archiveConfigFor(card)
        if (archive.archiveFolder.trim().length === 0) {
            new Notice(
                'No archive folder configured for this note type. Set one in Configure board → Archiving.'
            )
            return
        }
        this.warnActiveRelationships(card)
        const result = await archiveNote(this.app, card.file, archive)
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

/** Escape a value for use inside a `[data-…="…"]` attribute selector. */
function cssEscapeId(value: string): string {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/["\\]/g, '\\$&')
}

/** Flatten a frontmatter value into searchable strings (scalars only; objects skipped). */
function stringifyForSearch(raw: unknown): string[] {
    if (raw === null || raw === undefined) return []
    if (typeof raw === 'string') return raw.trim() ? [raw] : []
    if (typeof raw === 'number' || typeof raw === 'boolean') return [String(raw)]
    if (Array.isArray(raw)) return raw.flatMap((v) => stringifyForSearch(v))
    return []
}

/** Read the scheduling-panel sort mode, defaulting to manual order. */
function readSortMode(value: unknown): TabSortMode {
    return value === 'name' || value === 'property' ? value : 'order'
}

/** Coerce a frontmatter value into a sortable number/string, or null. */
function coerceSortValue(raw: unknown): number | string | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed.length === 0) return null
        const n = Number(trimmed)
        return Number.isFinite(n) ? n : trimmed
    }
    return null
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
