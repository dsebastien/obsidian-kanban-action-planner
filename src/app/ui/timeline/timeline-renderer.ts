import { Menu } from 'obsidian'
import type { CalendarRange } from '../../domain/calendar'
import { resizeEstimate, resizeFromStart } from '../../domain/timeline'
import type { AxisTick, BarGeometry } from '../../domain/timeline'
import { BAR_DURATION_TAG_MIN_PX, BAR_HANDLES_MIN_PX } from './width-gates'
import type { KanbanCard } from '../board/types'

/**
 * Timeline view DOM (issue #77, #80, estimate rework): header (nav + range
 * switch + Types visibility menu, reusing the calendar's toolbar classes),
 * then a flex row — an always-rendered collapsible LEFT "Undated" panel
 * (reusing the calendar's scheduling-panel shell classes) of full-width cards
 * grouped by note type → status that doubles as the unschedule drop target,
 * and a chart column (percentage-positioned axis + one row per card: label +
 * track with an estimate-length bar or a start-only square, milestone
 * diamonds and the today line). Bars and squares drag to move the start date
 * (whole-day snapping) or, dropped on the panel, to unschedule; bar edges
 * drag to resize (left = start + estimate, right = estimate); every drag
 * shows a floating date label + an in-track guide; Ctrl/Cmd+wheel zooms the
 * range. Geometry comes precomputed from the controller so this file is
 * DOM-only (the preview clamps mirror the pure domain rules so preview and
 * commit agree).
 */

/**
 * True while any bar/square/handle/card drag is in progress (issue #80): the
 * wheel-zoom handler must no-op then — a mid-drag rebuild would destroy the
 * dragged element while its document-level pointer listeners survive and
 * commit a wrong date against stale geometry.
 */
let dragActive = false

/** A milestone placed on a row's track. */
export interface TimelineMilestoneModel {
    pct: number
    /** Day offset from the window start (drag snapping + live labels). */
    dayOffset: number
    /** Tooltip: label + date (label may be empty). */
    tooltip: string
    /** The original frontmatter list entry — the removal/replace key. */
    raw: string
}

export interface TimelineRowModel {
    card: KanbanCard
    /** Bar geometry when start + estimate are set and the span is visible. */
    bar: BarGeometry | null
    /** Start-only marker centered on the start day's cell (no estimate). */
    square: { pct: number } | null
    milestones: TimelineMilestoneModel[]
    /**
     * The note's deadline (resolved due-date property) as a vertical red line
     * in the row's lane (issue #85); null when unset or outside the window.
     */
    deadline: { pct: number; label: string } | null
    /** Derived end (start + estimate − 1) in the past. Squares are never overdue. */
    overdue: boolean
    /** Dates exist but everything falls outside the window: which side. */
    offSide: 'before' | 'after' | null
    /** A start date is set, so dragging can shift it. */
    draggable: boolean
    /**
     * Signed, UNCLAMPED day offset of the real start from the window start
     * (negative when the bar is clipped left / the start precedes the window).
     * Null when the row has no start (milestone-only rows). Live drag labels
     * are computed from this, so they stay correct for clipped bars and
     * off-window drags.
     */
    startDayOffset: number | null
    /** Whole-day estimate SPAN (resize math + geometry), or null (square). */
    estimate: number | null
    /** Unit-aware estimate label ("12d", "1h 30m"), only when set. */
    durationLabel: string | null
    /** Tooltip for the bar/row (title + date span). */
    tooltip: string
}

/** One collapsible note-type group of timeline rows (multi-type boards). */
export interface TimelineTypeGroupModel {
    typeId: string
    name: string
    count: number
    collapsed: boolean
    rows: TimelineRowModel[]
}

/** One status subgroup of undated cards (collapse key `typeId::status`). */
export interface TimelineUndatedStatusGroupModel {
    key: string
    label: string
    collapsed: boolean
    cards: KanbanCard[]
    /** The owning note type id — pane-group drops are same-type only. */
    typeId: string
    /** The raw status value this group holds ('' = no status). */
    status: string
}

/** One note-type group of undated cards (collapse key = the type id). */
export interface TimelineUndatedTypeGroupModel {
    key: string
    label: string
    count: number
    collapsed: boolean
    groups: TimelineUndatedStatusGroupModel[]
}

/** One entry of the Types visibility menu (pre-hiding type set). */
export interface TimelineTypeVisibilityModel {
    id: string
    name: string
    hidden: boolean
}

export interface TimelineViewModel {
    range: CalendarRange
    anchorLabel: string
    ticks: AxisTick[]
    /** Today's position in % of the track, or null when outside the window. */
    todayPct: number | null
    /** Row groups by note type (a single group on single-type boards). */
    groups: TimelineTypeGroupModel[]
    /** Whether type headers render (pre-hiding distinct type count > 1). */
    grouped: boolean
    /** Undated cards grouped by note type → status (all collapsed by default). */
    undatedGroups: TimelineUndatedTypeGroupModel[]
    /** Whether the left undated panel is collapsed to its slim rail. */
    panelCollapsed: boolean
    /**
     * The Types visibility menu entries, derived from the PRE-hiding type set
     * so hiding every type never strands the user without the button.
     */
    types: TimelineTypeVisibilityModel[]
    /** Days in the visible window (drag snapping). */
    totalDays: number
}

export interface TimelineCallbacks {
    onOpen(card: KanbanCard, newTab: boolean): void
    onContextMenu(card: KanbanCard, event: MouseEvent): void
    onSetRange(range: CalendarRange): void
    onShiftAnchor(direction: number): void
    onToday(): void
    /** Collapse/expand the left undated panel. */
    onTogglePanel(): void
    /**
     * Human-readable date for the day `offset` days from the window start —
     * works for ANY signed offset (clipped bars / off-window drags), so live
     * drag labels never index past the visible window.
     */
    labelForDayOffset(offset: number): string
    /** Commit a move drag: shift the card's start date by whole days. */
    onMove(card: KanbanCard, dayDelta: number): void
    /**
     * Commit an edge resize: `start` trades the start date against the
     * estimate (derived end anchored), `end` resizes only the estimate.
     */
    onResizeEdge(card: KanbanCard, edge: 'start' | 'end', dayDelta: number): void
    /** Bar/square dropped on the undated panel: clear the start date. */
    onUnschedule(card: KanbanCard): void
    /**
     * Ctrl/Cmd+wheel zoom step: `1` = in, `-1` = out. `anchorPct` is the
     * pointer's position in % of the axis width (null when unmeasurable) so
     * the controller can keep the date under the cursor in view.
     */
    onZoom(direction: 1 | -1, anchorPct: number | null): void
    /** Undated card dropped on a track at `pct` (% of the window): set its start date. */
    onScheduleAt(card: KanbanCard, pct: number): void
    /** Live validity for a pane-group hover (same type, different status). */
    canPaneGroupDrop(card: KanbanCard, typeId: string, status: string): boolean
    /** Undated card dropped on another panel status group: set that status. */
    onPaneGroupDrop(card: KanbanCard, typeId: string, status: string): void
    /** Track double-clicked at `pct`: create a milestone there. */
    onAddMilestone(card: KanbanCard, pct: number): void
    /** Remove one milestone (the raw frontmatter list entry). */
    onRemoveMilestone(card: KanbanCard, raw: string): void
    /** Commit a diamond drag: shift one milestone's date by whole days. */
    onMoveMilestone(card: KanbanCard, raw: string, dayDelta: number): void
    /** Toggle one undated group's collapse (key: `typeId` or `typeId::status`). */
    onToggleUndatedGroup(key: string): void
    /** Toggle one row type-group's collapse. */
    onToggleTypeGroup(typeId: string): void
    /** Toggle one note type's visibility (rows + undated cards). */
    onToggleTypeHidden(typeId: string): void
}

const RANGES: Array<{ key: CalendarRange; label: string }> = [
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: 'quarter', label: 'Quarter' },
    { key: 'year', label: 'Year' }
]

export function renderTimeline(
    root: HTMLElement,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    root.empty()
    const tl = root.createDiv({ cls: 'kap-timeline' })
    renderHeader(tl, model, callbacks)

    // Below the toolbar: a flex row — the collapsible undated panel on the
    // left (calendar-panel parity) and the chart column (axis + rows) right.
    const main = tl.createDiv({ cls: 'kap-tl-main' })
    renderPanel(main, model, callbacks)
    const chart = main.createDiv({ cls: 'kap-tl-chart' })

    const axisRow = chart.createDiv({ cls: 'kap-tl-axisrow' })
    axisRow.createDiv({ cls: 'kap-tl-gutter' })
    const axis = axisRow.createDiv({ cls: 'kap-tl-axis' })
    for (const tick of model.ticks) {
        const tickEl = axis.createDiv({
            cls: tick.major ? 'kap-tl-tick kap-tl-tick-major' : 'kap-tl-tick'
        })
        tickEl.style.left = `${String(tick.pct)}%`
        if (tick.label) tickEl.createSpan({ cls: 'kap-tl-ticklabel', text: tick.label })
    }
    if (model.todayPct !== null) {
        const today = axis.createDiv({ cls: 'kap-tl-today kap-tl-today-axis' })
        today.style.left = `${String(model.todayPct)}%`
    }

    const body = chart.createDiv({ cls: 'kap-tl-body' })
    const rowCount = model.groups.reduce((sum, g) => sum + g.rows.length, 0)
    if (rowCount === 0) {
        body.createDiv({
            cls: 'kap-tl-empty',
            text: 'No cards with dates in this window. Navigate with ‹ › or drag a card in from the Unplanned panel.'
        })
    }
    // Measured once — the axis mirrors every row's track (same gutter + flex),
    // so per-row clientWidth reads (a reflow per bar) are unnecessary. 0 means
    // the view isn't laid out (hidden tab): width gates treat that as
    // unmeasurable and the resize-triggered re-render re-evaluates them.
    const trackWidth = axis.clientWidth
    for (const group of model.groups) {
        if (model.grouped) {
            const header = body.createEl('button', {
                cls: 'kap-tl-group',
                text: `${group.collapsed ? '▸' : '▾'} ${group.name} (${String(group.count)})`,
                attr: { 'type': 'button', 'aria-expanded': String(!group.collapsed) }
            })
            header.addEventListener('click', () => callbacks.onToggleTypeGroup(group.typeId))
            if (group.collapsed) continue
        }
        for (const row of group.rows) renderRow(body, row, model, trackWidth, callbacks)
    }

    // Ctrl/Cmd+wheel zoom (issue #80). The listener lives on the per-render
    // `tl` element — never on `root` (the persistent boardEl; `empty()` would
    // not remove its own listeners, so they'd stack per rebuild). deltaY is
    // accumulated so a fine-grained trackpad flick steps once per ±50, not
    // once per event; a plain wheel keeps scrolling the row body.
    let wheelAccum = 0
    tl.addEventListener(
        'wheel',
        (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return
            // Obsidian binds Ctrl+scroll to app zoom — claim the gesture fully.
            e.preventDefault()
            e.stopPropagation()
            if (dragActive) return
            wheelAccum += e.deltaY
            if (Math.abs(wheelAccum) < 50) return
            const direction: 1 | -1 = wheelAccum < 0 ? 1 : -1 // wheel up zooms in
            wheelAccum = 0
            const rect = axis.getBoundingClientRect()
            const anchorPct = rect.width <= 0 ? null : ((e.clientX - rect.left) / rect.width) * 100
            callbacks.onZoom(direction, anchorPct)
        },
        { passive: false }
    )
}

function renderHeader(
    parent: HTMLElement,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    // Reuses the calendar toolbar classes so both mode headers look identical.
    const toolbar = parent.createDiv({ cls: 'kap-calendar-toolbar kap-tl-toolbar' })
    const nav = toolbar.createDiv({ cls: 'kap-calendar-nav' })
    navButton(nav, '‹', 'Previous', () => callbacks.onShiftAnchor(-1))
    navButton(nav, 'Today', 'Jump to today', () => callbacks.onToday())
    navButton(nav, '›', 'Next', () => callbacks.onShiftAnchor(1))
    toolbar.createSpan({ cls: 'kap-calendar-anchor', text: model.anchorLabel })
    const ranges = toolbar.createDiv({ cls: 'kap-calendar-ranges' })
    for (const { key, label } of RANGES) {
        const btn = ranges.createEl('button', { cls: 'kap-range-btn', text: label })
        if (key === model.range) btn.addClass('kap-range-btn-active')
        btn.addEventListener('click', () => callbacks.onSetRange(key))
    }
    // Per-type visibility (estimate rework): a checkable menu over the
    // PRE-hiding type set — visible whenever the board mixes types, even with
    // every type hidden, so the user is never stranded without the button.
    // The `some(hidden)` arm covers the present set later shrinking to a
    // single type that is already hidden (the only unhide path is this menu).
    if (model.types.length > 1 || model.types.some((t) => t.hidden)) {
        const typesBtn = ranges.createEl('button', {
            cls: 'kap-range-btn kap-tl-types-btn',
            text: 'Types',
            attr: { 'type': 'button', 'aria-label': 'Show or hide note types' }
        })
        typesBtn.addEventListener('click', (e) => {
            const menu = new Menu()
            for (const type of model.types) {
                menu.addItem((item) =>
                    item
                        .setTitle(type.name)
                        .setChecked(!type.hidden)
                        .onClick(() => callbacks.onToggleTypeHidden(type.id))
                )
            }
            menu.showAtMouseEvent(e)
        })
    }
}

function renderRow(
    parent: HTMLElement,
    row: TimelineRowModel,
    model: TimelineViewModel,
    trackWidth: number,
    callbacks: TimelineCallbacks
): void {
    const rowEl = parent.createDiv({ cls: 'kap-tl-row' })
    const label = rowEl.createDiv({
        cls: 'kap-tl-rowlabel',
        text: row.card.display.title,
        attr: { title: row.tooltip }
    })
    label.addEventListener('click', (e) => callbacks.onOpen(row.card, e.ctrlKey || e.metaKey))
    rowEl.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onContextMenu(row.card, e)
    })

    const track = rowEl.createDiv({
        cls: 'kap-tl-track',
        attr: { title: 'Double-click to add a milestone' }
    })
    // Double-click on empty track space creates a milestone at that date.
    track.addEventListener('dblclick', (e) => {
        if (e.target !== track) return
        const rect = track.getBoundingClientRect()
        if (rect.width <= 0) return
        callbacks.onAddMilestone(row.card, ((e.clientX - rect.left) / rect.width) * 100)
    })
    if (model.todayPct !== null) {
        const today = track.createDiv({ cls: 'kap-tl-today' })
        today.style.left = `${String(model.todayPct)}%`
    }
    if (row.deadline) {
        const deadline = track.createDiv({
            cls: 'kap-tl-deadline',
            attr: { 'title': row.deadline.label, 'aria-label': row.deadline.label }
        })
        deadline.style.left = `${String(row.deadline.pct)}%`
    }

    if (row.bar) {
        const bar = track.createDiv({ cls: 'kap-tl-bar', attr: { title: row.tooltip } })
        bar.style.left = `${String(row.bar.leftPct)}%`
        bar.style.width = `${String(row.bar.widthPct)}%`
        if (row.bar.clippedStart) bar.addClass('kap-tl-clip-start')
        if (row.bar.clippedEnd) bar.addClass('kap-tl-clip-end')
        if (row.overdue) bar.addClass('kap-tl-overdue')
        const barWidthPx = (row.bar.widthPct / 100) * trackWidth
        // No title inside the bar — the row label already names the card. Only
        // the duration tag renders, and only when it has room (else tooltip).
        if (row.durationLabel !== null && barWidthPx >= BAR_DURATION_TAG_MIN_PX) {
            const text = bar.createDiv({ cls: 'kap-tl-bartext' })
            text.createSpan({ cls: 'kap-tl-barduration', text: row.durationLabel })
        }
        makeDraggable(bar, track, row, model, callbacks)
        // Resize handles (issue #80): none on a clipped side (the real date is
        // off-window) and none at all under 24px rendered width — two 7px
        // zones would swallow a 1–3-day bar's move-drag and click. Narrow bars
        // fall back to the context menu.
        if (barWidthPx >= BAR_HANDLES_MIN_PX) {
            const geometry = row.bar
            if (!geometry.clippedStart) {
                const handle = bar.createDiv({ cls: 'kap-tl-handle kap-tl-handle-start' })
                makeResizable(handle, bar, track, 'start', geometry, row, model, callbacks)
            }
            if (!geometry.clippedEnd) {
                const handle = bar.createDiv({ cls: 'kap-tl-handle kap-tl-handle-end' })
                makeResizable(handle, bar, track, 'end', geometry, row, model, callbacks)
            }
        }
    }
    if (row.square) {
        // Start without an estimate: a square centered on the day cell. No
        // handles (the estimate is set via the context menu) and never overdue
        // (a past start is normal in-progress work, not an error).
        const square = track.createDiv({ cls: 'kap-tl-square', attr: { title: row.tooltip } })
        square.style.left = `${String(row.square.pct)}%`
        makeDraggable(square, track, row, model, callbacks)
    }
    for (const milestone of row.milestones) {
        const diamond = track.createDiv({
            cls: 'kap-tl-milestone',
            attr: { 'title': milestone.tooltip, 'aria-label': milestone.tooltip }
        })
        diamond.style.left = `${String(milestone.pct)}%`
        diamond.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            e.stopPropagation()
            const menu = new Menu()
            menu.addItem((item) =>
                item
                    .setTitle(`Remove milestone: ${milestone.tooltip}`)
                    .setIcon('x')
                    .onClick(() => callbacks.onRemoveMilestone(row.card, milestone.raw))
            )
            menu.showAtMouseEvent(e)
        })
        makeMilestoneDraggable(diamond, track, milestone, row, model, callbacks)
    }
    if (row.offSide) {
        track.createSpan({
            cls: `kap-tl-off kap-tl-off-${row.offSide}`,
            text: row.offSide === 'before' ? '‹ Out of view' : 'Out of view ›',
            attr: { title: row.tooltip }
        })
    }
}

/** Whether client coordinates fall inside a DOMRect (panel drop testing). */
function inRect(rect: DOMRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/**
 * Floating drag label: the date about to be written, following the pointer.
 * Appended to the document body inside a `.kap-root`-classed wrapper so the
 * plugin's CSS scoping holds (and popout windows get their own element) —
 * anything inside the bar/track/panel would be clipped by an ancestor's
 * overflow. Lazily created on first `show`; `remove` tears it down (both the
 * pointerup cleanup and pointercancel must call it).
 */
function createDragLabel(doc: Document): {
    show(text: string, x: number, y: number): void
    remove(): void
} {
    let wrap: HTMLElement | null = null
    let label: HTMLElement | null = null
    return {
        show(text: string, x: number, y: number): void {
            if (!wrap || !label) {
                wrap = doc.body.createDiv({ cls: 'kap-root' })
                label = wrap.createDiv({ cls: 'kap-tl-drag-label' })
            }
            label.setText(text)
            label.style.left = `${String(x + 14)}px`
            label.style.top = `${String(y + 18)}px`
        },
        remove(): void {
            wrap?.remove()
            wrap = null
            label = null
        }
    }
}

/**
 * In-track guide line at the snapped day. One element that moves between
 * tracks (chip drags hover different rows); `showAtOffset` hides it when the
 * snapped day falls outside the visible window.
 */
function createGuide(totalDays: number): {
    showAtOffset(track: HTMLElement, dayOffset: number): void
    remove(): void
} {
    let el: HTMLElement | null = null
    return {
        showAtOffset(track: HTMLElement, dayOffset: number): void {
            const pct = (dayOffset / Math.max(1, totalDays)) * 100
            if (pct < 0 || pct > 100) {
                el?.remove()
                el = null
                return
            }
            if (!el || el.parentElement !== track) {
                el?.remove()
                el = track.createDiv({ cls: 'kap-tl-guide' })
            }
            el.style.left = `${String(pct)}%`
        },
        remove(): void {
            el?.remove()
            el = null
        }
    }
}

/**
 * Pointer-drag on a bar/square: X snaps to whole days (live transform + a
 * floating date label + in-track guide, commit the day delta on release as a
 * start-date shift). Over the undated panel the element follows the pointer
 * freely instead — releasing there unschedules the card (clears the start
 * date) regardless of the X delta (issue #80). A press without movement (2D
 * threshold, matching the undated cards) is a click (open the note; Ctrl/Cmd
 * for a new tab).
 */
function makeDraggable(
    el: HTMLElement,
    track: HTMLElement,
    row: TimelineRowModel,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    if (!row.draggable) {
        el.addEventListener('click', (e) => callbacks.onOpen(row.card, e.ctrlKey || e.metaKey))
        return
    }
    el.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return
        down.preventDefault()
        dragActive = true
        const startX = down.clientX
        const startY = down.clientY
        const dayWidth = track.clientWidth / Math.max(1, model.totalDays)
        const startOffset = row.startDayOffset ?? 0
        // The panel renders even collapsed / at Undated (0) so this
        // unschedule target always exists.
        const panel =
            el.closest('.kap-timeline')?.querySelector<HTMLElement>('.kap-tl-panel') ?? null
        let moved = false
        const doc = el.ownerDocument
        const label = createDragLabel(doc)
        const guide = createGuide(model.totalDays)

        const onMove = (move: PointerEvent): void => {
            if (Math.hypot(move.clientX - startX, move.clientY - startY) > 5) moved = true
            if (!moved) return
            el.addClass('kap-tl-dragging')
            panel?.addClass('kap-tl-drop-ready')
            const overPanel =
                panel !== null && inRect(panel.getBoundingClientRect(), move.clientX, move.clientY)
            panel?.toggleClass('kap-tl-drop-remove', overPanel)
            el.toggleClass('kap-tl-drag-remove', overPanel)
            // The label mirrors the commit's rounding exactly (Math.round of
            // the px delta), applied to the UNCLAMPED signed start offset.
            const dayDelta = Math.round((move.clientX - startX) / dayWidth)
            // Day-snapped X while over the chart; free pointer-follow while
            // over the panel (there is no day grid to snap to there).
            const dx = overPanel ? move.clientX - startX : dayDelta * dayWidth
            const dy = overPanel ? move.clientY - startY : 0
            el.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`
            if (overPanel) {
                // The panel's own hint says what a drop does; no date applies.
                label.remove()
                guide.remove()
            } else {
                label.show(
                    `→ ${callbacks.labelForDayOffset(startOffset + dayDelta)}`,
                    move.clientX,
                    move.clientY
                )
                guide.showAtOffset(track, startOffset + dayDelta)
            }
        }
        const cleanup = (): void => {
            dragActive = false
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onCancel)
            el.style.removeProperty('transform')
            el.removeClass('kap-tl-dragging', 'kap-tl-drag-remove')
            panel?.removeClass('kap-tl-drop-ready', 'kap-tl-drop-remove')
            label.remove()
            guide.remove()
        }
        const onUp = (up: PointerEvent): void => {
            // Test the drop BEFORE cleanup drops the classes, so the rect
            // measured is exactly the one the hover feedback highlighted.
            const droppedOnPanel =
                moved &&
                panel !== null &&
                inRect(panel.getBoundingClientRect(), up.clientX, up.clientY)
            cleanup()
            if (!moved) {
                callbacks.onOpen(row.card, up.ctrlKey || up.metaKey)
                return
            }
            if (droppedOnPanel) {
                callbacks.onUnschedule(row.card)
                return
            }
            const dayDelta = Math.round((up.clientX - startX) / dayWidth)
            if (dayDelta !== 0) callbacks.onMove(row.card, dayDelta)
        }
        // A canceled gesture (touch scroll takeover, pen leaving range, …)
        // aborts: no open, no write — its coordinates are unreliable.
        const onCancel = (): void => cleanup()
        doc.addEventListener('pointermove', onMove)
        doc.addEventListener('pointerup', onUp)
        doc.addEventListener('pointercancel', onCancel)
    })
}

/**
 * Edge-handle drag (issue #80, estimate rework): resizes the bar by whole
 * days. The %-geometry is converted to px once at pointerdown, then
 * left/width are live-set in px with day snapping; the preview delta applies
 * the IDENTICAL clamp as the commit ({@link resizeFromStart} /
 * {@link resizeEstimate}) so both agree — the left edge can never pass the
 * anchored derived end and the estimate never drops below 1 day. Extending
 * past the window edge is allowed (the commit allows off-window dates; the
 * next render clips). A delta-0 release is a click, like the bar itself. Live
 * feedback: the to-be-written date renders INSIDE the bar at the dragged edge
 * (larger, for readability) whenever the previewed width allows; narrower
 * bars fall back to the floating pointer label (left edge: the new start
 * date; right edge: `Nd → ends <date>`).
 */
function makeResizable(
    handle: HTMLElement,
    bar: HTMLElement,
    track: HTMLElement,
    edge: 'start' | 'end',
    geometry: BarGeometry,
    row: TimelineRowModel,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    handle.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return
        // Claim the gesture: no text selection, no bar move-drag underneath.
        down.preventDefault()
        down.stopPropagation()
        dragActive = true
        const startX = down.clientX
        const trackWidth = track.clientWidth
        const dayWidth = trackWidth / Math.max(1, model.totalDays)
        const leftPx = (geometry.leftPct / 100) * trackWidth
        const widthPx = (geometry.widthPct / 100) * trackWidth
        const doc = handle.ownerDocument
        // Handles only render on bars, which always carry start + estimate.
        const estimate = row.estimate ?? 1
        const startOffset = row.startDayOffset ?? 0
        const label = createDragLabel(doc)
        const guide = createGuide(model.totalDays)

        // The commit's clamp, verbatim: the shared start-delta stops at
        // estimate − 1; the estimate never drops below 1.
        const clampDelta = (dayDelta: number): number =>
            edge === 'start'
                ? resizeFromStart(estimate, dayDelta).startDelta
                : resizeEstimate(estimate, dayDelta) - estimate
        const snappedDelta = (clientX: number): number =>
            clampDelta(Math.round((clientX - startX) / dayWidth))

        // In-bar date at the dragged edge — bigger than the floating label,
        // shown only while the previewed bar is wide enough to fit it.
        bar.addClass('kap-tl-resizing')
        let inBar: HTMLElement | null = null
        const showInBar = (text: string, fits: boolean): boolean => {
            if (!fits) {
                inBar?.remove()
                inBar = null
                return false
            }
            inBar ??= bar.createDiv({ cls: `kap-tl-resize-label kap-tl-resize-label-${edge}` })
            inBar.setText(text)
            return true
        }

        let moved = false
        const onMove = (move: PointerEvent): void => {
            if (Math.abs(move.clientX - startX) > 5) moved = true
            const delta = snappedDelta(move.clientX)
            const px = delta * dayWidth
            // The delta is clamped against the FULL estimate while the
            // rendered width is the clipped one, so floor the preview at 0 —
            // a negative CSS width is silently ignored and freezes it.
            if (edge === 'start') {
                const newWidth = Math.max(0, widthPx - px)
                bar.style.left = `${String(leftPx + px)}px`
                bar.style.width = `${String(newWidth)}px`
                const date = callbacks.labelForDayOffset(startOffset + delta)
                if (showInBar(date, newWidth >= 110)) label.remove()
                else label.show(`→ ${date}`, move.clientX, move.clientY)
                guide.showAtOffset(track, startOffset + delta)
            } else {
                const newWidth = Math.max(0, widthPx + px)
                bar.style.width = `${String(newWidth)}px`
                const newEstimate = estimate + delta
                const date = callbacks.labelForDayOffset(startOffset + newEstimate - 1)
                if (showInBar(date, newWidth >= 110)) label.remove()
                else {
                    label.show(`${String(newEstimate)}d → ends ${date}`, move.clientX, move.clientY)
                }
                guide.showAtOffset(track, startOffset + newEstimate)
            }
        }
        const restore = (): void => {
            bar.style.left = `${String(geometry.leftPct)}%`
            bar.style.width = `${String(geometry.widthPct)}%`
        }
        const cleanup = (): void => {
            dragActive = false
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onCancel)
            bar.removeClass('kap-tl-resizing')
            inBar?.remove()
            inBar = null
            label.remove()
            guide.remove()
        }
        const onUp = (up: PointerEvent): void => {
            cleanup()
            const dayDelta = snappedDelta(up.clientX)
            if (!moved) {
                // A genuine click (no movement): restore the % styles and open.
                restore()
                callbacks.onOpen(row.card, up.ctrlKey || up.metaKey)
                return
            }
            if (dayDelta === 0) {
                // A real drag whose delta clamped to 0 (e.g. shrinking an
                // estimate-1 bar) is NOT a click — restore silently.
                restore()
                return
            }
            callbacks.onResizeEdge(row.card, edge, dayDelta)
        }
        // A canceled gesture aborts the resize: restore, write nothing.
        const onCancel = (): void => {
            cleanup()
            restore()
        }
        doc.addEventListener('pointermove', onMove)
        doc.addEventListener('pointerup', onUp)
        doc.addEventListener('pointercancel', onCancel)
    })
}

/**
 * Left undated panel (calendar parity): reuses the calendar's
 * scheduling-panel shell classes (identical chrome, collapsed rail + vertical
 * title for free) plus `kap-tl-panel` for timeline-scoped styling. Always
 * rendered — even collapsed or `Undated (0)` — because the whole panel is the
 * unschedule drop target for every bar/square drag (issue #80): the collapsed
 * rail still accepts drops (the hint stays hidden then — no room). The body
 * scrolls the undated cards as type → status collapsible groups (all
 * collapsed by default; single-type boards skip the type level).
 */
/**
 * Drag a milestone diamond horizontally to move it to another day: whole-day
 * snapping with the guide line + floating date label, committed as a day
 * delta on the milestone's raw list entry. A press without movement does
 * nothing (diamonds have no click action); pointercancel aborts. The inline
 * preview transform must repeat the class's centering + 45° rotation — a bare
 * translateX would override them and un-rotate the diamond.
 */
function makeMilestoneDraggable(
    diamond: HTMLElement,
    track: HTMLElement,
    milestone: TimelineMilestoneModel,
    row: TimelineRowModel,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    diamond.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return
        // Claim the gesture (no text selection, no track dblclick underneath).
        down.preventDefault()
        down.stopPropagation()
        dragActive = true
        const startX = down.clientX
        const dayWidth = track.clientWidth / Math.max(1, model.totalDays)
        const doc = diamond.ownerDocument
        const label = createDragLabel(doc)
        const guide = createGuide(model.totalDays)

        let moved = false
        const onMove = (move: PointerEvent): void => {
            if (Math.abs(move.clientX - startX) > 5) moved = true
            if (!moved) return
            const delta = Math.round((move.clientX - startX) / dayWidth)
            const snapped = delta * dayWidth
            diamond.style.transform = `translate(calc(-50% + ${String(snapped)}px), -50%) rotate(45deg)`
            diamond.addClass('kap-tl-dragging')
            const date = callbacks.labelForDayOffset(milestone.dayOffset + delta)
            label.show(`◆ → ${date}`, move.clientX, move.clientY)
            guide.showAtOffset(track, milestone.dayOffset + delta)
        }
        const cleanup = (): void => {
            dragActive = false
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onCancel)
            diamond.style.removeProperty('transform')
            diamond.removeClass('kap-tl-dragging')
            label.remove()
            guide.remove()
        }
        const onUp = (up: PointerEvent): void => {
            cleanup()
            if (!moved) return
            const dayDelta = Math.round((up.clientX - startX) / dayWidth)
            if (dayDelta !== 0) callbacks.onMoveMilestone(row.card, milestone.raw, dayDelta)
        }
        // A canceled gesture aborts: restore, write nothing.
        const onCancel = (): void => cleanup()
        doc.addEventListener('pointermove', onMove)
        doc.addEventListener('pointerup', onUp)
        doc.addEventListener('pointercancel', onCancel)
    })
}

function renderPanel(
    parent: HTMLElement,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    const total = model.undatedGroups.reduce((sum, g) => sum + g.count, 0)
    const panel = parent.createDiv({ cls: 'kap-scheduling-panel kap-tl-panel' })
    if (model.panelCollapsed) panel.addClass('kap-scheduling-panel-collapsed')

    const header = panel.createDiv({ cls: 'kap-panel-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-panel-toggle',
        text: model.panelCollapsed ? '»' : '«',
        attr: { 'aria-label': model.panelCollapsed ? 'Expand panel' : 'Collapse panel' }
    })
    toggle.addEventListener('click', () => callbacks.onTogglePanel())
    // "Unplanned", matching the calendar panel's tab vocabulary.
    header.createSpan({ cls: 'kap-panel-title', text: `Unplanned (${String(total)})` })
    // Revealed while a bar/square drag marks the panel kap-tl-drop-ready
    // (CSS); collapsed panels keep it hidden — the rail has no room.
    panel.createDiv({ cls: 'kap-tl-drop-hint', text: 'Drop here to unschedule' })
    if (model.panelCollapsed) return

    const body = panel.createDiv({ cls: 'kap-tl-panel-body' })
    if (total === 0) {
        body.createDiv({ cls: 'kap-panel-empty', text: 'Nothing unplanned.' })
        return
    }
    for (const group of model.undatedGroups) {
        // Multi-type boards nest status subgroups under a type header;
        // single-type boards skip the type level entirely.
        let host = body
        if (model.grouped) {
            // Full-width tab-like accordion header (calendar-tab treatment):
            // chevron + name + count badge.
            const typeHeader = body.createEl('button', {
                cls: group.collapsed ? 'kap-tl-ugroup' : 'kap-tl-ugroup kap-tl-ugroup-open',
                attr: { 'type': 'button', 'aria-expanded': String(!group.collapsed) }
            })
            typeHeader.createSpan({
                cls: 'kap-tl-ugroup-chevron',
                text: group.collapsed ? '▸' : '▾'
            })
            typeHeader.createSpan({ cls: 'kap-tl-ugroup-label', text: group.label })
            typeHeader.createSpan({ cls: 'kap-tl-ugroup-count', text: String(group.count) })
            typeHeader.addEventListener('click', () => callbacks.onToggleUndatedGroup(group.key))
            if (group.collapsed) continue
            host = body.createDiv({ cls: 'kap-tl-ugroup-body' })
        }
        for (const sub of group.groups) {
            const subHeader = host.createEl('button', {
                cls: 'kap-tl-usubgroup',
                text: `${sub.collapsed ? '▸' : '▾'} ${sub.label} (${String(sub.cards.length)})`,
                attr: { 'type': 'button', 'aria-expanded': String(!sub.collapsed) }
            })
            subHeader.addEventListener('click', () => callbacks.onToggleUndatedGroup(sub.key))
            // Pane-group DnD contract: an undated card dropped on another
            // status group (header or card grid) of the SAME type sets it.
            subHeader.dataset['paneDropType'] = sub.typeId
            subHeader.dataset['paneDropStatus'] = sub.status
            if (sub.collapsed) continue
            const grid = host.createDiv({ cls: 'kap-tl-undated-cards' })
            grid.dataset['paneDropType'] = sub.typeId
            grid.dataset['paneDropStatus'] = sub.status
            for (const card of sub.cards) {
                const cardEl = grid.createEl('button', {
                    cls: 'kap-tl-undated-card',
                    attr: { type: 'button', title: 'Drag onto the timeline to schedule' }
                })
                cardEl.createSpan({ cls: 'kap-tl-undated-cardtitle', text: card.display.title })
                cardEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault()
                    callbacks.onContextMenu(card, e)
                })
                makeCardSchedulable(cardEl, card, model, callbacks)
            }
        }
    }
}

/**
 * Drag an unplanned card from the panel anywhere over the CHART to schedule
 * it (writes the start date property for the day under the pointer, read off
 * the axis' x-geometry). The drop zone renders as a striped "new entry" lane
 * stuck to the top of the row body — dropping schedules a NEW row, it never
 * lands "inside" an existing card's line. The dragged card renders as a
 * fixed-position body-level GHOST following the pointer (an in-place
 * transform would be clipped by the panel body's `overflow-y-auto`; the
 * ghost's width is capped in CSS) while the original dims; the ghost carries
 * `kap-tl-nohit` from the moment the 5px threshold crosses so
 * `elementFromPoint` sees through it — that hit test drives the body
 * highlight, the lane's guide, and the floating date label on every
 * pointermove, and the pointerup drop reuses it. A press without movement
 * stays a click (open the note).
 */
function makeCardSchedulable(
    cardEl: HTMLElement,
    card: KanbanCard,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    cardEl.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return
        dragActive = true
        const startX = down.clientX
        const startY = down.clientY
        let moved = false
        const doc = cardEl.ownerDocument
        const tl = cardEl.closest('.kap-timeline')
        const body = tl?.querySelector<HTMLElement>('.kap-tl-body') ?? null
        const axis = tl?.querySelector<HTMLElement>('.kap-tl-axis') ?? null
        let ghostWrap: HTMLElement | null = null
        let ghost: HTMLElement | null = null
        let lane: HTMLElement | null = null
        let laneTrack: HTMLElement | null = null
        const label = createDragLabel(doc)
        const guide = createGuide(model.totalDays)

        // The whole chart column is the drop zone — requiring an existing
        // row's track would suggest the card lands on that row's line.
        const overChart = (x: number, y: number): boolean =>
            doc.elementFromPoint(x, y)?.closest('.kap-tl-chart') !== null
        // Another panel status group (same type) is also a drop target: the
        // drop sets that status (`data-pane-drop-*` contract, ghost is no-hit).
        const groupAt = (x: number, y: number): HTMLElement | null =>
            (doc.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(
                '[data-pane-drop-status]'
            ) ?? null
        let dropGroupEl: HTMLElement | null = null
        const highlightGroup = (groupEl: HTMLElement | null, valid: boolean): void => {
            if (dropGroupEl !== groupEl) {
                dropGroupEl?.removeClass('kap-cal-drop')
                dropGroupEl?.removeClass('kap-cal-drop-invalid')
                dropGroupEl = groupEl
            }
            dropGroupEl?.toggleClass('kap-cal-drop', valid)
            dropGroupEl?.toggleClass('kap-cal-drop-invalid', !valid)
        }
        // The commit path floors pct → day (dayOffsetAtPct); mirror it exactly
        // so the label always names the date that would be written. The axis
        // mirrors every track's x-geometry.
        const dayOffsetFor = (x: number, rect: DOMRect): number =>
            Math.max(
                0,
                Math.min(
                    model.totalDays - 1,
                    Math.floor(((x - rect.left) / rect.width) * model.totalDays)
                )
            )
        const showLane = (): void => {
            if (lane || !body) return
            lane = body.createDiv({ cls: 'kap-tl-drop-lane' })
            lane.createDiv({ cls: 'kap-tl-gutter kap-tl-drop-lane-label', text: 'New entry' })
            laneTrack = lane.createDiv({ cls: 'kap-tl-drop-lane-track' })
            // Sticky-first: visible even when the row body is scrolled.
            body.prepend(lane)
        }
        const hideLane = (): void => {
            lane?.remove()
            lane = null
            laneTrack = null
        }

        const onMove = (move: PointerEvent): void => {
            if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) > 5) {
                moved = true
                cardEl.addClass('kap-tl-drag-source')
                ghostWrap = doc.body.createDiv({ cls: 'kap-root' })
                ghost = ghostWrap.createDiv({
                    cls: 'kap-tl-undated-card kap-tl-ghost kap-tl-nohit'
                })
                ghost.createSpan({ cls: 'kap-tl-undated-cardtitle', text: card.display.title })
            }
            if (!moved || !ghost) return
            ghost.style.left = `${String(move.clientX + 10)}px`
            ghost.style.top = `${String(move.clientY + 10)}px`
            const hit = overChart(move.clientX, move.clientY)
            body?.toggleClass('kap-tl-drop-target', hit)
            const groupEl = hit ? null : groupAt(move.clientX, move.clientY)
            highlightGroup(
                groupEl,
                groupEl !== null &&
                    callbacks.canPaneGroupDrop(
                        card,
                        groupEl.dataset['paneDropType'] ?? '',
                        groupEl.dataset['paneDropStatus'] ?? ''
                    )
            )
            const rect = axis?.getBoundingClientRect()
            if (!hit || !rect || rect.width <= 0) {
                hideLane()
                label.remove()
                guide.remove()
                return
            }
            showLane()
            const offset = dayOffsetFor(move.clientX, rect)
            label.show(`→ ${callbacks.labelForDayOffset(offset)}`, move.clientX, move.clientY)
            if (laneTrack) guide.showAtOffset(laneTrack, offset)
        }
        const cleanup = (): void => {
            dragActive = false
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onCancel)
            cardEl.removeClass('kap-tl-drag-source')
            body?.removeClass('kap-tl-drop-target')
            highlightGroup(null, false)
            hideLane()
            ghostWrap?.remove()
            ghostWrap = null
            ghost = null
            label.remove()
            guide.remove()
        }
        const onUp = (up: PointerEvent): void => {
            // Same hit test as the hover feedback (the ghost is no-hit).
            const hit = moved && overChart(up.clientX, up.clientY)
            const groupEl = moved && !hit ? groupAt(up.clientX, up.clientY) : null
            const rect = axis?.getBoundingClientRect()
            cleanup()
            if (!moved) {
                callbacks.onOpen(card, up.ctrlKey || up.metaKey)
                return
            }
            if (groupEl) {
                const typeId = groupEl.dataset['paneDropType'] ?? ''
                const status = groupEl.dataset['paneDropStatus'] ?? ''
                if (callbacks.canPaneGroupDrop(card, typeId, status)) {
                    callbacks.onPaneGroupDrop(card, typeId, status)
                }
                return
            }
            if (!hit || !rect || rect.width <= 0) return
            callbacks.onScheduleAt(card, ((up.clientX - rect.left) / rect.width) * 100)
        }
        // A canceled gesture aborts: no open, no schedule.
        const onCancel = (): void => cleanup()
        doc.addEventListener('pointermove', onMove)
        doc.addEventListener('pointerup', onUp)
        doc.addEventListener('pointercancel', onCancel)
    })
}

function navButton(parent: HTMLElement, text: string, label: string, onClick: () => void): void {
    const btn = parent.createEl('button', {
        cls: 'kap-calendar-navbtn',
        text,
        attr: { 'type': 'button', 'aria-label': label }
    })
    btn.addEventListener('click', onClick)
}
