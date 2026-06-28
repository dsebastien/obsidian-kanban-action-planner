import { BasesView, debounce, Menu, Notice, TFile } from 'obsidian'
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
    NoteType,
    RelationshipRole
} from '../../domain/note-type'
import { archiveFolderPrefixes } from '../../domain/archive-paths'
import { buildBoard } from '../../domain/board-model'
import { compareTabCards, coerceSortValue } from '../../domain/calendar-tabs'
import type { SortDirection, TabSortKey, TabSortMode } from '../../domain/calendar-tabs'
import type { Board, UnmappedPosition } from '../../domain/board-model'
import { detectStatusProperty, normalizeStatusValue } from '../../domain/status'
import { passesFilter } from '../../domain/filtering'
import type { BlockedFilter, RelationalFilter } from '../../domain/filtering'
import type { RelationshipSet } from '../../domain/relationships'
import {
    addRelationshipLink,
    directLinkTargets,
    removeRelationshipLink,
    resolveBoardRelationships,
    roleProperties,
    toCardRelationships
} from '../../services/relationships.service'
import type { RelatedNote } from '../../services/relationships.service'
import { RELATIONSHIP_ROLES } from '../../domain/relationships'
import { RelationshipTargetModal } from '../../ui/relationship-target-modal'
import { planInsertion } from '../../domain/ordering'
import {
    coerceOrder,
    deleteProperty,
    getFrontmatterValue,
    setProperty
} from '../../services/frontmatter.service'
import {
    DEFAULT_NOTE_TYPE_ID,
    columnsFromValues,
    createDefaultNoteType,
    findNoteType,
    recognizeNoteTypeFor,
    resolveActiveNoteType,
    setCardPresentation
} from '../../services/note-type.service'
import { buildCardDisplay } from '../../services/card-display.service'
import { buildCardSearchRecord } from '../../services/card-search.service'
import { archiveNote } from '../../services/archive.service'
import {
    addDays,
    parseFrontmatterDate,
    periodRange,
    startOfDay,
    toDateKey
} from '../../domain/calendar'
import type { DateDimension } from '../../domain/calendar'
import { isEmptyQuery, matchesFilterQuery, parseFilterQuery } from '../../domain/filter-query'
import type { CardSearchRecord, FilterContext, FilterQuery } from '../../domain/filter-query'
import { CalendarDnd } from '../../ui/calendar/calendar-dnd'
import { formatDate } from '../../utils/momentjs'
import { patchBoard } from '../../ui/board/board-renderer'
import { applyUniformCardHeight } from '../../ui/board/card-equalize'
import { BoardDnd } from '../../ui/board/dnd-controller'
import type { DropTarget } from '../../ui/board/dnd-controller'
import { ColumnDnd } from '../../ui/board/column-dnd'
import type { KanbanCard } from '../../ui/board/types'
import { renderViewToolbar } from '../../ui/view-toolbar'
import { FilterBar } from '../../ui/filter-bar'
import { BoardSelection } from './board-selection'
import { buildCardMenu, isNewTabEvent } from './card-menu'
import type { CardMenuHost } from './card-menu'
import { CalendarController } from './calendar-controller'
import type { CalendarViewState } from './calendar-controller'
import {
    basesPropToName,
    normalizeLaneValue,
    readIdArray,
    readLaneGroupingOverride,
    readSortMode,
    readStringArray
} from './view-config'
import { cssEscapeAttr } from '../../utils/css-escape'
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
 * Reads the filtered notes, resolves the active note-type noteType (mirrored from
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
    private columnDnd: ColumnDnd | null = null
    private calendarDnd: CalendarDnd | null = null
    private readonly debouncedRebuild: Debouncer<[], void>
    private readonly debouncedFilter: Debouncer<[], void>

    private statusProperty: string | null = null
    private orderProperty = 'manual_order'
    private dueDateProperty = 'date_due'
    private availableProperties: string[] = []
    private noteType: NoteType = createDefaultNoteType(DEFAULT_NOTE_TYPE_ID, 'Default', 'local')
    private noteTypeStatusValues: string[] | null = null
    private columns: ColumnDef[] = []
    private laneGrouping: LaneGrouping = { kind: 'none' }
    private laneValueByPath = new Map<string, string | null>()
    // Per-file note type (Starter Kit) and the archive config it resolves to.
    private noteTypeByPath = new Map<string, { id: string; name: string } | null>()
    private archiveByPath = new Map<string, ArchiveConfig>()
    private relationshipsByPath = new Map<string, RelationshipSet>()
    private readonly collapsedLanes = new Set<string>()
    private readonly collapsedColumns = new Set<string>()
    // Collapsed lane/column ids load lazily from config once (issue #19).
    private collapseInitialized = false
    private board: Board<KanbanCard> = { lanes: [], isMultiLane: false }
    private cardsByKey = new Map<string, KanbanCard>()
    // After a keyboard move/reorder rebuild, refocus this card so focus follows it.
    private refocusCardKey: string | null = null

    // Multi-select + bulk actions (issue #18) — owned by the BoardSelection controller.
    private selectionBarEl: HTMLElement | null = null
    private selection: BoardSelection | null = null

    // Filter bar (issue #34). `allCards`/`searchByKey` are the unfiltered set +
    // per-card search index; the parsed query filters them on each render.
    private allCards: KanbanCard[] = []
    private searchByKey = new Map<string, CardSearchRecord>()
    private filterQuery = ''
    private parsedQuery: FilterQuery = { groups: [] }
    private filterInitialized = false

    // Calendar mode (Milestone 5) — state + rendering owned by CalendarController.
    private scheduledDateProperty = 'date_scheduled'
    private calendar: CalendarController | null = null
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
        this.selectionBarEl = this.rootEl.createDiv({ cls: 'kap-selection-bar kap-hidden' })
        this.selection = new BoardSelection({
            app: this.app,
            boardEl: () => this.boardEl,
            barEl: () => this.selectionBarEl,
            visibleCards: () => this.cardsByKey,
            flatCardKeys: () =>
                this.board.lanes.flatMap((l) =>
                    l.columns.flatMap((c) => c.cards.map((card) => card.key))
                ),
            columns: () => this.columns,
            statusProperty: () => this.statusProperty,
            archiveConfigFor: (card) => this.archiveConfigFor(card),
            onModeChanged: () => this.renderToolbar(this.board.lanes.length > 1)
        })
        this.filterEmptyEl = this.rootEl.createDiv({
            cls: 'kap-filter-empty kap-hidden',
            text: 'No cards match the filter.'
        })
        this.boardEl = this.rootEl.createDiv({ cls: 'kap-board-host' })
        this.dnd = new BoardDnd(this.boardEl, {
            onDrop: (cardKey, target) => void this.handleDrop(cardKey, target)
        })
        this.columnDnd = new ColumnDnd(this.boardEl, UNMAPPED_COLUMN_ID, {
            onReorder: (orderedColumnIds) => this.reorderColumns(orderedColumnIds)
        })
        this.calendar = new CalendarController({
            app: this.app,
            boardEl: () => this.boardEl,
            rebuild: () => this.rebuild(),
            isCalendarMode: () => this.calendarMode(),
            openCard: (card, newTab) => this.openCard(card, newTab),
            showCardMenu: (card, event) => this.showCardMenu(card, event),
            cardForKey: (key) => this.cardsByKey.get(key),
            scheduledProperty: () => this.scheduledDateProperty,
            deadlineProperty: () => this.dueDateProperty,
            dateFormat: () =>
                this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat,
            firstDayOfWeek: () => this.plugin.settings.firstDayOfWeek,
            configuredRange: () => this.config.get('calendarRange'),
            sortMode: () => readSortMode(this.config.get('calendarTabSort')),
            sortProperty: () => basesPropToName(this.config.get('calendarSortProperty')),
            restoreState: () => this.restoreCalendarState(),
            persistState: (state) => this.persistCalendarState(state)
        })
        this.calendarDnd = new CalendarDnd(this.boardEl, {
            onDrop: (cardKey, target, dimension) =>
                void this.calendar?.handleDrop(cardKey, target, dimension)
        })
        this.resizeObserver = new ResizeObserver(() => this.debouncedResize())
        this.resizeObserver.observe(this.boardEl)
        // Refresh when a note already on the board changes in place (issue #13).
        // `onDataUpdated` only fires when the Base result set changes, so editing a
        // card's frontmatter (a blocked_by link, a due date, a displayed field)
        // would otherwise leave the card stale until reload.
        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (this.affectsBoard(file.path)) this.debouncedRebuild()
            })
        )
        // A blocker being archived is a MOVE: it doesn't touch the blocked card's
        // own file, so refresh when a relationship target (or board note) is
        // renamed/deleted too, so the blocked card re-resolves (issue #13).
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (this.affectsBoard(file.path) || this.affectsBoard(oldPath)) {
                    this.debouncedRebuild()
                }
            })
        )
        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (this.affectsBoard(file.path)) this.debouncedRebuild()
            })
        )
        this.plugin.trackKanbanView(this)
        void this.resolveAndRebuild()
    }

    /**
     * Whether a path is a note on this board OR a relationship target of one, so
     * an in-place edit, archive (move), or delete of it should refresh the board.
     */
    private affectsBoard(path: string): boolean {
        if (this.files().some((f) => f.path === path)) return true
        for (const set of this.relationshipsByPath.values()) {
            if (
                set.blocked_by.includes(path) ||
                set.parent.includes(path) ||
                set.child.includes(path) ||
                set.sibling.includes(path)
            ) {
                return true
            }
        }
        return false
    }

    override onunload(): void {
        this.plugin.untrackKanbanView(this)
        this.resizeObserver?.disconnect()
        this.resizeObserver = null
        this.dnd?.destroy()
        this.dnd = null
        this.columnDnd?.destroy()
        this.columnDnd = null
        this.calendarDnd?.destroy()
        this.calendarDnd = null
        this.calendar = null
        this.filterBar?.destroy()
        this.filterBar = null
        this.selection = null
        this.rootEl?.remove()
        this.rootEl = null
        this.toolbarEl = null
        this.toolbarLeftEl = null
        this.toolbarRightEl = null
        this.filterEmptyEl = null
        this.selectionBarEl = null
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

    /** Resolve the note type + lane values (may hit the async Starter Kit API), then render. */
    private async resolveAndRebuild(): Promise<void> {
        const files = this.files()
        const resolved = await resolveActiveNoteType(this.app, this.plugin, files)
        this.noteType = resolved.noteType
        this.noteTypeStatusValues = resolved.statusValues
        // Recognize each file's note type once (Starter Kit only) — shared by
        // swimlanes and per-type archiving. Runs with or without the Starter Kit:
        // SK recognition first, then local mapping rules (issue #31).
        this.noteTypeByPath = await this.recognizeNoteTypes(files)
        this.laneGrouping = this.resolveLaneGrouping()
        this.laneValueByPath = this.computeLaneValues(files, this.laneGrouping)
        this.archiveByPath = this.computeArchiveByPath(files)
        this.rebuild()
    }

    /** Recognize each file's note type (Starter Kit, then local mapping rules). */
    private async recognizeNoteTypes(
        files: TFile[]
    ): Promise<Map<string, { id: string; name: string } | null>> {
        const map = new Map<string, { id: string; name: string } | null>()
        for (const file of files) {
            map.set(file.path, await recognizeNoteTypeFor(this.app, this.plugin, file))
        }
        return map
    }

    /**
     * Resolve each card's archive config by its note type: a recognized type uses
     * its own note type's archive (so a mixed board files each type where it
     * belongs); untyped cards fall back to the active/default note type.
     */
    private computeArchiveByPath(files: TFile[]): Map<string, ArchiveConfig> {
        const map = new Map<string, ArchiveConfig>()
        const byType = new Map<string, ArchiveConfig>()
        const empty: ArchiveConfig = { archiveFolder: '', triggerStatuses: [] }
        for (const file of files) {
            const type = this.noteTypeByPath.get(file.path) ?? null
            if (!type) {
                map.set(file.path, this.noteType.archive)
                continue
            }
            let config = byType.get(type.id)
            if (!config) {
                config = findNoteType(this.plugin, type.id)?.archive ?? empty
                byType.set(type.id, config)
            }
            map.set(file.path, config)
        }
        return map
    }

    /** The archive config that applies to a card (by its note type). */
    private archiveConfigFor(card: KanbanCard): ArchiveConfig {
        return this.archiveByPath.get(card.key) ?? this.noteType.archive
    }

    /**
     * Static archive-folder prefixes across every note type, so a `blocked_by`
     * target that has been archived (moved under one of them) stops blocking,
     * whatever note type the blocker is (issue #13).
     */
    private archiveFolderPrefixes(): string[] {
        return archiveFolderPrefixes(
            this.plugin.settings.noteTypes.map((t) => t.archive.archiveFolder)
        )
    }

    /** Per-view grouping override (when set) else the note type's grouping. */
    private resolveLaneGrouping(): LaneGrouping {
        return readLaneGroupingOverride(this.config) ?? this.noteType.laneGrouping
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

        this.relationshipsByPath = resolveBoardRelationships(
            this.app,
            files,
            this.noteType,
            this.archiveFolderPrefixes()
        )
        this.loadFilterQuery()
        this.loadCollapseState()

        const filter = this.relationalFilter()
        this.allCards = files
            .map((file) => this.toCard(file))
            .filter((card) => passesFilter(this.relationshipsByPath.get(card.key), filter))
        this.searchByKey = new Map(
            this.allCards.map((c) => [
                c.key,
                buildCardSearchRecord(this.app, c, this.dueDateProperty)
            ])
        )

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
            this.calendar?.render(cards)
            return
        }

        const values = this.resolveColumnValues()
        this.columns = columnsFromValues(values, this.noteType, true)

        let board = buildBoard(cards, this.columns, {
            grouped: this.laneGrouping.kind !== 'none',
            unmappedPosition: this.unmappedPosition(),
            compare: this.cardComparator()
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
            `Kanban rebuild: ${String(cards.length)}/${String(this.allCards.length)} cards, ${String(this.columns.length)} columns, ${String(board.lanes.length)} lane(s), noteType "${this.noteType.name}"`,
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
                onCardClick: (card, event) => this.onCardClick(card, event),
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
        this.selection?.refresh()

        // All cards share one height (the tallest card's), recomputed here since
        // the card set / content just changed. Synchronous (before paint) so
        // cards never flash at uneven heights.
        this.equalizeCardHeights()
    }

    /** Refocus the card a keyboard move/reorder acted on, so focus follows it. */
    private applyRefocus(): void {
        if (!this.refocusCardKey || !this.boardEl) return
        const el = this.boardEl.querySelector<HTMLElement>(
            `.kap-card[data-card-key="${cssEscapeAttr(this.refocusCardKey)}"]`
        )
        this.refocusCardKey = null
        el?.focus()
    }

    // ── Multi-select + bulk actions (issue #18) ───────────────

    /** Mouse click on a card: let selection mode consume it, else open the note. */
    private onCardClick(card: KanbanCard, event: MouseEvent): void {
        if (!this.selection?.handleClick(card, event)) {
            this.openCard(card, event.ctrlKey || event.metaKey)
        }
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
        const escaped = cssEscapeAttr(anchor.id)
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
        this.config.set('collapsedLanes', [...this.collapsedLanes])
        this.rebuild()
    }

    private toggleColumn(columnId: string): void {
        if (this.collapsedColumns.has(columnId)) this.collapsedColumns.delete(columnId)
        else this.collapsedColumns.add(columnId)
        this.config.set('collapsedColumns', [...this.collapsedColumns])
        this.rebuild()
    }

    /** Load the persisted collapsed lane/column ids on first rebuild (issue #19). */
    private loadCollapseState(): void {
        if (this.collapseInitialized) return
        this.collapseInitialized = true
        this.collapsedLanes.clear()
        for (const id of readIdArray(this.config.get('collapsedLanes'))) this.collapsedLanes.add(id)
        this.collapsedColumns.clear()
        for (const id of readIdArray(this.config.get('collapsedColumns')))
            this.collapsedColumns.add(id)
    }

    /** Read the durable calendar UI state (defaults when unset) — issue #19. */
    private restoreCalendarState(): CalendarViewState {
        const stored = this.config.get('calendarRangeOverride')
        const range =
            stored === 'week' || stored === 'month' || stored === 'quarter' || stored === 'year'
                ? stored
                : null
        return {
            range,
            tab: this.config.get('calendarTab') === 'deadline' ? 'deadline' : 'scheduled',
            panelCollapsed: this.config.get('calendarPanelCollapsed') === true,
            showScheduled: this.config.get('calendarShowScheduled') !== false,
            showDeadlines: this.config.get('calendarShowDeadlines') !== false
        }
    }

    /** Persist the durable calendar UI state per-view — issue #19. */
    private persistCalendarState(state: CalendarViewState): void {
        this.config.set('calendarRangeOverride', state.range)
        this.config.set('calendarTab', state.tab)
        this.config.set('calendarPanelCollapsed', state.panelCollapsed)
        this.config.set('calendarShowScheduled', state.showScheduled)
        this.config.set('calendarShowDeadlines', state.showDeadlines)
    }

    /**
     * Persist a drag-reordered column order (issue #24) to the per-view `statuses`
     * list — which takes precedence over the Starter Kit / default order. The ids
     * are status values (Unmapped is excluded from dragging).
     */
    private reorderColumns(orderedColumnIds: string[]): void {
        if (orderedColumnIds.length === 0) return
        this.config.set('statuses', orderedColumnIds)
        this.rebuild()
    }

    private resolveStatusProperty(_files: TFile[]): string | null {
        const configured = basesPropToName(this.config.get('statusProperty'))
        if (configured) return configured
        if (this.noteType.source === 'starter-kit' && this.noteType.statusProperty) {
            return this.noteType.statusProperty
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
            this.noteType.calendar.dueDateProperty ??
            this.plugin.settings.defaultDueDateProperty
        )
    }

    private resolveScheduledDateProperty(): string {
        return (
            basesPropToName(this.config.get('scheduledDateProperty')) ??
            this.noteType.calendar.scheduledDateProperty ??
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
        if (this.noteTypeStatusValues && this.noteTypeStatusValues.length > 0) {
            return this.noteTypeStatusValues
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

    /** The per-view in-column sort mode (issue #17); `order` = manual (default). */
    private cardSortMode(): TabSortMode {
        return readSortMode(this.config.get('cardSort'))
    }

    private cardSortDirection(): SortDirection {
        return this.config.get('cardSortDirection') === 'desc' ? 'desc' : 'asc'
    }

    /**
     * In-column comparator for {@link buildBoard} (issue #17). Returns `undefined`
     * for manual order so the board keeps its default `manual_order` sort; for a
     * name/property sort it reuses the pure `compareTabCards`, caching each card's
     * sort key so the property read happens once per card, not per comparison.
     */
    private cardComparator(): ((a: KanbanCard, b: KanbanCard) => number) | undefined {
        const mode = this.cardSortMode()
        if (mode === 'order') return undefined
        const direction = this.cardSortDirection()
        const sortProperty =
            mode === 'property' ? basesPropToName(this.config.get('cardSortProperty')) : null
        const cache = new Map<string, TabSortKey>()
        const keyOf = (card: KanbanCard): TabSortKey => {
            const cached = cache.get(card.key)
            if (cached) return cached
            const sortValue = sortProperty
                ? coerceSortValue(getFrontmatterValue(this.app, card.file, sortProperty))
                : null
            const key: TabSortKey = {
                title: card.display.title,
                order: card.order,
                sortValue,
                searchText: ''
            }
            cache.set(card.key, key)
            return key
        }
        return (a, b) => compareTabCards(keyOf(a), keyOf(b), mode, direction)
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
     * The noteType whose card config drives a file's display: its recognized
     * note-type noteType when available, else the board's active note type. This is
     * what makes a mixed board show each note type's own fields, and what the
     * card's "Show fields" menu edits.
     */
    private cardDisplayNoteType(file: TFile): NoteType {
        const type = this.noteTypeByPath.get(file.path)
        if (type) {
            const typeNoteType = findNoteType(this.plugin, type.id)
            if (typeNoteType) return typeNoteType
        }
        return this.noteType
    }

    /** The card-presentation config for a file (by its note type). */
    private cardPresentationFor(file: TFile): CardPresentation {
        return this.cardDisplayNoteType(file).card
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

        // Manual order is only written under the default (manual) sort; a
        // name/property sort owns the in-column order, so a reorder is a no-op
        // (the status change above still applies) — issue #17.
        if (this.cardSortMode() !== 'order') return

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
        buildCardMenu(card, this.cardMenuHost).showAtMouseEvent(event)
    }

    /** Keyboard-triggered card menu, anchored just below the card (issue #20). */
    private showCardMenuAt(card: KanbanCard, cardEl: HTMLElement): void {
        const rect = cardEl.getBoundingClientRect()
        buildCardMenu(card, this.cardMenuHost).showAtPosition({ x: rect.left, y: rect.bottom })
    }

    /** Closures over the card actions the {@link buildCardMenu} builder triggers. */
    private get cardMenuHost(): CardMenuHost {
        return {
            openCard: (card, newTab) => this.openCard(card, newTab),
            columns: () => this.columns,
            setCardStatus: (card, statusValue, columnId) =>
                this.setCardStatus(card, statusValue, columnId),
            archivingConfigured: (card) => this.archivingConfigured(card),
            archiveCard: (card) => this.archiveCard(card),
            cardDate: (card, dimension) => this.cardDate(card, dimension),
            writeCardDate: (card, dimension, iso) => this.writeCardDate(card, dimension, iso),
            promptDate: (card, dimension, current) => this.promptDate(card, dimension, current),
            cardDisplayNoteType: (file) => this.cardDisplayNoteType(file),
            displayFieldCandidates: (card, presentation) =>
                this.displayFieldCandidates(card, presentation),
            toggleDisplayField: (noteTypeId, property) =>
                this.toggleDisplayField(noteTypeId, property),
            openRelated: (note, newTab) => this.openRelated(note, newTab),
            todayKey: () => toDateKey(startOfDay(new Date())),
            tomorrowKey: () => toDateKey(addDays(startOfDay(new Date()), 1)),
            addableRelationshipRoles: () => this.addableRelationshipRoles(),
            directRelationships: (card) => this.directRelationships(card),
            addRelationship: (card, role) => this.addRelationship(card, role),
            removeRelationship: (card, role, targetPath) =>
                this.removeRelationship(card, role, targetPath)
        }
    }

    // ── Relationship editing (issue #14) ──────────────────────

    /** The role→link-property map for the active note type (read+write agree). */
    private relationshipProperties(): Record<RelationshipRole, string> {
        return roleProperties(this.noteType)
    }

    /** Roles whose link-property is non-empty, so a target can be linked. */
    private addableRelationshipRoles(): ReadonlySet<RelationshipRole> {
        const props = this.relationshipProperties()
        const roles = new Set<RelationshipRole>()
        for (const role of RELATIONSHIP_ROLES) {
            if (props[role].length > 0) roles.add(role)
        }
        return roles
    }

    /** Removable direct links currently stored on the card, per role. */
    private directRelationships(
        card: KanbanCard
    ): Array<{ role: RelationshipRole; target: { path: string; label: string } }> {
        const props = this.relationshipProperties()
        const out: Array<{ role: RelationshipRole; target: { path: string; label: string } }> = []
        for (const role of RELATIONSHIP_ROLES) {
            const property = props[role]
            if (property.length === 0) continue
            for (const target of directLinkTargets(this.app, card.file, property)) {
                out.push({ role, target })
            }
        }
        return out
    }

    /** Open a note picker and link the chosen note in `role`'s property. */
    private addRelationship(card: KanbanCard, role: RelationshipRole): void {
        const property = this.relationshipProperties()[role]
        if (property.length === 0) return
        const exclude = new Set<string>([card.file.path])
        for (const target of directLinkTargets(this.app, card.file, property)) {
            exclude.add(target.path)
        }
        new RelationshipTargetModal(this.app, role, exclude, (target) => {
            void addRelationshipLink(this.app, card.file, property, target).then((added) => {
                new Notice(
                    added
                        ? `Linked "${target.basename}" as ${role.replace('_', ' ')}.`
                        : `"${target.basename}" is already linked.`
                )
            })
        }).open()
    }

    /** Remove the link to `targetPath` from `role`'s property. */
    private async removeRelationship(
        card: KanbanCard,
        role: RelationshipRole,
        targetPath: string
    ): Promise<void> {
        const property = this.relationshipProperties()[role]
        if (property.length === 0) return
        await removeRelationshipLink(this.app, card.file, property, targetPath)
    }

    // ── Keyboard move & reorder (issue #20) ───────────────────

    /** Locate a card within the current board (lane, column index, card index). */
    private cardLocation(card: KanbanCard): {
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
        if (this.cardSortMode() !== 'order') return // manual reorder is off under a sort (#17)
        const loc = this.cardLocation(card)
        if (!loc) return
        const column = loc.columns[loc.colIndex]
        if (!column) return
        const target = loc.cardIndex + direction
        if (target < 0 || target >= column.cards.length) return // at the top/bottom
        this.refocusCardKey = card.key
        void this.applyMove(card, card.statusValue, loc.laneId, column.column.id, target)
    }

    /** Add or remove a property from a note type's displayed card fields. */
    private async toggleDisplayField(noteTypeId: string, property: string): Promise<void> {
        const noteType = findNoteType(this.plugin, noteTypeId)
        if (!noteType) return
        const exists = noteType.card.fields.some((f) => f.property === property)
        const fields = exists
            ? noteType.card.fields.filter((f) => f.property !== property)
            : [...noteType.card.fields, { property, showLabel: false, emphasis: 'normal' as const }]
        await setCardPresentation(this.plugin, noteTypeId, { ...noteType.card, fields })
    }

    /**
     * A noteType/settings change landed (from this board's menus or the settings
     * tab): re-resolve and re-render so card display reflects the new config.
     */
    onSettingsChanged(): void {
        this.debouncedRebuild()
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
            this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat
        await setProperty(this.app, card.file, property, formatDate(date, dateFormat))
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
            {
                calendarMode: this.calendarMode(),
                showLaneNav,
                selectionMode: this.selection?.active ?? false
            },
            {
                onSetCalendarMode: (calendar) => this.setCalendarMode(calendar),
                onConfigure: () => this.openSettings(),
                onLanePrev: () => this.scrollLane(-1),
                onLaneNext: () => this.scrollLane(1),
                onToggleSelectionMode: () => this.selection?.toggleMode()
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
        this.calendar?.resetNarrow()
        this.calendar?.evaluatePanelAutoCollapse()
    }

    /**
     * Container resized: re-evaluate the calendar pane auto-collapse and re-equalize
     * card heights (a narrower column rewraps titles, changing the tallest card).
     */
    private onResize(): void {
        this.calendar?.evaluatePanelAutoCollapse()
        this.equalizeCardHeights()
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
