import { BasesView, debounce, getAllTags, Menu, Notice, TFile } from 'obsidian'
import { offsetTopWithin } from '../../utils/offset-top'
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
    DEFAULT_CONTEXTS_PROPERTY,
    KANBAN_VIEW_TYPE,
    UNGROUPED_LANE_ID,
    UNMAPPED_COLUMN_ID
} from '../../constants'
import type {
    ArchiveConfig,
    AutomationRule,
    ColumnDef,
    LaneGrouping,
    NoteType,
    RelationshipRole
} from '../../domain/note-type'
import { isDoneValue, resolveDoneConfig } from '../../domain/done'
import type { ResolvedDoneConfig } from '../../domain/done'
import {
    dedupeRules,
    rawValuesEqual,
    rulesForArchive,
    rulesForPropertyChange,
    rulesForTransition,
    watchedProperties
} from '../../domain/automation'
import { runAutomationRules } from '../../services/automation.service'
import { archiveFolderPrefixes } from '../../domain/archive-paths'
import { buildBoard, restrictBoardColumns, restrictBoardLanes } from '../../domain/board-model'
import { buildAgenda } from '../../domain/agenda'
import type { AgendaWindow } from '../../domain/agenda'
import { renderAgendaView } from '../../ui/agenda/agenda-view'
import { NO_TYPE_ID, groupByTypeAndStatus } from '../../domain/timeline'
import { resolvePaneGroupDrop } from '../../domain/pane-drop'
import type { EstimateConfig } from '../../domain/estimate'
import { formatDuration, readEstimate } from '../../domain/estimate'
import type { AggregateKind } from '../../domain/column-aggregate'
import {
    computeAggregate,
    formatAggregateLabel,
    readAggregateKind,
    toAggregateNumber
} from '../../domain/column-aggregate'
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
import { ORDER_STEP, planInsertion } from '../../domain/ordering'
import { collectFilterFacts, emptyFilterFacts, narrowestFolder } from '../../domain/base-filters'
import type { BaseFilterFacts } from '../../domain/base-filters'
import {
    buildNoteBasename,
    buildUniquePath,
    emptyInheritedDefaults,
    normalizeCreationFolder,
    resolveCreationConfig
} from '../../domain/note-creation'
import type { ResolvedCreationConfig } from '../../domain/note-creation'
import { resolvePlaceholders } from '../../utils/expressions'
import type { ExpressionContext } from '../../utils/expressions'
import { createNote } from '../../services/note-creation.service'
import type { CreateNoteResult } from '../../services/note-creation.service'
import { autoTemplatePathFor } from '../../services/templater.service'
import { CreateNoteModal } from '../../ui/create-note-modal'
import type { CreateNotePreview } from '../../ui/create-note-modal'
import {
    appendToListProperty,
    coerceOrder,
    deleteProperty,
    findKeyCaseInsensitive,
    getFrontmatterValue,
    removeFromListProperty,
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
import { buildCardSearchRecord, stringifyForSearch } from '../../services/card-search.service'
import {
    elapsedSessionMinutes,
    formatTrackedMinutes,
    isTrackingPath,
    readDurationMinutes,
    startTimeSession,
    stopTimeSession
} from '../../services/time-tracking.service'
import { removeFocusView, renderFocusView, updateFocusTimerLabel } from '../../ui/focus/focus-view'
import type { FocusCardData, FocusRelatedGroup } from '../../ui/focus/focus-view'
import { archiveNote, liveExpressionContext } from '../../services/archive.service'
import {
    addDays,
    parseFrontmatterDate,
    periodRange,
    startOfDay,
    toDateKey
} from '../../domain/calendar'
import type { DateDimension } from '../../domain/calendar'
import {
    getContextTerms,
    getZoomTerm,
    isAvailable,
    isDeferred,
    isEmptyQuery,
    matchesFilterQuery,
    parseFilterQuery,
    removeZoomTerm,
    setContextTerms,
    setZoomTerm
} from '../../domain/filter-query'
import type { CardSearchRecord, FilterContext, FilterQuery } from '../../domain/filter-query'
import { resolvePendingWrite } from '../../domain/pending-write'
import type { PendingWrite } from '../../domain/pending-write'
import { parseEmbedParams } from '../../domain/embed-params'
import type { EmbedParams } from '../../domain/embed-params'
import { CalendarDnd } from '../../ui/calendar/calendar-dnd'
import { formatDate } from '../../utils/momentjs'
import { boardStructureWillChange, patchBoard } from '../../ui/board/board-renderer'
import {
    anchorScrollDelta,
    captureBoardScroll,
    pickScrollAnchor,
    restoreBoardScroll
} from '../../ui/scroll-preservation'
import {
    boardRenderSignature,
    cardSignature,
    composeCardsSignature,
    renderPassSignature
} from '../../ui/board/signatures'
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
import {
    creationDefaults,
    getNoteTypeById,
    listNoteTypes
} from '../../services/starter-kit.service'
import { FilterBar } from '../../ui/filter-bar'
import { TimelineController } from './timeline-controller'
import type { TimelineViewState } from './timeline-controller'
import { WbsController } from './wbs-controller'
import type { WbsViewState } from './wbs-controller'
import { WbsDnd } from '../../ui/wbs/wbs-dnd'
import { resolveColor } from '../../services/colors.service'
import { BoardSelection } from './board-selection'
import { buildCardMenu, buildStatusMenu, isNewTabEvent } from './card-menu'
import type { CardMenuHost } from './card-menu'
import { CalendarController } from './calendar-controller'
import type { ContextLegendItem } from '../../ui/calendar/calendar-renderer'
import type { CalendarViewState } from './calendar-controller'
import {
    basesPropToName,
    EmbedAwareConfig,
    laneValueForLaneId,
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
import { TextPromptModal } from '../../ui/text-prompt-modal'
import { log } from '../../../utils/log'

/** The (untyped) settings controller exposed on `app.setting`. */
interface ObsidianSettings {
    open(): void
    openTabById(id: string): void
}

/**
 * A triage value that was JUST written (issue #105, finding 4.2). Obsidian's
 * metadata cache is stale until the Bases echo lands, so the immediate
 * post-write render substitutes this value for the matching property read —
 * the click shows at once, and the echo (which re-derives the identical
 * state) is absorbed by the triage signature guard instead of tearing the
 * view down.
 */
/**
 * How long quick capture keeps trying to reveal the card it just created
 * (issue #46). The note only becomes a card once Bases re-runs its query, which
 * takes a few passes — and never happens at all when a template moved the note
 * out of the view's filters, hence the bound.
 */
const REVEAL_NEW_CARD_TIMEOUT_MS = 5000

/**
 * How long a card move's status write outranks the metadata cache (issue #64
 * follow-up). Long enough to cover a slow re-parse, short enough that a write
 * which never landed corrects itself instead of leaving the board lying.
 */
const PENDING_STATUS_WRITE_TIMEOUT_MS = 5000

/**
 * Floor for a board sized to its Canvas node (issue #154). A node dragged
 * smaller than this keeps a usable board that scrolls inside the node instead
 * of collapsing to a sliver of toolbar.
 */
const CANVAS_MIN_EMBED_HEIGHT_PX = 160

/**
 * A captured "keep this card where it is" anchor inside one column's card list,
 * consumed by the render pass that follows a Send to top / Send to bottom.
 */
interface PendingScrollAnchor {
    laneId: string
    columnId: string
    /** The anchor card's key (never the moved card's). */
    key: string
    /** The anchor card's offset from the scroller's visible top, at capture time. */
    top: number
}

interface TriageValueOverride {
    /** The card the value was written to (card key = vault path). */
    cardKey: string
    /** The written note property's name. */
    name: string
    /** The written value (null = cleared). */
    value: string | null
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
    private deferDateProperty = 'date_defer'
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
    // Property-condition automations (edge-triggered): the last-seen value of
    // every watched property per note, and the notes whose automation actions
    // are currently executing (re-entry guard — no cascades).
    private automationSnapshot = new Map<string, Map<string, unknown>>()
    private readonly automationRunning = new Set<string>()
    private archiveByPath = new Map<string, ArchiveConfig>()
    private relationshipsByPath = new Map<string, RelationshipSet>()
    private readonly collapsedLanes = new Set<string>()
    private readonly collapsedColumns = new Set<string>()
    // Collapsed lane/column ids load lazily from config once (issue #19).
    private collapseInitialized = false
    private board: Board<KanbanCard> = { lanes: [], isMultiLane: false }
    /**
     * Column aggregate labels (issue #23) for the current board, keyed by
     * {@link aggregateKey}. Recomputed with the board (before the render gate,
     * which hashes it) so the renderer only has to look one up.
     */
    private aggregateLabels = new Map<string, string>()
    private cardsByKey = new Map<string, KanbanCard>()
    // Triage (issue #53): a stable ordered queue snapshot (card keys) captured on
    // entering triage, and the cursor into it. Null = needs (re)building.
    private triageQueueKeys: string[] | null = null
    private triageCursor = 0
    // Focus mode (issue #160): the spotlighted card's key (null = off) and
    // the 1s timer-label tick (running only while the overlay is mounted).
    private focusCardKey: string | null = null
    private focusTimerId: number | null = null
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
    // Render-signature gate (issue #105): signature of the last completed
    // board/calendar/timeline render pass. When a rebuild (typically the Bases
    // echo of the plugin's own frontmatter/config write, or a body-only edit)
    // re-derives content-identical state, the pass is skipped entirely —
    // no toolbar teardown, no calendar/timeline teardown, no column-anchor
    // restore, no equalize. Null = next pass always renders (triage/WBS
    // passes and view creation reset it).
    private lastRenderSignature: string | null = null
    // Signature computed by the current pass, committed to lastRenderSignature
    // only when the pass finishes (commitRenderPass) — if a renderer throws
    // partway, the next trigger repaints over the partial DOM instead of
    // being gated away (issue #105 review).
    private pendingRenderSignature: string | null = null
    // While a multi-write sequence runs (drag renumber, bulk status/archive),
    // the data-event debounce must not fire mid-sequence: the non-resetting
    // 250ms debouncer would re-derive a PARTIAL on-disk state and visibly
    // revert the optimistic render (issue #105 review). Depth-counted so
    // sequences can nest; a swallowed event schedules one trailing rebuild,
    // which the render-signature gate absorbs when the echo matches.
    private suppressRebuildDepth = 0
    private rebuildDeferredWhileSuppressed = false
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
    /**
     * Deadline (performance clock) until which {@link applyRefocus} keeps waiting
     * for a not-yet-rendered refocus target. 0 = drop it on the first miss (the
     * keyboard-move case); set by quick capture, whose note only reaches the board
     * after Bases re-runs its query.
     */
    private refocusUntil = 0
    /**
     * Whether {@link applyRefocus} may reveal-scroll the refocused card. False
     * for moves that must not move the viewport (Send to top / Send to bottom):
     * the card travels the length of the column, so revealing it would yank the
     * user away from what they were looking at. Reset when the key is consumed.
     */
    private refocusReveal = true
    /**
     * Column scroll anchor to re-pin after the next board render, so a Send to
     * top / Send to bottom keeps the visible cards where they are (see
     * {@link pickScrollAnchor}).
     */
    private pendingScrollAnchor: PendingScrollAnchor | null = null
    /**
     * Status writes not yet observed in the metadata cache, keyed by card path.
     * A rebuild landing in that window would otherwise re-derive the card from
     * the pre-write cache and snap it back to the column it was dragged out of
     * (see {@link resolvePendingWrite}).
     */
    private readonly pendingStatusWrites = new Map<string, PendingWrite>()

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

    // Markdown-note embed (issue #103). Non-null params = this instance renders
    // inside an `![[….base#View|…]]` embed and is a PROJECTION: NO interaction
    // may write to the shared view config (it would silently rewrite the view
    // for every other consumer). Detection is lazy — containerEl may still be
    // detached during onload — and cached once the root is connected
    // (embedChecked).
    private embedParams: EmbedParams | null = null
    private embedChecked = false
    // Re-applies alias overrides when the embed line is edited in the note
    // (Obsidian reuses the wrapper and only rewrites its `alt` attribute).
    private embedAltObserver: MutationObserver | null = null
    // The single config read/write funnel. In embeds, EVERY set() stays in an
    // in-memory overlay (panel collapse, compact toggle, triage scope, column
    // reorder, …) so interactions still work without touching the .base file.
    // INVARIANT: no direct `this.viewConfig.set(…)` call may exist in this class —
    // always go through `this.viewConfig`.
    private readonly viewConfig = new EmbedAwareConfig(
        () => this.config,
        () => this.isEmbedded()
    )
    // Ephemeral mode override: seeded from the embed's `mode=` param and
    // updated by mode switches inside an embed. Always null when not embedded,
    // so viewMode() falls through to the persisted config flags.
    private ephemeralMode: ViewMode | null = null

    // Calendar mode (Milestone 5) — state + rendering owned by CalendarController.
    private scheduledDateProperty = 'date_scheduled'
    private calendar: CalendarController | null = null
    // Timeline mode (issue #77) — state + rendering owned by TimelineController.
    private timeline: TimelineController | null = null
    // WBS mode (issue #76) — state + rendering owned by WbsController.
    private wbs: WbsController | null = null
    private wbsDnd: WbsDnd | null = null
    private resizeObserver: ResizeObserver | null = null
    // Canvas embed (issue #154). Inside a Canvas node the NODE is the size
    // control: `height=` is ignored and --kap-embed-height is driven from the
    // node's content box instead, so resizing the node resizes the board.
    private canvasScrollerEl: HTMLElement | null = null
    private canvasResizeObserver: ResizeObserver | null = null
    /** Last height (px) pushed to --kap-embed-height — kills observer feedback. */
    private canvasHeightPx = 0
    private readonly debouncedResize: Debouncer<[], void>
    /**
     * Board width (px) at the last equalize pass — width-unchanged resize
     * ticks skip the redundant clear→measure→set cycle (issue #105, finding
     * 5.5). -1 = never equalized.
     */
    private lastEqualizeWidth = -1

    constructor(
        controller: QueryController,
        containerEl: HTMLElement,
        plugin: KanbanActionPlannerPlugin
    ) {
        super(controller)
        this.containerEl = containerEl
        this.plugin = plugin
        this.debouncedRebuild = debounce(() => {
            if (this.suppressRebuildDepth > 0) {
                this.rebuildDeferredWhileSuppressed = true
                return
            }
            void this.resolveAndRebuild()
        }, 250)
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
            onZoomOpen: (label) => this.openParentByTitle(label),
            onContextDismiss: (value) => this.dismissContext(value)
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
            onModeChanged: () => this.renderToolbar(this.board.lanes.length > 1),
            // Optimistic bulk actions (issue #105, finding 1.4): one model
            // mutation + one render up front; the write echoes re-derive the
            // same state and are absorbed by the render-signature gate.
            // Per-entry values so the failure path can revert JUST the cards
            // whose write failed (issue #105 review).
            applyBulkStatus: (entries) => {
                for (const { card, statusValue } of entries) {
                    const live = this.liveCard(card)
                    live.statusValue = statusValue
                    // When the status property is a visible card field its chip
                    // must change in the same optimistic render — recompute the
                    // display with the written value substituted (the entry and
                    // metadata cache are stale until the echo).
                    const property = this.statusPropertyFor(live)
                    if (property) {
                        live.display = this.cardDisplayFor(
                            live.file,
                            new Map<string, string | null>([[property.toLowerCase(), statusValue]])
                        )
                    }
                }
                this.applyFilterAndRender()
            },
            removeCardsFromModel: (keys) => {
                const dropped = new Set(keys)
                this.allCards = this.allCards.filter((c) => !dropped.has(c.key))
                this.applyFilterAndRender()
            },
            restoreCardsToModel: (cards) => {
                // Failed archives only: the files never moved, so the captured
                // card objects are still valid — re-adding them (instead of a
                // full rebuild from the still-stale data set, which would
                // briefly resurrect the successfully archived cards too) keeps
                // the rollback scoped to what actually failed (issue #105
                // review). buildBoard re-sorts, so append order is irrelevant.
                const have = new Set(this.allCards.map((c) => c.key))
                this.allCards = [...this.allCards, ...cards.filter((c) => !have.has(c.key))]
                this.applyFilterAndRender()
            },
            runExclusiveWrites: (writes) => this.withRebuildsSuppressed(writes),
            runStatusAutomations: (card, from, to) => this.runStatusAutomations(card, from, to),
            runArchiveAutomations: (card) => this.runArchiveAutomations(card)
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
            // UI-state-only changes re-render from the already-derived card
            // set — no re-derivation of relationships/cards/search index
            // (issue #105, finding 2.3). The render-signature gate makes the
            // state change render once and absorbs the config-persist echo.
            refresh: () => this.applyFilterAndRender(),
            isCalendarMode: () => this.calendarMode(),
            openCard: (card, newTab) => this.openCard(card, newTab),
            showCardMenu: (card, event) => this.showCardMenu(card, event),
            cardForKey: (key) => this.cardsByKey.get(key),
            scheduledProperty: () => this.scheduledDateProperty,
            deadlineProperty: () => this.dueDateProperty,
            estimateConfigFor: (card) => this.estimateConfigFor(card),
            minutesPerDay: () => this.plugin.settings.minutesPerDay,
            noteTypeFor: (card) => this.noteTypeByPath.get(card.key) ?? null,
            dateFormat: () =>
                this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat,
            firstDayOfWeek: () => this.plugin.settings.firstDayOfWeek,
            configuredRange: () => this.viewConfig.get('calendarRange'),
            sortMode: () => readSortMode(this.viewConfig.get('calendarTabSort')),
            sortValue: (card) => {
                const ref = parsePropertyRef(this.viewConfig.get('calendarSortProperty'))
                return ref ? this.readScalarProperty(card, ref) : null
            },
            restoreState: () => this.restoreCalendarState(),
            persistState: (state) => this.persistCalendarState(state),
            contextLegend: () => this.contextLegend(),
            toggleContext: (value) => this.toggleContextValue(value)
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
            // Same render-from-cached-cards hook as the calendar (issue #105,
            // finding 2.4) — timeline callbacks change only view/UI state.
            refresh: () => this.applyFilterAndRender(),
            isTimelineMode: () => this.timelineMode(),
            openCard: (card, newTab) => this.openCard(card, newTab),
            showCardMenu: (card, event, extend) => this.showCardMenu(card, event, extend),
            startProperty: () => this.resolveTimelineStartProperty(),
            estimateConfigFor: (card) => this.estimateConfigFor(card),
            minutesPerDay: () => this.plugin.settings.minutesPerDay,
            milestoneProperty: () => this.resolveTimelineMilestoneProperty(),
            scheduledProperty: () => this.scheduledDateProperty,
            deadlineProperty: () => this.dueDateProperty,
            dateFormat: () =>
                this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat,
            firstDayOfWeek: () => this.plugin.settings.firstDayOfWeek,
            noteTypeFor: (card) => this.noteTypeByPath.get(card.key) ?? null,
            configuredRange: () => this.viewConfig.get('timelineRange'),
            restoreState: () => this.restoreTimelineState(),
            persistState: (state) => this.persistTimelineState(state),
            restoreHiddenTypes: () => this.restoreTimelineHiddenTypes(),
            persistHiddenTypes: (ids) => this.persistTimelineHiddenTypes(ids),
            canDropOnPaneGroup: (cardKey, typeId, status) =>
                this.canDropOnPaneGroup(cardKey, typeId, status),
            dropOnPaneGroup: (cardKey, typeId, status) =>
                this.dropOnPaneGroup(cardKey, typeId, status),
            contextLegend: () => this.contextLegend(),
            toggleContext: (value) => this.toggleContextValue(value)
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
            showStatusMenu: (card, event) => this.showStatusMenu(card, event),
            cardForKey: (key) => this.cardsByKey.get(key),
            allCardForKey: (key) => this.allCards.find((c) => c.key === key),
            relationshipSets: () => this.relationshipsByPath,
            startProperty: () => this.resolveTimelineStartProperty(),
            estimateConfigFor: (card) => this.estimateConfigFor(card),
            doneConfigFor: (card) => this.doneConfigFor(card),
            minutesPerDay: () => this.plugin.settings.minutesPerDay,
            firstDayOfWeek: () => this.plugin.settings.firstDayOfWeek,
            progressProperty: () => this.resolveProgressProperty(),
            durationProperty: () => this.plugin.settings.defaultDurationProperty,
            totalDurationProperty: () => this.plugin.settings.defaultTotalDurationProperty,
            scheduledProperty: () => this.scheduledDateProperty,
            deadlineProperty: () => this.dueDateProperty,
            dueSoonDays: () => this.plugin.settings.dueSoonThresholdDays,
            // Per-path role properties: each note's OWN type decides where its
            // parent/children links live (mixed boards + context ancestors).
            parentPropertyForPath: (path) => this.relationshipPropertiesForPath(path).parent,
            childPropertyForPath: (path) => this.relationshipPropertiesForPath(path).child,
            dateFormat: () =>
                this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat,
            noteTypeFor: (card) => this.noteTypeByPath.get(card.key) ?? null,
            statusColorFor: (card) => this.statusColorFor(card),
            statusLabelFor: (card) => this.statusLabelFor(card),
            comparator: () =>
                this.cardComparator() ?? ((a, b) => a.display.title.localeCompare(b.display.title)),
            comparatorKey: () => {
                const mode = this.cardSortMode()
                if (mode === 'order') return 'order'
                const prop =
                    mode === 'property'
                        ? JSON.stringify(this.viewConfig.get('cardSortProperty') ?? null)
                        : ''
                return `${mode}:${this.cardSortDirection()}:${prop}`
            },
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
                if (!this.affectsBoard(file.path)) return
                // Property-condition automations diff BEFORE the debounced
                // rebuild resets the snapshot baseline.
                void this.handlePropertyAutomations(file)
                this.debouncedRebuild()
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
     * Matches every mode's note-backed element (issue #99): board cards,
     * calendar chips (span continuations carry no key — skipped), timeline
     * rows + undated panel cards, WBS rows (incl. context rows — the key is
     * a vault path) + pane cards.
     */
    private onCardPointerOver(evt: PointerEvent): void {
        const target = evt.target
        if (!(target instanceof HTMLElement)) return
        const cardEl = target.closest<HTMLElement>(
            '.kap-card[data-card-key], .kap-cal-card[data-card-key], .kap-tl-row[data-card-key], .kap-tl-undated-card[data-card-key], .kap-wbs-row[data-card-key], .kap-wbs-pane-card[data-card-key]'
        )
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
        // The raw paths, not `files()`: a delete event must still match the
        // note that was just removed, or no rebuild would drop its card.
        if (this.entryPaths().includes(path)) return true
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
        this.embedAltObserver?.disconnect()
        this.embedAltObserver = null
        this.canvasResizeObserver?.disconnect()
        this.canvasResizeObserver = null
        this.canvasScrollerEl = null
        this.stopFocusTick()
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

    /** Toggle agenda mode (returns to board when already in agenda) — issue #39. */
    toggleAgenda(): void {
        this.setViewMode(this.agendaMode() ? 'board' : 'agenda')
    }

    /**
     * Toggle focus mode (issue #160): exit the spotlight when it's open,
     * else spotlight the first card of the current (filtered) result set.
     */
    toggleFocus(): void {
        if (this.focusCardKey !== null) {
            this.exitFocus()
            return
        }
        const first = this.cardsByKey.values().next()
        if (!first.done) this.enterFocus(first.value)
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

    /**
     * The Bases result's notes, minus any that no longer exist in the vault.
     *
     * A Bases query result is a snapshot: when a note is deleted while this
     * leaf is not the visible one, Bases does not re-run the query, so the
     * deleted note stays in `data` — and the plugin's own `delete` handler
     * would then rebuild a GHOST card for a file that is gone (and read it,
     * raising ENOENT). The vault is the authority on existence, so every
     * consumer of the result set filters on it.
     *
     * `affectsBoard` deliberately does NOT use this — it must still recognize
     * the just-deleted path to schedule the refreshing rebuild.
     */
    private files(): TFile[] {
        const entries = this.data?.data ?? []
        return entries
            .map((e) => e.file)
            .filter((f): f is TFile => f instanceof TFile && this.fileStillExists(f))
    }

    /** Whether the vault still has a file at this note's path (see {@link files}). */
    private fileStillExists(file: TFile): boolean {
        return this.app.vault.getFileByPath(file.path) !== null
    }

    /** Every path in the raw Bases result, deleted notes included (see {@link files}). */
    private entryPaths(): string[] {
        return (this.data?.data ?? [])
            .filter((e) => e.file instanceof TFile)
            .map((e) => e.file.path)
    }

    /** Index the current Bases entries by path so computed columns can be read per card (#50). */
    private refreshEntries(): void {
        this.entriesByPath = new Map(
            (this.data?.data ?? [])
                .filter((e) => e.file instanceof TFile && this.fileStillExists(e.file))
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
        this.rebuildAutomationSnapshot(files)
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
            readLaneGroupingOverride(this.viewConfig),
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
        this.deferDateProperty = this.resolveDeferDateProperty()

        // Per-type resolution (mixed boards): each file's role properties,
        // active roles, and heuristics come from its OWN recognized type.
        this.relationshipsByPath = resolveBoardRelationships(
            this.app,
            files,
            this.noteType,
            this.archiveFolderPrefixes(),
            (path) => {
                const type = this.noteTypeByPath.get(path)
                return type ? (findNoteType(this.plugin, type.id) ?? null) : null
            }
        )
        this.detectEmbed()
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
                    ancestorPaths(c.key, this.relationshipsByPath).map(labelForPath),
                    // Defer date + done state back `defer:` / `is:` (issue #113).
                    this.deferDateProperty,
                    this.isCardDone(c),
                    // Configured-property filter aliases (issue #169):
                    // `scheduled:` / `estimate:` / `progress:` / `order:`.
                    {
                        scheduledDateProperty: this.scheduledDateProperty,
                        estimateDays: this.estimateDaysFor(c),
                        progressProperty: this.resolveProgressProperty(),
                        orderProperty: this.orderProperty
                    }
                )
            ])
        )

        this.applyFilterAndRender()
    }

    /**
     * Whether this instance renders inside a markdown-note embed (issue #103).
     * Forces a synchronous detection attempt first: every config-write
     * decision funnels through here, and at interaction time the DOM is
     * necessarily connected — so a click landing in the window between attach
     * and the next detection pass can never leak a write to the shared view.
     */
    private isEmbedded(): boolean {
        this.detectEmbed()
        return this.embedParams !== null
    }

    /**
     * Lazily detect a markdown-note embed and apply its alias overrides
     * (issue #103). Obsidian renders `![[….base#View|…]]` inside a wrapper
     * carrying `.internal-embed.bases-embed`, with the wikilink alias landing
     * verbatim in its `alt` attribute — the override channel. containerEl may
     * not be attached to the DOM when the view is constructed, so this
     * re-checks each rebuild (and on reveal, via onResize) until the root is
     * connected, then caches the verdict either way.
     */
    private detectEmbed(): void {
        if (this.embedChecked) return
        const rootEl = this.rootEl
        if (!rootEl?.isConnected) return // still detached — re-check next pass
        this.embedChecked = true
        const wrapper = this.containerEl.closest('.internal-embed.bases-embed')
        if (!wrapper) return
        rootEl.addClass('kap-embedded')
        this.detectCanvasHost(rootEl)
        this.applyEmbedParams(parseEmbedParams(wrapper.getAttribute('alt') ?? ''))
        // Editing the embed line in the note reuses the SAME wrapper and view
        // instance — Obsidian only rewrites the `alt` attribute in place — so
        // watch it and re-apply (verified live: sameEl/sameRoot on alias edit).
        this.embedAltObserver = new MutationObserver(() => {
            const params = parseEmbedParams(wrapper.getAttribute('alt') ?? '')
            this.applyEmbedParams(params)
            this.rebuild()
        })
        this.embedAltObserver.observe(wrapper, {
            attributes: true,
            attributeFilter: ['alt']
        })
    }

    /**
     * Canvas hosts the embed inside a fixed-size node (issue #154). Unlike a
     * markdown note — where the embed has no definite height and must size to
     * content under the `height=` cap — the node IS the height, and users
     * expect resizing it to resize the board. So detect the node, ignore
     * `height=`, and drive --kap-embed-height from the node's scroll container
     * (which Canvas resizes for us). A definite height also restores the
     * full-leaf behaviour: every mode gets its own internal scroller again.
     */
    private detectCanvasHost(rootEl: HTMLElement): void {
        const nodeContentEl = this.containerEl.closest<HTMLElement>('.canvas-node-content')
        if (!nodeContentEl) return
        rootEl.addClass('kap-in-canvas')
        // The preview view is the node's scroll container AND a positioned
        // element, so it is both what Canvas resizes and a valid offsetParent
        // anchor. A `.base` file node has no preview view — the content box
        // itself is positioned there.
        this.canvasScrollerEl =
            nodeContentEl.querySelector<HTMLElement>('.markdown-preview-view') ?? nodeContentEl
        this.canvasResizeObserver = new ResizeObserver(() => {
            this.syncCanvasHeight()
        })
        this.canvasResizeObserver.observe(this.canvasScrollerEl)
        this.syncCanvasHeight()
    }

    /**
     * Push the height left inside the canvas node — its content box minus
     * whatever sits above the board (the embed wrapper's own leading content
     * and the Bases embed header). Measured through the offsetParent chain
     * rather than client rects so canvas zoom (a CSS transform on the node)
     * does not scale the number. The last value is remembered so the
     * ResizeObserver our own write triggers settles instead of looping.
     */
    private syncCanvasHeight(): void {
        const scrollerEl = this.canvasScrollerEl
        const rootEl = this.rootEl
        if (!scrollerEl || !rootEl?.isConnected) return
        const available = Math.max(
            CANVAS_MIN_EMBED_HEIGHT_PX,
            scrollerEl.clientHeight - offsetTopWithin(rootEl, scrollerEl)
        )
        if (Math.abs(available - this.canvasHeightPx) < 1) return
        this.canvasHeightPx = available
        rootEl.style.setProperty('--kap-embed-height', `${String(available)}px`)
    }

    /**
     * Apply (or re-apply, on an embed-line edit) the alias overrides. The
     * `height=` param feeds the CSS cap through a scoped custom property
     * (dynamic value → inline style is the lint-legal channel); without the
     * kap-embedded containment the embed grows to full content height and
     * loops the ResizeObserver.
     */
    private applyEmbedParams(params: EmbedParams): void {
        this.embedParams = params
        this.ephemeralMode = params.mode
        const rootEl = this.rootEl
        if (rootEl) {
            if (this.canvasScrollerEl) {
                // In a Canvas the node's own size wins (issue #154).
                this.syncCanvasHeight()
            } else if (params.heightPx !== null) {
                rootEl.style.setProperty('--kap-embed-height', `${String(params.heightPx)}px`)
            } else {
                rootEl.style.removeProperty('--kap-embed-height')
            }
        }
        // Re-seed the filter through the embed-aware loader (a first rebuild
        // on a detached root may already have loaded the persisted query; an
        // edited `filter=` must replace whatever was typed since).
        this.filterInitialized = false
    }

    /**
     * Apply the text filter to the already-built card set and (re-)render the
     * board or calendar. Split out from {@link rebuild} so a filter keystroke
     * re-renders without re-deriving cards/relationships (and without touching
     * the persistent filter input, so focus is never stolen mid-typing).
     */
    private applyFilterAndRender(): void {
        this.applyFilterAndRenderInner()
        // Focus mode (issue #160): the spotlight overlay sits ON TOP of
        // whatever mode just rendered, so it must be re-mounted after every
        // pass (mode renderers may have emptied the host).
        this.renderFocusOverlay()
    }

    private applyFilterAndRenderInner(): void {
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
        // Context chips (GTD contexts): pure derived state from the managed
        // `<prop>:` term — no separate context state. Original casing comes from
        // the raw query token (getContextTerms).
        this.filterBar?.setContextChips(getContextTerms(this.filterQuery, this.contextsProperty()))
        this.filterEmptyEl?.setText(
            zoom === null
                ? 'No cards match the filter.'
                : `No cards match the filter. ${
                      zoom.field === 'ancestor' ? 'Descendants' : 'Children'
                  } of "${zoom.title}" may be excluded by this view's own Base filters.`
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
            // Triage keeps its own no-op guard inside renderTriage
            // (lastTriageSignature, computed from the actual triage data —
            // which reads more of the note than the card set covers). Clear
            // the pass signature so a later gated mode always renders over
            // the triage DOM.
            this.lastRenderSignature = null
            this.renderToolbar(false)
            this.renderTriage()
            return
        }

        if (this.calendarMode()) {
            if (this.skipUnchangedRenderPass('calendar', cards, ':scope > .kap-calendar-root')) {
                return
            }
            this.renderToolbar(false)
            this.calendar?.render(cards)
            this.commitRenderPass()
            return
        }

        if (this.timelineMode()) {
            if (this.skipUnchangedRenderPass('timeline', cards, ':scope > .kap-timeline')) {
                return
            }
            this.renderToolbar(false)
            this.timeline?.render(cards)
            this.commitRenderPass()
            return
        }

        if (this.wbsMode()) {
            // WBS is not gated (its render inputs — tree expansion, off-board
            // context ancestors — are not covered by the pass signature).
            this.lastRenderSignature = null
            this.renderToolbar(false)
            this.wbs?.render(cards)
            return
        }

        if (this.agendaMode()) {
            // Ungated (cheap flat render; its date reads are not covered by
            // the pass signature).
            this.lastRenderSignature = null
            this.renderToolbar(false)
            this.renderAgenda(cards)
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
        // Embed column/lane restrictions (issues #128/#131): `columns=` and
        // `lanes=` alias overrides narrow the rendered board to the matching
        // columns/swimlanes only. The card menu still offers the full status
        // vocabulary (this.columns), so a card can be moved out of the
        // visible subset — it then simply leaves the embed.
        const embedColumns = this.embedParams?.columns ?? []
        if (embedColumns.length > 0) {
            board = restrictBoardColumns(board, embedColumns)
        }
        const embedLanes = this.embedParams?.lanes ?? []
        if (embedLanes.length > 0) {
            board = restrictBoardLanes(board, embedLanes)
        }
        this.board = board
        // Before the gate below: the render signature hashes these labels, so
        // editing an aggregated property re-renders even though nothing in the
        // card signatures changed (issue #23).
        this.aggregateLabels = this.computeColumnAggregates(board)
        // The board MODEL above is always refreshed (handlers resolve cards
        // through it and cardsByKey), but when nothing the render would draw
        // changed, the DOM pass and its side effects are skipped.
        const boardSelector = ':scope > .kap-board, :scope > .kap-lanes, :scope > .kap-empty'
        if (this.skipUnchangedRenderPass('board', cards, boardSelector)) return
        this.renderToolbar(this.board.lanes.length > 1)

        log(
            `Kanban rebuild: ${String(cards.length)}/${String(
                this.allCards.length
            )} cards, ${String(this.columns.length)} columns, ${String(
                board.lanes.length
            )} lane(s), noteType "${this.noteType.name}"`,
            'debug'
        )

        // Only a structure flip forces the full renderBoard teardown — the
        // keyed patch path reuses nodes in place and preserves scroll by
        // construction. Across that teardown, capture and pin back (same
        // task, no frame paints at scroll 0):
        // - per-lane horizontal column anchors, so a structural change
        //   (notably the Unmapped column appearing/disappearing at the left
        //   edge) doesn't shift the visible columns sideways (issue #12), and
        // - every column's and the lane stack's vertical scrollTop
        //   (issue #105, findings 3.1/3.3).
        const structureChanged = boardStructureWillChange(this.boardEl, this.board)
        const anchors = structureChanged ? this.captureColumnAnchors() : null
        const scrolls = structureChanged ? captureBoardScroll(this.boardEl) : null
        patchBoard(
            this.boardEl,
            this.board,
            {
                onOpen: (card, newTab) => this.openCard(card, newTab),
                onCardClick: (card, event) => this.onCardClick(card, event),
                onContextMenu: (card, event) => this.onCardContextMenu(card, event),
                onToggleLane: (laneId) => this.toggleLane(laneId),
                onToggleColumn: (columnId) => this.toggleColumn(columnId),
                onRelationship: (card, role, event) => this.showRelatedMenu(card, role, event),
                onMoveColumn: (card, direction) => this.moveCardColumn(card, direction),
                onReorderCard: (card, direction) => this.reorderCard(card, direction),
                onKeyboardMenu: (card, cardEl) => this.showCardMenuAt(card, cardEl),
                aggregateLabel: (laneId, columnId) =>
                    this.aggregateLabels.get(
                        KanbanActionPlannerView.aggregateKey(laneId, columnId)
                    ) ?? null,
                ...(this.addCardEnabled()
                    ? {
                          onAddCard: (laneId: string, columnId: string) => {
                              this.promptCreateCard(laneId, columnId)
                          }
                      }
                    : {})
            },
            this.collapsedLanes,
            this.collapsedColumns
        )
        if (scrolls) restoreBoardScroll(this.boardEl, scrolls)
        if (anchors) this.restoreColumnAnchors(anchors)
        this.selection?.refresh()

        // All cards share one height (the tallest card's), recomputed here since
        // the card set / content just changed. Synchronous (before paint) so
        // cards never flash at uneven heights.
        this.equalizeCardHeights()
        // AFTER equalize (issue #105, finding N2): the refocus reveal-scroll
        // must be computed against the final layout — before it, equalize
        // invalidates the scroll and the focus scroll can override the
        // anchors just restored.
        this.applyRefocus()
        // Last, so nothing above can override it: a Send to top/bottom pins its
        // column back to the card the user was looking at (issue #78 follow-up).
        this.applyPendingScrollAnchor()
        this.commitRenderPass()
    }

    /**
     * The render-signature gate (issue #105): skip the render pass — and all
     * of its side effects (toolbar teardown, full calendar/timeline teardown,
     * column-anchor restore, equalize, selection refresh) — when everything
     * the pass would draw is identical to the last completed pass and the
     * mode's DOM is already mounted. This absorbs the Bases echo of the
     * plugin's own frontmatter/config writes and body-only edits as true
     * no-ops. Optimistic in-memory mutations (applyMove, relationship edits,
     * refreshCardDisplay) change the signature by construction, so their
     * immediate render always proceeds; a pending keyboard refocus also
     * always renders (applyRefocus must run).
     */
    private skipUnchangedRenderPass(
        mode: ViewMode,
        cards: KanbanCard[],
        mountedSelector: string
    ): boolean {
        const signature = this.renderPassSignature(mode, cards)
        if (signature === null) {
            this.lastRenderSignature = null
            this.pendingRenderSignature = null
            return false
        }
        const mounted = this.boardEl ? this.boardEl.querySelector(mountedSelector) !== null : false
        if (mounted && this.refocusCardKey === null && signature === this.lastRenderSignature) {
            log(`Kanban render skipped (${mode}): signature unchanged`, 'debug')
            return true
        }
        // Clear now, commit only when the pass finishes (commitRenderPass):
        // a renderer throwing partway must not record the pass as completed,
        // or the next content-identical trigger (typically the write's own
        // echo) would be gated away and the partial DOM would stick.
        this.lastRenderSignature = null
        this.pendingRenderSignature = signature
        return false
    }

    /** Record the render pass that just finished (see {@link skipUnchangedRenderPass}). */
    private commitRenderPass(): void {
        this.lastRenderSignature = this.pendingRenderSignature
    }

    /**
     * Run a multi-file write sequence with the data-event rebuild deferred to
     * its end (see {@link suppressRebuildDepth}). The trailing rebuild only
     * runs when an event was actually swallowed, and the render-signature
     * gate absorbs it when the echo re-derives the optimistic state.
     */
    private async withRebuildsSuppressed(writes: () => Promise<void>): Promise<void> {
        this.suppressRebuildDepth++
        try {
            await writes()
        } finally {
            this.suppressRebuildDepth--
            if (this.suppressRebuildDepth === 0 && this.rebuildDeferredWhileSuppressed) {
                this.rebuildDeferredWhileSuppressed = false
                this.debouncedRebuild()
            }
        }
    }

    /**
     * A cheap, deterministic signature of everything the current render pass
     * consumes, or null for ungated modes (triage guards itself inside
     * renderTriage; WBS is ungated). Keep the enumerated inputs in sync with
     * {@link applyFilterAndRender} and the mode renderers:
     *
     * - All gated modes: the view mode, the filter query (drives the card
     *   set, the match count and the zoom chip) and the compact flag.
     * - Board: the grouped/sorted board model — lane/column structure,
     *   labels, counts, colors, WIP limits, lane/column collapse state, and
     *   every card's rendered content signature in position
     *   ({@link boardRenderSignature}).
     * - Calendar/timeline: the controller's render-state signature (range,
     *   anchor, tab, panel/group collapse, legend toggles, hidden types,
     *   resolved date properties, today, track width), plus — because those
     *   renderers read the note directly at render time (dates, estimates,
     *   milestones, sort values, tags) — each card's raw frontmatter, tags,
     *   note type, status, order, estimate config, panel sort value and
     *   content signature.
     */
    private renderPassSignature(mode: ViewMode, cards: KanbanCard[]): string | null {
        if (mode !== 'board' && mode !== 'calendar' && mode !== 'timeline') return null
        const common: unknown[] = [mode, this.filterQuery, this.compactMode()]
        if (mode === 'board') {
            return renderPassSignature([
                ...common,
                // The quick-capture footer is chrome the board signature doesn't
                // cover, so toggling the option would otherwise be gated away.
                this.addCardEnabled(),
                // Likewise the aggregate badge: it reads a property no card
                // signature covers, so the computed labels themselves go in
                // (sorted — a Map is not JSON-serializable in a stable order).
                [...this.aggregateLabels.entries()].sort((a, b) => a[0].localeCompare(b[0])),
                boardRenderSignature(this.board, this.collapsedLanes, this.collapsedColumns)
            ])
        }
        const sortRef =
            mode === 'calendar'
                ? parsePropertyRef(this.viewConfig.get('calendarSortProperty'))
                : null
        // One JSON.stringify per card — the raw frontmatter OBJECT goes in
        // directly (escaped once). The old form nested this array inside an
        // outer stringify, re-escaping every card's frontmatter a second time
        // (issue #110, item 2). {@link composeCardsSignature} joins the
        // per-card strings without that re-escape.
        const cardsPart = cards.map((card) => {
            const cache = this.app.metadataCache.getFileCache(card.file)
            const estimate = this.estimateConfigFor(card)
            return JSON.stringify([
                card.key,
                card.statusValue,
                card.order,
                this.noteTypeByPath.get(card.key)?.id ?? '',
                // Group headers and the timeline's Types menu draw the type
                // NAME — a settings rename keeps the id, so without the name
                // here the rename would be gated away (issue #105 review).
                this.noteTypeByPath.get(card.key)?.name ?? '',
                cardSignature(card, ''),
                // The dated renderers read these straight from the note.
                cache?.frontmatter ?? null,
                cache ? (getAllTags(cache) ?? []).join(',') : '',
                estimate.property,
                estimate.unit,
                sortRef ? this.readScalarProperty(card, sortRef) : null
            ])
        })
        const modeState =
            mode === 'calendar'
                ? this.calendar?.renderStateSignature()
                : this.timeline?.renderStateSignature()
        return composeCardsSignature([...common, modeState ?? ''], cardsPart)
    }

    /**
     * Refocus the card a keyboard move/reorder acted on, so focus follows it.
     * Runs after {@link equalizeCardHeights} with the focus scroll suppressed,
     * then a scoped minimal reveal — so the browser's focus reveal never scrolls
     * ancestors against a pre-equalize layout (issue #105, finding N2).
     */
    private applyRefocus(): void {
        if (!this.refocusCardKey || !this.boardEl) return
        const el = this.boardEl.querySelector<HTMLElement>(
            `.kap-card[data-card-key="${cssEscapeAttr(this.refocusCardKey)}"]`
        )
        if (!el) {
            // A keyboard move's card exists in the very next pass, so the key is
            // dropped at once. A newly CREATED note (issue #46) only reaches the
            // board once Bases re-runs its query, which takes a few passes — keep
            // the key until then, bounded so a note that never matches the view's
            // filters can't pin the render gate open forever.
            if (window.performance.now() < this.refocusUntil) return
            this.refocusCardKey = null
            this.refocusReveal = true
            return
        }
        this.refocusCardKey = null
        this.refocusUntil = 0
        const reveal = this.refocusReveal
        this.refocusReveal = true
        el.focus({ preventScroll: true })
        // Focus still follows the card (keyboard flow, screen readers), but a
        // Send to top/bottom deliberately skips the reveal: the viewport stays
        // put instead of chasing the card to the far end of the column.
        if (reveal) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }

    /** One column's card-list scroller in the rendered board (null when not mounted). */
    private columnCardsEl(laneId: string, columnId: string): HTMLElement | null {
        if (!this.boardEl) return null
        const colEl = this.boardEl.querySelector<HTMLElement>(
            `.kap-column[data-column-id="${cssEscapeAttr(columnId)}"][data-lane-id="${cssEscapeAttr(
                laneId
            )}"]`
        )
        return colEl?.querySelector<HTMLElement>(':scope > .kap-column-cards') ?? null
    }

    /**
     * Snapshot the anchor card that must stay put while `movedKey` is sent to
     * the top/bottom of its column. Null when the column does not scroll (there
     * is nothing to preserve) or nothing suitable is in view.
     */
    private captureCardScrollAnchor(
        laneId: string,
        columnId: string,
        movedKey: string
    ): PendingScrollAnchor | null {
        const listEl = this.columnCardsEl(laneId, columnId)
        if (!listEl || listEl.scrollHeight <= listEl.clientHeight) return null
        const listTop = listEl.getBoundingClientRect().top
        const anchor = pickScrollAnchor(
            Array.from(listEl.querySelectorAll<HTMLElement>(':scope > .kap-card')).map((el) => ({
                key: el.dataset['cardKey'] ?? '',
                top: el.getBoundingClientRect().top - listTop
            })),
            movedKey
        )
        return anchor ? { laneId, columnId, key: anchor.key, top: anchor.top } : null
    }

    /** Re-pin the captured anchor after the reorder rendered (see {@link captureCardScrollAnchor}). */
    private applyPendingScrollAnchor(): void {
        const anchor = this.pendingScrollAnchor
        if (!anchor) return
        this.pendingScrollAnchor = null
        const listEl = this.columnCardsEl(anchor.laneId, anchor.columnId)
        const el = listEl?.querySelector<HTMLElement>(
            `:scope > .kap-card[data-card-key="${cssEscapeAttr(anchor.key)}"]`
        )
        if (!listEl || !el) return
        const current = el.getBoundingClientRect().top - listEl.getBoundingClientRect().top
        const delta = anchorScrollDelta(anchor.top, current)
        if (delta !== 0) listEl.scrollTop += delta
    }

    // ── Multi-select + bulk actions (issue #18) ───────────────

    /** Mouse click on a card: let selection mode consume it, else open the note. */
    private onCardClick(card: KanbanCard, event: MouseEvent): void {
        if (!this.selection?.handleClick(card, event)) {
            this.openCard(card, event.ctrlKey || event.metaKey)
        }
    }

    /**
     * Card context-menu: a right-click on a card belonging to a multi-card
     * selection acts on the WHOLE selection (issue #129) — the bulk menu
     * opens instead of the single-card menu, whose `Set status` would only
     * write the clicked card and read as "the selection was ignored".
     */
    private onCardContextMenu(card: KanbanCard, event: MouseEvent): void {
        if (!this.selection?.handleContextMenu(card, event)) {
            this.showCardMenu(card, event)
        }
    }

    /** The owning lane id of a lane's `.kap-board` scroller ('' on single-lane boards). */
    private laneIdForBoardScroller(scroller: HTMLElement): string {
        return scroller.closest<HTMLElement>('.kap-lane')?.dataset['laneId'] ?? ''
    }

    /**
     * Record, PER LANE, the leftmost on-screen column and its offset from
     * that lane's scroller left edge — lanes are independent horizontal
     * scrollers, so each needs its own anchor (issue #105, finding 3.1).
     * Collapsed lanes (their board measures 0×0 behind `display: none`) are
     * skipped: every rect in them is zero and would capture a bogus
     * left-edge anchor. With per-lane column sets (mixed boards) the restore
     * is best-effort — lanes lacking their anchored id are left alone.
     */
    private captureColumnAnchors(): Map<string, { id: string; offset: number }> {
        const anchors = new Map<string, { id: string; offset: number }>()
        if (!this.boardEl) return anchors
        for (const scroller of Array.from(
            this.boardEl.querySelectorAll<HTMLElement>('.kap-board')
        )) {
            if (scroller.offsetWidth === 0 && scroller.offsetHeight === 0) continue
            const sRect = scroller.getBoundingClientRect()
            const cols = Array.from(scroller.querySelectorAll<HTMLElement>(':scope > .kap-column'))
            const anchorEl =
                cols.find((c) => c.getBoundingClientRect().right > sRect.left + 1) ?? cols[0]
            const id = anchorEl?.dataset['columnId']
            if (!anchorEl || !id) continue
            anchors.set(this.laneIdForBoardScroller(scroller), {
                id,
                offset: anchorEl.getBoundingClientRect().left - sRect.left
            })
        }
        return anchors
    }

    /** Pin each lane's anchored column back to its own captured offset. */
    private restoreColumnAnchors(anchors: Map<string, { id: string; offset: number }>): void {
        if (anchors.size === 0 || !this.boardEl) return
        for (const scroller of Array.from(
            this.boardEl.querySelectorAll<HTMLElement>('.kap-board')
        )) {
            if (scroller.offsetWidth === 0 && scroller.offsetHeight === 0) continue
            const anchor = anchors.get(this.laneIdForBoardScroller(scroller))
            if (!anchor) continue
            const el = scroller.querySelector<HTMLElement>(
                `:scope > .kap-column[data-column-id="${cssEscapeAttr(anchor.id)}"]`
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
        // Remember the width this pass measured at, so width-unchanged resize
        // ticks can skip the clear→measure→set cycle (issue #105, finding 5.5).
        this.lastEqualizeWidth = this.boardEl.offsetWidth
        applyUniformCardHeight(this.boardEl)
    }

    private relationalFilter(): RelationalFilter {
        const value = this.viewConfig.get('blockedFilter')
        const blocked: BlockedFilter = value === 'only' || value === 'hide' ? value : 'all'
        return { blocked }
    }

    private toggleLane(laneId: string): void {
        if (this.collapsedLanes.has(laneId)) this.collapsedLanes.delete(laneId)
        else this.collapsedLanes.add(laneId)
        this.viewConfig.set('collapsedLanes', [...this.collapsedLanes])
        this.rebuild()
    }

    private toggleColumn(columnId: string): void {
        if (this.collapsedColumns.has(columnId)) this.collapsedColumns.delete(columnId)
        else this.collapsedColumns.add(columnId)
        this.viewConfig.set('collapsedColumns', [...this.collapsedColumns])
        this.rebuild()
    }

    /** Load the persisted collapsed lane/column ids on first rebuild (issue #19). */
    private loadCollapseState(): void {
        if (this.collapseInitialized) return
        this.collapseInitialized = true
        this.collapsedLanes.clear()
        for (const id of readIdArray(this.viewConfig.get('collapsedLanes')))
            this.collapsedLanes.add(id)
        this.collapsedColumns.clear()
        for (const id of readIdArray(this.viewConfig.get('collapsedColumns')))
            this.collapsedColumns.add(id)
    }

    /** Read the durable calendar UI state (defaults when unset) — issue #19. */
    private restoreCalendarState(): CalendarViewState {
        const stored = this.viewConfig.get('calendarRangeOverride')
        const range =
            stored === 'week' || stored === 'month' || stored === 'quarter' || stored === 'year'
                ? stored
                : null
        return {
            range,
            tab: this.viewConfig.get('calendarTab') === 'deadline' ? 'deadline' : 'scheduled',
            panelCollapsed: this.viewConfig.get('calendarPanelCollapsed') === true,
            showScheduled: this.viewConfig.get('calendarShowScheduled') !== false,
            showDeadlines: this.viewConfig.get('calendarShowDeadlines') !== false
        }
    }

    /** Persist the durable calendar UI state per-view — issue #19. */
    private persistCalendarState(state: CalendarViewState): void {
        this.viewConfig.set('calendarRangeOverride', state.range)
        this.viewConfig.set('calendarTab', state.tab)
        this.viewConfig.set('calendarPanelCollapsed', state.panelCollapsed)
        this.viewConfig.set('calendarShowScheduled', state.showScheduled)
        this.viewConfig.set('calendarShowDeadlines', state.showDeadlines)
    }

    /** Read the persisted durable timeline state (issue #77; anchor stays transient). */
    private restoreTimelineState(): TimelineViewState {
        const stored = this.viewConfig.get('timelineRangeOverride')
        return {
            range:
                stored === 'week' || stored === 'month' || stored === 'quarter' || stored === 'year'
                    ? stored
                    : null,
            panelCollapsed: this.viewConfig.get('timelinePanelCollapsed') === true
        }
    }

    private persistTimelineState(state: TimelineViewState): void {
        this.viewConfig.set('timelineRangeOverride', state.range)
        this.viewConfig.set('timelinePanelCollapsed', state.panelCollapsed)
    }

    /**
     * Hidden timeline note-type IDs (estimate rework): a dedicated config key
     * with a validated string[] read — deliberately NOT part of
     * `TimelineViewState`, whose `persistState({ range })` call sites would
     * silently clobber the list.
     */
    private restoreTimelineHiddenTypes(): string[] {
        return readIdArray(this.viewConfig.get('timelineHiddenTypes'))
    }

    private persistTimelineHiddenTypes(ids: string[]): void {
        this.viewConfig.set('timelineHiddenTypes', ids)
    }

    /** Read the durable WBS UI state (defaults when unset) — issue #76. */
    private restoreWbsState(): WbsViewState {
        return { panelCollapsed: this.viewConfig.get('wbsPanelCollapsed') === true }
    }

    private persistWbsState(state: WbsViewState): void {
        this.viewConfig.set('wbsPanelCollapsed', state.panelCollapsed)
    }

    /**
     * Collapsed WBS node paths: a dedicated config key with a validated
     * string[] read — deliberately NOT part of `WbsViewState`, whose
     * `persistState({ panelCollapsed })` call sites would clobber the list
     * (the `timelineHiddenTypes` pattern).
     */
    private restoreWbsCollapsedNodes(): string[] {
        return readIdArray(this.viewConfig.get('wbsCollapsedNodes'))
    }

    private persistWbsCollapsedNodes(paths: string[]): void {
        this.viewConfig.set('wbsCollapsedNodes', paths)
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

    /**
     * The estimate property + unit for a card: its note type's override
     * (e.g. tasknotes-style `time_estimate` in minutes) when configured,
     * else the global default property in days. An override with an empty
     * property keeps the global name and only changes the unit.
     */
    private estimateConfigFor(card: KanbanCard): EstimateConfig {
        const typeId = this.noteTypeByPath.get(card.key)?.id
        const noteType = typeId ? findNoteType(this.plugin, typeId) : undefined
        const override = noteType?.estimate
        if (!override) {
            return { property: this.plugin.settings.defaultEstimateProperty, unit: 'days' }
        }
        return {
            property: override.property.trim() || this.plugin.settings.defaultEstimateProperty,
            unit: override.unit
        }
    }

    /**
     * The card's estimate resolved into DAYS through its own type's estimate
     * config (property + unit), for the `estimate:` filter alias (issue #169).
     */
    private estimateDaysFor(card: KanbanCard): number | null {
        const config = this.estimateConfigFor(card)
        const resolved = readEstimate(
            getFrontmatterValue(this.app, card.file, config.property),
            config.unit,
            this.plugin.settings.minutesPerDay
        )
        return resolved?.days ?? null
    }

    /**
     * The done-state definition for a card (issue #56): its own note type's
     * config; untyped cards fall back to the active/default note type (the
     * archive-config pattern). Null = no done state configured.
     */
    private doneConfigFor(card: KanbanCard): ResolvedDoneConfig | null {
        const typeId = this.noteTypeByPath.get(card.key)?.id
        const noteType = typeId ? findNoteType(this.plugin, typeId) : this.noteType
        return resolveDoneConfig(noteType)
    }

    /**
     * Whether a card's note counts as done per its type's done definition
     * (issue #113: `is:done` / the done leg of `is:available`). False when
     * the type has no done config.
     */
    private isCardDone(card: KanbanCard): boolean {
        const config = this.doneConfigFor(card)
        if (!config) return false
        return isDoneValue(getFrontmatterValue(this.app, card.file, config.property), config.values)
    }

    /**
     * The automation rules for a note: its own type's; untyped notes fall
     * back to the active/default note type (the archive/done pattern).
     */
    private automationRulesForPath(path: string): ReadonlyArray<AutomationRule> {
        const typeId = this.noteTypeByPath.get(path)?.id
        const noteType = typeId ? findNoteType(this.plugin, typeId) : this.noteType
        return noteType?.automations ?? []
    }

    /**
     * Run the card's type's automation rules for a status transition
     * (post-write). Every status write path funnels here — board drops and
     * menus (applyMove), bulk multi-select, and triage/property writes — and
     * fires at most once per actual transition. Property-condition rules on
     * the STATUS property also fire here (the snapshot entry updates in the
     * same step, so the write's metadata echo can't double-fire them).
     * Actions run raw frontmatter writes/moves and never re-enter this
     * method, so rules cannot cascade.
     */
    private async runStatusAutomations(
        card: KanbanCard,
        from: string | null,
        to: string | null,
        options?: { skipMoveActions?: boolean }
    ): Promise<void> {
        const statusProperty = this.statusPropertyFor(card)
        if (!statusProperty) return
        const rules = this.automationRulesForPath(card.key)
        // Keep the snapshot in sync even when nothing matches, so the echo
        // diff of this write never re-evaluates the same transition.
        this.automationSnapshot.get(card.key)?.set(statusProperty.toLowerCase(), to)
        if (rules.length === 0) return
        let matched = [
            ...rulesForTransition(rules, { from, to }, this.doneConfigFor(card), statusProperty),
            ...rulesForPropertyChange(rules, statusProperty, from, to)
        ]
        // Auto-archive owns the final location — a rule's move on the same
        // transition would be immediately overridden (and Notice-contradicted).
        if (options?.skipMoveActions) {
            matched = matched
                .map((r) => ({
                    ...r,
                    actions: r.actions.filter((a) => a.kind !== 'move-to-folder')
                }))
                .filter((r) => r.actions.length > 0)
        }
        await this.executeAutomations(card.key, card.file, matched, card.display.title)
    }

    /** Run the note's `archived`-trigger rules, just before the move. */
    private async runArchiveAutomations(card: KanbanCard): Promise<void> {
        const matched = rulesForArchive(this.automationRulesForPath(card.key))
        await this.executeAutomations(card.key, card.file, matched, card.display.title)
    }

    /**
     * Edge-triggered property-condition rules (any edit source): diff the
     * changed file's watched properties against the snapshot, fire the rules
     * whose condition BECAME true, and advance the snapshot. Guarded while a
     * run is in flight so automation writes never cascade into more rules.
     */
    private async handlePropertyAutomations(file: TFile): Promise<void> {
        const snapshot = this.automationSnapshot.get(file.path)
        if (!snapshot || snapshot.size === 0 || this.automationRunning.has(file.path)) return
        const rules = this.automationRulesForPath(file.path)
        const matched: AutomationRule[] = []
        for (const [name, oldValue] of snapshot) {
            const newValue = getFrontmatterValue(this.app, file, name)
            if (rawValuesEqual(oldValue, newValue)) continue
            matched.push(...rulesForPropertyChange(rules, name, oldValue, newValue))
            snapshot.set(name, newValue)
        }
        const title = this.allCards.find((c) => c.key === file.path)?.display.title ?? file.basename
        await this.executeAutomations(file.path, file, dedupeRules(matched), title)
    }

    /** Shared executor: re-entry guard, snapshot refresh, move Notice. */
    private async executeAutomations(
        path: string,
        file: TFile,
        matched: ReadonlyArray<AutomationRule>,
        title: string
    ): Promise<void> {
        if (matched.length === 0 || this.automationRunning.has(path)) return
        this.automationRunning.add(path)
        try {
            const result = await runAutomationRules(this.app, file, matched)
            // Refresh the snapshot for exactly what the actions wrote, so
            // their echoes never re-trigger property rules (no cascades).
            const snapshot = this.automationSnapshot.get(path)
            if (snapshot) {
                for (const name of result.writtenProperties) {
                    if (snapshot.has(name)) {
                        snapshot.set(name, getFrontmatterValue(this.app, file, name))
                    }
                }
            }
            if (result.movedTo) {
                const folder = result.movedTo.split('/').slice(0, -1).join('/') || '/'
                new Notice(`Moved "${title}" to ${folder} (automation).`)
            }
            if (result.moveError) {
                new Notice(`Automation move failed: ${result.moveError}`)
            }
        } finally {
            this.automationRunning.delete(path)
        }
    }

    /**
     * Baseline for the property-condition diffs, rebuilt with the board
     * (only notes whose type watches at least one property get an entry).
     */
    private rebuildAutomationSnapshot(files: TFile[]): void {
        const next = new Map<string, Map<string, unknown>>()
        for (const file of files) {
            const watched = watchedProperties(this.automationRulesForPath(file.path))
            if (watched.length === 0) continue
            const values = new Map<string, unknown>()
            for (const name of watched) {
                values.set(name, getFrontmatterValue(this.app, file, name))
            }
            next.set(file.path, values)
        }
        this.automationSnapshot = next
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
        this.viewConfig.set('statuses', orderedColumnIds)
        this.rebuild()
    }

    private resolveStatusProperty(_files: TFile[]): string | null {
        const configured = basesPropToName(this.viewConfig.get('statusProperty'))
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
            basesPropToName(this.viewConfig.get('orderProperty')) ??
            this.plugin.settings.defaultOrderProperty
        )
    }

    private resolveDueDateProperty(): string {
        return (
            basesPropToName(this.viewConfig.get('dueDateProperty')) ??
            this.noteType.calendar.dueDateProperty ??
            this.plugin.settings.defaultDueDateProperty
        )
    }

    private resolveScheduledDateProperty(): string {
        return (
            basesPropToName(this.viewConfig.get('scheduledDateProperty')) ??
            this.noteType.calendar.scheduledDateProperty ??
            this.plugin.settings.defaultScheduledDateProperty
        )
    }

    /**
     * The defer ("can't start until") property (issue #113): per-view
     * override, else the note type's calendar override (empty = unset), else
     * the global default.
     */
    private resolveDeferDateProperty(): string {
        const perType = this.noteType.calendar.deferDateProperty.trim()
        return (
            basesPropToName(this.viewConfig.get('deferDateProperty')) ??
            (perType.length > 0 ? perType : null) ??
            this.plugin.settings.defaultDeferDateProperty
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
        const viewStatuses = readStringArray(this.viewConfig.get('statuses'))
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
            readStringArray(this.viewConfig.get('statuses')).length === 0
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
        if (readStringArray(this.viewConfig.get('statuses')).length > 0) return this.columns
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
        const configured = basesPropToName(this.viewConfig.get('statusProperty'))
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
        const value = this.viewConfig.get('showEmptyColumns')
        return value === undefined ? true : value === true
    }

    private unmappedPosition(): UnmappedPosition {
        return this.viewConfig.get('unmappedPosition') === 'last' ? 'last' : 'first'
    }

    /** The per-view in-column sort mode (issue #17); `order` = manual (default). */
    private cardSortMode(): TabSortMode {
        return readSortMode(this.viewConfig.get('cardSort'))
    }

    private cardSortDirection(): SortDirection {
        return this.viewConfig.get('cardSortDirection') === 'desc' ? 'desc' : 'asc'
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
            mode === 'property' ? parsePropertyRef(this.viewConfig.get('cardSortProperty')) : null
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

    /** The per-view column aggregate function (issue #23). */
    private columnAggregateKind(): AggregateKind {
        return readAggregateKind(this.viewConfig.get('columnAggregate'))
    }

    /**
     * A card's contribution to the column aggregate (issue #23).
     *
     * When the picked property IS this card's own estimate property, the value
     * goes through {@link readEstimate} and comes back in **days** — otherwise a
     * board mixing a days-based type with a minutes-based one (tasknotes-style
     * `time_estimate`) would sum 3 days and 90 minutes into "93". Any other
     * property is a plain number, and non-numeric values drop out.
     */
    private aggregateValueFor(
        card: KanbanCard,
        ref: PropertyRef
    ): { value: number | null; isEstimate: boolean } {
        if (ref.kind === 'note') {
            const estimate = this.estimateConfigFor(card)
            if (estimate.property.toLowerCase() === ref.name.toLowerCase()) {
                const resolved = readEstimate(
                    getFrontmatterValue(this.app, card.file, ref.name),
                    estimate.unit,
                    this.plugin.settings.minutesPerDay
                )
                return { value: resolved?.days ?? null, isEstimate: true }
            }
        }
        return { value: toAggregateNumber(this.readScalarProperty(card, ref)), isEstimate: false }
    }

    /** Map key for a column's aggregate — lane + column, since lanes differ. */
    private static aggregateKey(laneId: string, columnId: string): string {
        return `${laneId} ${columnId}`
    }

    /**
     * Compute every column's aggregate label (issue #23). Returns an empty map
     * when the option is off or no property is picked, which is also what makes
     * the renderer drop the badge.
     */
    private computeColumnAggregates(board: Board<KanbanCard>): Map<string, string> {
        const labels = new Map<string, string>()
        const kind = this.columnAggregateKind()
        if (kind === 'none') return labels
        const ref = parsePropertyRef(this.viewConfig.get('columnAggregateProperty'))
        if (!ref) return labels

        for (const lane of board.lanes) {
            for (const { column, cards } of lane.columns) {
                const values: (number | null)[] = []
                let anyEstimate = false
                for (const card of cards) {
                    const { value, isEstimate } = this.aggregateValueFor(card, ref)
                    if (isEstimate) anyEstimate = true
                    values.push(value)
                }
                // Estimate values are days — render them through the shared
                // duration grammar ("1d 2h") rather than as decimal days.
                const label = formatAggregateLabel(
                    kind,
                    computeAggregate(values, kind),
                    anyEstimate
                        ? (days): string => formatDuration(days, this.plugin.settings.minutesPerDay)
                        : undefined
                )
                if (label !== null)
                    labels.set(KanbanActionPlannerView.aggregateKey(lane.lane.id, column.id), label)
            }
        }
        return labels
    }

    /**
     * The per-view card-title source (issue #4): a validated Bases property id
     * (`note.*` / `formula.*` / `file.*`), or null → the note name.
     */
    private titlePropertyId(): BasesPropertyId | null {
        const ref = parsePropertyRef(this.viewConfig.get('titleProperty'))
        if (!ref) return null
        return ref.kind === 'note' ? (`note.${ref.name}` as BasesPropertyId) : ref.id
    }

    /**
     * The date the countdown badge counts down to (issue #68): the deadline by
     * default, or the scheduled date for boards that triage by when work lands.
     * Only the badge follows this — the overdue/due-today card emphasis stays on
     * the deadline.
     */
    private countdownDateProperty(): string {
        return this.viewConfig.get('countdownSource') === 'scheduled'
            ? this.scheduledDateProperty
            : this.dueDateProperty
    }

    /**
     * Build a card's display from the current config + settings (issue #50/#62).
     * Extracted so a lightweight presentational refresh ({@link refreshCardDisplay})
     * can recompute just the display without re-deriving the whole card.
     */
    private cardDisplayFor(
        file: TFile,
        /** Just-written values by lowercase property name (finding 4.3). */
        overrides?: ReadonlyMap<string, string | null>
    ): CardDisplay {
        return buildCardDisplay(
            this.app,
            file,
            this.entriesByPath.get(file.path),
            this.config,
            this.titlePropertyId(),
            this.dueDateProperty,
            startOfDay(new Date()),
            {
                show: this.viewConfig.get('showDueCountdown') === true,
                soonDays: this.plugin.settings.dueSoonThresholdDays,
                placement: this.plugin.settings.dueCountdownStyle,
                property: this.countdownDateProperty()
            },
            (id) => this.allowedValuesForCardField(file, id),
            overrides
        )
    }

    private toCard(file: TFile): KanbanCard {
        // The card's own type's status property (mixed boards) — per-view
        // override and board default fall out of statusPropertyForFile.
        const statusProperty = this.statusPropertyForFile(file)
        const statusValue = this.settledStatus(file.path, this.cachedStatus(file, statusProperty))
        const order = coerceOrder(getFrontmatterValue(this.app, file, this.orderProperty))
        const display = this.cardDisplayFor(file)
        const laneValue =
            this.laneGrouping.kind === 'none' ? null : (this.laneValueByPath.get(file.path) ?? null)
        const relationships = toCardRelationships(this.relationshipsByPath.get(file.path))
        const defer = parseFrontmatterDate(
            getFrontmatterValue(this.app, file, this.deferDateProperty)
        )
        return {
            key: file.path,
            file,
            title: file.basename,
            statusValue,
            order,
            laneValue,
            display,
            relationships,
            contexts: this.contextsForFile(file),
            deferred: isDeferred(defer, startOfDay(new Date()))
        }
    }

    /** A note's status exactly as the metadata cache currently holds it. */
    private cachedStatus(file: TFile, statusProperty: string | null): string | null {
        if (statusProperty === null) return null
        return normalizeStatusValue(getFrontmatterValue(this.app, file, statusProperty))
    }

    /**
     * The status to render for a note: the cached one, unless a move's write is
     * still in flight and the cache has not caught up yet — see
     * {@link resolvePendingWrite}. A settled write is forgotten here, so the
     * override lives exactly as long as the staleness it covers.
     */
    private settledStatus(path: string, cached: string | null): string | null {
        const pending = this.pendingStatusWrites.get(path)
        if (!pending) return cached
        const resolved = resolvePendingWrite(pending, cached, window.performance.now())
        if (resolved.settled) this.pendingStatusWrites.delete(path)
        return resolved.value
    }

    /** A note's GTD contexts (original casing, note order), or `[]` when unset. */
    private contextsForFile(file: TFile): string[] {
        return stringifyForSearch(getFrontmatterValue(this.app, file, this.contextsProperty()))
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
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
    private async applyLaneChange(cardRef: KanbanCard, targetLaneId: string): Promise<boolean> {
        const card = this.liveCard(cardRef)
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
        // Optimistic model mutation (issue #105, finding 4.1): update the
        // card's in-memory lane value BEFORE the write, so the immediate
        // render applyMove performs draws the card in the TARGET lane (no
        // snap-back to the source lane while the write round-trips). The
        // value gets the same normalization computeLaneValues applies on the
        // echo, so the re-derived state is identical and the echo is absorbed
        // by the render-signature gate.
        const laneValue = laneValueForLaneId(targetLaneId, UNGROUPED_LANE_ID)
        const previousLaneValue = card.laneValue
        const previousMapped = this.laneValueByPath.get(card.key) ?? null
        card.laneValue = laneValue
        this.laneValueByPath.set(card.key, laneValue)
        try {
            await this.withRebuildsSuppressed(async () => {
                if (targetLaneId === UNGROUPED_LANE_ID) {
                    await deleteProperty(this.app, card.file, property)
                } else {
                    await setProperty(this.app, card.file, property, targetLaneId)
                }
            })
        } catch (error) {
            // A failed write fires no echo, and laneValueByPath is only
            // re-derived in resolveAndRebuild — without this revert the card
            // would render in a lane the disk does not hold indefinitely
            // (issue #105 review).
            card.laneValue = previousLaneValue
            this.laneValueByPath.set(card.key, previousMapped)
            this.applyFilterAndRender()
            log('Cross-lane write failed; reverted the optimistic lane change.', 'error', error)
            new Notice('Failed to move the card to the target lane.')
            return false
        }
        return true
    }

    /**
     * Resolve the LIVE card object for a (possibly stale) card reference.
     * Reused DOM nodes keep handlers that close over the card from the render
     * that created them, and every rebuild recreates `allCards` — so after
     * any rebuild a captured card can be a ghost whose mutation the next
     * render would never see (issue #105 review). Every optimistic mutation
     * path must resolve through this first.
     */
    private liveCard(card: KanbanCard): KanbanCard {
        return (
            this.cardsByKey.get(card.key) ?? this.allCards.find((c) => c.key === card.key) ?? card
        )
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
        cardRef: KanbanCard,
        newStatus: string | null,
        destLaneId: string,
        destColumnId: string,
        index: number
    ): Promise<void> {
        const card = this.liveCard(cardRef)
        // The card's own note type is authoritative for every status write:
        // the value comes from the card's lane/type column set (callers), the
        // property from its own type.
        const statusProperty = this.statusPropertyFor(card)
        const statusChanged = statusProperty !== null && newStatus !== card.statusValue

        // Status-triggered archiving is terminal — the note leaves the board and its
        // file moves — so it stays on the write-then-rebuild path (the archived note
        // must also carry the new status). No optimistic shortcut here.
        if (statusChanged && this.willAutoArchive(card, newStatus) && statusProperty) {
            const previousStatus = card.statusValue
            // Suppressed like the optimistic branch: a multi-action rule can
            // widen the write sequence arbitrarily, and the non-resetting
            // debouncer would otherwise render a torn mid-sequence state.
            await this.withRebuildsSuppressed(async () => {
                if (newStatus === null) await deleteProperty(this.app, card.file, statusProperty)
                else await setProperty(this.app, card.file, statusProperty, newStatus)
                // Automations run on the note BEFORE it moves to the archive,
                // so property/tag actions land on the archived note too. The
                // archive owns the final location — rule moves are skipped.
                await this.runStatusAutomations(card, previousStatus, newStatus, {
                    skipMoveActions: true
                })
                await this.maybeAutoArchive(card, newStatus)
            })
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

        const previousStatus = card.statusValue
        if (statusChanged) {
            card.statusValue = newStatus
            // Outrank the metadata cache until it reports the write (issue #64
            // follow-up): the optimistic model below is recreated by every
            // rebuild from the cache, so a rebuild landing before Obsidian
            // re-parses the note would snap the card back to its old column.
            // `previous` is read from the cache, not from the model, so a
            // second move of the same card records the value it must mask.
            this.pendingStatusWrites.set(card.key, {
                value: newStatus,
                previous: this.cachedStatus(card.file, statusProperty),
                until: window.performance.now() + PENDING_STATUS_WRITE_TIMEOUT_MS
            })
        }
        this.applyFilterAndRender()

        // Persist. Each write triggers onDataUpdated → a debounced rebuild that
        // re-derives this exact state, so there is no visual change (issue #64).
        // The whole sequence runs with data rebuilds suppressed: the renumber
        // path writes N files, and the non-resetting 250ms debouncer would
        // otherwise fire mid-sequence and re-derive a PARTIAL on-disk state,
        // visibly reverting the optimistic render (issue #105 review).
        try {
            await this.withRebuildsSuppressed(async () => {
                if (statusChanged && statusProperty) {
                    if (newStatus === null)
                        await deleteProperty(this.app, card.file, statusProperty)
                    else await setProperty(this.app, card.file, statusProperty, newStatus)
                }
                for (const write of orderWrites) {
                    await setProperty(this.app, write.file, this.orderProperty, write.order)
                }
                if (statusChanged) {
                    await this.runStatusAutomations(card, previousStatus, newStatus)
                }
            })
        } catch (error) {
            // A failed write leaves disk behind the optimistic model, and no
            // echo will correct it — re-derive everything from the metadata
            // cache so the board shows what actually landed. Drop the pending
            // write first, or it would mask the very state being re-derived.
            this.pendingStatusWrites.delete(card.key)
            log('Card move write failed; re-deriving the board state.', 'error', error)
            new Notice('Failed to save the card move.')
            void this.resolveAndRebuild()
        }
    }

    // ── Quick capture (issue #46) ─────────────────────────────

    /** Whether the per-column "Add card" affordance is rendered. Default on. */
    private addCardEnabled(): boolean {
        return this.viewConfig.get('showAddCard') !== false
    }

    /**
     * The note type whose creation config drives a column: on note-type
     * swimlanes each lane owns its own type (mixed boards), otherwise the
     * board's resolved type.
     */
    private noteTypeForLane(laneId: string): NoteType {
        if (this.laneGrouping.kind === 'note-type' && laneId !== UNGROUPED_LANE_ID) {
            const byName = this.plugin.settings.noteTypes.find((t) => t.name === laneId)
            if (byName) return byName
        }
        return this.noteType
    }

    /**
     * The Base's filter-implied facts (folder / tags / property equalities) a new
     * note must carry to show up in this view. The query object is a private
     * runtime accessor, so it is fully feature-detected: no query, no facts (the
     * note is still created, and a note that ends up outside the filters is
     * reported rather than silently vanishing).
     */
    private baseFilterFacts(): BaseFilterFacts {
        try {
            const controller = (this as unknown as { queryController?: unknown }).queryController
            const query = (
                controller as { query?: { getSerializable?: () => unknown } } | undefined
            )?.query
            if (typeof query?.getSerializable !== 'function') return emptyFilterFacts()
            const serialized = query.getSerializable() as {
                filters?: unknown
                views?: Array<{ name?: string; filters?: unknown }>
            }
            const viewFilters = serialized.views?.find((v) => v.name === this.config.name)?.filters
            return collectFilterFacts(serialized.filters, viewFilters)
        } catch (error: unknown) {
            log('Could not read the Base filters for quick capture; ignoring them.', 'warn', error)
            return emptyFilterFacts()
        }
    }

    /** Layer the note type's own creation config over the Starter Kit's + the Base's. */
    private resolvedCreationConfig(
        noteType: NoteType,
        facts: BaseFilterFacts
    ): ResolvedCreationConfig {
        const skType = getNoteTypeById(this.app, noteType.id)
        const inherited = skType ? creationDefaults(skType) : emptyInheritedDefaults()
        const fallback = this.app.fileManager.getNewFileParent(this.filePathForNewNote()).path
        return resolveCreationConfig(noteType.creation, inherited, narrowestFolder(facts), fallback)
    }

    /**
     * The source path Obsidian's "new note location" resolution keys off — the
     * .base file itself (the active file for a board), NOT one of the queried
     * notes: under "same folder as current file" an arbitrary card's folder would
     * otherwise decide where captures land.
     */
    private filePathForNewNote(): string {
        return this.app.workspace.getActiveFile()?.path ?? ''
    }

    /**
     * Every tag the new note needs: the type's tag recognition rules + the Base's
     * filter tags. Deliberately NOT the Starter Kit type's full `tags` list (nor
     * its required-property defaults): the Starter Kit makes auto-adding those an
     * explicit opt-in ("adding tags automatically can be unexpected"), and a note
     * type's template already supplies them. Only what the card needs to be
     * recognized and to match the view is written here.
     */
    private creationTags(noteType: NoteType, facts: BaseFilterFacts): string[] {
        const tags = noteType.typeRecognition.mappings
            .filter((m) => m.enabled && m.type === 'tag')
            .map((m) => m.value.trim().replace(/^#+/, ''))
            .filter((value) => value.length > 0)
        for (const tag of facts.tags) if (!tags.includes(tag)) tags.push(tag)
        return tags
    }

    /**
     * Ask for a title, then create the note (issue #46). The properties that make
     * it land in the clicked column are computed HERE and written by the creation
     * service AFTER the template, so a template's own status prompt can never win
     * over the column the user clicked.
     */
    private promptCreateCard(laneId: string, columnId: string): void {
        const noteType = this.noteTypeForLane(laneId)
        const facts = this.baseFilterFacts()
        const config = this.resolvedCreationConfig(noteType, facts)
        // ONE context for the subtitle, the live preview, and the creation itself:
        // `{{uuid}}` (and `{{date}}` across midnight) would otherwise resolve to
        // different values, so the previewed path would not be the created one.
        const ctx = liveExpressionContext()
        new CreateNoteModal(
            this.app,
            `New ${noteType.name === 'Default' ? 'note' : noteType.name}`,
            this.createNoteSubtitle(laneId, columnId, config, ctx),
            (title) => this.previewCreatedNote(title, config, ctx),
            (title) => {
                void this.createCard(title, laneId, columnId, noteType, facts, config, ctx)
            }
        ).open()
    }

    /** The modal's subtitle: which column (and lane) the note will land in. */
    private createNoteSubtitle(
        laneId: string,
        columnId: string,
        config: ResolvedCreationConfig,
        ctx: ExpressionContext
    ): string {
        const column = this.laneColumns(laneId).find((c) => c.id === columnId)
        const where = column ? `“${column.label}”` : 'this column'
        const lane =
            this.board.isMultiLane && laneId !== UNGROUPED_LANE_ID && laneId.length > 0
                ? ` in the “${laneId}” swimlane`
                : ''
        const folder = normalizeCreationFolder(resolvePlaceholders(config.folder, ctx))
        return `The note is created in ${
            folder.length > 0 ? `“${folder}”` : 'the vault root'
        } and lands in ${where}${lane}.`
    }

    /** Live preview for the modal: the exact path + template that will be used. */
    private previewCreatedNote(
        title: string,
        config: ResolvedCreationConfig,
        ctx: ExpressionContext
    ): CreateNotePreview {
        const basename = buildNoteBasename(title, config, ctx)
        const folder = normalizeCreationFolder(resolvePlaceholders(config.folder, ctx))
        const path = buildUniquePath(
            folder,
            basename,
            (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
        )
        const configured = config.templatePath.trim()
        return {
            path,
            templatePath: configured.length > 0 ? configured : autoTemplatePathFor(this.app, path)
        }
    }

    /**
     * Create the note and reveal it. Rebuilds are suppressed for the whole
     * sequence so the Bases echo of the creation write can't re-derive a partial
     * state mid-flight (same discipline as {@link applyMove}).
     */
    private async createCard(
        title: string,
        laneId: string,
        columnId: string,
        noteType: NoteType,
        facts: BaseFilterFacts,
        config: ResolvedCreationConfig,
        ctx: ExpressionContext
    ): Promise<void> {
        const properties: Record<string, unknown> = { ...facts.properties }

        // The status the card must end up with, resolved exactly like every other
        // status write (`statusPropertyForFile`): the per-view override wins, then
        // the TARGET TYPE's own property (a mixed board writes each lane's type's
        // property), then the board-wide one. Blank names fall through — an empty
        // configured property must not become a `''` frontmatter key.
        const statusValue = this.columnStatusValue(columnId, laneId)
        const statusProperty =
            basesPropToName(this.viewConfig.get('statusProperty')) ||
            noteType.statusProperty ||
            this.statusProperty
        if (statusValue !== null && statusProperty) properties[statusProperty] = statusValue

        const laneValue = this.laneValueForNewCard(laneId)
        if (laneValue) properties[laneValue.property] = laneValue.value

        // Manual order only: a name/property sort owns the in-column order, and
        // quick capture must never renumber (rewrite) the column's other notes.
        if (this.cardSortMode() === 'order') {
            const order = this.appendOrderFor(laneId, columnId)
            if (order !== null) properties[this.orderProperty] = order
        }

        // Boxed so the assignment inside the closure stays visible to the type
        // narrower (a plain `let` narrows to `never` here).
        const outcome: { value: CreateNoteResult | null } = { value: null }
        await this.withRebuildsSuppressed(async () => {
            outcome.value = await createNote(
                this.app,
                {
                    config,
                    title,
                    properties,
                    tags: this.creationTags(noteType, facts),
                    listProperties: facts.listProperties
                },
                ctx
            )
        })

        const created = outcome.value
        if (!created || !created.ok) {
            new Notice(
                created?.reason === 'empty-title'
                    ? 'Enter a name for the new note.'
                    : 'Could not create the note.'
            )
            return
        }

        // The note is opened by the creation service (BEFORE templating, so
        // `tp.file.cursor()` resolves) — nothing to open here. Revealing the card
        // is only right when the note did NOT open: focusing it would otherwise
        // steal focus from the editor the user was just sent to.
        const file = created.file
        if (!config.openAfterCreate) {
            this.refocusCardKey = file.path
            this.refocusUntil = window.performance.now() + REVEAL_NEW_CARD_TIMEOUT_MS
        }
        // The card may not be able to appear here: a template can move the note out
        // of a filtered folder, and a Base filtered on the very property the columns
        // write (`status == "Todo"` with a Done column) is contradictory by
        // construction. Say so instead of leaving the user hunting for a card that
        // never appears.
        const unmet = this.unmetFilterFacts(file, facts, properties)
        if (unmet.length > 0) {
            new Notice(
                `Created “${file.basename}” in “${
                    file.parent?.path ?? '/'
                }”, but this view filters on ${unmet.join(', ')} — the card does not appear here.`,
                8000
            )
        }
        void this.resolveAndRebuild()
    }

    /** The swimlane property + value a new card needs to land in `laneId`. */
    private laneValueForNewCard(laneId: string): { property: string; value: string } | null {
        if (this.laneGrouping.kind !== 'property') return null
        if (laneId === UNGROUPED_LANE_ID || laneId.length === 0) return null
        const ref = parsePropertyRef(this.laneGrouping.property)
        // Computed swimlanes (`formula.*` / `file.*`) are read-only (rule 26).
        if (!ref || ref.kind !== 'note') return null
        return { property: ref.name, value: laneId }
    }

    /**
     * The manual order placing a new card at the END of its column: one step past
     * the largest existing order. `null` when the column holds cards with NO order
     * — those sort last (rule: unset order goes to the bottom), so any number
     * would place the new card ABOVE them, and fixing that would mean renumbering
     * the column. Quick capture writes exactly one file, so it writes nothing here
     * and the new card joins the unordered group instead.
     */
    private appendOrderFor(laneId: string, columnId: string): number | null {
        const cards = this.columnCards(laneId, columnId)
        if (cards.some((c) => c.order === null)) return null
        const orders = cards.map((c) => c.order).filter((order): order is number => order !== null)
        return orders.length === 0 ? ORDER_STEP : Math.max(...orders) + ORDER_STEP
    }

    /**
     * The view's filter facts the created note does NOT satisfy — a folder a
     * template moved it out of, or a property/tag the card's own column, swimlane
     * or template overwrote. Purely for reporting: the note is never rewritten to
     * force a match (the clicked column stays authoritative).
     */
    private unmetFilterFacts(
        file: TFile,
        facts: BaseFilterFacts,
        written: Record<string, unknown>
    ): string[] {
        const unmet: string[] = []
        for (const folder of facts.folders) {
            if (folder.length === 0) continue
            if (file.path === folder || file.path.startsWith(`${folder}/`)) continue
            unmet.push(`folder “${folder}”`)
        }
        for (const [name, value] of Object.entries(facts.properties)) {
            const key = findKeyCaseInsensitive(written, name)
            if (key === null || written[key] === value) continue
            unmet.push(`${name} = ${JSON.stringify(value)}`)
        }
        return unmet
    }

    private columnCards(laneId: string, columnId: string): KanbanCard[] {
        const lane = this.board.lanes.find((l) => l.lane.id === laneId) ?? this.board.lanes[0]
        return lane?.columns.find((c) => c.column.id === columnId)?.cards ?? []
    }

    private showCardMenu(card: KanbanCard, event: MouseEvent, extend?: (menu: Menu) => void): void {
        // liveCard: the menu displays current status/relationships, and its
        // handlers must mutate the live model, not a pre-rebuild ghost.
        buildCardMenu(this.liveCard(card), this.cardMenuHost, extend).showAtMouseEvent(event)
    }

    /**
     * Keyboard-triggered card menu, anchored just below the card (issue #20).
     * Like the pointer path, a card belonging to a multi-card selection gets
     * the bulk menu instead (issue #130).
     */
    private showCardMenuAt(card: KanbanCard, cardEl: HTMLElement): void {
        if (this.selection?.handleContextMenuAt(card, cardEl)) return
        const rect = cardEl.getBoundingClientRect()
        buildCardMenu(this.liveCard(card), this.cardMenuHost).showAtPosition({
            x: rect.left,
            y: rect.bottom
        })
    }

    /** Status-only quick menu (WBS status dot, issue #98) — same write path. */
    private showStatusMenu(card: KanbanCard, event: MouseEvent): void {
        const menu = buildStatusMenu(this.liveCard(card), this.cardMenuHost)
        // Keyboard activation synthesizes a click at (0,0) — anchor to the dot.
        if (event.detail === 0 && event.currentTarget instanceof HTMLElement) {
            const rect = event.currentTarget.getBoundingClientRect()
            menu.showAtPosition({ x: rect.left, y: rect.bottom })
        } else {
            menu.showAtMouseEvent(event)
        }
    }

    // ── Focus mode (issue #160) ───────────────────────────────

    /** Spotlight one card full-pane (issue #160). */
    enterFocus(card: KanbanCard): void {
        this.focusCardKey = card.key
        this.renderFocusOverlay()
    }

    /** Leave focus mode: remove the overlay and stop the timer tick. */
    exitFocus(): void {
        this.focusCardKey = null
        this.stopFocusTick()
        if (this.boardEl) removeFocusView(this.boardEl)
    }

    /** Advance to the next card in the current filtered order (wraps around). */
    private focusNext(): void {
        if (this.focusCardKey === null) return
        const keys = [...this.cardsByKey.keys()]
        if (keys.length === 0) {
            this.exitFocus()
            return
        }
        const index = keys.indexOf(this.focusCardKey)
        const next = keys[(index + 1) % keys.length]
        if (next === undefined) {
            this.exitFocus()
            return
        }
        this.focusCardKey = next
        this.renderFocusOverlay()
    }

    /**
     * Mark the focused card done (its type's done definition) and advance.
     * A done-state column writes through {@link setCardStatus} — the same
     * path the board uses, so automations fire exactly once; a non-status
     * done property is written directly (the property-condition automation
     * diff picks it up like any other write path).
     */
    private async focusDone(cardRef: KanbanCard): Promise<void> {
        const card = this.liveCard(cardRef)
        const config = this.doneConfigFor(card)
        if (!config) return
        this.focusNext()
        const doneColumn = this.cardColumns(card).find(
            (col) => col.statusValue !== null && isDoneValue(col.statusValue, config.values)
        )
        if (doneColumn) {
            await this.setCardStatus(card, doneColumn.statusValue, doneColumn.id)
        } else {
            await setProperty(this.app, card.file, config.property, config.values[0] ?? true)
        }
    }

    /** Start/stop the time-tracking session for the focused card (issue #119). */
    private async focusToggleTimer(card: KanbanCard): Promise<void> {
        if (isTrackingPath(this.plugin, card.key)) await stopTimeSession(this.plugin)
        else await startTimeSession(this.plugin, card.key)
        this.renderFocusOverlay()
    }

    /** The focused card's tracked (live session included) + estimate labels. */
    private focusTimerLabels(card: KanbanCard): {
        trackedLabel: string | null
        estimateLabel: string | null
    } {
        const perDay = this.plugin.settings.minutesPerDay
        let minutes =
            readDurationMinutes(
                getFrontmatterValue(
                    this.app,
                    card.file,
                    this.plugin.settings.defaultDurationProperty
                )
            ) ?? 0
        const session = this.plugin.settings.activeTimeSession
        if (session && session.path === card.key) {
            minutes += elapsedSessionMinutes(session.startedAt, Date.now())
        }
        const config = this.estimateConfigFor(card)
        const estimate = readEstimate(
            getFrontmatterValue(this.app, card.file, config.property),
            config.unit,
            perDay
        )
        return {
            trackedLabel: minutes > 0 ? formatTrackedMinutes(minutes, perDay) : null,
            estimateLabel: estimate?.label ?? null
        }
    }

    /** Build the focus overlay's render data for a card. */
    private buildFocusData(card: KanbanCard): FocusCardData {
        const keys = [...this.cardsByKey.keys()]
        const index = keys.indexOf(card.key)
        const doneOf = (key: string): boolean => {
            const child = this.cardsByKey.get(key) ?? this.allCards.find((c) => c.key === key)
            return child ? this.isCardDone(child) : false
        }
        const related: FocusRelatedGroup[] = [
            { label: 'Blocked by', icon: 'ban', items: card.relationships.blocked_by },
            { label: 'Parent', icon: 'corner-left-up', items: card.relationships.parent },
            { label: 'Sibling', icon: 'arrow-left-right', items: card.relationships.sibling }
        ]
            .map((group) => ({
                ...group,
                items: group.items.map((note) => ({ key: note.key, label: note.label }))
            }))
            .filter((group) => group.items.length > 0)
        const { trackedLabel, estimateLabel } = this.focusTimerLabels(card)
        return {
            title: card.display.title,
            statusLabel: this.statusLabelFor(card),
            fields: card.display.fields,
            subtasks: card.relationships.child.map((note) => ({
                key: note.key,
                title: note.label,
                done: doneOf(note.key)
            })),
            related,
            tracking: isTrackingPath(this.plugin, card.key),
            trackedLabel,
            estimateLabel,
            canMarkDone: this.doneConfigFor(card) !== null && !this.isCardDone(card),
            position: index >= 0 ? index + 1 : 1,
            total: Math.max(keys.length, 1)
        }
    }

    /** Mount (or re-mount) the focus overlay; called after every render pass. */
    private renderFocusOverlay(): void {
        if (!this.boardEl) return
        if (this.focusCardKey === null) {
            removeFocusView(this.boardEl)
            this.stopFocusTick()
            return
        }
        const card =
            this.cardsByKey.get(this.focusCardKey) ??
            this.allCards.find((c) => c.key === this.focusCardKey)
        if (!card) {
            this.exitFocus()
            return
        }
        renderFocusView(this.boardEl, this.buildFocusData(card), {
            onExit: () => this.exitFocus(),
            onOpen: (newTab) => this.openCard(card, newTab),
            onNext: () => this.focusNext(),
            onDone: () => void this.focusDone(card),
            onToggleTimer: () => void this.focusToggleTimer(card),
            onOpenNote: (key, newTab) => {
                const file = this.app.vault.getFileByPath(key)
                if (file) void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file)
            },
            onMenu: (event) => this.showCardMenu(card, event)
        })
        this.startFocusTick()
    }

    /** 1s tick updating just the timer label while a session runs. */
    private startFocusTick(): void {
        if (this.focusTimerId !== null) return
        this.focusTimerId = window.setInterval(() => {
            if (!this.boardEl || this.focusCardKey === null) return
            const card =
                this.cardsByKey.get(this.focusCardKey) ??
                this.allCards.find((c) => c.key === this.focusCardKey)
            if (!card) return
            const { trackedLabel, estimateLabel } = this.focusTimerLabels(card)
            updateFocusTimerLabel(this.boardEl, trackedLabel, estimateLabel)
        }, 1000)
    }

    private stopFocusTick(): void {
        if (this.focusTimerId !== null) {
            window.clearInterval(this.focusTimerId)
            this.focusTimerId = null
        }
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
                this.setCardPropertyFromMenu(card, propertyName, value),
            contextValuesFor: (card) => this.contextValuesFor(card),
            toggleCardContext: (card, value, present) =>
                this.toggleCardContext(card, value, present),
            promptNewContext: (card) => this.promptNewContext(card),
            archivingConfigured: (card) => this.archivingConfigured(card),
            archiveCard: (card) => this.archiveCard(card),
            cardDate: (card, dimension) => this.cardDate(card, dimension),
            writeCardDate: (card, dimension, iso) => this.writeCardDate(card, dimension, iso),
            promptDate: (card, dimension, current) => this.promptDate(card, dimension, current),
            enterFocus: (card) => this.enterFocus(card),
            // Time tracking (issue #119): one global session in the settings.
            isTrackingCard: (card) => isTrackingPath(this.plugin, card.key),
            startTracking: (card) => startTimeSession(this.plugin, card.key),
            stopTracking: () => stopTimeSession(this.plugin),
            openRelated: (note, newTab) => this.openRelated(note, newTab),
            focusOnChildren: (card) => this.focusOnChildren(card),
            focusOnDescendants: (card) => this.focusOnDescendants(card.display.title),
            canReorderCards: () => this.cardSortMode() === 'order',
            sendCardToEdge: (card, edge) => this.sendCardToEdge(card, edge),
            todayKey: () => toDateKey(startOfDay(new Date())),
            tomorrowKey: () => toDateKey(addDays(startOfDay(new Date()), 1)),
            addableRelationshipRoles: (card) => this.addableRelationshipRoles(card),
            directRelationships: (card) => this.directRelationships(card),
            addRelationship: (card, role) => this.addRelationship(card, role),
            removeRelationship: (card, role, targetPath) =>
                this.removeRelationship(card, role, targetPath)
        }
    }

    // ── Relationship editing (issue #14) ──────────────────────

    /**
     * The role→link-property map for a vault path, resolved from the note's
     * OWN recognized type so reads and writes agree per card on mixed boards
     * (issue #14 + per-type resolution). Board files use the recognition map;
     * off-board paths (WBS context ancestors) recognize on demand; both fall
     * back to the active note type.
     */
    private relationshipPropertiesForPath(path: string): Record<RelationshipRole, string> {
        let type = this.noteTypeByPath.get(path) ?? null
        if (type === null && !this.noteTypeByPath.has(path)) {
            const file = this.app.vault.getFileByPath(path)
            type = file ? recognizeLocalNoteType(this.app, this.plugin, file) : null
        }
        const noteType = type ? findNoteType(this.plugin, type.id) : undefined
        return roleProperties(noteType ?? this.noteType)
    }

    /** Roles whose link-property is non-empty for THIS card's own type. */
    private addableRelationshipRoles(card: KanbanCard): ReadonlySet<RelationshipRole> {
        const props = this.relationshipPropertiesForPath(card.key)
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
        const props = this.relationshipPropertiesForPath(card.key)
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
    private addRelationship(cardRef: KanbanCard, role: RelationshipRole): void {
        const property = this.relationshipPropertiesForPath(cardRef.key)[role]
        if (property.length === 0) return
        const exclude = new Set<string>([cardRef.file.path])
        for (const target of directLinkTargets(this.app, cardRef.file, property)) {
            exclude.add(target.path)
        }
        new RelationshipTargetModal(this.app, role, exclude, (target) => {
            // Resolve the live card at COMMIT time — a rebuild can land while
            // the picker is open, orphaning the captured object (issue #105
            // review). Optimistic: show the new badge at once, then write
            // (issue #64).
            const card = this.liveCard(cardRef)
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
        cardRef: KanbanCard,
        role: RelationshipRole,
        targetPath: string
    ): Promise<void> {
        const card = this.liveCard(cardRef)
        const property = this.relationshipPropertiesForPath(card.key)[role]
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
    private moveCardColumn(cardRef: KanbanCard, direction: 1 | -1): void {
        const card = this.liveCard(cardRef)
        const loc = this.cardLocation(card)
        if (!loc) return
        const target = loc.columns[loc.colIndex + direction]
        if (!target) return // at the first/last column
        const newStatus = target.column.id === UNMAPPED_COLUMN_ID ? null : target.column.statusValue
        this.refocusCardKey = card.key
        void this.applyMove(card, newStatus, loc.laneId, target.column.id, target.cards.length)
    }

    /** Keyboard: reorder a card up/down within its column (writes manual order). */
    private reorderCard(cardRef: KanbanCard, direction: 1 | -1): void {
        if (this.cardSortMode() !== 'order') return // manual reorder is off under a sort (#17)
        const card = this.liveCard(cardRef)
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
    private sendCardToEdge(cardRef: KanbanCard, edge: 'top' | 'bottom'): void {
        if (this.cardSortMode() !== 'order') return // manual reorder is off under a sort (#17)
        const card = this.liveCard(cardRef)
        const loc = this.cardLocation(card)
        if (!loc) return
        const column = loc.columns[loc.colIndex]
        if (!column) return
        const target = edge === 'top' ? 0 : column.cards.length
        const atEdge =
            edge === 'top' ? loc.cardIndex === 0 : loc.cardIndex === column.cards.length - 1
        if (atEdge) return
        // The card travels the whole column, so neither the reveal-scroll nor the
        // raw scrollTop keeps the user in place: anchor the column to a card that
        // stays visible, and let the rest close the gap the card left behind.
        this.pendingScrollAnchor = this.captureCardScrollAnchor(
            loc.laneId,
            column.column.id,
            card.key
        )
        this.refocusCardKey = card.key
        this.refocusReveal = false
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
            // Chip styles have different geometry, so natural card heights
            // change immediately — re-equalize NOW so the board-wide height
            // shift lands with its cause instead of riding along with the
            // next unrelated rebuild (issue #105, finding 5.6).
            this.equalizeCardHeights()
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
        const show = this.viewConfig.get('showDueCountdown') === true
        const soonDays = this.plugin.settings.dueSoonThresholdDays
        const placement = this.plugin.settings.dueCountdownStyle
        const today = startOfDay(new Date())
        const countdownProperty = this.countdownDateProperty()
        for (const card of this.allCards) {
            const countdown = show
                ? formatCountdown(
                      parseFrontmatterDate(
                          getFrontmatterValue(this.app, card.file, countdownProperty)
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
        new DatePromptModal(
            this.app,
            heading,
            current ? toDateKey(current) : '',
            (iso) => {
                void this.writeCardDate(card, dimension, iso)
            },
            this.plugin.settings.firstDayOfWeek
        ).open()
    }

    /**
     * Write (or clear, when `isoDate` is null) a card's scheduled date or
     * deadline, then refresh the card optimistically (issue #105, finding
     * 4.3) — the due state/countdown recompute from the EXACT string written,
     * so the echo re-derives the identical display and is absorbed.
     */
    private async writeCardDate(
        card: KanbanCard,
        dimension: DateDimension,
        isoDate: string | null
    ): Promise<void> {
        const property =
            dimension === 'scheduled' ? this.scheduledDateProperty : this.dueDateProperty
        if (isoDate === null) {
            await deleteProperty(this.app, card.file, property)
            this.applyCardWrite(card, property, null)
            return
        }
        const date = parseFrontmatterDate(isoDate)
        if (!date) return
        const dateFormat =
            this.noteType.calendar.dateFormat || this.plugin.settings.defaultDateFormat
        const formatted = formatDate(date, dateFormat)
        await setProperty(this.app, card.file, property, formatted)
        this.applyCardWrite(card, property, formatted)
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
        cardRef: KanbanCard,
        statusValue: string | null,
        columnId: string
    ): Promise<void> {
        const card = this.liveCard(cardRef)
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

    /**
     * Write (or clear) an enum property on a card's note (issue #52). A write
     * that targets the card's STATUS property (triage allows it) is a status
     * transition like any other: the in-model status updates and the type's
     * automation rules run, so triage edits behave like board moves.
     */
    private async setCardProperty(
        card: KanbanCard,
        propertyName: string,
        value: string | null
    ): Promise<void> {
        const live = this.liveCard(card)
        const statusProperty = this.statusPropertyFor(live)
        const isStatusWrite =
            statusProperty !== null && propertyName.toLowerCase() === statusProperty.toLowerCase()
        const previousStatus = live.statusValue
        if (value === null) await deleteProperty(this.app, live.file, propertyName)
        else await setProperty(this.app, live.file, propertyName, value)
        if (isStatusWrite && value !== previousStatus) {
            live.statusValue = value
            await this.runStatusAutomations(live, previousStatus, value)
        }
    }

    /**
     * Card-menu enum write: persist, then refresh optimistically (issue #105,
     * finding 4.3). Triage has its own optimistic path over the raw
     * {@link setCardProperty}, so the refresh lives on the menu boundary.
     */
    private async setCardPropertyFromMenu(
        card: KanbanCard,
        propertyName: string,
        value: string | null
    ): Promise<void> {
        await this.setCardProperty(card, propertyName, value)
        this.applyCardWrite(card, propertyName, value)
    }

    /**
     * Optimistic refresh after a card-menu frontmatter write (issue #105,
     * finding 4.3): recompute the card's display with the just-written value
     * substituted (the Bases entry and metadata cache are stale until the
     * echo) and render immediately, so the chip/countdown updates at once
     * instead of landing on the echo as a node swap. In board mode the card
     * is also re-focused, so the keyboard path keeps focus on the node the
     * reconciler replaces. When the echo re-derives the identical display it
     * is absorbed by the render-signature gate; a differing derivation
     * simply renders once more, exactly as before this shortcut existed.
     */
    private applyCardWrite(card: KanbanCard, propertyName: string, value: string | null): void {
        const live = this.liveCard(card)
        live.display = this.cardDisplayFor(
            live.file,
            new Map<string, string | null>([[propertyName.toLowerCase(), value]])
        )
        // refocusCardKey is consumed by the board patch path only — setting it
        // in other modes would linger and defeat the render-signature gate.
        if (this.viewMode() === 'board') this.refocusCardKey = live.key
        this.applyFilterAndRender()
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

    private agendaMode(): boolean {
        return this.viewMode() === 'agenda'
    }

    /** The active view mode (triage wins, else calendar, timeline, WBS, board). */
    private viewMode(): ViewMode {
        // Embed override (issue #103): ephemeral, independent of the flags
        // saved in the shared .base view config.
        if (this.ephemeralMode !== null) return this.ephemeralMode
        if (this.viewConfig.get('triageMode') === true) return 'triage'
        if (this.viewConfig.get('calendarMode') === true) return 'calendar'
        if (this.viewConfig.get('timelineMode') === true) return 'timeline'
        if (this.viewConfig.get('wbsMode') === true) return 'wbs'
        if (this.viewConfig.get('agendaMode') === true) return 'agenda'
        return 'board'
    }

    /** Switch the view mode, persisting the mode flags and rebuilding. */
    private setViewMode(mode: ViewMode): void {
        if (this.viewMode() === mode) return
        // Selection is board-only: leaving board mode must end the select
        // session, or the reserved bar (issue #105, finding 5.4) would sit
        // stuck over calendar/timeline/triage/WBS with no toggle to close it.
        if (mode !== 'board') this.selection?.exitMode()
        if (this.isEmbedded()) {
            // Embeds are projections (issue #103): persisting the flags would
            // silently rewrite the shared view for every other consumer.
            this.ephemeralMode = mode
        } else {
            this.viewConfig.set('calendarMode', mode === 'calendar')
            this.viewConfig.set('triageMode', mode === 'triage')
            this.viewConfig.set('timelineMode', mode === 'timeline')
            this.viewConfig.set('wbsMode', mode === 'wbs')
            this.viewConfig.set('agendaMode', mode === 'agenda')
        }
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
        return readCompactMode(this.viewConfig)
    }

    /** Toggle compact cards, persisting the flag (same mechanism as the mode flags). */
    private toggleCompactMode(): void {
        this.viewConfig.set('compactMode', !this.compactMode())
        this.rebuild()
    }

    // ── Agenda mode (issue #39) ───────────────────────────────

    /** The agenda look-ahead window, persisted per view (embed-safe overlay). */
    private agendaWindow(): AgendaWindow {
        return this.viewConfig.get('agendaWindow') === 'today' ? 'today' : 'week'
    }

    /** Whether the agenda hides unavailable cards (issue #113); default on. */
    private agendaAvailableOnly(): boolean {
        return this.viewConfig.get('agendaAvailableOnly') !== false
    }

    /**
     * Render agenda mode (issue #39): a flat, prioritized Overdue / Today /
     * Upcoming list over the SAME (already filtered) card set as the board.
     * Availability (issue #113) comes from the search records so the two
     * features share one definition.
     */
    private renderAgenda(cards: KanbanCard[]): void {
        if (!this.boardEl) return
        const today = startOfDay(new Date())
        const inputs = cards.map((card) => {
            const rec = this.searchByKey.get(card.key)
            return {
                ...card,
                title: card.display.title,
                due: rec?.due ?? null,
                scheduled: parseFrontmatterDate(
                    getFrontmatterValue(this.app, card.file, this.scheduledDateProperty)
                ),
                available: rec ? isAvailable(rec, today) : true
            }
        })
        const model = buildAgenda(inputs, today, this.agendaWindow(), this.agendaAvailableOnly())
        renderAgendaView(
            this.boardEl,
            model,
            { window: this.agendaWindow(), availableOnly: this.agendaAvailableOnly(), today },
            {
                onOpen: (card, newTab) => this.openCard(card, newTab),
                onContextMenu: (card, event) => this.showCardMenu(card, event),
                onSetWindow: (window) => {
                    this.viewConfig.set('agendaWindow', window)
                    this.rebuild()
                },
                onToggleAvailableOnly: () => {
                    this.viewConfig.set('agendaAvailableOnly', !this.agendaAvailableOnly())
                    this.rebuild()
                }
            }
        )
    }

    // ── Triage mode (issue #53) ───────────────────────────────

    /**
     * Render the triage queue into the board host from a stable snapshot.
     * `override` carries a just-written value (the metadata cache is stale
     * until the echo) so the immediate render reflects the click — finding 4.2.
     */
    private renderTriage(override?: TriageValueOverride): void {
        if (!this.boardEl) return
        this.triageTypeProps.clear() // rebuild per-type property sets for this render
        const cfg = readTriageConfig(this.viewConfig)
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
            ? this.buildTriageData(
                  current,
                  cfg,
                  this.triageCursor + 1,
                  this.triageQueueKeys.length,
                  override && override.cardKey === current.key ? override : undefined
              )
            : null
        const pane = this.buildTriagePane(cfg, currentKey ?? null, override)
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
                    this.viewConfig.set('triagePaneCollapsed', !this.triagePaneCollapsed())
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
        return this.viewConfig.get('triagePaneCollapsed') === true
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
    private buildTriagePane(
        cfg: TriageConfig,
        currentKey: string | null,
        override?: TriageValueOverride
    ): TriagePaneModel {
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
                        needsTriage: this.triageRank(
                            card,
                            cfg,
                            override && override.cardKey === card.key ? override : undefined
                        ).include
                    }))
                }
            })
        }))
        return { collapsed, grouped, groups, total: cards.length }
    }

    /**
     * Advance the triage cursor (Next/Skip); past the end shows the done state.
     * `override` propagates a just-written value into the render so the LEFT
     * pane reflects the completed card despite the stale cache (finding 4.2).
     */
    private triageAdvance(override?: TriageValueOverride): void {
        this.triageCursor += 1
        // A new card starts at the top — don't inherit the scroll of the last one.
        this.triageResetScroll = true
        this.renderTriage(override)
    }

    /** Persist the triage scope, reset the queue snapshot, and re-render. */
    private setTriageScope(scope: TriageConfig['scope']): void {
        this.viewConfig.set('triageScope', scope)
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
                scope: readTriageConfig(this.viewConfig).scope,
                editable: readIdArray(this.viewConfig.get('triageUpdateProps')).map(toBasesId),
                gating: readIdArray(this.viewConfig.get('triageGateProps')).map(toBasesId),
                context: readIdArray(this.viewConfig.get('triageSeeProps')).map(toBasesId),
                tokens: readStringArray(this.viewConfig.get('triageTokens'))
            }),
            save: (data: TriageConfigData): void => {
                this.viewConfig.set('triageScope', data.scope)
                this.viewConfig.set('triageUpdateProps', data.editable)
                this.viewConfig.set('triageGateProps', data.gating)
                this.viewConfig.set('triageSeeProps', data.context)
                this.viewConfig.set('triageTokens', data.tokens)
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
        const cfg = readTriageConfig(this.viewConfig)
        const wasComplete = this.cardUnsetCount(card, cfg) === 0
        await this.setCardProperty(card, name, value)
        // Use the value we just wrote everywhere below — the metadata cache
        // hasn't reparsed yet, so re-reading it here would still see the old
        // value. Without the override the immediate render recomputes data
        // identical to the pre-write screen, the signature guard skips it, and
        // the visible change lands only on the echo teardown (finding 4.2).
        const override: TriageValueOverride = { cardKey: card.key, name, value }
        const nowComplete = this.cardUnsetCount(card, cfg, override) === 0
        if (!wasComplete && nowComplete) {
            // Card fully clarified — celebrate, then jump to the next card (or the
            // done state when this was the last one).
            this.celebrateTriageComplete()
            this.triageAdvance(override)
        } else {
            this.renderTriage(override)
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
    private triageRank(
        card: KanbanCard,
        cfg: TriageConfig,
        /** Just-written value for one gate (stale cache — see {@link cardUnsetCount}). */
        override?: { name: string; value: string | null }
    ): TriageRank {
        if (cfg.scope === 'review') {
            const state = this.cardReviewState(card)
            return { include: state.due, weight: state.weight }
        }
        const n = this.cardUnsetCount(card, cfg, override)
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

    /**
     * Read a card scalar, substituting a just-written value for the matching
     * note property (finding 4.2). The override goes through the SAME
     * coercion the echo's re-read applies ({@link coerceSortValue} on the
     * frontmatter value), so the post-write render and the echo derive
     * identical data and the echo is absorbed by the signature guard.
     */
    private readScalarWithOverride(
        card: KanbanCard,
        ref: PropertyRef,
        override?: { name: string; value: string | null }
    ): number | string | null {
        if (
            override &&
            ref.kind === 'note' &&
            ref.name.toLowerCase() === override.name.toLowerCase()
        ) {
            return coerceSortValue(override.value)
        }
        return this.readScalarProperty(card, ref)
    }

    /** Assemble the render data for one triage card. */
    private buildTriageData(
        card: KanbanCard,
        cfg: TriageConfig,
        position: number,
        total: number,
        /** Just-written value substituted for the matching property (stale cache). */
        override?: { name: string; value: string | null }
    ): TriageCardData {
        const baseContext: TriageContextField[] =
            cfg.seeProps.length > 0
                ? cfg.seeProps
                      .map((id) => this.triageContextField(card, id, override))
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
            const raw = this.readScalarWithOverride(card, parsed.ref, override)
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
    private triageContextField(
        card: KanbanCard,
        id: string,
        override?: { name: string; value: string | null }
    ): TriageContextField | null {
        const parsed = this.triageRef(id)
        if (!parsed) return null
        const scalar = this.readScalarWithOverride(card, parsed.ref, override)
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
                compactMode: this.compactMode(),
                contextsAvailable: this.hasAnyContextValue(),
                contextCount: getContextTerms(this.filterQuery, this.contextsProperty()).length
            },
            {
                onSetMode: (mode) => this.setViewMode(mode),
                onConfigure: () => this.openSettings(),
                onLanePrev: () => this.scrollLane(-1),
                onLaneNext: () => this.scrollLane(1),
                onToggleSelectionMode: () => this.selection?.toggleMode(),
                onToggleCompactMode: () => this.toggleCompactMode(),
                onOpenContextMenu: (anchorEl) => this.openContextMenu(anchorEl)
            }
        )
    }

    // ── Filter bar (issue #34) ────────────────────────────────

    /** Load the persisted filter query on first rebuild and sync the input. */
    private loadFilterQuery(): void {
        if (this.filterInitialized) return
        this.filterInitialized = true
        // An embed's `filter=` param (issue #103) seeds the bar instead of the
        // persisted query; it rides the normal parse path so the match count
        // shows in the toolbar, and later edits stay ephemeral (the viewConfig
        // funnel keeps every embed write in memory). This only runs before any
        // in-embed edit: filterInitialized is reset solely by detectEmbed().
        const stored = this.embedParams?.filter ?? this.viewConfig.get('filterQuery')
        let query = typeof stored === 'string' ? stored : ''
        // An embed's `context=` param (fast-follow) pins contexts by folding a
        // managed `<prop>:` term into the SAME query — no separate machinery,
        // ephemeral like `filter=` (this never calls this.config.set).
        const embedContexts = this.embedParams?.contexts ?? []
        if (embedContexts.length > 0) {
            query = setContextTerms(query, this.contextsProperty(), embedContexts)
        }
        this.filterQuery = query
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
        this.viewConfig.set('filterQuery', '')
        this.applyFilterAndRender()
    }

    /** Persist the current query and re-render (debounced target). */
    private commitFilter(): void {
        // In embeds the funnel keeps this ephemeral (issue #103): filter edits
        // (incl. zoom, which rides setFilterQuery → here) never touch the
        // shared view config.
        this.viewConfig.set('filterQuery', this.filterQuery)
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

    // ── GTD contexts (filter-only) ────────────────────────────

    /** The global contexts property name (default-on-missing to the constant). */
    private contextsProperty(): string {
        return this.plugin.settings.defaultContextsProperty || DEFAULT_CONTEXTS_PROPERTY
    }

    /**
     * The union of GTD context values across the built card set, de-duped
     * case-insensitively with original casing preserved. Read lazily (on menu
     * open) from the already-built `allCards` — never triggers a rebuild. Values
     * come from the raw frontmatter (original casing), not the lowercased search
     * index, so the menu/chips display `@Work` as typed.
     */
    private availableContextValues(): string[] {
        const byLower = new Map<string, string>()
        for (const card of this.allCards) {
            for (const value of card.contexts) {
                const key = value.toLowerCase()
                if (!byLower.has(key)) byLower.set(key, value)
            }
        }
        return Array.from(byLower.values()).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
        )
    }

    /** Whether any built card carries a GTD context (drives the switcher's empty state). */
    private hasAnyContextValue(): boolean {
        return this.allCards.some((card) => card.contexts.length > 0)
    }

    /**
     * Open the context switcher: an Obsidian `Menu` of checkboxes, one per
     * available context value. Toggling recomputes the selected set (matched
     * case-insensitively against the raw available values) and routes it through
     * `setFilterQuery` (the single funnel), so the change persists per-view and
     * re-renders like any filter change. No note-frontmatter is written.
     */
    private openContextMenu(anchorEl: HTMLElement): void {
        const prop = this.contextsProperty()
        const available = this.availableContextValues()
        const selected = getContextTerms(this.filterQuery, prop)
        const selectedLower = new Set(selected.map((v) => v.toLowerCase()))
        const menu = new Menu()
        for (const value of available) {
            const isSelected = selectedLower.has(value.toLowerCase())
            menu.addItem((item) => {
                item.setTitle(value)
                    .setChecked(isSelected)
                    .onClick(() => this.toggleContextValue(value))
            })
        }
        const rect = anchorEl.getBoundingClientRect()
        menu.showAtPosition({ x: rect.left, y: rect.bottom })
    }

    /**
     * Toggle one context value in the managed filter term. Recomputes the full
     * selected set from the raw query (preserving original casing) and writes it
     * back through `setFilterQuery` as ONE OR-ed token.
     */
    private toggleContextValue(value: string): void {
        const prop = this.contextsProperty()
        const current = getContextTerms(this.filterQuery, prop)
        const lower = value.toLowerCase()
        const next = current.some((v) => v.toLowerCase() === lower)
            ? current.filter((v) => v.toLowerCase() !== lower)
            : [...current, value]
        this.setFilterQuery(setContextTerms(this.filterQuery, prop, next))
    }

    /** Chip ✕: remove only that context value; the rest of the query survives. */
    private dismissContext(value: string): void {
        const prop = this.contextsProperty()
        const lower = value.toLowerCase()
        const remaining = getContextTerms(this.filterQuery, prop).filter(
            (v) => v.toLowerCase() !== lower
        )
        this.setFilterQuery(setContextTerms(this.filterQuery, prop, remaining))
    }

    /**
     * The context legend for calendar/timeline: every context on the board
     * (unfiltered), with `active` = currently pinned in the filter. Drives the
     * color key + click-to-filter. Empty when the board has no contexts.
     */
    private contextLegend(): ContextLegendItem[] {
        const active = new Set(
            getContextTerms(this.filterQuery, this.contextsProperty()).map((v) => v.toLowerCase())
        )
        return this.availableContextValues().map((value) => ({
            value,
            active: active.has(value.toLowerCase())
        }))
    }

    // ── Card-menu context writes (list add/remove) ────────────

    /** The card-menu "Contexts" submenu payload: board values + the card's own. */
    private contextValuesFor(card: KanbanCard): { values: string[]; current: string[] } | null {
        return { values: this.availableContextValues(), current: this.liveCard(card).contexts }
    }

    /**
     * Toggle one context on a card's note: optimistic (mutate `card.contexts`
     * and re-render before the write), then a LIST add/remove — never a scalar
     * overwrite — with case-insensitive dedupe. On failure, restore and re-render.
     */
    private async toggleCardContext(
        cardRef: KanbanCard,
        value: string,
        present: boolean
    ): Promise<void> {
        const card = this.liveCard(cardRef)
        const prop = this.contextsProperty()
        const lower = value.toLowerCase()
        const before = card.contexts
        card.contexts = present
            ? before.filter((v) => v.toLowerCase() !== lower)
            : [...before, value]
        this.applyFilterAndRender()
        const matches = (item: unknown): boolean =>
            typeof item === 'string' && item.toLowerCase() === lower
        try {
            if (present) await removeFromListProperty(this.app, card.file, prop, value, matches)
            else await appendToListProperty(this.app, card.file, prop, value, matches)
        } catch (error) {
            card.contexts = before
            this.applyFilterAndRender()
            log('Failed to update contexts', 'error', error)
        }
    }

    /** Prompt for a brand-new context and add it to the card (skips a duplicate). */
    private promptNewContext(cardRef: KanbanCard): void {
        const card = this.liveCard(cardRef)
        new TextPromptModal(this.app, 'Add context', 'e.g. @work', 'Add', (value) => {
            const exists = card.contexts.some((v) => v.toLowerCase() === value.toLowerCase())
            if (exists) return
            void this.toggleCardContext(card, value, false)
        }).open()
    }

    /** The `due:` evaluation context (today + calendar period ranges). */
    private filterContext(): FilterContext {
        const today = startOfDay(new Date())
        const firstDay = this.plugin.settings.firstDayOfWeek
        return {
            today,
            // `context:` / `contexts:` aliases resolve to the configured
            // contexts property (issue #166).
            contextsProp: this.contextsProperty().toLowerCase(),
            // Unit-suffixed `estimate:` values convert through the global
            // minutes-per-day setting (issue #169).
            minutesPerDay: this.plugin.settings.minutesPerDay,
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
     * while hidden and fires the ResizeObserver when revealed. That re-render
     * goes through {@link applyFilterAndRender}, NOT the full rebuild — a
     * resize never changes the card set (issue #105, finding 2.4), and the
     * render-signature gate (which includes the track width) turns
     * width-unchanged ticks into no-ops. The timeline panel evaluation runs
     * BEFORE it — it only re-renders itself on a width-CATEGORY change
     * (memoized), so the resize render storm never fights it.
     */
    private onResize(): void {
        // A hidden leaf measures 0×0: every card/track would read 0, so any
        // work here is wasted or destructive (issue #105, finding 5.5). The
        // reveal fires the observer again with real dimensions.
        const boardEl = this.boardEl
        if (!boardEl || (boardEl.offsetWidth === 0 && boardEl.offsetHeight === 0)) return
        // Embed detection (issue #103) may have been skipped while the root
        // was detached; a real-dimension tick means it is attached now. A
        // just-detected embed rebuilds so mode/filter overrides apply.
        if (!this.embedChecked) {
            this.detectEmbed()
            if (this.isEmbedded()) {
                this.rebuild()
                return
            }
        }
        this.calendar?.evaluatePanelAutoCollapse()
        this.timeline?.evaluatePanelAutoCollapse()
        this.wbs?.evaluatePanelAutoCollapse()
        // Height-only resizes (selection bar, empty-state toggles) cannot
        // change card wrapping — re-equalize only when the width changed
        // since the last pass (finding 5.5).
        if (boardEl.offsetWidth !== this.lastEqualizeWidth) this.equalizeCardHeights()
        // Timeline: %-geometry reflows in pure CSS — re-render only when the
        // new width flips a px-gated affordance (finding N1).
        if (this.timelineMode() && (this.timeline?.resizeNeedsRender() ?? true)) {
            this.applyFilterAndRender()
        }
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
        await this.runArchiveAutomations(card)
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
        await this.runArchiveAutomations(card)
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
