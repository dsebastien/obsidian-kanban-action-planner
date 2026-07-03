import { Menu } from 'obsidian'
import type { CalendarRange } from '../../domain/calendar'
import type { AxisTick, BarGeometry, StatusGroup } from '../../domain/timeline'
import type { KanbanCard } from '../board/types'

/**
 * Timeline view DOM (issue #77, #80): header (nav + range switch, reusing the
 * calendar's toolbar classes), a percentage-positioned axis, one row per card
 * (label + track with bar / point dots / milestone diamonds / today line), and
 * an always-rendered "Undated" footer that doubles as the unschedule drop
 * target. Bars and points drag to reschedule (whole-day snapping) or, dropped
 * on the footer, to unschedule; bar edges drag to resize; Ctrl/Cmd+wheel zooms
 * the range. Geometry comes precomputed from the controller so this file is
 * DOM-only.
 */

/**
 * True while any bar/point/handle/chip drag is in progress (issue #80): the
 * wheel-zoom handler must no-op then — a mid-drag rebuild would destroy the
 * dragged element while its document-level pointer listeners survive and
 * commit a wrong date against stale geometry.
 */
let dragActive = false

/** A milestone placed on a row's track. */
export interface TimelineMilestoneModel {
    pct: number
    /** Tooltip: label + date (label may be empty). */
    tooltip: string
    /** The original frontmatter list entry — the removal key. */
    raw: string
}

/** A single-date marker (start-only or end-only card). */
export interface TimelinePointModel {
    pct: number
    kind: 'start' | 'end'
}

export interface TimelineRowModel {
    card: KanbanCard
    /** Bar geometry when both dates are set and the span is visible. */
    bar: BarGeometry | null
    points: TimelinePointModel[]
    milestones: TimelineMilestoneModel[]
    /** End date in the past (overdue wash on the bar/points). */
    overdue: boolean
    /** Dates exist but everything falls outside the window: which side. */
    offSide: 'before' | 'after' | null
    /** At least one of start/end is set, so dragging can shift it. */
    draggable: boolean
    /** Inclusive span length ("12d"), only when both dates are set. */
    durationLabel: string | null
    /** Tooltip for the bar/row (title + date span). */
    tooltip: string
}

export interface TimelineViewModel {
    range: CalendarRange
    anchorLabel: string
    ticks: AxisTick[]
    /** Today's position in % of the track, or null when outside the window. */
    todayPct: number | null
    rows: TimelineRowModel[]
    /** Undated cards grouped by status value (column order, no-status last). */
    undatedGroups: StatusGroup<KanbanCard>[]
    undatedExpanded: boolean
    /** Days in the visible window (drag snapping). */
    totalDays: number
}

export interface TimelineCallbacks {
    onOpen(card: KanbanCard, newTab: boolean): void
    onContextMenu(card: KanbanCard, event: MouseEvent): void
    onSetRange(range: CalendarRange): void
    onShiftAnchor(direction: number): void
    onToday(): void
    onToggleUndated(): void
    /** Commit a drag: shift the card's start/end date(s) by whole days. */
    onShiftDates(card: KanbanCard, dayDelta: number): void
    /** Commit an edge resize: move only that edge's date by whole days. */
    onResizeDates(card: KanbanCard, edge: 'start' | 'end', dayDelta: number): void
    /** Bar/point dropped on the undated footer: clear the start/end dates. */
    onUnschedule(card: KanbanCard): void
    /**
     * Ctrl/Cmd+wheel zoom step: `1` = in, `-1` = out. `anchorPct` is the
     * pointer's position in % of the axis width (null when unmeasurable) so
     * the controller can keep the date under the cursor in view.
     */
    onZoom(direction: 1 | -1, anchorPct: number | null): void
    /** Undated chip dropped on a track at `pct` (% of the window): set its start date. */
    onScheduleAt(card: KanbanCard, pct: number): void
    /** Track double-clicked at `pct`: create a milestone there. */
    onAddMilestone(card: KanbanCard, pct: number): void
    /** Remove one milestone (the raw frontmatter list entry). */
    onRemoveMilestone(card: KanbanCard, raw: string): void
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

    const axisRow = tl.createDiv({ cls: 'kap-tl-axisrow' })
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

    const body = tl.createDiv({ cls: 'kap-tl-body' })
    if (model.rows.length === 0) {
        body.createDiv({
            cls: 'kap-tl-empty',
            text: 'No cards with dates in this window. Navigate with ‹ › or add start/end dates.'
        })
    }
    // Measured once — the axis mirrors every row's track (same gutter + flex),
    // so per-row clientWidth reads (a reflow per bar) are unnecessary. 0 means
    // the view isn't laid out (hidden tab): width gates treat that as
    // unmeasurable and the resize-triggered re-render re-evaluates them.
    const trackWidth = axis.clientWidth
    for (const row of model.rows) renderRow(body, row, model, trackWidth, callbacks)

    renderUndated(tl, model, callbacks)

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

    if (row.bar) {
        const bar = track.createDiv({ cls: 'kap-tl-bar', attr: { title: row.tooltip } })
        bar.style.left = `${String(row.bar.leftPct)}%`
        bar.style.width = `${String(row.bar.widthPct)}%`
        if (row.bar.clippedStart) bar.addClass('kap-tl-clip-start')
        if (row.bar.clippedEnd) bar.addClass('kap-tl-clip-end')
        if (row.overdue) bar.addClass('kap-tl-overdue')
        const barWidthPx = (row.bar.widthPct / 100) * trackWidth
        const text = bar.createDiv({ cls: 'kap-tl-bartext' })
        text.createSpan({ cls: 'kap-tl-bartitle', text: row.card.display.title })
        // The duration tag needs room; narrow bars keep it tooltip-only.
        if (row.durationLabel !== null && barWidthPx >= 60) {
            text.createSpan({ cls: 'kap-tl-barduration', text: row.durationLabel })
        }
        makeDraggable(bar, track, row, model, callbacks)
        // Resize handles (issue #80): none on a clipped side (the real date is
        // off-window) and none at all under 24px rendered width — two 7px
        // zones would swallow a 1–3-day bar's move-drag and click. Narrow bars
        // fall back to the context menu.
        if (barWidthPx >= 24) {
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
    for (const point of row.points) {
        const dot = track.createDiv({
            cls: `kap-tl-point kap-tl-point-${point.kind}`,
            attr: { title: row.tooltip }
        })
        dot.style.left = `${String(point.pct)}%`
        if (row.overdue && point.kind === 'end') dot.addClass('kap-tl-overdue')
        makeDraggable(dot, track, row, model, callbacks)
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
    }
    if (row.offSide) {
        track.createSpan({
            cls: `kap-tl-off kap-tl-off-${row.offSide}`,
            text: row.offSide === 'before' ? '‹ out of view' : 'out of view ›',
            attr: { title: row.tooltip }
        })
    }
}

/** Whether client coordinates fall inside a DOMRect (footer drop testing). */
function inRect(rect: DOMRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/**
 * Pointer-drag on a bar/point: X snaps to whole days (live transform, commit
 * the day delta on release), while Y only engages over the undated footer —
 * releasing there unschedules the card regardless of the X delta (issue #80).
 * A press without movement (2D threshold, matching the chips) is a click
 * (open the note; Ctrl/Cmd for a new tab).
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
        // The footer renders even at Undated (0) so this target always exists.
        const footer =
            el.closest('.kap-timeline')?.querySelector<HTMLElement>('.kap-tl-undated') ?? null
        let moved = false
        const doc = el.ownerDocument

        const onMove = (move: PointerEvent): void => {
            if (Math.hypot(move.clientX - startX, move.clientY - startY) > 5) moved = true
            if (!moved) return
            el.addClass('kap-tl-dragging')
            footer?.addClass('kap-tl-drop-ready')
            const overFooter =
                footer !== null &&
                inRect(footer.getBoundingClientRect(), move.clientX, move.clientY)
            footer?.toggleClass('kap-tl-drop-remove', overFooter)
            el.toggleClass('kap-tl-drag-remove', overFooter)
            const snapped = Math.round((move.clientX - startX) / dayWidth) * dayWidth
            const dy = overFooter ? move.clientY - startY : 0
            el.style.transform = `translate(${String(snapped)}px, ${String(dy)}px)`
        }
        const cleanup = (): void => {
            dragActive = false
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onCancel)
            el.style.removeProperty('transform')
            el.removeClass('kap-tl-dragging', 'kap-tl-drag-remove')
            footer?.removeClass('kap-tl-drop-ready', 'kap-tl-drop-remove')
        }
        const onUp = (up: PointerEvent): void => {
            // Test the drop BEFORE cleanup drops the classes: kap-tl-drop-ready
            // enlarges the footer, and that grown rect is the real target.
            const droppedOnFooter =
                moved &&
                footer !== null &&
                inRect(footer.getBoundingClientRect(), up.clientX, up.clientY)
            cleanup()
            if (!moved) {
                callbacks.onOpen(row.card, up.ctrlKey || up.metaKey)
                return
            }
            if (droppedOnFooter) {
                callbacks.onUnschedule(row.card)
                return
            }
            const dayDelta = Math.round((up.clientX - startX) / dayWidth)
            if (dayDelta !== 0) callbacks.onShiftDates(row.card, dayDelta)
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
 * Edge-handle drag (issue #80): resizes the bar by whole days, moving only the
 * grabbed edge. The %-geometry is converted to px once at pointerdown, then
 * left/width are live-set in px with day snapping; the preview delta is
 * clamped to the same min-1-day rule as the commit so both agree (extending
 * past the window edge is allowed — the next render clips). A delta-0 release
 * is a click, like the bar itself.
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

        // Shrinking stops at 1 rendered day; growing is unbounded.
        const clampDelta = (dayDelta: number): number => {
            const maxShrink = Math.max(0, Math.round(widthPx / dayWidth) - 1)
            return edge === 'start' ? Math.min(dayDelta, maxShrink) : Math.max(dayDelta, -maxShrink)
        }
        const snappedDelta = (clientX: number): number =>
            clampDelta(Math.round((clientX - startX) / dayWidth))

        const onMove = (move: PointerEvent): void => {
            const px = snappedDelta(move.clientX) * dayWidth
            if (edge === 'start') {
                bar.style.left = `${String(leftPx + px)}px`
                bar.style.width = `${String(widthPx - px)}px`
            } else {
                bar.style.width = `${String(widthPx + px)}px`
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
        }
        const onUp = (up: PointerEvent): void => {
            cleanup()
            const dayDelta = snappedDelta(up.clientX)
            if (dayDelta === 0) {
                // No movement → a click: restore the % styles and open.
                restore()
                callbacks.onOpen(row.card, up.ctrlKey || up.metaKey)
                return
            }
            callbacks.onResizeDates(row.card, edge, dayDelta)
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

function renderUndated(
    parent: HTMLElement,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    const total = model.undatedGroups.reduce((sum, g) => sum + g.items.length, 0)
    // Always rendered — even `Undated (0)` — so the unschedule drop target
    // exists for every bar/point drag (issue #80).
    const footer = parent.createDiv({ cls: 'kap-tl-undated' })
    const toggle = footer.createEl('button', {
        cls: 'kap-tl-undated-toggle',
        text: `${model.undatedExpanded ? '▾' : '▸'} Undated (${String(total)})`,
        attr: { 'type': 'button', 'aria-expanded': String(model.undatedExpanded) }
    })
    toggle.addEventListener('click', () => callbacks.onToggleUndated())
    // Hidden until a drag marks the footer kap-tl-drop-ready (CSS), so the
    // hint shows regardless of the collapsed/expanded state.
    footer.createDiv({ cls: 'kap-tl-drop-hint', text: 'Drop here to unschedule' })
    if (!model.undatedExpanded) return
    for (const group of model.undatedGroups) {
        const groupEl = footer.createDiv({ cls: 'kap-tl-undated-group' })
        groupEl.createSpan({
            cls: 'kap-tl-undated-grouplabel',
            text: `${group.label} (${String(group.items.length)})`
        })
        const list = groupEl.createDiv({ cls: 'kap-tl-undated-list' })
        for (const card of group.items) {
            const chip = list.createEl('button', {
                cls: 'kap-tl-undated-chip',
                text: card.display.title,
                attr: { type: 'button', title: 'Drag onto the timeline to schedule' }
            })
            chip.addEventListener('contextmenu', (e) => {
                e.preventDefault()
                callbacks.onContextMenu(card, e)
            })
            makeChipSchedulable(chip, card, callbacks)
        }
    }
}

/**
 * Drag an undated chip onto any row's track to schedule the card there (writes
 * the start date property for the day under the pointer). A press without
 * movement stays a click (open the note).
 */
function makeChipSchedulable(
    chip: HTMLElement,
    card: KanbanCard,
    callbacks: TimelineCallbacks
): void {
    chip.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return
        dragActive = true
        const startX = down.clientX
        const startY = down.clientY
        let moved = false
        const doc = chip.ownerDocument

        const onMove = (move: PointerEvent): void => {
            if (Math.hypot(move.clientX - startX, move.clientY - startY) > 5) moved = true
            if (moved) {
                chip.addClass('kap-tl-dragging')
                const dx = move.clientX - startX
                const dy = move.clientY - startY
                chip.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`
            }
        }
        const cleanup = (): void => {
            dragActive = false
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onCancel)
            chip.style.removeProperty('transform')
            chip.removeClass('kap-tl-dragging')
        }
        const onUp = (up: PointerEvent): void => {
            cleanup()
            if (!moved) {
                callbacks.onOpen(card, up.ctrlKey || up.metaKey)
                return
            }
            // The chip follows the pointer, so look just beneath it.
            chip.addClass('kap-tl-nohit')
            const under = doc.elementFromPoint(up.clientX, up.clientY)
            chip.removeClass('kap-tl-nohit')
            const track = under?.closest<HTMLElement>('.kap-tl-track') ?? null
            if (!track) return
            const rect = track.getBoundingClientRect()
            if (rect.width <= 0) return
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
