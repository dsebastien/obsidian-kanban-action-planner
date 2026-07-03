import { Menu } from 'obsidian'
import type { CalendarRange } from '../../domain/calendar'
import type { AxisTick, BarGeometry, StatusGroup } from '../../domain/timeline'
import type { KanbanCard } from '../board/types'

/**
 * Timeline view DOM (issue #77): header (nav + range switch, reusing the
 * calendar's toolbar classes), a percentage-positioned axis, one row per card
 * (label + track with bar / point dots / milestone diamonds / today line), and
 * a collapsible "Undated" footer. Bars and points drag horizontally to
 * reschedule (whole-day snapping); geometry comes precomputed from the
 * controller so this file is DOM-only.
 */

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
    for (const row of model.rows) renderRow(body, row, model, callbacks)

    renderUndated(tl, model, callbacks)
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
        bar.createSpan({ cls: 'kap-tl-bartext', text: row.card.display.title })
        makeDraggable(bar, track, row, model, callbacks)
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

/**
 * Horizontal pointer-drag on a bar/point: live transform while dragging, then
 * commit the snapped whole-day delta on release. A press without movement is a
 * click (open the note; Ctrl/Cmd for a new tab).
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
        const startX = down.clientX
        const dayWidth = track.clientWidth / Math.max(1, model.totalDays)
        let moved = false
        const doc = el.ownerDocument

        const onMove = (move: PointerEvent): void => {
            const dx = move.clientX - startX
            if (Math.abs(dx) > 4) moved = true
            if (moved) {
                const snapped = Math.round(dx / dayWidth) * dayWidth
                el.style.transform = `translateX(${String(snapped)}px)`
                el.addClass('kap-tl-dragging')
            }
        }
        const onUp = (up: PointerEvent): void => {
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onUp)
            el.style.removeProperty('transform')
            el.removeClass('kap-tl-dragging')
            if (!moved) {
                callbacks.onOpen(row.card, up.ctrlKey || up.metaKey)
                return
            }
            const dayDelta = Math.round((up.clientX - startX) / dayWidth)
            if (dayDelta !== 0) callbacks.onShiftDates(row.card, dayDelta)
        }
        doc.addEventListener('pointermove', onMove)
        doc.addEventListener('pointerup', onUp)
        doc.addEventListener('pointercancel', onUp)
    })
}

function renderUndated(
    parent: HTMLElement,
    model: TimelineViewModel,
    callbacks: TimelineCallbacks
): void {
    const total = model.undatedGroups.reduce((sum, g) => sum + g.items.length, 0)
    if (total === 0) return
    const footer = parent.createDiv({ cls: 'kap-tl-undated' })
    const toggle = footer.createEl('button', {
        cls: 'kap-tl-undated-toggle',
        text: `${model.undatedExpanded ? '▾' : '▸'} Undated (${String(total)})`,
        attr: { 'type': 'button', 'aria-expanded': String(model.undatedExpanded) }
    })
    toggle.addEventListener('click', () => callbacks.onToggleUndated())
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
        const onUp = (up: PointerEvent): void => {
            doc.removeEventListener('pointermove', onMove)
            doc.removeEventListener('pointerup', onUp)
            doc.removeEventListener('pointercancel', onUp)
            chip.style.removeProperty('transform')
            chip.removeClass('kap-tl-dragging')
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
        doc.addEventListener('pointermove', onMove)
        doc.addEventListener('pointerup', onUp)
        doc.addEventListener('pointercancel', onUp)
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
