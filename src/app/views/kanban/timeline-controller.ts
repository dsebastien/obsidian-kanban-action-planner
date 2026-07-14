import type { App, Menu } from 'obsidian'
import {
    addDays,
    buildCalendar,
    parseFrontmatterDate,
    periodRange,
    shiftAnchor,
    startOfDay,
    toDateKey
} from '../../domain/calendar'
import type { CalendarRange } from '../../domain/calendar'
import {
    NO_TYPE_ID,
    axisTicks,
    barGeometry,
    dayOffsetAtPct,
    daysBetween,
    derivedEnd,
    groupByTypeAndStatus,
    parseEstimate,
    parseMilestoneEntry,
    parseMilestones,
    pointPct,
    resizeEstimate,
    resizeFromStart,
    totalDays,
    zoomRange
} from '../../domain/timeline'
import type { TimelineRange } from '../../domain/timeline'
import {
    appendToListProperty,
    deleteProperty,
    getFrontmatterValue,
    removeFromListProperty,
    replaceInListProperty,
    setProperties,
    setProperty
} from '../../services/frontmatter.service'
import { renderTimeline } from '../../ui/timeline/timeline-renderer'
import type {
    TimelineRowModel,
    TimelineTypeGroupModel,
    TimelineTypeVisibilityModel,
    TimelineUndatedTypeGroupModel
} from '../../ui/timeline/timeline-renderer'
import { MilestoneModal } from '../../ui/timeline/milestone-modal'
import { EstimatePromptModal } from '../../ui/timeline/estimate-modal'
import { DatePromptModal } from '../../ui/date-prompt-modal'
import { formatDate } from '../../utils/momentjs'
import type { KanbanCard } from '../../ui/board/types'

/** Durable timeline UI state persisted per-view (the anchor stays transient). */
export interface TimelineViewState {
    range: CalendarRange | null
    /** Whether the left undated panel is collapsed to its slim rail. */
    panelCollapsed: boolean
}

/**
 * What {@link TimelineController} needs from the host view — closures only, so
 * the controller never reaches into view privates (same shape as
 * `CalendarController`).
 */
export interface TimelineHost {
    readonly app: App
    boardEl(): HTMLElement | null
    /** Re-render after a controller state change. */
    rebuild(): void
    /** Whether the view is currently in timeline mode (guards auto-collapse). */
    isTimelineMode(): boolean
    openCard(card: KanbanCard, newTab: boolean): void
    showCardMenu(card: KanbanCard, event: MouseEvent, extend?: (menu: Menu) => void): void
    /** Resolved start date + estimate (days) + milestone list property names. */
    startProperty(): string
    estimateProperty(): string
    milestoneProperty(): string
    /**
     * Resolved scheduled property (issue #80): when the timeline start
     * property IS this one, the menu's own "Set start date…" item is skipped —
     * the standard schedule items already write exactly that property.
     */
    scheduledProperty(): string
    /** Resolved due-date property (issue #85): the row's red deadline line. */
    deadlineProperty(): string
    /** The momentjs format dates are written with. */
    dateFormat(): string
    firstDayOfWeek(): number
    /** The card's recognized note type, or null (→ the "No type" bucket). */
    noteTypeFor(card: KanbanCard): { id: string; name: string } | null
    /** Raw per-view `timelineRange` option (validated against the override). */
    configuredRange(): unknown
    restoreState(): TimelineViewState
    persistState(state: TimelineViewState): void
    /**
     * Hidden note-type IDs, persisted under their own config key
     * (`timelineHiddenTypes`) so `persistState({ range })` call sites can
     * never clobber the list. IDs are rename-proof; the read is validated as
     * a string[].
     */
    restoreHiddenTypes(): string[]
    persistHiddenTypes(ids: string[]): void
    /** Pane-group DnD (drag between status groups): live validity + commit. */
    canDropOnPaneGroup(cardKey: string, typeId: string, status: string): boolean
    dropOnPaneGroup(cardKey: string, typeId: string, status: string): void
}

/**
 * Timeline mode (issue #77, estimate rework): owns the in-memory timeline
 * state (range override, anchor, undated-panel collapse, group collapse
 * maps, hidden types), builds the row models from frontmatter (start date +
 * estimate in days; derived end = start + estimate − 1), and writes date/
 * estimate changes back on drag. Rendering is delegated to
 * `ui/timeline/timeline-renderer.ts`; geometry math is pure in
 * `domain/timeline.ts`.
 */
export class TimelineController {
    private rangeOverride: CalendarRange | null = null
    private anchor: Date | null = null
    private panelCollapsed = false
    // Auto-collapse the undated panel when the container is too narrow
    // (mirrors CalendarController's scheduling-panel auto-collapse).
    private panelAutoCollapsed = false
    private panelLastNarrow: boolean | null = null
    /**
     * Undated group collapse, keyed `typeId` / `typeId::status`. Lives on the
     * controller instance (NOT the renderer) so it survives the rebuild every
     * frontmatter write triggers — default collapsed.
     */
    private readonly undatedCollapsed = new Map<string, boolean>()
    /** Row type-group collapse, keyed by type id — default expanded. */
    private readonly typeGroupsCollapsed = new Map<string, boolean>()
    /** Hidden note-type ids (persisted per view via the host). */
    private hiddenTypes = new Set<string>()
    // Durable state loads lazily: config is unavailable at construction.
    private loaded = false

    constructor(private readonly host: TimelineHost) {}

    private ensureLoaded(): void {
        if (this.loaded) return
        this.loaded = true
        const state = this.host.restoreState()
        this.rangeOverride = state.range
        this.panelCollapsed = state.panelCollapsed
        this.hiddenTypes = new Set(this.host.restoreHiddenTypes())
    }

    /**
     * Persist the durable bits — ALWAYS the full state from the instance
     * fields (mirrors `CalendarController.persist()`), so no call site can
     * clobber another field's key with a partial object.
     */
    private persist(): void {
        this.host.persistState({
            range: this.rangeOverride,
            panelCollapsed: this.panelCollapsed
        })
    }

    /** Reset the narrow-width memo so the next evaluation re-decides from scratch. */
    resetNarrow(): void {
        this.panelLastNarrow = null
    }

    /**
     * Collapse the undated panel automatically when the timeline container is
     * too narrow to show it comfortably, and restore it when there's room again
     * — but only on a width-category change, so a manual toggle is never fought.
     */
    evaluatePanelAutoCollapse(): void {
        const boardEl = this.host.boardEl()
        if (!boardEl || !this.host.isTimelineMode()) {
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
            : 'quarter'
    }

    /** A card's type for grouping/visibility: unrecognized → the No type bucket. */
    private typeFor(card: KanbanCard): { id: string; name: string } {
        return this.host.noteTypeFor(card) ?? { id: NO_TYPE_ID, name: 'No type' }
    }

    /** Build the view model from the (already filtered) cards and render it. */
    render(cards: KanbanCard[]): void {
        const boardEl = this.host.boardEl()
        if (!boardEl) return
        this.ensureLoaded()
        const kind = this.effectiveRange()
        const anchor = this.anchor ?? startOfDay(new Date())
        const today = startOfDay(new Date())
        const firstDay = this.host.firstDayOfWeek()
        const window = periodRange(kind, anchor, firstDay)

        const startProperty = this.host.startProperty()
        const estimateProperty = this.host.estimateProperty()
        const milestoneProperty = this.host.milestoneProperty()

        // The PRE-hiding type set: the Types menu and the grouping decision
        // both derive from it, so hiding every type never removes the button
        // and single-type boards never grow redundant headers.
        const typeNames = new Map<string, string>()
        for (const card of cards) {
            const type = this.typeFor(card)
            if (!typeNames.has(type.id)) typeNames.set(type.id, type.name)
        }
        const grouped = typeNames.size > 1
        const types: TimelineTypeVisibilityModel[] = [...typeNames.entries()]
            .map(([id, name]) => ({ id, name, hidden: this.hiddenTypes.has(id) }))
            .sort((a, b) => this.compareTypes(a.id, a.name, b.id, b.name))

        const rows: Array<{
            row: TimelineRowModel
            sortDate: Date | null
            type: { id: string; name: string }
        }> = []
        const undated: KanbanCard[] = []
        for (const card of cards) {
            const type = this.typeFor(card)
            // Hiding a type removes its rows AND its undated cards.
            if (this.hiddenTypes.has(type.id)) continue
            const start = this.readDate(card, startProperty)
            const estimate = parseEstimate(
                getFrontmatterValue(this.host.app, card.file, estimateProperty)
            )
            const milestones = parseMilestones(
                getFrontmatterValue(this.host.app, card.file, milestoneProperty)
            )
            // No start = undated, even with an estimate (effort without a
            // date) — legacy end-only cards land here too. Milestone-only
            // cards keep their row.
            if (!start && milestones.length === 0) {
                undated.push(card)
                continue
            }
            rows.push({
                row: this.buildRow(card, start, estimate, milestones, window, today),
                sortDate: start ?? milestones[0]?.date ?? null,
                type
            })
        }
        rows.sort((a, b) => {
            const at = a.sortDate?.getTime() ?? Number.MAX_SAFE_INTEGER
            const bt = b.sortDate?.getTime() ?? Number.MAX_SAFE_INTEGER
            if (at !== bt) return at - bt
            return a.row.card.display.title.localeCompare(b.row.card.display.title)
        })

        renderTimeline(
            boardEl,
            {
                range: kind,
                anchorLabel: this.anchorLabel(anchor, kind),
                ticks: axisTicks(window, kind, firstDay),
                todayPct: pointPct(today, window),
                groups: this.groupRows(rows, grouped),
                grouped,
                undatedGroups: this.buildUndatedGroups(undated),
                panelCollapsed: this.panelCollapsed,
                types,
                totalDays: totalDays(window)
            },
            {
                onOpen: (card, newTab) => this.host.openCard(card, newTab),
                onContextMenu: (card, event) =>
                    this.host.showCardMenu(card, event, (menu) => this.extendCardMenu(menu, card)),
                onSetRange: (range) => {
                    this.rangeOverride = range
                    this.persist()
                    this.host.rebuild()
                },
                onShiftAnchor: (direction) => {
                    this.anchor = shiftAnchor(
                        this.anchor ?? startOfDay(new Date()),
                        kind,
                        direction
                    )
                    this.host.rebuild()
                },
                onToday: () => {
                    this.anchor = null
                    this.host.rebuild()
                },
                onTogglePanel: () => {
                    this.panelCollapsed = !this.panelCollapsed
                    // A manual toggle wins over any earlier auto-collapse.
                    this.panelAutoCollapsed = false
                    this.persist()
                    this.host.rebuild()
                },
                // Works for ANY signed offset — clipped bars carry a negative
                // startDayOffset and drags may leave the window entirely.
                labelForDayOffset: (offset) => toDateKey(addDays(window.start, offset)),
                onMove: (card, dayDelta) => void this.moveStart(card, dayDelta),
                onResizeEdge: (card, edge, dayDelta) => void this.resizeEdge(card, edge, dayDelta),
                onUnschedule: (card) => void this.unschedule(card),
                onZoom: (direction, anchorPct) => this.zoom(kind, window, direction, anchorPct),
                onScheduleAt: (card, pct) => void this.scheduleAt(card, pct, window),
                canPaneGroupDrop: (card, typeId, status) =>
                    this.host.canDropOnPaneGroup(card.key, typeId, status),
                onPaneGroupDrop: (card, typeId, status) =>
                    this.host.dropOnPaneGroup(card.key, typeId, status),
                onAddMilestone: (card, pct) => this.promptMilestone(card, pct, window),
                onRemoveMilestone: (card, raw) =>
                    void removeFromListProperty(
                        this.host.app,
                        card.file,
                        this.host.milestoneProperty(),
                        raw
                    ),
                onMoveMilestone: (card, raw, dayDelta) =>
                    void this.moveMilestone(card, raw, dayDelta),
                onToggleUndatedGroup: (key) => {
                    this.undatedCollapsed.set(key, !(this.undatedCollapsed.get(key) ?? true))
                    this.host.rebuild()
                },
                onToggleTypeGroup: (typeId) => {
                    this.typeGroupsCollapsed.set(
                        typeId,
                        !(this.typeGroupsCollapsed.get(typeId) ?? false)
                    )
                    this.host.rebuild()
                },
                onToggleTypeHidden: (typeId) => {
                    if (this.hiddenTypes.has(typeId)) this.hiddenTypes.delete(typeId)
                    else this.hiddenTypes.add(typeId)
                    this.host.persistHiddenTypes([...this.hiddenTypes])
                    this.host.rebuild()
                }
            }
        )
    }

    /** Types alphabetical, the No type bucket always last. */
    private compareTypes(aId: string, aName: string, bId: string, bName: string): number {
        if (aId === NO_TYPE_ID) return 1
        if (bId === NO_TYPE_ID) return -1
        return aName.localeCompare(bName)
    }

    /**
     * Partition the (already date-sorted) rows into per-type groups (types
     * alphabetical, No type last, collapse from the controller-instance map).
     * Single-type boards keep one header-less group — the renderer skips the
     * header when `grouped` is false.
     */
    private groupRows(
        rows: Array<{ row: TimelineRowModel; type: { id: string; name: string } }>,
        grouped: boolean
    ): TimelineTypeGroupModel[] {
        if (!grouped) {
            return [
                {
                    typeId: '',
                    name: '',
                    count: rows.length,
                    collapsed: false,
                    rows: rows.map((r) => r.row)
                }
            ]
        }
        const byType = new Map<string, TimelineTypeGroupModel>()
        for (const { row, type } of rows) {
            let group = byType.get(type.id)
            if (!group) {
                group = {
                    typeId: type.id,
                    name: type.name,
                    count: 0,
                    collapsed: this.typeGroupsCollapsed.get(type.id) ?? false,
                    rows: []
                }
                byType.set(type.id, group)
            }
            group.rows.push(row)
            group.count += 1
        }
        return [...byType.values()].sort((a, b) =>
            this.compareTypes(a.typeId, a.name, b.typeId, b.name)
        )
    }

    /**
     * Undated cards as type → status groups with resolved collapse flags —
     * all collapsed by default; the collapse map lives on this controller so
     * expanding a group survives the rebuild each frontmatter write triggers.
     */
    private buildUndatedGroups(undated: KanbanCard[]): TimelineUndatedTypeGroupModel[] {
        return groupByTypeAndStatus(
            undated,
            (card) => this.host.noteTypeFor(card),
            (card) => card.statusValue
        ).map((typeGroup) => ({
            key: typeGroup.typeId,
            label: typeGroup.typeName,
            count: typeGroup.groups.reduce((sum, g) => sum + g.items.length, 0),
            collapsed: this.undatedCollapsed.get(typeGroup.typeId) ?? true,
            groups: typeGroup.groups.map((statusGroup) => {
                const key = `${typeGroup.typeId}::${statusGroup.status}`
                return {
                    key,
                    label: statusGroup.label,
                    collapsed: this.undatedCollapsed.get(key) ?? true,
                    cards: statusGroup.items,
                    typeId: typeGroup.typeId,
                    status: statusGroup.status
                }
            })
        }))
    }

    /**
     * Unplanned card dropped on the timeline: write the start date for that
     * day, seeding a **1-day estimate** ONLY when the estimate property is
     * absent or empty — a fresh entry lands as a resizable one-day rectangle,
     * not a handle-less square. One transaction; any present value (even one
     * the timeline can't parse) is never touched.
     */
    private async scheduleAt(card: KanbanCard, pct: number, window: TimelineRange): Promise<void> {
        const date = addDays(window.start, dayOffsetAtPct(pct, window))
        const start = formatDate(date, this.host.dateFormat())
        const estimateProperty = this.host.estimateProperty()
        const raw = getFrontmatterValue(this.host.app, card.file, estimateProperty)
        if (raw !== undefined && raw !== null && raw !== '') {
            await setProperty(this.host.app, card.file, this.host.startProperty(), start)
            return
        }
        await setProperties(this.host.app, card.file, {
            [this.host.startProperty()]: start,
            [estimateProperty]: 1
        })
    }

    /** Track double-click: prompt for a label, then append `<date> <label>`. */
    private promptMilestone(card: KanbanCard, pct: number, window: TimelineRange): void {
        this.openMilestoneModal(card, addDays(window.start, dayOffsetAtPct(pct, window)))
    }

    /**
     * Diamond drag commit: shift one milestone's date by `dayDelta` whole
     * days, rewriting its list entry IN PLACE (position and label kept). A
     * raw entry that no longer parses (edited mid-gesture) is a no-op.
     */
    private async moveMilestone(card: KanbanCard, raw: string, dayDelta: number): Promise<void> {
        const parsed = parseMilestoneEntry(raw)
        if (!parsed) return
        const date = toDateKey(addDays(parsed.date, dayDelta))
        const replacement = parsed.label ? `${date} ${parsed.label}` : date
        await replaceInListProperty(
            this.host.app,
            card.file,
            this.host.milestoneProperty(),
            raw,
            replacement
        )
    }

    /** Milestone prompt pre-filled with `date` (track dblclick or menu item). */
    private openMilestoneModal(card: KanbanCard, date: Date): void {
        new MilestoneModal(this.host.app, card.display.title, toDateKey(date), (isoDate, label) => {
            const entry = label ? `${isoDate} ${label}` : isoDate
            void appendToListProperty(
                this.host.app,
                card.file,
                this.host.milestoneProperty(),
                entry
            )
        }).open()
    }

    /** Move-drag commit: shift ONLY the start date; the estimate rides along. */
    private async moveStart(card: KanbanCard, dayDelta: number): Promise<void> {
        const property = this.host.startProperty()
        const current = this.readDate(card, property)
        if (!current) return
        await setProperty(
            this.host.app,
            card.file,
            property,
            formatDate(addDays(current, dayDelta), this.host.dateFormat())
        )
    }

    /**
     * Handle-drag commit (estimate rework). Right edge: only the estimate
     * changes ({@link resizeEstimate}, never below 1), written as a NUMBER so
     * a resize can't silently retype the property to text. Left edge: the
     * derived end stays anchored — {@link resizeFromStart} clamps ONE shared
     * delta and yields the new start offset plus the new estimate, committed
     * in a single frontmatter transaction (two sequential writes would
     * double-rebuild and leave a torn intermediate state on disk).
     */
    private async resizeEdge(
        card: KanbanCard,
        edge: 'start' | 'end',
        dayDelta: number
    ): Promise<void> {
        const estimateProperty = this.host.estimateProperty()
        const estimate = parseEstimate(
            getFrontmatterValue(this.host.app, card.file, estimateProperty)
        )
        if (estimate === null) return
        if (edge === 'end') {
            await setProperty(
                this.host.app,
                card.file,
                estimateProperty,
                resizeEstimate(estimate, dayDelta)
            )
            return
        }
        const startProperty = this.host.startProperty()
        const start = this.readDate(card, startProperty)
        if (!start) return
        const resized = resizeFromStart(estimate, dayDelta)
        await setProperties(this.host.app, card.file, {
            [startProperty]: formatDate(addDays(start, resized.startDelta), this.host.dateFormat()),
            [estimateProperty]: resized.estimate
        })
    }

    /**
     * Panel drop / "Clear start date": delete ONLY the start property. The
     * estimate is intrinsic effort and is kept; milestones are kept too — the
     * row survives when it has any. By default the start IS the shared
     * scheduled property, so the card also leaves the calendar.
     */
    private async unschedule(card: KanbanCard): Promise<void> {
        const property = this.host.startProperty()
        if (getFrontmatterValue(this.host.app, card.file, property) === undefined) return
        await deleteProperty(this.host.app, card.file, property)
    }

    /**
     * Ctrl/Cmd+wheel zoom (issue #80): step one range kind, anchor on the date
     * under the cursor (a null pct keeps the current anchor), and persist like
     * the range buttons. At either end of the zoom order this is a full no-op.
     */
    private zoom(
        kind: CalendarRange,
        window: TimelineRange,
        direction: 1 | -1,
        anchorPct: number | null
    ): void {
        const next = zoomRange(kind, direction)
        if (!next) return
        if (anchorPct !== null) {
            this.anchor = addDays(window.start, dayOffsetAtPct(anchorPct, window))
        }
        this.rangeOverride = next
        this.persist()
        this.host.rebuild()
    }

    /**
     * Timeline extras appended to the standard card menu, for rows and
     * undated cards alike. Every item sits in the `kap-timeline` section so
     * the sectioned menu groups them at the end (no manual separators).
     */
    private extendCardMenu(menu: Menu, card: KanbanCard): void {
        const startProperty = this.host.startProperty()
        // The standard "Schedule on a date…" item already writes exactly the
        // scheduled property — skip the duplicate.
        if (startProperty !== this.host.scheduledProperty()) {
            menu.addItem((item) =>
                item
                    .setTitle('Set start date…')
                    .setIcon('calendar')
                    .setSection('kap-timeline')
                    .onClick(() => this.promptStartDate(card, startProperty))
            )
        }
        menu.addItem((item) =>
            item
                .setTitle('Set estimate…')
                .setIcon('ruler')
                .setSection('kap-timeline')
                .onClick(() => this.promptEstimate(card))
        )
        menu.addItem((item) =>
            item
                .setTitle('Add milestone…')
                .setIcon('diamond')
                .setSection('kap-timeline')
                .onClick(() => this.openMilestoneModal(card, startOfDay(new Date())))
        )
        if (this.readDate(card, startProperty) !== null) {
            menu.addItem((item) =>
                item
                    .setTitle('Clear start date')
                    .setIcon('x')
                    .setSection('kap-timeline')
                    .onClick(() => void this.unschedule(card))
            )
        }
    }

    /**
     * "Set start date…" menu item: a date prompt pre-filled with the current
     * value as `YYYY-MM-DD` (the native date input silently rejects anything
     * non-ISO). Set writes the configured format; Clear deletes.
     */
    private promptStartDate(card: KanbanCard, property: string): void {
        const current = this.readDate(card, property)
        new DatePromptModal(
            this.host.app,
            `Set start date — ${card.display.title}`,
            current ? toDateKey(current) : '',
            (isoDate) => void this.writeStartDate(card, property, isoDate)
        ).open()
    }

    private async writeStartDate(
        card: KanbanCard,
        property: string,
        isoDate: string | null
    ): Promise<void> {
        if (isoDate === null) {
            await deleteProperty(this.host.app, card.file, property)
            return
        }
        const date = parseFrontmatterDate(isoDate)
        if (!date) return
        await setProperty(
            this.host.app,
            card.file,
            property,
            formatDate(date, this.host.dateFormat())
        )
    }

    /**
     * "Set estimate…" menu item: a number prompt (days, min 1) pre-filled
     * with the parsed current value. Set writes a NUMBER; Clear deletes the
     * property (the card falls back to a start-only square).
     */
    private promptEstimate(card: KanbanCard): void {
        const property = this.host.estimateProperty()
        const current = parseEstimate(getFrontmatterValue(this.host.app, card.file, property))
        new EstimatePromptModal(
            this.host.app,
            `Set estimate — ${card.display.title}`,
            current,
            (days) => void this.writeEstimate(card, days)
        ).open()
    }

    private async writeEstimate(card: KanbanCard, days: number | null): Promise<void> {
        const property = this.host.estimateProperty()
        if (days === null) {
            await deleteProperty(this.host.app, card.file, property)
            return
        }
        await setProperty(this.host.app, card.file, property, days)
    }

    /**
     * One row's geometry: a rectangle spanning `start → start + estimate − 1`
     * when an estimate is set, a square on the start day otherwise, plus
     * milestone diamonds and the deadline line (issue #85: the resolved
     * due-date property as a vertical red line in the row's lane). Only
     * rectangles can be overdue (derived end in the past) — a square's past
     * start is normal in-progress work.
     */
    private buildRow(
        card: KanbanCard,
        start: Date | null,
        estimate: number | null,
        milestones: ReturnType<typeof parseMilestones>,
        window: TimelineRange,
        today: Date
    ): TimelineRowModel {
        const end = start && estimate !== null ? derivedEnd(start, estimate) : null
        const bar = start && end ? barGeometry(start, end, window) : null
        let square: TimelineRowModel['square'] = null
        if (start && estimate === null) {
            const pct = pointPct(start, window)
            if (pct !== null) square = { pct }
        }
        const visibleMilestones = milestones.flatMap((m) => {
            const pct = pointPct(m.date, window)
            if (pct === null) return []
            const label = m.label ? `${m.label} — ` : ''
            return [
                {
                    pct,
                    dayOffset: daysBetween(window.start, m.date),
                    tooltip: `◆ ${label}${toDateKey(m.date)}`,
                    raw: m.raw
                }
            ]
        })

        // Dates exist but nothing landed in the window: which side is it on?
        let offSide: TimelineRowModel['offSide'] = null
        if (!bar && !square && visibleMilestones.length === 0) {
            const anyDate = start ?? milestones[0]?.date ?? null
            if (anyDate) offSide = anyDate < window.start ? 'before' : 'after'
        }

        // The deadline line (issue #85): only when it lands in the window.
        const deadlineDate = this.readDate(card, this.host.deadlineProperty())
        const deadlinePct = deadlineDate ? pointPct(deadlineDate, window) : null
        const deadline =
            deadlineDate && deadlinePct !== null
                ? { pct: deadlinePct, label: `Due ${toDateKey(deadlineDate)}` }
                : null

        // Tooltip: the span (start → derived end), the estimate length, and
        // the deadline (kept even when its line is off-window).
        let span = [
            start ? toDateKey(start) : null,
            end ? toDateKey(end) : milestones.length > 0 ? `${String(milestones.length)} ◆` : null
        ]
            .filter(Boolean)
            .join(' → ')
        if (end !== null && estimate !== null) {
            span = `${span} — ${String(estimate)} day${estimate === 1 ? '' : 's'}`
        }
        if (deadlineDate) {
            span = span
                ? `${span} · due ${toDateKey(deadlineDate)}`
                : `due ${toDateKey(deadlineDate)}`
        }
        return {
            card,
            bar,
            square,
            milestones: visibleMilestones,
            deadline,
            overdue: end !== null && end < today,
            offSide,
            draggable: start !== null,
            startDayOffset: start ? daysBetween(window.start, start) : null,
            estimate,
            durationLabel: estimate !== null ? `${String(estimate)}d` : null,
            tooltip: span ? `${card.display.title} (${span})` : card.display.title
        }
    }

    private readDate(card: KanbanCard, property: string): Date | null {
        return parseFrontmatterDate(getFrontmatterValue(this.host.app, card.file, property))
    }

    /** Header label for the window (mirrors the calendar's anchor label). */
    private anchorLabel(anchor: Date, range: CalendarRange): string {
        const year = anchor.getFullYear()
        if (range === 'quarter') {
            return `Q${String(Math.floor(anchor.getMonth() / 3) + 1)} ${String(year)}`
        }
        if (range === 'year') return String(year)
        return buildCalendar(anchor, range, anchor)[0]?.label ?? ''
    }
}
