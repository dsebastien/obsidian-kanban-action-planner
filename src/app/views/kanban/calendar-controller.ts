import { getAllTags } from 'obsidian'
import type { App } from 'obsidian'
import {
    addDays,
    buildCalendar,
    formatLongDate,
    parseFrontmatterDate,
    shiftAnchor,
    startOfDay,
    toDateKey,
    weekdayLabels
} from '../../domain/calendar'
import type { CalendarRange, DateDimension } from '../../domain/calendar'
import { compareTabCards } from '../../domain/calendar-tabs'
import type { TabSortKey, TabSortMode } from '../../domain/calendar-tabs'
import { groupByTypeAndStatus, parseEstimate } from '../../domain/timeline'
import { renderCalendar } from '../../ui/calendar/calendar-renderer'
import type { CalendarEntry, PanelTypeGroupModel } from '../../ui/calendar/calendar-renderer'
import type { CalendarDropTarget } from '../../ui/calendar/calendar-dnd'
import {
    deleteProperty,
    getFrontmatterValue,
    setProperty
} from '../../services/frontmatter.service'
import { formatDate } from '../../utils/momentjs'
import type { KanbanCard } from '../../ui/board/types'

/**
 * The durable calendar UI state persisted per-view across reloads (issue #19).
 * Transient bits (anchor date, focused day) are deliberately excluded — they
 * reset to today/none on reload.
 */
export interface CalendarViewState {
    range: CalendarRange | null
    tab: DateDimension
    panelCollapsed: boolean
    showScheduled: boolean
    showDeadlines: boolean
}

/**
 * What {@link CalendarController} needs from the host view: the board host
 * element, the resolved date/sort config, and the actions it triggers — all
 * as closures so the controller never reaches into view privates.
 */
export interface CalendarHost {
    readonly app: App
    boardEl(): HTMLElement | null
    /** Re-resolve + re-render (the controller mutates its own state, then asks for a render). */
    rebuild(): void
    /** Whether the view is currently in calendar mode (guards auto-collapse). */
    isCalendarMode(): boolean
    openCard(card: KanbanCard, newTab: boolean): void
    showCardMenu(card: KanbanCard, event: MouseEvent): void
    cardForKey(key: string): KanbanCard | undefined
    scheduledProperty(): string
    deadlineProperty(): string
    /** Resolved estimate property (issue #86): spans render on every covered day. */
    estimateProperty(): string
    /** The card's recognized note type, or null (→ the "No type" bucket) — panel grouping. */
    noteTypeFor(card: KanbanCard): { id: string; name: string } | null
    /** The momentjs date format dates are written with. */
    dateFormat(): string
    firstDayOfWeek(): number
    /** Raw per-view `calendarRange` option (validated here against the override). */
    configuredRange(): unknown
    /** Resolved scheduling-panel sort mode + optional sort property. */
    sortMode(): TabSortMode
    /** The panel sort value for a card in `property` mode (note or computed) — issue #50. */
    sortValue(card: KanbanCard): number | string | null
    /** Read the persisted durable calendar state (defaults when unset) — issue #19. */
    restoreState(): CalendarViewState
    /** Persist the durable calendar state per-view — issue #19. */
    persistState(state: CalendarViewState): void
}

/**
 * Calendar mode (Milestone 5). Owns the in-memory per-session calendar state
 * (range override, active tab, anchor, focused day, panel collapse + the
 * legend toggles) and the calendar rendering + drag handling. Extracted from
 * the view to keep that file focused; the view delegates the calendar render,
 * the calendar drop, and the panel auto-collapse to it.
 */
export class CalendarController {
    private rangeOverride: CalendarRange | null = null
    private tab: DateDimension = 'scheduled'
    private anchor: Date | null = null
    private panelCollapsed = false
    private focusedDay: string | null = null
    // Legend toggles: show planned work and/or deadlines on the grid (both on).
    private showScheduled = true
    private showDeadlines = true
    // Auto-collapse the scheduling pane when the container is too narrow.
    private panelAutoCollapsed = false
    private panelLastNarrow: boolean | null = null
    /**
     * Panel group collapse, keyed `typeId` / `typeId::status`. Lives on the
     * controller instance so expanding a group survives the rebuild every
     * frontmatter write / tab switch triggers — default collapsed (mirrors the
     * timeline's Unplanned panel).
     */
    private readonly panelCollapsedGroups = new Map<string, boolean>()
    // Durable state is loaded from config lazily (config is unavailable at
    // construction; the view reads it on first render) — issue #19.
    private loaded = false

    constructor(private readonly host: CalendarHost) {}

    /**
     * Load the persisted durable state once. Config is not available when the
     * controller is constructed, so this defers to the first render/evaluate —
     * mirroring the view's lazy `loadFilterQuery`.
     */
    private ensureLoaded(): void {
        if (this.loaded) return
        this.loaded = true
        const state = this.host.restoreState()
        this.rangeOverride = state.range
        this.tab = state.tab
        this.panelCollapsed = state.panelCollapsed
        this.showScheduled = state.showScheduled
        this.showDeadlines = state.showDeadlines
    }

    /** Persist the durable bits (called after any change to one of them). */
    private persist(): void {
        this.host.persistState({
            range: this.rangeOverride,
            tab: this.tab,
            panelCollapsed: this.panelCollapsed,
            showScheduled: this.showScheduled,
            showDeadlines: this.showDeadlines
        })
    }

    /** Reset the narrow-width memo so the next evaluation re-decides from scratch. */
    resetNarrow(): void {
        this.panelLastNarrow = null
    }

    /**
     * Collapse the scheduling pane automatically when the calendar container is
     * too narrow to show it comfortably, and restore it when there's room again
     * — but only on a width-category change, so a manual toggle is never fought.
     */
    evaluatePanelAutoCollapse(): void {
        const boardEl = this.host.boardEl()
        if (!boardEl || !this.host.isCalendarMode()) {
            this.panelLastNarrow = null
            return
        }
        this.ensureLoaded()
        const width = boardEl.clientWidth
        if (width === 0) return
        const root = boardEl.ownerDocument.documentElement
        const remPx = parseFloat(getComputedStyle(root).fontSize) || 16
        const narrow = width < 36 * remPx
        if (narrow === this.panelLastNarrow) return
        this.panelLastNarrow = narrow
        if (narrow && !this.panelCollapsed) {
            this.panelCollapsed = true
            this.panelAutoCollapsed = true
            this.persist()
            this.host.rebuild()
        } else if (!narrow && this.panelAutoCollapsed) {
            this.panelCollapsed = false
            this.panelAutoCollapsed = false
            this.persist()
            this.host.rebuild()
        }
    }

    private effectiveRange(): CalendarRange {
        if (this.rangeOverride) return this.rangeOverride
        const configured = this.host.configuredRange()
        return configured === 'week' ||
            configured === 'month' ||
            configured === 'quarter' ||
            configured === 'year'
            ? configured
            : 'month'
    }

    private effectiveAnchor(): Date {
        return this.anchor ?? startOfDay(new Date())
    }

    /** Compute the calendar/scheduling model and render it into the board host. */
    render(cards: KanbanCard[]): void {
        const boardEl = this.host.boardEl()
        if (!boardEl) return
        this.ensureLoaded()
        const range = this.effectiveRange()
        const anchor = this.effectiveAnchor()
        const today = startOfDay(new Date())
        const dimension = this.tab
        const scheduledProperty = this.host.scheduledProperty()
        const deadlineProperty = this.host.deadlineProperty()

        const dateFor = (card: KanbanCard, dim: DateDimension): Date | null => {
            const prop = dim === 'scheduled' ? scheduledProperty : deadlineProperty
            return parseFrontmatterDate(getFrontmatterValue(this.host.app, card.file, prop))
        }

        const unplanned = cards.filter((c) => dateFor(c, 'scheduled') === null)
        const noDeadline = cards.filter((c) => dateFor(c, 'deadline') === null)
        const panelCards = this.sortFilterPanel(dimension === 'scheduled' ? unplanned : noDeadline)
        // Group the backlog by note type → status (issue: panel parity with the
        // timeline). Type headers only on multi-type boards; sorted cards keep
        // their order inside each status subgroup.
        const distinctTypes = new Set(panelCards.map((c) => this.host.noteTypeFor(c)?.id ?? '∅'))
        const panelGrouped = distinctTypes.size > 1
        const panelGroups = this.buildPanelGroups(panelCards)

        // Unified overlay: every card is placed on BOTH its scheduled day (blue)
        // and its deadline (orange); same-day collapses to one "both" chip.
        const cardsByDay = new Map<string, CalendarEntry[]>()
        const place = (key: string, entry: CalendarEntry): void => {
            const arr = cardsByDay.get(key)
            if (arr) arr.push(entry)
            else cardsByDay.set(key, [entry])
        }
        const estimateProperty = this.host.estimateProperty()
        for (const card of cards) {
            const sched = this.showScheduled ? dateFor(card, 'scheduled') : null
            const due = this.showDeadlines ? dateFor(card, 'deadline') : null
            if (sched && due && toDateKey(sched) === toDateKey(due)) {
                place(toDateKey(sched), { card, kind: 'both', overdue: due < today })
            } else {
                if (sched) place(toDateKey(sched), { card, kind: 'scheduled', overdue: false })
                if (due) place(toDateKey(due), { card, kind: 'deadline', overdue: due < today })
            }
            // Multi-day span (issue #86): a scheduled card with an estimate
            // continues across every covered day — dimmed continuation chips
            // on offsets 1…estimate−1 (the start day already has its chip).
            if (!sched) continue
            const estimate = parseEstimate(
                getFrontmatterValue(this.host.app, card.file, estimateProperty)
            )
            if (estimate === null) continue
            for (let offset = 1; offset < estimate; offset++) {
                place(toDateKey(addDays(sched, offset)), {
                    card,
                    kind: 'span',
                    overdue: false,
                    spanLabel: `day ${String(offset + 1)} of ${String(estimate)}`
                })
            }
        }
        const firstDay = this.host.firstDayOfWeek()

        renderCalendar(
            boardEl,
            {
                range,
                activeTab: dimension,
                anchorLabel: this.anchorLabel(anchor, range),
                blocks: buildCalendar(anchor, range, today, firstDay),
                panelGroups,
                panelGrouped,
                cardsByDay,
                panelCollapsed: this.panelCollapsed,
                counts: { unplanned: unplanned.length, noDeadline: noDeadline.length },
                showScheduled: this.showScheduled,
                showDeadlines: this.showDeadlines,
                weekdays: weekdayLabels(firstDay),
                focusedDay: this.focusedDay,
                focusedDayLabel: this.focusedDayLabel()
            },
            {
                onOpen: (card, newTab) => this.host.openCard(card, newTab),
                onContextMenu: (card, event) => this.host.showCardMenu(card, event),
                onSwitchTab: (dim) => {
                    this.tab = dim
                    this.persist()
                    this.host.rebuild()
                },
                onToggleDimension: (dim) => {
                    if (dim === 'scheduled') this.showScheduled = !this.showScheduled
                    else this.showDeadlines = !this.showDeadlines
                    this.persist()
                    this.host.rebuild()
                },
                onSetRange: (r) => {
                    this.rangeOverride = r
                    this.focusedDay = null // leaving the focused day on a range change
                    this.persist()
                    this.host.rebuild()
                },
                onShiftAnchor: (direction) => {
                    this.anchor = shiftAnchor(this.effectiveAnchor(), range, direction)
                    this.host.rebuild()
                },
                onToday: () => {
                    this.anchor = null
                    this.host.rebuild()
                },
                onTogglePanel: () => {
                    this.panelCollapsed = !this.panelCollapsed
                    this.panelAutoCollapsed = false
                    this.persist()
                    this.host.rebuild()
                },
                onTogglePanelGroup: (key) => {
                    this.panelCollapsedGroups.set(
                        key,
                        !(this.panelCollapsedGroups.get(key) ?? true)
                    )
                    this.host.rebuild()
                },
                onFocusDay: (dayKey) => {
                    this.focusedDay = dayKey
                    this.host.rebuild()
                },
                onClearFocus: () => {
                    this.focusedDay = null
                    this.host.rebuild()
                },
                onFocusShift: (direction) => {
                    const current = parseFrontmatterDate(this.focusedDay)
                    if (current) this.focusedDay = toDateKey(addDays(current, direction))
                    this.host.rebuild()
                },
                onFocusToday: () => {
                    this.focusedDay = toDateKey(startOfDay(new Date()))
                    this.host.rebuild()
                }
            }
        )
    }

    /** Long label for the focused day (empty when no day is focused). */
    private focusedDayLabel(): string {
        const date = parseFrontmatterDate(this.focusedDay)
        return date ? formatLongDate(date) : ''
    }

    /**
     * The (already sorted) backlog as type → status groups with resolved
     * collapse flags — all collapsed by default; the collapse map lives on
     * this controller so expanding a group survives the rebuild each
     * frontmatter write / tab switch triggers (mirrors the timeline).
     */
    private buildPanelGroups(cards: KanbanCard[]): PanelTypeGroupModel[] {
        return groupByTypeAndStatus(
            cards,
            (card) => this.host.noteTypeFor(card),
            (card) => card.statusValue
        ).map((typeGroup) => ({
            key: typeGroup.typeId,
            label: typeGroup.typeName,
            count: typeGroup.groups.reduce((sum, g) => sum + g.items.length, 0),
            collapsed: this.panelCollapsedGroups.get(typeGroup.typeId) ?? true,
            groups: typeGroup.groups.map((statusGroup) => {
                const key = `${typeGroup.typeId}::${statusGroup.status}`
                return {
                    key,
                    label: statusGroup.label,
                    collapsed: this.panelCollapsedGroups.get(key) ?? true,
                    cards: statusGroup.items,
                    typeId: typeGroup.typeId,
                    status: statusGroup.status
                }
            })
        }))
    }

    /** Sort the scheduling-panel cards (the toolbar filter already narrowed them). */
    private sortFilterPanel(cards: KanbanCard[]): KanbanCard[] {
        const mode = this.host.sortMode()
        const byProperty = mode === 'property'
        return cards
            .map((card) => ({ card, key: this.tabSortKey(card, byProperty) }))
            .sort((a, b) => compareTabCards(a.key, b.key, mode))
            .map((e) => e.card)
    }

    private tabSortKey(card: KanbanCard, byProperty: boolean): TabSortKey {
        const tags = this.cardTags(card.file)
        const sortValue = byProperty ? this.host.sortValue(card) : null
        return {
            title: card.display.title,
            order: card.order,
            sortValue,
            searchText: `${card.display.title} ${tags.join(' ')}`.toLowerCase()
        }
    }

    private cardTags(file: KanbanCard['file']): string[] {
        const cache = this.host.app.metadataCache.getFileCache(file)
        return cache ? (getAllTags(cache) ?? []) : []
    }

    /** The frontmatter date properties a drag of `dimension` writes/clears. */
    private propertiesForDimension(dimension: string): string[] {
        if (dimension === 'deadline') return [this.host.deadlineProperty()]
        if (dimension === 'both')
            return [this.host.scheduledProperty(), this.host.deadlineProperty()]
        return [this.host.scheduledProperty()]
    }

    /**
     * Handle a calendar drag drop: dropping on a day writes the active
     * dimension's date (formatted with the note type's momentjs format); dropping
     * back on the panel clears it. The frontmatter write triggers a rebuild.
     */
    async handleDrop(
        cardKey: string,
        target: CalendarDropTarget,
        dimension: string
    ): Promise<void> {
        const card = this.host.cardForKey(cardKey)
        if (!card) return
        const properties = this.propertiesForDimension(dimension)

        if (target.kind === 'panel') {
            for (const property of properties)
                await deleteProperty(this.host.app, card.file, property)
            return
        }
        // Pane-group drops (set status) are committed by the host view.
        if (target.kind === 'paneGroup') return

        const date = parseFrontmatterDate(target.dayKey)
        if (!date) return
        const value = formatDate(date, this.host.dateFormat())
        for (const property of properties)
            await setProperty(this.host.app, card.file, property, value)
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
}
