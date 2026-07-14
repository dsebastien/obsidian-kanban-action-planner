import { BasesView, debounce, Menu, Notice, TFile } from 'obsidian'
import type {
    BasesEntry,
    BasesPropertyId,
    Debouncer,
    HoverParent,
    HoverPopover,
    QueryController
} from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../../plugin'
import type { SettingsRefreshScope } from '../../types/plugin-settings.intf'
import {
    CSS_ROOT_CLASS,
    KANBAN_VIEW_TYPE,
    UNGROUPED_LANE_ID,
    UNMAPPED_COLUMN_ID
} from '../../constants'
import type {
    ArchiveConfig,
    ColumnDef,
    LaneGrouping,
    NoteType,
    RelationshipRole
} from '../../domain/note-type'
import { archiveFolderPrefixes } from '../../domain/archive-paths'
import { buildBoard } from '../../domain/board-model'
import { NO_TYPE_ID, groupByTypeAndStatus } from '../../domain/timeline'
import { resolvePaneGroupDrop } from '../../domain/pane-drop'
import { compareTabCards, coerceSortValue } from '../../domain/calendar-tabs'
import type { SortDirection, TabSortKey, TabSortMode } from '../../domain/calendar-tabs'
import type { Board, UnmappedPosition } from '../../domain/board-model'
import { detectStatusProperty, normalizeStatusValue, splitStatusValue } from '../../domain/status'
import { passesFilter } from '../../domain/filtering'
import type { BlockedFilter, RelationalFilter } from '../../domain/filtering'
import type { RelationshipSet } from '../../domain/relationships'
import {
    addRelationshipLink,
    directLinkTargets,
    labelForPath,
    removeRelationshipLink,
    resolveBoardRelationships,
    roleProperties,
    toCardRelationships
} from '../../services/relationships.service'
import type { RelatedNote } from '../../services/relationships.service'
import { RELATIONSHIP_ROLES, ancestorPaths } from '../../domain/relationships'
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
    recognizeLocalNoteType,
    recognizeNoteTypeFor,
    resolveActiveNoteType
} from '../../services/note-type.service'
import {
    buildCardDisplay,
    formatCountdown,
    parseProgressField
} from '../../services/card-display.service'
import { listEnumProperties } from '../../services/enum.service'
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
import {
    getZoomTerm,
    isEmptyQuery,
    matchesFilterQuery,
    parseFilterQuery,
    removeZoomTerm,
    setZoomTerm
} from '../../domain/filter-query'
import type { CardSearchRecord, FilterContext, FilterQuery } from '../../domain/filter-query'
import { CalendarDnd } from '../../ui/calendar/calendar-dnd'
import { formatDate } from '../../utils/momentjs'
import { patchBoard } from '../../ui/board/board-renderer'
import { applyUniformCardHeight } from '../../ui/board/card-equalize'
import { BoardDnd } from '../../ui/board/dnd-controller'
import type { DropTarget } from '../../ui/board/dnd-controller'
import { ColumnDnd } from '../../ui/board/column-dnd'
import type { CardDisplay, KanbanCard } from '../../ui/board/types'
import { renderViewToolbar } from '../../ui/view-toolbar'
import type { ViewMode } from '../../ui/view-toolbar'
import { renderTriageView } from '../../ui/triage/triage-view'
import { burstConfetti } from '../../ui/triage/confetti'
import type {
    TriageCardData,
    TriageContextField,
    TriageEditableProp,
    TriagePaneModel
} from '../../ui/triage/triage-view'
import { buildTriageQueue, isPropUnset, reviewState, unsetCount } from './triage'
import type { TriageRank } from './triage'
import { TriageConfigModal } from '../../ui/triage/triage-config-modal'
import type { TriageConfigData } from '../../ui/triage/triage-config-modal'
import { resolveAllowedValues } from '../../services/enum.service'
import { listNoteTypes } from '../../services/starter-kit.service'
import { FilterBar } from '../../ui/filter-bar'
import { TimelineController } from './timeline-controller'
import type { TimelineViewState } from './timeline-controller'
import { WbsController } from './wbs-controller'
import type { WbsViewState } from './wbs-controller'
import { WbsDnd } from '../../ui/wbs/wbs-dnd'
import { resolveColor } from '../../services/colors.service'
import { BoardSelection } from './board-selection'
import { buildCardMenu, isNewTabEvent } from './card-menu'
import type { CardMenuHost } from './card-menu'
import { CalendarController } from './calendar-controller'
import type { CalendarViewState } from './calendar-controller'
import {
    basesPropToName,
    normalizeLaneValue,
    readCompactMode,
    readIdArray,
    readLaneGroupingOverride,
    readSortMode,
    readStringArray,
    readTriageConfig,
    resolveEffectiveLaneGrouping
} from './view-config'
import type { TriageConfig } from './view-config'
import { parsePropertyRef, unwrapValue } from './property-access'
import type { PropertyRef } from './property-access'
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
export class KanbanActionPlannerView extends BasesView implements HoverParent {
    override readonly type = KANBAN_VIEW_TYPE
    /** Set by the core "Page preview" plugin while a card hover popover is open. */
    hoverPopover: HoverPopover | null = null

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
    /**
     * Per-lane column sets on mixed boards (note-type lanes, no per-view
     * `statuses` override): lane id (the note type NAME) → that type's own
     * column defs. Empty when the board shares one column set.
     */
    private columnsByLane = new Map<string, ColumnDef[]>()
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
    // Triage (issue #53): a stable ordered queue snapshot (card keys) captured on
    // entering triage, and the cursor into it. Null = needs (re)building.
    private triageQueueKeys: string[] | null = null
    private triageCursor = 0
    // Set by Next/Skip (and completion auto-advance) so the next render scrolls the
    // body back to the top — a new card should start at its title, not inherit the
    // scroll of the one you just left. Plain in-place writes leave it false so the
    // body keeps its position (a value selection re-renders the whole view).
    private triageResetScroll = false
    // Signature of the last triage render (card data + scope). When a write echoes
    // back through the Base (onDataUpdated → debounced rebuild), the recomputed
    // data is identical to what's already on screen — skip the teardown so the view
    // doesn't flash/lose focus for a no-op. Reset on mode switch / view recreation.
    private lastTriageSignature: string | null = null
    // Left-pane group collapse (issue: triage navigation pane), keyed
    // `typeId` / `typeId::status`. In-memory; groups default EXPANDED (the pane
    // is a navigation list, so the queue is visible without clicking to expand).
    private readonly triagePaneCollapsedGroups = new Map<string, boolean>()
    // Per-note-type property-name sets (lowercased), cached per triage render so
    // gating can be type-aware on mixed boards (#53). Cleared each renderTriage.
    private readonly triageTypeProps = new Map<string, Set<string>>()
    // Allowed-values per `${noteTypeId}|${prop}`, cached per rebuild so card-field
    // heat coloring doesn't re-resolve for every card. Cleared each rebuild().
    private readonly cardFieldAllowedCache = new Map<string, string[]>()
    // Bases entries by file path, rebuilt each rebuild() so computed columns
    // (formula.*/file.*) can be read per card via getValue (issue #50). The
    // BasesQueryResult is replaced on every update, so this is never cached across one.
    private entriesByPath = new Map<string, BasesEntry>()
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
    // Timeline mode (issue #77) — state + rendering owned by TimelineController.
    private timeline: TimelineController | null = null
    // WBS mode (issue #76) — state + rendering owned by WbsController.
    private wbs: WbsController | null = null
    private wbsDnd: WbsDnd | null = null
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
            onClear: () => this.onFilterClear(),
            onZoomDismiss: () => this.clearChildFocus(),
            onZoomOpen: (label) => this.openParentByTitle(label)
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
            columnsForSelection: (cards) => this.columnsForSelection(cards),
            statusPropertyFor: (card) => this.statusPropertyFor(card),
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
            estimateProperty: () => this.resolveTimelineEstimateProperty(),
            noteTypeFor: (card) => this.noteTypeByPath.get(card.key) ?? null,
            dateFormat: () =>
                this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat,
            firstDayOfWeek: () => this.plugin.settings.firstDayOfWeek,
            configuredRange: () => this.config.get('calendarRange'),
            sortMode: () => readSortMode(this.config.get('calendarTabSort')),
            sortValue: (card) => {
                const ref = parsePropertyRef(this.config.get('calendarSortProperty'))
                return ref ? this.readScalarProperty(card, ref) : null
            },
            restoreState: () => this.restoreCalendarState(),
            persistState: (state) => this.persistCalendarState(state)
        })
        this.calendarDnd = new CalendarDnd(this.boardEl, {
            onDrop: (cardKey, target, dimension) => {
                if (target.kind === 'paneGroup') {
                    this.dropOnPaneGroup(cardKey, target.typeId, target.status)
                    return
                }
                void this.calendar?.handleDrop(cardKey, target, dimension)
            },
            // Day/panel drops keep their permissive legacy behavior (the
            // controller validates on commit); groups validate live.
            canDrop: (cardKey, target) =>
                target.kind !== 'paneGroup' ||
                this.canDropOnPaneGroup(cardKey, target.typeId, target.status)
        })
        this.timeline = new TimelineController({
            app: this.app,
            boardEl: () => this.boardEl,
            rebuild: () => this.rebuild(),
            isTimelineMode: () => this.timelineMode(),
            openCard: (card, newTab) => this.openCard(card, newTab),
            showCardMenu: (card, event, extend) => this.showCardMenu(card, event, extend),
            startProperty: () => this.resolveTimelineStartProperty(),
            estimateProperty: () => this.resolveTimelineEstimateProperty(),
            milestoneProperty: () => this.resolveTimelineMilestoneProperty(),
            scheduledProperty: () => this.scheduledDateProperty,
            deadlineProperty: () => this.dueDateProperty,
            dateFormat: () =>
                this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat,
            firstDayOfWeek: () => this.plugin.settings.firstDayOfWeek,
            noteTypeFor: (card) => this.noteTypeByPath.get(card.key) ?? null,
            configuredRange: () => this.config.get('timelineRange'),
            restoreState: () => this.restoreTimelineState(),
            persistState: (state) => this.persistTimelineState(state),
            restoreHiddenTypes: () => this.restoreTimelineHiddenTypes(),
            persistHiddenTypes: (ids) => this.persistTimelineHiddenTypes(ids),
            canDropOnPaneGroup: (cardKey, typeId, status) =>
                this.canDropOnPaneGroup(cardKey, typeId, status),
            dropOnPaneGroup: (cardKey, typeId, status) =>
                this.dropOnPaneGroup(cardKey, typeId, status)
        })
        this.wbs = new WbsController({
            app: this.app,
            boardEl: () => this.boardEl,
            rebuild: () => this.rebuild(),
            refresh: () => this.applyFilterAndRender(),
            isWbsMode: () => this.wbsMode(),
            openCard: (card, newTab) => this.openCard(card, newTab),
            openPath: (path, newTab) => {
                const file = this.app.vault.getFileByPath(path)
                if (file) void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file)
            },
            showCardMenu: (card, event, extend) => this.showCardMenu(card, event, extend),
            cardForKey: (key) => this.cardsByKey.get(key),
            allCardForKey: (key) => this.allCards.find((c) => c.key === key),
            relationshipSets: () => this.relationshipsByPath,
            startProperty: () => this.resolveTimelineStartProperty(),
            estimateProperty: () => this.resolveTimelineEstimateProperty(),
            progressProperty: () => this.resolveProgressProperty(),
            scheduledProperty: () => this.scheduledDateProperty,
            deadlineProperty: () => this.dueDateProperty,
            dueSoonDays: () => this.plugin.settings.dueSoonThresholdDays,
            parentProperty: () => this.relationshipProperties().parent,
            childProperty: () => this.relationshipProperties().child,
            // Ancestor climbing resolves each out-of-set note's OWN type
            // (e.g. a project stores its parent in `related_goals` while the
            // task board's parent property is `related_projects`).
            parentPropertyForPath: (path) => {
                const file = this.app.vault.getFileByPath(path)
                if (!file) return ''
                const local = recognizeLocalNoteType(this.app, this.plugin, file)
                const noteType = local
                    ? this.plugin.settings.noteTypes.find((t) => t.id === local.id)
                    : undefined
                return noteType
                    ? roleProperties(noteType).parent
                    : this.relationshipProperties().parent
            },
            dateFormat: () =>
                this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat,
            noteTypeFor: (card) => this.noteTypeByPath.get(card.key) ?? null,
            statusColorFor: (card) => this.statusColorFor(card),
            statusLabelFor: (card) => this.statusLabelFor(card),
            comparator: () =>
                this.cardComparator() ?? ((a, b) => a.display.title.localeCompare(b.display.title)),
            restoreState: () => this.restoreWbsState(),
            persistState: (state) => this.persistWbsState(state),
            restoreCollapsedNodes: () => this.restoreWbsCollapsedNodes(),
            persistCollapsedNodes: (paths) => this.persistWbsCollapsedNodes(paths),
            addParentRelationship: (card) => this.addRelationship(card, 'parent')
        })
        this.wbsDnd = new WbsDnd(this.boardEl, {
            canDrop: (sourceKey, sourceParentKey, target) =>
                target.kind === 'paneGroup'
                    ? this.canDropOnPaneGroup(sourceKey, target.typeId, target.status)
                    : (this.wbs?.canDrop(sourceKey, sourceParentKey, target) ?? false),
            onDrop: (sourceKey, sourceParentKey, target) => {
                if (target.kind === 'paneGroup') {
                    this.dropOnPaneGroup(sourceKey, target.typeId, target.status)
                    return
                }
                this.wbs?.handleDrop(sourceKey, sourceParentKey, target)
            },
            onHoverExpand: (targetKey) => this.wbs?.hoverExpand(targetKey)
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
        // Native note popover on card hover via the core "Page preview" plugin.
        this.registerDomEvent(this.boardEl, 'pointerover', (evt) => this.onCardPointerOver(evt))
        this.plugin.trackKanbanView(this)
        void this.resolveAndRebuild()
    }

    /**
     * Trigger Obsidian's "Page preview" popover for the card under the pointer, so
     * hovering a card previews its note (Ctrl/Cmd-gated by default — see the
     * registered hover-link source). The core plugin dedups by `targetEl`.
     */
    private onCardPointerOver(evt: PointerEvent): void {
        const target = evt.target
        if (!(target instanceof HTMLElement)) return
        const cardEl = target.closest<HTMLElement>('.kap-card[data-card-key]')
        const key = cardEl?.dataset['cardKey']
        if (!cardEl || !key) return
        this.app.workspace.trigger('hover-link', {
            event: evt,
            source: KANBAN_VIEW_TYPE,
            hoverParent: this,
            targetEl: cardEl,
            linktext: key,
            sourcePath: key
        })
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
        this.wbsDnd?.destroy()
        this.wbsDnd = null
        this.wbs = null
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

    /** Toggle calendar mode (returns to board when already in calendar). */
    toggleMode(): void {
        this.setViewMode(this.calendarMode() ? 'board' : 'calendar')
    }

    /** Toggle triage mode (returns to board when already in triage). */
    toggleTriage(): void {
        this.setViewMode(this.triageMode() ? 'board' : 'triage')
    }

    /** Toggle timeline mode (returns to board when already in timeline) — issue #77. */
    toggleTimeline(): void {
        this.setViewMode(this.timelineMode() ? 'board' : 'timeline')
    }

    /** Toggle WBS mode (returns to board when already in WBS) — issue #76. */
    toggleWbs(): void {
        this.setViewMode(this.wbsMode() ? 'board' : 'wbs')
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

    /** Index the current Bases entries by path so computed columns can be read per card (#50). */
    private refreshEntries(): void {
        this.entriesByPath = new Map(
            (this.data?.data ?? [])
                .filter((e) => e.file instanceof TFile)
                .map((e) => [e.file.path, e])
        )
    }

    /** Resolve the note type + lane values (may hit the async Starter Kit API), then render. */
    private async resolveAndRebuild(): Promise<void> {
        const files = this.files()
        this.refreshEntries() // computeLaneValues below may read computed columns (#50)
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

    /**
     * Effective swimlane grouping: a per-view override always wins (an explicit
     * 'None' disables lanes); otherwise a mixed board (more than one recognized
     * note type) whose profile grouping is `none` auto-enables note-type lanes,
     * so each type gets its own lane — and, with per-lane column sets, its own
     * status vocabulary. Else the note type's grouping.
     */
    private resolveLaneGrouping(): LaneGrouping {
        return resolveEffectiveLaneGrouping(
            readLaneGroupingOverride(this.config),
            this.noteType.laneGrouping,
            this.distinctRecognizedTypeCount()
        )
    }

    /** Distinct recognized (non-null) note type ids across the board's files. */
    private distinctRecognizedTypeCount(): number {
        const ids = new Set<string>()
        for (const type of this.noteTypeByPath.values()) if (type) ids.add(type.id)
        return ids.size
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
            const ref = parsePropertyRef(grouping.property)
            for (const file of files) {
                const raw = !ref
                    ? null
                    : ref.kind === 'note'
                      ? getFrontmatterValue(this.app, file, ref.name)
                      : unwrapValue(this.entriesByPath.get(file.path)?.getValue(ref.id) ?? null)
                map.set(file.path, normalizeLaneValue(raw))
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
        this.refreshEntries()
        this.cardFieldAllowedCache.clear() // allowed-values may have changed since last build
        this.applyChipStyle()

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
                buildCardSearchRecord(
                    this.app,
                    c,
                    this.dueDateProperty,
                    // Transitive parents, climbed through the board's notes,
                    // for `ancestor:` / descendants zoom (issue #74).
                    ancestorPaths(c.key, this.relationshipsByPath).map(labelForPath)
                )
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
        // Zoom chip (issue #74): derived from the query's `parent:`/`ancestor:`
        // term — no separate zoom state. The empty message hints that the Base's
        // own filters may exclude the children (e.g. tasks on a projects-only view).
        const zoom = getZoomTerm(this.filterQuery)
        this.filterBar?.setZoomChip(zoom?.title ?? null)
        this.filterEmptyEl?.setText(
            zoom === null
                ? 'No cards match the filter.'
                : `No cards match the filter. ${zoom.field === 'ancestor' ? 'Descendants' : 'Children'} of "${zoom.title}" may be excluded by this view's own Base filters.`
        )
        this.filterEmptyEl?.toggleClass('kap-hidden', !(active && cards.length === 0))

        // Compact cards apply to the board only (the calendar's scheduling panel
        // and the triage card keep their full layout).
        this.boardEl.toggleClass('kap-compact', this.compactMode() && this.viewMode() === 'board')

        // Resolve the column set BEFORE the mode branches: `cardColumns` (the
        // menu's Set-status list, the WBS status dots) reads `this.columns`,
        // which would otherwise stay stale/empty until board mode renders
        // once (e.g. a view whose .base opens straight into WBS).
        this.columns = columnsFromValues(this.resolveColumnValues(), this.noteType, true)

        if (this.triageMode()) {
            this.renderToolbar(false)
            this.renderTriage()
            return
        }

        if (this.calendarMode()) {
            this.renderToolbar(false)
            this.calendar?.render(cards)
            return
        }

        if (this.timelineMode()) {
            this.renderToolbar(false)
            this.timeline?.render(cards)
            return
        }

        if (this.wbsMode()) {
            this.renderToolbar(false)
            this.wbs?.render(cards)
            return
        }

        // Per-lane column sets (mixed boards): each note-type lane carries its
        // own type's vocabulary/colors/WIP limits. Lane ids are the type NAMES
        // (see computeLaneValues); the Ungrouped lane falls back to the board set.
        this.columnsByLane.clear()
        let columnsForLane: ((laneId: string) => ReadonlyArray<ColumnDef>) | undefined
        if (this.perLaneColumnsActive()) {
            for (const type of this.noteTypeByPath.values()) {
                if (!type || this.columnsByLane.has(type.name)) continue
                const cols = this.columnsForType(type.id)
                if (cols) this.columnsByLane.set(type.name, cols)
            }
            columnsForLane = (laneId) => this.laneColumns(laneId)
        }

        let board = buildBoard(cards, this.columns, {
            grouped: this.laneGrouping.kind !== 'none',
            unmappedPosition: this.unmappedPosition(),
            compare: this.cardComparator(),
            columnsForLane
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
     * re-render. Reads the first column board; with per-lane column sets
     * (mixed boards) the restore is best-effort — lanes lacking the anchored
     * id are simply left alone.
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
        if (!this.boardEl || this.calendarMode() || this.wbsMode()) return
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

    /** Read the persisted durable timeline state (issue #77; anchor stays transient). */
    private restoreTimelineState(): TimelineViewState {
        const stored = this.config.get('timelineRangeOverride')
        return {
            range:
                stored === 'week' || stored === 'month' || stored === 'quarter' || stored === 'year'
                    ? stored
                    : null,
            panelCollapsed: this.config.get('timelinePanelCollapsed') === true
        }
    }

    private persistTimelineState(state: TimelineViewState): void {
        this.config.set('timelineRangeOverride', state.range)
        this.config.set('timelinePanelCollapsed', state.panelCollapsed)
    }

    /**
     * Hidden timeline note-type IDs (estimate rework): a dedicated config key
     * with a validated string[] read — deliberately NOT part of
     * `TimelineViewState`, whose `persistState({ range })` call sites would
     * silently clobber the list.
     */
    private restoreTimelineHiddenTypes(): string[] {
        return readIdArray(this.config.get('timelineHiddenTypes'))
    }

    private persistTimelineHiddenTypes(ids: string[]): void {
        this.config.set('timelineHiddenTypes', ids)
    }

    /** Read the durable WBS UI state (defaults when unset) — issue #76. */
    private restoreWbsState(): WbsViewState {
        return { panelCollapsed: this.config.get('wbsPanelCollapsed') === true }
    }

    private persistWbsState(state: WbsViewState): void {
        this.config.set('wbsPanelCollapsed', state.panelCollapsed)
    }

    /**
     * Collapsed WBS node paths: a dedicated config key with a validated
     * string[] read — deliberately NOT part of `WbsViewState`, whose
     * `persistState({ panelCollapsed })` call sites would clobber the list
     * (the `timelineHiddenTypes` pattern).
     */
    private restoreWbsCollapsedNodes(): string[] {
        return readIdArray(this.config.get('wbsCollapsedNodes'))
    }

    private persistWbsCollapsedNodes(paths: string[]): void {
        this.config.set('wbsCollapsedNodes', paths)
    }

    /** WBS progress property, 0–100 (global plugin setting; issue #76). */
    private resolveProgressProperty(): string {
        return this.plugin.settings.defaultProgressProperty
    }

    /** The status column color for a card's own value (WBS row dot). */
    private statusColorFor(card: KanbanCard): string | null {
        if (card.statusValue === null) return null
        const column = this.cardColumns(card).find((c) => c.statusValue === card.statusValue)
        return column ? resolveColor(column.color) : null
    }

    /** The status column label for a card's own value (WBS row tooltip). */
    private statusLabelFor(card: KanbanCard): string | null {
        if (card.statusValue === null) return null
        const column = this.cardColumns(card).find((c) => c.statusValue === card.statusValue)
        return column?.label ?? splitStatusValue(card.statusValue).label
    }

    // Timeline properties are GLOBAL (plugin settings) — no per-view overrides
    // (owner decision; old per-view keys in .base files are simply ignored).

    /** Timeline bar start date property: the resolved scheduled property. */
    private resolveTimelineStartProperty(): string {
        return this.scheduledDateProperty
    }

    /** Timeline estimate property, in days (global plugin setting). */
    private resolveTimelineEstimateProperty(): string {
        return this.plugin.settings.defaultEstimateProperty
    }

    /** Milestone list property (global plugin setting). */
    private resolveTimelineMilestoneProperty(): string {
        return this.plugin.settings.defaultMilestonesProperty
    }

    /**
     * Persist a drag-reordered column order (issue #24) to the per-view `statuses`
     * list — which takes precedence over the Starter Kit / default order. The ids
     * are status values (Unmapped is excluded from dragging).
     */
    private reorderColumns(orderedColumnIds: string[]): void {
        if (orderedColumnIds.length === 0) return
        // Per-lane column sets (mixed board): persisting a single `statuses`
        // list would silently force the legacy shared set for every lane.
        if (this.perLaneColumnsActive()) {
            new Notice('On a mixed board, column order comes from each note type.')
            this.rebuild() // snap the dragged column back
            return
        }
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

    // ── Per-type columns on mixed boards ──────────────────────
    // A card's own note type is authoritative for its status vocabulary and
    // every status write. On a mixed board with note-type lanes, each lane
    // carries its type's own column set; a per-view `statuses` list is the
    // legacy whole-board override and forces one shared set.

    /** Whether per-lane column sets are active (note-type lanes, no `statuses` override). */
    private perLaneColumnsActive(): boolean {
        return (
            this.laneGrouping.kind === 'note-type' &&
            readStringArray(this.config.get('statuses')).length === 0
        )
    }

    /**
     * One note type's own column defs: its defined status values (else the
     * global defaults) with its own colors and WIP limits. `null` when the type
     * is unknown (deleted config), so callers fall back to the board set.
     */
    private columnsForType(typeId: string): ColumnDef[] | null {
        const noteType = findNoteType(this.plugin, typeId)
        if (!noteType) return null
        const values = noteType.columns.map((c) => c.statusValue)
        const effective = values.length > 0 ? values : this.plugin.settings.defaultStatuses
        return columnsFromValues(effective, noteType, true)
    }

    /** A lane's column set (its type's own on mixed boards), else the board's. */
    private laneColumns(laneId: string | undefined): ReadonlyArray<ColumnDef> {
        if (laneId !== undefined) {
            const cols = this.columnsByLane.get(laneId)
            if (cols) return cols
        }
        return this.columns
    }

    /**
     * The column set that applies to one card: its own recognized type's
     * vocabulary (any view mode), unless a per-view `statuses` override forces
     * the shared set; untyped cards use the board set.
     */
    private cardColumns(card: KanbanCard): ReadonlyArray<ColumnDef> {
        if (readStringArray(this.config.get('statuses')).length > 0) return this.columns
        const type = this.noteTypeByPath.get(card.key)
        if (type) {
            const cols = this.columnsForType(type.id)
            if (cols && cols.length > 0) return cols
        }
        return this.columns
    }

    /**
     * The status property for one card: the per-view override wins for every
     * card (existing semantics), else the card's own recognized type's status
     * property, else the board-wide resolved property. Every status read and
     * write for the card goes through this.
     */
    private statusPropertyForFile(file: TFile): string | null {
        const configured = basesPropToName(this.config.get('statusProperty'))
        if (configured) return configured
        const type = this.noteTypeByPath.get(file.path)
        if (type) {
            const own = findNoteType(this.plugin, type.id)?.statusProperty
            if (own) return own
        }
        return this.statusProperty
    }

    private statusPropertyFor(card: KanbanCard): string | null {
        return this.statusPropertyForFile(card.file)
    }

    /**
     * Shared column set for a bulk selection: only when every selected card
     * resolves to the same note type (or all untyped). `null` = mixed types,
     * so bulk set-status is unavailable (vocabularies differ).
     */
    private columnsForSelection(cards: KanbanCard[]): ReadonlyArray<ColumnDef> | null {
        const first = cards[0]
        if (!first) return null
        const ids = new Set(cards.map((c) => this.noteTypeByPath.get(c.key)?.id ?? ''))
        if (ids.size > 1) return null
        return this.cardColumns(first)
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
        const sortRef =
            mode === 'property' ? parsePropertyRef(this.config.get('cardSortProperty')) : null
        const cache = new Map<string, TabSortKey>()
        const keyOf = (card: KanbanCard): TabSortKey => {
            const cached = cache.get(card.key)
            if (cached) return cached
            const sortValue = sortRef ? this.readScalarProperty(card, sortRef) : null
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

    /**
     * Read a property as a sortable/groupable scalar (issue #50). A `note`
     * property comes from frontmatter (writeable); a `computed` column
     * (`formula.*`/`file.*`) is read from the card's Bases entry via `getValue`
     * and is read-only.
     */
    private readScalarProperty(card: KanbanCard, ref: PropertyRef): number | string | null {
        if (ref.kind === 'note') {
            return coerceSortValue(getFrontmatterValue(this.app, card.file, ref.name))
        }
        return unwrapValue(this.entriesByPath.get(card.key)?.getValue(ref.id) ?? null)
    }

    /**
     * The per-view card-title source (issue #4): a validated Bases property id
     * (`note.*` / `formula.*` / `file.*`), or null → the note name.
     */
    private titlePropertyId(): BasesPropertyId | null {
        const ref = parsePropertyRef(this.config.get('titleProperty'))
        if (!ref) return null
        return ref.kind === 'note' ? (`note.${ref.name}` as BasesPropertyId) : ref.id
    }

    /**
     * Build a card's display from the current config + settings (issue #50/#62).
     * Extracted so a lightweight presentational refresh ({@link refreshCardDisplay})
     * can recompute just the display without re-deriving the whole card.
     */
    private cardDisplayFor(file: TFile): CardDisplay {
        return buildCardDisplay(
            this.app,
            file,
            this.entriesByPath.get(file.path),
            this.config,
            this.titlePropertyId(),
            this.dueDateProperty,
            startOfDay(new Date()),
            {
                show: this.config.get('showDueCountdown') === true,
                soonDays: this.plugin.settings.dueSoonThresholdDays,
                placement: this.plugin.settings.dueCountdownStyle
            },
            (id) => this.allowedValuesForCardField(file, id)
        )
    }

    private toCard(file: TFile): KanbanCard {
        // The card's own type's status property (mixed boards) — per-view
        // override and board default fall out of statusPropertyForFile.
        const statusProperty = this.statusPropertyForFile(file)
        const statusValue =
            statusProperty === null
                ? null
                : normalizeStatusValue(getFrontmatterValue(this.app, file, statusProperty))
        const order = coerceOrder(getFrontmatterValue(this.app, file, this.orderProperty))
        const display = this.cardDisplayFor(file)
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

        // Resolve the dropped column's status from the TARGET LANE's own set
        // (per-type vocabularies on mixed boards). Cross-lane drops were
        // rejected above for note-type lanes, so this is the card's own type.
        const newStatus =
            target.columnId === UNMAPPED_COLUMN_ID
                ? null
                : (this.columnStatusValue(target.columnId, target.laneId) ?? card.statusValue)
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
        // A `formula.*`/`file.*` grouping is read-only — there's no property to
        // write — so cross-lane drag is ignored, like note-type lanes (#50).
        const ref = parsePropertyRef(this.laneGrouping.property)
        if (!ref || ref.kind !== 'note') {
            log('Cross-lane drag is not supported for computed swimlanes; ignoring.', 'warn')
            return false
        }
        const property = ref.name
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

    private columnStatusValue(columnId: string, laneId?: string): string | null {
        return this.laneColumns(laneId).find((c) => c.id === columnId)?.statusValue ?? null
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
        // The card's own note type is authoritative for every status write:
        // the value comes from the card's lane/type column set (callers), the
        // property from its own type.
        const statusProperty = this.statusPropertyFor(card)
        const statusChanged = statusProperty !== null && newStatus !== card.statusValue

        // Status-triggered archiving is terminal — the note leaves the board and its
        // file moves — so it stays on the write-then-rebuild path (the archived note
        // must also carry the new status). No optimistic shortcut here.
        if (statusChanged && this.willAutoArchive(card, newStatus) && statusProperty) {
            if (newStatus === null) await deleteProperty(this.app, card.file, statusProperty)
            else await setProperty(this.app, card.file, statusProperty, newStatus)
            await this.maybeAutoArchive(card, newStatus)
            return
        }

        // Manual order is only written under the default (manual) sort; a
        // name/property sort owns the in-column order (issue #17).
        const manualOrder = this.cardSortMode() === 'order'

        // Plan the order writes from the CURRENT board (before any mutation), then
        // apply status + order to the in-memory model and re-render immediately, so
        // the card lands in its new column/position at once — no snap-back while the
        // file write round-trips (issue #64). The frontmatter writes follow; the
        // rebuild they trigger re-derives the same state, so the reconciler no-ops.
        const orderWrites: Array<{ file: TFile; order: number }> = []
        if (manualOrder) {
            const destCards = this.columnCards(destLaneId, destColumnId).filter(
                (c) => c.key !== card.key
            )
            const clamped = Math.max(0, Math.min(index, destCards.length))
            const plan = planInsertion(
                destCards.map((c) => c.order),
                clamped
            )
            if (plan.kind === 'single') {
                card.order = plan.order
                orderWrites.push({ file: card.file, order: plan.order })
            } else {
                const arrangement = [
                    ...destCards.slice(0, clamped),
                    card,
                    ...destCards.slice(clamped)
                ]
                for (let i = 0; i < arrangement.length; i++) {
                    const c = arrangement[i]
                    const o = plan.orders[i]
                    if (c && o !== undefined && c.order !== o) {
                        c.order = o
                        orderWrites.push({ file: c.file, order: o })
                    }
                }
            }
        }

        if (statusChanged) card.statusValue = newStatus
        this.applyFilterAndRender()

        // Persist. Each write triggers onDataUpdated → a debounced rebuild that
        // re-derives this exact state, so there is no visual change (issue #64).
        if (statusChanged && statusProperty) {
            if (newStatus === null) await deleteProperty(this.app, card.file, statusProperty)
            else await setProperty(this.app, card.file, statusProperty, newStatus)
        }
        for (const write of orderWrites) {
            await setProperty(this.app, write.file, this.orderProperty, write.order)
        }
    }

    private columnCards(laneId: string, columnId: string): KanbanCard[] {
        const lane = this.board.lanes.find((l) => l.lane.id === laneId) ?? this.board.lanes[0]
        return lane?.columns.find((c) => c.column.id === columnId)?.cards ?? []
    }

    private showCardMenu(card: KanbanCard, event: MouseEvent, extend?: (menu: Menu) => void): void {
        buildCardMenu(card, this.cardMenuHost, extend).showAtMouseEvent(event)
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
            columnsFor: (card) => this.cardColumns(card),
            setCardStatus: (card, statusValue, columnId) =>
                this.setCardStatus(card, statusValue, columnId),
            enumPropertiesFor: (card) => this.enumPropertiesFor(card),
            setCardProperty: (card, propertyName, value) =>
                this.setCardProperty(card, propertyName, value),
            archivingConfigured: (card) => this.archivingConfigured(card),
            archiveCard: (card) => this.archiveCard(card),
            cardDate: (card, dimension) => this.cardDate(card, dimension),
            writeCardDate: (card, dimension, iso) => this.writeCardDate(card, dimension, iso),
            promptDate: (card, dimension, current) => this.promptDate(card, dimension, current),
            openRelated: (note, newTab) => this.openRelated(note, newTab),
            focusOnChildren: (card) => this.focusOnChildren(card),
            focusOnDescendants: (card) => this.focusOnDescendants(card.display.title),
            canReorderCards: () => this.cardSortMode() === 'order',
            sendCardToEdge: (card, edge) => this.sendCardToEdge(card, edge),
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
            // Optimistic: show the new badge at once, then write (issue #64).
            if (!card.relationships[role].some((r) => r.key === target.path)) {
                card.relationships[role] = [
                    ...card.relationships[role],
                    { key: target.path, label: target.basename }
                ]
                this.applyFilterAndRender()
            }
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
        // Optimistic: drop the badge immediately, then write (issue #64).
        const before = card.relationships[role]
        card.relationships[role] = before.filter((r) => r.key !== targetPath)
        if (card.relationships[role].length !== before.length) this.applyFilterAndRender()
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

    /** Menu: send a card to the top or bottom of its column (writes manual order; issue #78). */
    private sendCardToEdge(card: KanbanCard, edge: 'top' | 'bottom'): void {
        if (this.cardSortMode() !== 'order') return // manual reorder is off under a sort (#17)
        const loc = this.cardLocation(card)
        if (!loc) return
        const column = loc.columns[loc.colIndex]
        if (!column) return
        const target = edge === 'top' ? 0 : column.cards.length
        const atEdge =
            edge === 'top' ? loc.cardIndex === 0 : loc.cardIndex === column.cards.length - 1
        if (atEdge) return
        this.refocusCardKey = card.key
        void this.applyMove(card, card.statusValue, loc.laneId, column.column.id, target)
    }

    /**
     * A settings change landed (from the settings tab). `scope` keeps cosmetic
     * changes off the heavy rebuild path so they apply instantly (issue #67):
     * - `chrome` — toggle the chip-style class only (no re-render).
     * - `cards` — recompute each card's display + re-render (due countdown,
     *   "soon" threshold); reuses relationships/order/lanes already resolved.
     * - `full` — re-resolve everything (property names, note types, swimlanes),
     *   debounced so rapid edits (e.g. typing a property name) coalesce.
     */
    onSettingsChanged(scope: SettingsRefreshScope = 'full'): void {
        if (scope === 'chrome') {
            this.applyChipStyle()
            return
        }
        if (scope === 'cards') {
            this.refreshCardDisplay()
            return
        }
        this.debouncedRebuild()
    }

    /**
     * Lightweight presentational refresh (issue #67): recompute only each card's
     * **due countdown** (the sole card-display output the `cards`-scope settings —
     * position + "soon" threshold — affect) and re-render. The chips/heat/cover
     * are untouched, and relationships, the search index, note-type recognition,
     * and ordering are all reused — so it applies at once even on large boards,
     * where the full {@link rebuild} is ~seconds with thousands of cards.
     */
    private refreshCardDisplay(): void {
        if (!this.boardEl) return
        const show = this.config.get('showDueCountdown') === true
        const soonDays = this.plugin.settings.dueSoonThresholdDays
        const placement = this.plugin.settings.dueCountdownStyle
        const today = startOfDay(new Date())
        for (const card of this.allCards) {
            const countdown = show
                ? formatCountdown(
                      parseFrontmatterDate(
                          getFrontmatterValue(this.app, card.file, this.dueDateProperty)
                      ),
                      today,
                      soonDays,
                      placement
                  )
                : null
            card.display = { ...card.display, countdown }
        }
        this.applyFilterAndRender()
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
        // The ▼ children and ▲ parents badges always open a menu so the zoom
        // actions (issue #74) are reachable; other roles keep the
        // open-directly shortcut.
        if (role !== 'child' && role !== 'parent' && related.length === 1 && related[0]) {
            this.openRelated(related[0], newTab)
            return
        }
        const menu = new Menu()
        if (role === 'child') {
            menu.addItem((item) =>
                item
                    .setTitle('Focus on children on this board')
                    .setIcon('zoom-in')
                    .onClick(() => this.focusOnChildren(card))
            )
            menu.addItem((item) =>
                item
                    .setTitle('Focus on all descendants on this board')
                    .setIcon('zoom-in')
                    .onClick(() => this.focusOnDescendants(card.display.title))
            )
            menu.addSeparator()
        }
        if (role === 'parent') {
            // Zoom up-and-across: focus a parent's children (this card and its
            // siblings) or its whole subtree (issue #74 follow-up).
            for (const note of related) {
                menu.addItem((item) =>
                    item
                        .setTitle(`Focus on children of ${note.label}`)
                        .setIcon('zoom-in')
                        .onClick(() => this.focusOnParent(note.label))
                )
                menu.addItem((item) =>
                    item
                        .setTitle(`Focus on all descendants of ${note.label}`)
                        .setIcon('zoom-in')
                        .onClick(() => this.focusOnDescendants(note.label))
                )
            }
            menu.addSeparator()
        }
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

    // ── Pane-group DnD (drag between the scheduling panels' status groups) ──

    /**
     * Whether dropping a pane card onto another status group commits, and to
     * what — same-type only, resolved against the card's own column set, the
     * "No status" group clearing the status (the Set-status menu semantics).
     */
    private resolvePaneDrop(
        cardKey: string,
        typeId: string,
        status: string
    ): { card: KanbanCard; statusValue: string | null; columnId: string } | null {
        const card = this.cardsByKey.get(cardKey)
        if (!card) return null
        const resolved = resolvePaneGroupDrop(
            {
                typeId: this.noteTypeByPath.get(card.key)?.id ?? NO_TYPE_ID,
                statusValue: card.statusValue
            },
            { typeId, status },
            this.cardColumns(card)
        )
        return resolved ? { card, ...resolved } : null
    }

    private canDropOnPaneGroup(cardKey: string, typeId: string, status: string): boolean {
        return this.resolvePaneDrop(cardKey, typeId, status) !== null
    }

    private dropOnPaneGroup(cardKey: string, typeId: string, status: string): void {
        const resolved = this.resolvePaneDrop(cardKey, typeId, status)
        if (resolved)
            void this.setCardStatus(resolved.card, resolved.statusValue, resolved.columnId)
    }

    // ── Enum quick-set (issue #52) ────────────────────────────

    /** The note type id a card resolved to (its own type, else the active type). */
    private noteTypeIdFor(card: KanbanCard): string {
        return this.noteTypeByPath.get(card.file.path)?.id ?? this.noteType.id
    }

    /**
     * Enum properties offered in the card's "Set <property>" menu (issue #52):
     * the card's note type's known enums, minus the status property (it has its
     * own menu), each with the card's current value.
     */
    private enumPropertiesFor(card: KanbanCard): Array<{
        name: string
        displayName: string
        values: string[]
        current: string | null
    }> {
        const statusName = this.statusPropertyFor(card)?.toLowerCase() ?? ''
        const defs = listEnumProperties(this.app, this.plugin, this.noteTypeIdFor(card))
        return defs
            .filter((def) => def.name.toLowerCase() !== statusName)
            .map((def) => {
                const raw = getFrontmatterValue(this.app, card.file, def.name)
                const current =
                    typeof raw === 'string'
                        ? raw
                        : typeof raw === 'number' || typeof raw === 'boolean'
                          ? String(raw)
                          : null
                return {
                    name: def.name,
                    displayName: def.displayName,
                    values: def.values,
                    current: current === '' ? null : current
                }
            })
    }

    /** Write (or clear) an enum property on a card's note (issue #52). */
    private async setCardProperty(
        card: KanbanCard,
        propertyName: string,
        value: string | null
    ): Promise<void> {
        if (value === null) await deleteProperty(this.app, card.file, propertyName)
        else await setProperty(this.app, card.file, propertyName, value)
    }

    // ── Calendar mode ─────────────────────────────────────────

    private calendarMode(): boolean {
        return this.viewMode() === 'calendar'
    }

    private triageMode(): boolean {
        return this.viewMode() === 'triage'
    }

    private timelineMode(): boolean {
        return this.viewMode() === 'timeline'
    }

    private wbsMode(): boolean {
        return this.viewMode() === 'wbs'
    }

    /** The active view mode (triage wins, else calendar, timeline, WBS, board). */
    private viewMode(): ViewMode {
        if (this.config.get('triageMode') === true) return 'triage'
        if (this.config.get('calendarMode') === true) return 'calendar'
        if (this.config.get('timelineMode') === true) return 'timeline'
        if (this.config.get('wbsMode') === true) return 'wbs'
        return 'board'
    }

    /** Switch the view mode, persisting the mode flags and rebuilding. */
    private setViewMode(mode: ViewMode): void {
        if (this.viewMode() === mode) return
        this.config.set('calendarMode', mode === 'calendar')
        this.config.set('triageMode', mode === 'triage')
        this.config.set('timelineMode', mode === 'timeline')
        this.config.set('wbsMode', mode === 'wbs')
        if (mode === 'triage') {
            // Fresh queue snapshot each time triage is (re)entered.
            this.triageQueueKeys = null
            this.triageCursor = 0
        }
        this.rebuild()
        if (mode === 'calendar') {
            this.calendar?.resetNarrow()
            this.calendar?.evaluatePanelAutoCollapse()
        }
        if (mode === 'timeline') {
            this.timeline?.resetNarrow()
            this.timeline?.evaluatePanelAutoCollapse()
        }
        if (mode === 'wbs') {
            this.wbs?.resetNarrow()
            this.wbs?.evaluatePanelAutoCollapse()
        }
    }

    /** Whether compact cards (title only) are active (board mode). */
    private compactMode(): boolean {
        return readCompactMode(this.config)
    }

    /** Toggle compact cards, persisting the flag (same mechanism as the mode flags). */
    private toggleCompactMode(): void {
        this.config.set('compactMode', !this.compactMode())
        this.rebuild()
    }

    // ── Triage mode (issue #53) ───────────────────────────────

    /** Render the triage queue into the board host from a stable snapshot. */
    private renderTriage(): void {
        if (!this.boardEl) return
        this.triageTypeProps.clear() // rebuild per-type property sets for this render
        const cfg = readTriageConfig(this.config)
        // Build the snapshot when there's none yet — OR when the current one is
        // empty. Opening a view straight into triage renders once before the Bases
        // query has resolved (`cardsByKey` empty), which would otherwise freeze an
        // empty `[]` snapshot that never refills (the `else` branch only drops
        // cards, never adds) — so the queue stayed empty until you bounced through
        // board mode (which resets it to null). An empty snapshot is never a valid
        // "done" state (advancing keeps the keys), so rebuilding it is safe.
        if (this.triageQueueKeys === null || this.triageQueueKeys.length === 0) {
            // Fall back to a stable no-op order when the view sort is manual.
            const compare = this.cardComparator() ?? ((): number => 0)
            const queue = buildTriageQueue(
                [...this.cardsByKey.values()],
                (card) => this.triageRank(card, cfg),
                compare
            )
            this.triageQueueKeys = queue.map((c) => c.key)
            this.triageCursor = 0
        } else {
            // Drop cards no longer in the result set (filtered out / deleted).
            this.triageQueueKeys = this.triageQueueKeys.filter((k) => this.cardsByKey.has(k))
        }
        if (this.triageCursor < 0) this.triageCursor = 0
        const currentKey = this.triageQueueKeys[this.triageCursor]
        const current = currentKey ? this.cardsByKey.get(currentKey) : undefined
        const data = current
            ? this.buildTriageData(current, cfg, this.triageCursor + 1, this.triageQueueKeys.length)
            : null
        const pane = this.buildTriagePane(cfg, currentKey ?? null)
        // Skip an identical re-render (optimistic UI): if the rendered card data,
        // scope and pane match what's already mounted, there's nothing to change on
        // screen — re-tearing it down would only flash and steal focus. The
        // DOM-presence check forces a render when the host shows something else.
        const signature = JSON.stringify({ data, scope: cfg.scope, pane })
        const mounted = this.boardEl.querySelector('.kap-triage-body') !== null
        if (mounted && signature === this.lastTriageSignature) return
        this.lastTriageSignature = signature
        // A null card with a non-empty queue means the cursor ran off the end —
        // i.e. the user worked through every card. Distinguish that "all done"
        // celebration from a scope that simply had nothing to triage (empty queue).
        const completedAll = data === null && this.triageQueueKeys.length > 0
        const scrollToTop = this.triageResetScroll
        this.triageResetScroll = false
        renderTriageView(
            this.boardEl,
            data,
            cfg.scope,
            pane,
            {
                onSetProperty: (name, value) => void this.triageSetProperty(current, name, value),
                onNext: () => this.triageAdvance(),
                onSkip: () => this.triageAdvance(),
                onMarkReviewed: () => void this.triageMarkReviewed(current),
                onOpen: () => {
                    if (current) this.openCard(current, false)
                },
                onExit: () => this.setViewMode('board'),
                onRefresh: () => {
                    this.triageQueueKeys = null
                    this.renderTriage()
                },
                onConfigure: () => this.openTriageConfig(),
                onScopeChange: (scope) => this.setTriageScope(scope),
                onSelect: (key) => this.triageSelect(key),
                onTogglePane: () => {
                    this.config.set('triagePaneCollapsed', !this.triagePaneCollapsed())
                    this.renderTriage()
                },
                onTogglePaneGroup: (key) => {
                    this.triagePaneCollapsedGroups.set(
                        key,
                        !(this.triagePaneCollapsedGroups.get(key) ?? false)
                    )
                    this.renderTriage()
                }
            },
            { scrollToTop, completedAll }
        )
    }

    /** Whether the triage queue pane is collapsed (persisted per view). */
    private triagePaneCollapsed(): boolean {
        return this.config.get('triagePaneCollapsed') === true
    }

    /** Left-pane click: show the queue card `key` on the right (move the cursor). */
    private triageSelect(key: string): void {
        if (this.triageQueueKeys === null) return
        const index = this.triageQueueKeys.indexOf(key)
        if (index < 0) return
        this.triageCursor = index
        this.triageResetScroll = true
        this.renderTriage()
    }

    /**
     * The left navigation pane: the whole queue grouped by note type → status,
     * the current card marked selected and any card that no longer needs triage
     * in this scope muted. Type headers only on multi-type boards; group
     * collapse lives on the instance (default expanded — it's a nav list).
     */
    private buildTriagePane(cfg: TriageConfig, currentKey: string | null): TriagePaneModel {
        const collapsed = this.triagePaneCollapsed()
        const keys = this.triageQueueKeys ?? []
        const cards = keys.map((k) => this.cardsByKey.get(k)).filter((c): c is KanbanCard => !!c)
        const grouped =
            new Set(cards.map((c) => this.noteTypeByPath.get(c.key)?.id ?? '∅')).size > 1
        const groups = groupByTypeAndStatus(
            cards,
            (card) => this.noteTypeByPath.get(card.key) ?? null,
            (card) => card.statusValue
        ).map((typeGroup) => ({
            key: typeGroup.typeId,
            label: typeGroup.typeName,
            count: typeGroup.groups.reduce((sum, g) => sum + g.items.length, 0),
            collapsed: this.triagePaneCollapsedGroups.get(typeGroup.typeId) ?? false,
            groups: typeGroup.groups.map((statusGroup) => {
                const groupKey = `${typeGroup.typeId}::${statusGroup.status}`
                return {
                    key: groupKey,
                    label: statusGroup.label,
                    collapsed: this.triagePaneCollapsedGroups.get(groupKey) ?? false,
                    items: statusGroup.items.map((card) => ({
                        key: card.key,
                        title: card.display.title,
                        selected: card.key === currentKey,
                        needsTriage: this.triageRank(card, cfg).include
                    }))
                }
            })
        }))
        return { collapsed, grouped, groups, total: cards.length }
    }

    /** Advance the triage cursor (Next/Skip); past the end shows the done state. */
    private triageAdvance(): void {
        this.triageCursor += 1
        // A new card starts at the top — don't inherit the scroll of the last one.
        this.triageResetScroll = true
        this.renderTriage()
    }

    /** Persist the triage scope, reset the queue snapshot, and re-render. */
    private setTriageScope(scope: TriageConfig['scope']): void {
        this.config.set('triageScope', scope)
        this.triageQueueKeys = null
        this.triageCursor = 0
        this.renderTriage()
    }

    /**
     * Property options for the triage config modal. **Note** properties come from
     * the **note types** present in this view (Starter Kit definitions + local
     * `enumProperties`) — never the raw dataset, no fallback. **Formulas** come
     * from the **base** (the `formula.*` columns). Labels use the base's display
     * names so they match the rest of the UI.
     */
    private triagePropertyOptions(): Array<{
        id: string
        label: string
        kind: 'note' | 'computed'
    }> {
        const out: Array<{ id: string; label: string; kind: 'note' | 'computed' }> = []
        const seen = new Set<string>()
        const add = (id: string, kind: 'note' | 'computed'): void => {
            if (seen.has(id)) return
            seen.add(id)
            out.push({ id, label: this.config.getDisplayName(id as BasesPropertyId), kind })
        }

        // Note properties: the note types shown on this board (active + per-card).
        const typeIds = new Set<string>([this.noteType.id])
        for (const value of this.noteTypeByPath.values()) if (value) typeIds.add(value.id)
        const skById = new Map(listNoteTypes(this.app).map((t) => [t.id, t]))
        for (const typeId of typeIds) {
            for (const prop of skById.get(typeId)?.properties ?? [])
                add(`note.${prop.name}`, 'note')
            const local = findNoteType(this.plugin, typeId)
            if (local) {
                for (const name of Object.keys(local.enumProperties)) add(`note.${name}`, 'note')
            }
        }

        // Formulas: the base's computed columns (already evaluated in the dataset).
        for (const id of this.allProperties) {
            if (id.startsWith('formula.')) add(String(id), 'computed')
        }
        return out
    }

    /** Open the "Configure triage" modal — real property pickers over `this.config`. */
    openTriageConfig(): void {
        const toBasesId = (id: string): string => {
            const ref = parsePropertyRef(id)
            if (!ref) return id
            return ref.kind === 'note' ? `note.${ref.name}` : ref.id
        }
        new TriageConfigModal(this.app, {
            properties: () => this.triagePropertyOptions(),
            current: (): TriageConfigData => ({
                scope: readTriageConfig(this.config).scope,
                editable: readIdArray(this.config.get('triageUpdateProps')).map(toBasesId),
                gating: readIdArray(this.config.get('triageGateProps')).map(toBasesId),
                context: readIdArray(this.config.get('triageSeeProps')).map(toBasesId),
                tokens: readStringArray(this.config.get('triageTokens'))
            }),
            save: (data: TriageConfigData): void => {
                this.config.set('triageScope', data.scope)
                this.config.set('triageUpdateProps', data.editable)
                this.config.set('triageGateProps', data.gating)
                this.config.set('triageSeeProps', data.context)
                this.config.set('triageTokens', data.tokens)
                this.triageQueueKeys = null
                if (this.triageMode()) this.renderTriage()
            }
        }).open()
    }

    /**
     * Write a triage enum value. While the card still has unset gating props, the
     * view re-renders in place (so you can keep filling fields). The moment the last
     * one is filled, celebrate and auto-advance to the next card — or the "all done"
     * state when this was the last card in the queue.
     */
    private async triageSetProperty(
        card: KanbanCard | undefined,
        name: string,
        value: string | null
    ): Promise<void> {
        if (!card) return
        // Detect the moment a note's triage completes (last gating prop filled) so
        // we can celebrate it. Read before/after the write; the metadata cache is
        // fresh once the write resolves (same read the re-render below relies on).
        const cfg = readTriageConfig(this.config)
        const wasComplete = this.cardUnsetCount(card, cfg) === 0
        await this.setCardProperty(card, name, value)
        // Use the value we just wrote for `nowComplete` — the metadata cache hasn't
        // reparsed yet, so re-reading it here would still see the old value.
        const nowComplete = this.cardUnsetCount(card, cfg, { name, value }) === 0
        if (!wasComplete && nowComplete) {
            // Card fully clarified — celebrate, then jump to the next card (or the
            // done state when this was the last one).
            this.celebrateTriageComplete()
            this.triageAdvance()
        } else {
            this.renderTriage()
        }
    }

    /** Play the triage-complete confetti burst, when enabled in settings. */
    private celebrateTriageComplete(): void {
        if (!this.plugin.settings.triageCelebrateOnComplete) return
        if (this.rootEl) burstConfetti(this.rootEl)
    }

    /** Resolve a stored triage property id into a ref + Bases id + display label. */
    private triageRef(
        id: string
    ): { ref: PropertyRef; basesId: BasesPropertyId; label: string } | null {
        const ref = parsePropertyRef(id)
        if (!ref) return null
        const basesId: BasesPropertyId = ref.kind === 'note' ? `note.${ref.name}` : ref.id
        return { ref, basesId, label: this.config.getDisplayName(basesId) }
    }

    /** Known allowed values for a property ref (note props only; computed → []). */
    private allowedValuesForRef(card: KanbanCard, ref: PropertyRef): string[] {
        if (ref.kind !== 'note') return []
        return resolveAllowedValues(this.app, this.plugin, this.noteTypeIdFor(card), ref.name)
    }

    /** Toggle the chip-style modifier class (Settings → Card chip style) on the root. */
    private applyChipStyle(): void {
        if (!this.rootEl) return
        const style = this.plugin.settings.cardChipStyle
        this.rootEl.classList.toggle('kap-chips-minimal', style === 'minimal')
        this.rootEl.classList.toggle('kap-chips-tinted', style === 'tinted')
        this.rootEl.classList.toggle('kap-chips-rail', style === 'rail')
    }

    /**
     * Allowed values for a card field's property id, for heat coloring (cached per
     * rebuild). **Note** props → the note type's allowed values. **Formula** props
     * → the distinct values observed on the board (so a formula enum like a
     * horizon/bucket still gets a heat color). `file.*` → none.
     */
    private allowedValuesForCardField(file: TFile, id: BasesPropertyId): string[] {
        const ref = parsePropertyRef(id)
        if (!ref) return []
        if (ref.kind === 'note') {
            const typeId = this.noteTypeByPath.get(file.path)?.id ?? this.noteType.id
            const cacheKey = `${typeId}|${ref.name.toLowerCase()}`
            const cached = this.cardFieldAllowedCache.get(cacheKey)
            if (cached) return cached
            const values = resolveAllowedValues(this.app, this.plugin, typeId, ref.name)
            this.cardFieldAllowedCache.set(cacheKey, values)
            return values
        }
        if (!ref.id.startsWith('formula.')) return []
        const cacheKey = `computed|${ref.id}`
        const cached = this.cardFieldAllowedCache.get(cacheKey)
        if (cached) return cached
        const set = new Set<string>()
        for (const entry of this.entriesByPath.values()) {
            const v = entry.getValue(ref.id)
            const s = v == null ? '' : v.toString().trim()
            if (s && s !== 'null') set.add(s)
        }
        const values = [...set]
        this.cardFieldAllowedCache.set(cacheKey, values)
        return values
    }

    /**
     * Lowercased property names a note type defines (Starter Kit `.properties` +
     * local `enumProperties`), cached per render. Empty when the type is unknown
     * — callers then treat all props as applicable (no false skips).
     */
    private noteTypePropertyNames(noteTypeId: string): Set<string> {
        const cached = this.triageTypeProps.get(noteTypeId)
        if (cached) return cached
        const names = new Set<string>()
        const sk = listNoteTypes(this.app).find((t) => t.id === noteTypeId)
        for (const prop of sk?.properties ?? []) names.add(prop.name.toLowerCase())
        const local = findNoteType(this.plugin, noteTypeId)
        if (local)
            for (const name of Object.keys(local.enumProperties)) names.add(name.toLowerCase())
        this.triageTypeProps.set(noteTypeId, names)
        return names
    }

    /**
     * Count a card's unset gating properties (#53). **Type-aware (mixed boards):**
     * a `note.*` gating prop that the card's note type doesn't define is skipped
     * (not counted as unset), so a goal-only prop never flags a task. The skip
     * only applies when the type's properties are known; an unknown type counts
     * every gating prop (preserves single-type behavior).
     */
    private cardUnsetCount(
        card: KanbanCard,
        cfg: TriageConfig,
        /**
         * Optional just-written value for one note property. Obsidian's metadata
         * cache is stale right after `processFrontMatter` resolves, so a caller
         * detecting completion immediately after a write supplies the new value
         * here for the matching gate instead of re-reading the (stale) cache. The
         * other gates didn't change, so reading them from cache stays correct.
         */
        override?: { name: string; value: string | null }
    ): number {
        const typeProps = this.noteTypePropertyNames(this.noteTypeIdFor(card))
        const gates: Array<{ value: string | number | null; allowedValues: string[] | null }> = []
        for (const id of cfg.gateProps) {
            const parsed = this.triageRef(id)
            if (!parsed) continue
            if (
                parsed.ref.kind === 'note' &&
                typeProps.size > 0 &&
                !typeProps.has(parsed.ref.name.toLowerCase())
            ) {
                continue // prop not defined by this card's type — irrelevant
            }
            const allowed =
                parsed.ref.kind === 'note' ? this.allowedValuesForRef(card, parsed.ref) : []
            const isOverridden =
                override !== undefined &&
                parsed.ref.kind === 'note' &&
                parsed.ref.name.toLowerCase() === override.name.toLowerCase()
            gates.push({
                value: isOverridden ? override.value : this.readScalarProperty(card, parsed.ref),
                allowedValues: allowed.length > 0 ? allowed : null
            })
        }
        return unsetCount(gates, cfg.tokens)
    }

    /** Rank a card for the active scope: membership + worst-first weight. */
    private triageRank(card: KanbanCard, cfg: TriageConfig): TriageRank {
        if (cfg.scope === 'review') {
            const state = this.cardReviewState(card)
            return { include: state.due, weight: state.weight }
        }
        const n = this.cardUnsetCount(card, cfg)
        return { include: cfg.scope === 'all' ? true : n > 0, weight: n }
    }

    /** A card's review due-state from its review properties (issue #57). */
    private cardReviewState(card: KanbanCard): { due: boolean; weight: number } {
        const s = this.plugin.settings
        const last = parseFrontmatterDate(
            getFrontmatterValue(this.app, card.file, s.reviewedDateProperty)
        )
        const interval =
            coerceOrder(getFrontmatterValue(this.app, card.file, s.reviewIntervalProperty)) ??
            s.defaultReviewIntervalDays
        return reviewState(last, interval, startOfDay(new Date()))
    }

    /** Stamp `last_reviewed` = today and increment `review_count`, then advance. */
    private async triageMarkReviewed(card: KanbanCard | undefined): Promise<void> {
        if (!card) return
        const s = this.plugin.settings
        const count = coerceOrder(getFrontmatterValue(this.app, card.file, s.reviewCountProperty))
        await setProperty(
            this.app,
            card.file,
            s.reviewedDateProperty,
            toDateKey(startOfDay(new Date()))
        )
        await setProperty(this.app, card.file, s.reviewCountProperty, (count ?? 0) + 1)
        // Marking a note reviewed completes its triage for this scope — celebrate.
        this.celebrateTriageComplete()
        this.triageAdvance()
    }

    /** Read-only review context fields (Last reviewed / Reviews / Due) for review scope. */
    private reviewContextFields(card: KanbanCard): TriageContextField[] {
        const s = this.plugin.settings
        const last = parseFrontmatterDate(
            getFrontmatterValue(this.app, card.file, s.reviewedDateProperty)
        )
        const count = coerceOrder(getFrontmatterValue(this.app, card.file, s.reviewCountProperty))
        const { weight, due } = this.cardReviewState(card)
        const dueText = !last
            ? 'never reviewed'
            : due
              ? `overdue ${String(weight)}d`
              : `in ${String(-weight)}d`
        return [
            { label: 'Last reviewed', text: last ? toDateKey(last) : 'never', progress: null },
            { label: 'Reviews', text: String(count ?? 0), progress: null },
            { label: 'Due', text: dueText, progress: null }
        ]
    }

    /** Assemble the render data for one triage card. */
    private buildTriageData(
        card: KanbanCard,
        cfg: TriageConfig,
        position: number,
        total: number
    ): TriageCardData {
        const baseContext: TriageContextField[] =
            cfg.seeProps.length > 0
                ? cfg.seeProps
                      .map((id) => this.triageContextField(card, id))
                      .filter((f): f is TriageContextField => f !== null)
                : card.display.fields.map((f) => ({
                      label: f.label ?? '',
                      text: f.text,
                      progress: f.progress
                  }))
        // Review scope leads with the review status (last reviewed / count / due).
        const context =
            cfg.scope === 'review'
                ? [...this.reviewContextFields(card), ...baseContext]
                : baseContext

        const editable: TriageEditableProp[] = []
        for (const id of cfg.updateProps) {
            const parsed = this.triageRef(id)
            if (!parsed || parsed.ref.kind !== 'note') continue
            const values = this.allowedValuesForRef(card, parsed.ref)
            if (values.length === 0) continue
            const raw = this.readScalarProperty(card, parsed.ref)
            const current = raw === null || raw === '' ? null : String(raw)
            editable.push({
                name: parsed.ref.name,
                displayName: parsed.label,
                values,
                current,
                needsTriage: isPropUnset(current, cfg.tokens, values)
            })
        }

        return { title: card.display.title, context, editable, position, total, scope: cfg.scope }
    }

    /** Build one read-only context field from a stored property id, or null. */
    private triageContextField(card: KanbanCard, id: string): TriageContextField | null {
        const parsed = this.triageRef(id)
        if (!parsed) return null
        const scalar = this.readScalarProperty(card, parsed.ref)
        if (scalar === null || scalar === '') return null
        const text = String(scalar)
        return { label: parsed.label, text, progress: parseProgressField(parsed.label, text) }
    }

    /** (Re)render the toolbar's mode + action slots (the filter slot is persistent). */
    private renderToolbar(showLaneNav: boolean): void {
        if (!this.toolbarLeftEl || !this.toolbarRightEl) return
        renderViewToolbar(
            this.toolbarLeftEl,
            this.toolbarRightEl,
            {
                mode: this.viewMode(),
                showLaneNav,
                selectionMode: this.selection?.active ?? false,
                compactMode: this.compactMode()
            },
            {
                onSetMode: (mode) => this.setViewMode(mode),
                onConfigure: () => this.openSettings(),
                onLanePrev: () => this.scrollLane(-1),
                onLaneNext: () => this.scrollLane(1),
                onToggleSelectionMode: () => this.selection?.toggleMode(),
                onToggleCompactMode: () => this.toggleCompactMode()
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

    // ── Zoom / focus on children (issue #74) ──────────────────

    /** Set the query (zoom set/swap/dismiss) through the normal filter path. */
    private setFilterQuery(query: string): void {
        this.filterQuery = query
        this.parsedQuery = parseFilterQuery(query)
        this.filterBar?.setValue(query)
        this.commitFilter()
    }

    /**
     * Zoom into `card`: re-filter the board to the notes whose parent it is, by
     * writing a `parent:="Title"` exact term into the filter query (swapping
     * any previous one, so repeated zooms drill down one level at a time).
     */
    private focusOnChildren(card: KanbanCard): void {
        this.focusOnParent(card.display.title)
    }

    /**
     * Zoom to the direct children of the note titled `title` (from a card's ▲
     * parents badge: the card and its siblings under that parent). Same
     * mechanism as {@link focusOnChildren} — only the source of the title differs.
     */
    private focusOnParent(title: string): void {
        this.setFilterQuery(setZoomTerm(this.filterQuery, title, 'parent'))
    }

    /**
     * Zoom to ALL descendants of the note titled `title` (`ancestor:=` — the
     * whole subtree: children, grandchildren, …, climbed through the board's
     * notes), from the card's own zoom or a ▲ parents badge.
     */
    private focusOnDescendants(title: string): void {
        this.setFilterQuery(setZoomTerm(this.filterQuery, title, 'ancestor'))
    }

    /** Chip ✕: remove only the zoom term; the rest of the query survives. */
    private clearChildFocus(): void {
        this.setFilterQuery(removeZoomTerm(this.filterQuery))
    }

    /** Chip label click: best-effort resolve the focused parent note by title. */
    private openParentByTitle(title: string): void {
        const file = this.app.metadataCache.getFirstLinkpathDest(title, '')
        if (file) void this.app.workspace.getLeaf(false).openFile(file)
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

    /**
     * Container resized: re-evaluate both panels' auto-collapse and re-equalize
     * card heights (a narrower column rewraps titles, changing the tallest card).
     * The timeline re-renders outright — its px width gates (resize handles,
     * duration tag) are decided at render time and go stale as bars re-flow
     * (issue #80); this also covers a hidden→visible leaf, which measures 0
     * while hidden and fires the ResizeObserver when revealed. The timeline
     * panel evaluation runs BEFORE that unconditional rebuild — it only
     * rebuilds itself on a width-CATEGORY change (memoized), so the resize
     * rebuild storm never fights it.
     */
    private onResize(): void {
        this.calendar?.evaluatePanelAutoCollapse()
        this.timeline?.evaluatePanelAutoCollapse()
        this.wbs?.evaluatePanelAutoCollapse()
        this.equalizeCardHeights()
        if (this.timelineMode()) this.rebuild()
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
    /**
     * Whether moving `card` to `newStatus` would trigger auto-archiving (a
     * transition INTO a configured trigger status, with an archive folder set).
     * Pure predicate, so {@link applyMove} can keep that case off the optimistic
     * path (the note leaves the board).
     */
    private willAutoArchive(card: KanbanCard, newStatus: string | null): boolean {
        if (newStatus === null || card.statusValue === newStatus) return false
        const archive = this.archiveConfigFor(card)
        return (
            archive.triggerStatuses.includes(newStatus) && archive.archiveFolder.trim().length > 0
        )
    }

    private async maybeAutoArchive(card: KanbanCard, newStatus: string | null): Promise<boolean> {
        if (!this.willAutoArchive(card, newStatus)) return false
        const archive = this.archiveConfigFor(card)
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
