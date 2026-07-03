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
    axisTicks,
    barGeometry,
    clampResizeDate,
    dayOffsetAtPct,
    daysBetween,
    groupByStatus,
    inclusiveDays,
    parseMilestones,
    pointPct,
    totalDays,
    zoomRange
} from '../../domain/timeline'
import type { TimelineRange } from '../../domain/timeline'
import {
    appendToListProperty,
    deleteProperty,
    getFrontmatterValue,
    removeFromListProperty,
    setProperty
} from '../../services/frontmatter.service'
import { renderTimeline } from '../../ui/timeline/timeline-renderer'
import type { TimelineRowModel } from '../../ui/timeline/timeline-renderer'
import { MilestoneModal } from '../../ui/timeline/milestone-modal'
import { DatePromptModal } from '../../ui/date-prompt-modal'
import { formatDate } from '../../utils/momentjs'
import type { KanbanCard } from '../../ui/board/types'

/** Durable timeline UI state persisted per-view (the anchor stays transient). */
export interface TimelineViewState {
    range: CalendarRange | null
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
    openCard(card: KanbanCard, newTab: boolean): void
    showCardMenu(card: KanbanCard, event: MouseEvent, extend?: (menu: Menu) => void): void
    /** Resolved start/end date + milestone list property names. */
    startProperty(): string
    endProperty(): string
    milestoneProperty(): string
    /**
     * Resolved scheduled/deadline properties (issue #80): when a timeline
     * start/end property IS one of these, the menu's own "Set start/end
     * date…" item is skipped — the standard schedule/deadline items already
     * write exactly that property.
     */
    scheduledProperty(): string
    deadlineProperty(): string
    /** The momentjs format dates are written with. */
    dateFormat(): string
    firstDayOfWeek(): number
    /** Raw per-view `timelineRange` option (validated against the override). */
    configuredRange(): unknown
    restoreState(): TimelineViewState
    persistState(state: TimelineViewState): void
}

/**
 * Timeline mode (issue #77): owns the in-memory timeline state (range override,
 * anchor, undated-strip expansion), builds the row models from frontmatter, and
 * writes date shifts back on drag. Rendering is delegated to
 * `ui/timeline/timeline-renderer.ts`; geometry math is pure in
 * `domain/timeline.ts`.
 */
export class TimelineController {
    private rangeOverride: CalendarRange | null = null
    private anchor: Date | null = null
    private undatedExpanded = false
    // Durable state loads lazily: config is unavailable at construction.
    private loaded = false

    constructor(private readonly host: TimelineHost) {}

    private ensureLoaded(): void {
        if (this.loaded) return
        this.loaded = true
        this.rangeOverride = this.host.restoreState().range
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
        const endProperty = this.host.endProperty()
        const milestoneProperty = this.host.milestoneProperty()

        const rows: Array<{ row: TimelineRowModel; sortDate: Date | null }> = []
        const undated: KanbanCard[] = []
        for (const card of cards) {
            const start = this.readDate(card, startProperty)
            const end = this.readDate(card, endProperty)
            const milestones = parseMilestones(
                getFrontmatterValue(this.host.app, card.file, milestoneProperty)
            )
            if (!start && !end && milestones.length === 0) {
                undated.push(card)
                continue
            }
            rows.push({
                row: this.buildRow(card, start, end, milestones, window, today),
                sortDate: start ?? end ?? milestones[0]?.date ?? null
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
                rows: rows.map((r) => r.row),
                undatedGroups: groupByStatus(undated, (c) => c.statusValue),
                undatedExpanded: this.undatedExpanded,
                totalDays: totalDays(window)
            },
            {
                onOpen: (card, newTab) => this.host.openCard(card, newTab),
                onContextMenu: (card, event) =>
                    this.host.showCardMenu(card, event, (menu) => this.extendCardMenu(menu, card)),
                onSetRange: (range) => {
                    this.rangeOverride = range
                    this.host.persistState({ range })
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
                onToggleUndated: () => {
                    this.undatedExpanded = !this.undatedExpanded
                    this.host.rebuild()
                },
                onShiftDates: (card, dayDelta) => void this.shiftDates(card, dayDelta),
                onResizeDates: (card, edge, dayDelta) =>
                    void this.resizeDates(card, edge, dayDelta),
                onUnschedule: (card) => void this.unschedule(card),
                onZoom: (direction, anchorPct) => this.zoom(kind, window, direction, anchorPct),
                onScheduleAt: (card, pct) => void this.scheduleAt(card, pct, window),
                onAddMilestone: (card, pct) => this.promptMilestone(card, pct, window),
                onRemoveMilestone: (card, raw) =>
                    void removeFromListProperty(
                        this.host.app,
                        card.file,
                        this.host.milestoneProperty(),
                        raw
                    )
            }
        )
    }

    /** Undated chip dropped on the timeline: write the start date for that day. */
    private async scheduleAt(card: KanbanCard, pct: number, window: TimelineRange): Promise<void> {
        const date = addDays(window.start, dayOffsetAtPct(pct, window))
        await setProperty(
            this.host.app,
            card.file,
            this.host.startProperty(),
            formatDate(date, this.host.dateFormat())
        )
    }

    /** Track double-click: prompt for a label, then append `<date> <label>`. */
    private promptMilestone(card: KanbanCard, pct: number, window: TimelineRange): void {
        this.openMilestoneModal(card, addDays(window.start, dayOffsetAtPct(pct, window)))
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

    /**
     * Handle-drag commit (issue #80): move only the dragged edge's date,
     * clamped by the pure domain rule (span never inverts, minimum 1 day).
     * Already-inverted stored dates (end before start — hand-edited
     * frontmatter) render as the single start day; dragging the start edge of
     * such a bar also rewrites the end to that day, otherwise the pair would
     * stay inverted behind the user's back (the end edge self-heals — its
     * clamp always yields end ≥ start).
     */
    private async resizeDates(
        card: KanbanCard,
        edge: 'start' | 'end',
        dayDelta: number
    ): Promise<void> {
        const start = this.readDate(card, this.host.startProperty())
        const end = this.readDate(card, this.host.endProperty())
        if (!start || !end) return
        const format = this.host.dateFormat()
        const property = edge === 'start' ? this.host.startProperty() : this.host.endProperty()
        await setProperty(
            this.host.app,
            card.file,
            property,
            formatDate(clampResizeDate(start, end, edge, dayDelta), format)
        )
        if (edge === 'start' && daysBetween(start, end) < 0) {
            await setProperty(
                this.host.app,
                card.file,
                this.host.endProperty(),
                formatDate(start, format)
            )
        }
    }

    /**
     * Footer drop / "Clear start & end dates" (issue #80): delete whichever of
     * the start/end properties exist. Milestones are kept — the row survives
     * when it has any. By default these ARE the shared scheduled/due
     * properties, so the card also leaves the calendar and loses its due badge.
     */
    private async unschedule(card: KanbanCard): Promise<void> {
        for (const property of [this.host.startProperty(), this.host.endProperty()]) {
            if (getFrontmatterValue(this.host.app, card.file, property) === undefined) continue
            await deleteProperty(this.host.app, card.file, property)
        }
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
        this.host.persistState({ range: next })
        this.host.rebuild()
    }

    /**
     * Timeline extras appended to the standard card menu (issue #80), for rows
     * and undated chips alike. Every item sits in the `kap-timeline` section so
     * the sectioned menu groups them at the end (no manual separators).
     */
    private extendCardMenu(menu: Menu, card: KanbanCard): void {
        const reserved = [this.host.scheduledProperty(), this.host.deadlineProperty()]
        const edges: Array<{ property: string; label: string }> = [
            { property: this.host.startProperty(), label: 'start' },
            { property: this.host.endProperty(), label: 'end' }
        ]
        for (const { property, label } of edges) {
            // The standard "Schedule on a date…" / "Set deadline on a date…"
            // items already write exactly that property — skip the duplicate.
            if (reserved.includes(property)) continue
            menu.addItem((item) =>
                item
                    .setTitle(`Set ${label} date…`)
                    .setIcon('calendar')
                    .setSection('kap-timeline')
                    .onClick(() => this.promptEdgeDate(card, label, property))
            )
        }
        menu.addItem((item) =>
            item
                .setTitle('Add milestone…')
                .setIcon('diamond')
                .setSection('kap-timeline')
                .onClick(() => this.openMilestoneModal(card, startOfDay(new Date())))
        )
        const hasStart = this.readDate(card, this.host.startProperty()) !== null
        const hasEnd = this.readDate(card, this.host.endProperty()) !== null
        if (hasStart || hasEnd) {
            menu.addItem((item) =>
                item
                    .setTitle('Clear start & end dates')
                    .setIcon('x')
                    .setSection('kap-timeline')
                    .onClick(() => void this.unschedule(card))
            )
        }
    }

    /**
     * "Set start/end date…" menu item: a date prompt pre-filled with the
     * current value as `YYYY-MM-DD` (the native date input silently rejects
     * anything non-ISO). Set writes the configured format; Clear deletes.
     */
    private promptEdgeDate(card: KanbanCard, label: string, property: string): void {
        const current = this.readDate(card, property)
        new DatePromptModal(
            this.host.app,
            `Set ${label} date — ${card.display.title}`,
            current ? toDateKey(current) : '',
            (isoDate) => void this.writeEdgeDate(card, property, isoDate)
        ).open()
    }

    private async writeEdgeDate(
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

    /** One row's geometry: bar (both dates), point dots (one date), milestones. */
    private buildRow(
        card: KanbanCard,
        start: Date | null,
        end: Date | null,
        milestones: ReturnType<typeof parseMilestones>,
        window: TimelineRange,
        today: Date
    ): TimelineRowModel {
        const bar = start && end ? barGeometry(start, end, window) : null
        const points: TimelineRowModel['points'] = []
        if (start && !end) {
            const pct = pointPct(start, window)
            if (pct !== null) points.push({ pct, kind: 'start' })
        }
        if (end && !start) {
            const pct = pointPct(end, window)
            if (pct !== null) points.push({ pct, kind: 'end' })
        }
        const visibleMilestones = milestones.flatMap((m) => {
            const pct = pointPct(m.date, window)
            if (pct === null) return []
            const label = m.label ? `${m.label} — ` : ''
            return [{ pct, tooltip: `◆ ${label}${toDateKey(m.date)}`, raw: m.raw }]
        })

        // Dates exist but nothing landed in the window: which side is it on?
        let offSide: TimelineRowModel['offSide'] = null
        if (!bar && points.length === 0 && visibleMilestones.length === 0) {
            const anyDate = start ?? end ?? milestones[0]?.date ?? null
            if (anyDate) offSide = anyDate < window.start ? 'before' : 'after'
        }

        // Duration (issue #80): inclusive day count, both dates only. The
        // tooltip always carries it — narrow bars skip the on-bar tag.
        const durationDays = start && end ? inclusiveDays(start, end) : null
        let span = [
            start ? toDateKey(start) : null,
            end ? toDateKey(end) : milestones.length > 0 ? `${String(milestones.length)} ◆` : null
        ]
            .filter(Boolean)
            .join(' → ')
        if (durationDays !== null) {
            span = `${span} — ${String(durationDays)} day${durationDays === 1 ? '' : 's'}`
        }
        return {
            card,
            bar,
            points,
            milestones: visibleMilestones,
            overdue: end !== null && end < today,
            offSide,
            draggable: start !== null || end !== null,
            durationLabel: durationDays !== null ? `${String(durationDays)}d` : null,
            tooltip: span ? `${card.display.title} (${span})` : card.display.title
        }
    }

    private readDate(card: KanbanCard, property: string): Date | null {
        return parseFrontmatterDate(getFrontmatterValue(this.host.app, card.file, property))
    }

    /**
     * Drag commit: shift whichever of the start/end dates exist by `dayDelta`
     * whole days (both move together, so the span's duration is preserved).
     * The frontmatter write triggers the usual metadata-cache rebuild.
     */
    private async shiftDates(card: KanbanCard, dayDelta: number): Promise<void> {
        const format = this.host.dateFormat()
        for (const property of [this.host.startProperty(), this.host.endProperty()]) {
            const current = this.readDate(card, property)
            if (!current) continue
            await setProperty(
                this.host.app,
                card.file,
                property,
                formatDate(addDays(current, dayDelta), format)
            )
        }
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
