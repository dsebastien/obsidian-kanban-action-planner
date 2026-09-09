import type { WeekEntry, WeekGridConfig } from '../../domain/week-planner'
import { gridHeight, hourMarks, workBand } from '../../domain/week-planner'
import { DAY_LABELS, formatMinutes, plannedMinutesPerWeek } from '../../domain/time-blocks'
import type { Slot } from '../../domain/time-blocks'
import { addContextLegendItem, renderGroupHeader } from '../calendar/calendar-renderer'
import type { ContextLegendItem } from '../calendar/calendar-renderer'

/**
 * Ideal Week mode renderer (issue #172, phase B): a date-less week — one
 * column per weekday (rotated by `firstDayOfWeek`), an hour gutter, the work
 * band, and every ideal-week block as an absolutely positioned piece. The
 * ideal week is edited rarely (it says how the user WANTS to spend a week),
 * so there is no week-to-week navigation. A rail on the left lists every
 * note of the ideal week with its planned and target minutes.
 *
 * DOM contract for `week-dnd.ts`:
 * - `.kap-week-day[data-day]` — a day column (Monday-first index).
 * - `.kap-week-block[data-key][data-path][data-day][data-start][data-end]` —
 *   one piece; `data-continuation="1"` on the second half of a crosser.
 * - `.kap-week-handle-top` / `.kap-week-handle-bottom` — resize handles.
 * - `.kap-week-rail-item[data-path]` — a rail entry (drag onto the grid).
 */

/** One rendered piece of one note's slot. */
export interface WeekBlockPiece {
    key: string
    path: string
    title: string
    /** Resolved context colour, or null for a neutral (no-context) block. */
    color: string | null
    contextLabel: string
    /** The note is on the board but not active: drawn dimmed. */
    inactive: boolean
    slot: Slot
    day: number
    start: number
    end: number
    top: number
    height: number
    continuation: boolean
    clippedTop: boolean
    clippedBottom: boolean
}

export interface WeekViewModel {
    cfg: WeekGridConfig
    /** Monday-first day index per column. */
    columnDays: number[]
    pieces: WeekBlockPiece[]
    /**
     * The rail: every note of the board carrying the blocks property, split
     * into "not planned yet" and "planned", each grouped by status.
     */
    sections: {
        key: string
        label: string
        groups: { label: string; rank: number; entries: WeekEntry[] }[]
    }[]
    /** Folded rail headers, keyed `section` or `section|status`. */
    collapsedGroups: ReadonlySet<string>
    /** Selected block keys (marquee / Ctrl-click). */
    selectedKeys: ReadonlySet<string>
    panelCollapsed: boolean
    /** Planned minutes across every shown note. */
    plannedTotal: number
    /** Target minutes across every shown note carrying one. */
    targetTotal: number
    errors: { title: string; entry: string; error: string }[]
    contextLegend: ContextLegendItem[]
    /** Resolved colour for a context value (rail dots). */
    contextColorOf: (value: string) => string
}

/** Keyboard edits on a focused block (issue #172). */
export type BlockKeyAction =
    | { kind: 'move'; dDay: number; dMinutes: number }
    | { kind: 'resize'; dMinutes: number }
    | { kind: 'remove' }

export interface WeekCallbacks {
    onTogglePanel: () => void
    onToggleGroup: (label: string) => void
    onOpen: (path: string, newTab: boolean) => void
    onBlockContextMenu: (path: string, slot: Slot, event: MouseEvent) => void
    onBlockKey: (path: string, slot: Slot, action: BlockKeyAction) => void
    onRailContextMenu: (path: string, event: MouseEvent) => void
    onToggleContext: (value: string) => void
}

/** Render the whole mode into `rootEl` (replaces its content). */
export function renderWeek(
    rootEl: HTMLElement,
    model: WeekViewModel,
    callbacks: WeekCallbacks
): void {
    rootEl.empty()
    const root = rootEl.createDiv({ cls: 'kap-week-root' })
    renderRail(root, model, callbacks)
    const main = root.createDiv({ cls: 'kap-week' })
    renderToolbar(main, model, callbacks)
    if (model.errors.length > 0) renderErrors(main, model)
    renderHead(main, model)
    const scroller = main.createDiv({ cls: 'kap-week-scroller' })
    renderGrid(scroller, model, callbacks)
}

/** "2h" / "1h 30m" / "45m". */
export function formatHoursMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function renderRail(parent: HTMLElement, model: WeekViewModel, callbacks: WeekCallbacks): void {
    const panel = parent.createDiv({ cls: 'kap-scheduling-panel kap-week-panel' })
    if (model.panelCollapsed) panel.addClass('kap-scheduling-panel-collapsed')
    const header = panel.createDiv({ cls: 'kap-panel-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-panel-toggle',
        text: model.panelCollapsed ? '»' : '«',
        attr: {
            'type': 'button',
            'aria-label': model.panelCollapsed ? 'Expand the panel' : 'Collapse the panel'
        }
    })
    toggle.addEventListener('click', callbacks.onTogglePanel)
    if (model.panelCollapsed) return
    const total = model.sections.reduce(
        (n, sec) => n + sec.groups.reduce((m, g) => m + g.entries.length, 0),
        0
    )
    header.createSpan({ cls: 'kap-panel-title', text: `Notes (${total})` })
    const list = panel.createDiv({ cls: 'kap-panel-list kap-week-rail', attr: { role: 'list' } })
    if (total === 0) {
        list.createDiv({
            cls: 'kap-panel-empty',
            text: 'Nothing here: the rail lists the notes of this board that carry the time blocks property.'
        })
        return
    }
    for (const section of model.sections) {
        const count = section.groups.reduce((m, g) => m + g.entries.length, 0)
        const sectionCollapsed = model.collapsedGroups.has(section.key)
        renderGroupHeader(list, 'kap-cal-ugroup', section.label, count, sectionCollapsed, () =>
            callbacks.onToggleGroup(section.key)
        )
        if (sectionCollapsed) continue
        for (const group of section.groups) {
            const key = `${section.key}|${group.label}`
            const collapsed = model.collapsedGroups.has(key)
            renderGroupHeader(
                list,
                'kap-cal-usubgroup',
                group.label,
                group.entries.length,
                collapsed,
                () => callbacks.onToggleGroup(key)
            )
            if (collapsed) continue
            for (const entry of group.entries) renderRailItem(list, entry, model, callbacks)
        }
    }
}

function renderRailItem(
    list: HTMLElement,
    entry: WeekEntry,
    model: WeekViewModel,
    callbacks: WeekCallbacks
): void {
    const planned = plannedMinutesPerWeek(entry.blocks)
    const item = list.createDiv({
        cls: 'kap-cal-card kap-week-rail-item',
        attr: { role: 'listitem', tabindex: '0', draggable: 'false' }
    })
    item.dataset['path'] = entry.path
    if (entry.blocks.length === 0) item.addClass('kap-week-rail-unplanned')
    if (!entry.active) item.addClass('kap-week-rail-inactive')
    const context = entry.contexts[0]
    if (context) {
        const dot = item.createSpan({ cls: 'kap-cal-card-ctx' })
        dot.style.setProperty('--kap-ctx-color', model.contextColorOf(context))
    }
    item.createSpan({ cls: 'kap-week-rail-title', text: entry.title })
    const status =
        entry.targetMinutes !== null
            ? `${formatHoursMinutes(planned)} / ${formatHoursMinutes(entry.targetMinutes)}`
            : planned > 0
              ? formatHoursMinutes(planned)
              : 'no block'
    const badge = item.createSpan({ cls: 'kap-week-rail-target', text: status })
    if (entry.targetMinutes !== null && planned < entry.targetMinutes) {
        badge.addClass('kap-week-rail-under')
    }
    item.title =
        `${entry.title}${entry.typeName ? ` · ${entry.typeName}` : ''} · ${entry.statusLabel}\n` +
        `${formatHoursMinutes(planned)} planned` +
        (entry.targetMinutes !== null
            ? ` of a ${formatHoursMinutes(entry.targetMinutes)} target`
            : ', no weekly target yet') +
        (entry.active ? '' : '\nNot active: its blocks render dimmed') +
        '\nDrag onto the grid to plan a block'
    item.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onRailContextMenu(entry.path, e)
    })
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') callbacks.onOpen(entry.path, e.ctrlKey || e.metaKey)
    })
}

function renderToolbar(parent: HTMLElement, model: WeekViewModel, callbacks: WeekCallbacks): void {
    const toolbar = parent.createDiv({ cls: 'kap-calendar-toolbar kap-week-toolbar' })
    toolbar.createSpan({ cls: 'kap-calendar-anchor kap-week-anchor', text: 'Ideal week' })
    const summary =
        model.targetTotal > 0
            ? `${formatHoursMinutes(model.plannedTotal)} planned of ${formatHoursMinutes(model.targetTotal)} targeted`
            : `${formatHoursMinutes(model.plannedTotal)} planned`
    toolbar.createSpan({
        cls: 'kap-week-planned',
        text: summary,
        attr: {
            title: 'Minutes reserved per week by every block shown, against the notes’ weekly targets'
        }
    })
    if (model.contextLegend.length > 0) {
        const legend = toolbar.createDiv({ cls: 'kap-cal-legend' })
        for (const item of model.contextLegend) {
            addContextLegendItem(legend, item, () => callbacks.onToggleContext(item.value))
        }
    }
}

function renderErrors(parent: HTMLElement, model: WeekViewModel): void {
    const strip = parent.createDiv({ cls: 'kap-week-errors', attr: { role: 'alert' } })
    strip.createSpan({
        cls: 'kap-week-errors-title',
        text: `${model.errors.length} block${model.errors.length === 1 ? '' : 's'} could not be read:`
    })
    for (const error of model.errors.slice(0, 5)) {
        strip.createSpan({ cls: 'kap-week-error', text: `${error.title}: ${error.error}` })
    }
}

function renderHead(parent: HTMLElement, model: WeekViewModel): void {
    const head = parent.createDiv({ cls: 'kap-week-head' })
    head.createDiv({ cls: 'kap-week-gutter-spacer' })
    for (const day of model.columnDays) {
        const cell = head.createDiv({ cls: 'kap-week-dayhead' })
        cell.createSpan({ cls: 'kap-week-dayname', text: DAY_LABELS[day] ?? '' })
    }
}

function renderGrid(parent: HTMLElement, model: WeekViewModel, callbacks: WeekCallbacks): void {
    const cfg = model.cfg
    const grid = parent.createDiv({ cls: 'kap-week-grid', attr: { tabindex: '-1' } })
    grid.style.height = `${gridHeight(cfg)}px`
    const gutter = grid.createDiv({ cls: 'kap-week-gutter' })
    for (const mark of hourMarks(cfg)) {
        const label = gutter.createSpan({ cls: 'kap-week-hour', text: formatMinutes(mark) })
        label.style.top = `${(mark - cfg.gridStart) * cfg.pxPerMinute}px`
    }
    const byDay = new Map<number, WeekBlockPiece[]>()
    for (const piece of model.pieces) {
        const list = byDay.get(piece.day) ?? []
        list.push(piece)
        byDay.set(piece.day, list)
    }
    for (const day of model.columnDays) {
        const col = grid.createDiv({ cls: 'kap-week-day' })
        col.dataset['day'] = String(day)
        const band = workBand(day, cfg)
        if (band) {
            const bandEl = col.createDiv({ cls: 'kap-week-work' })
            bandEl.style.top = `${band.top}px`
            bandEl.style.height = `${band.height}px`
        }
        for (const mark of hourMarks(cfg)) {
            const line = col.createDiv({ cls: 'kap-week-hourline' })
            line.style.top = `${(mark - cfg.gridStart) * cfg.pxPerMinute}px`
        }
        for (const piece of byDay.get(day) ?? []) renderPiece(col, piece, model, callbacks)
    }
}

/** The keyboard edit a key press on a block stands for, or null. */
export function blockKeyAction(e: {
    key: string
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
}): BlockKeyAction | null {
    if (e.ctrlKey || e.metaKey || e.altKey) return null
    switch (e.key) {
        case 'ArrowUp':
            return e.shiftKey
                ? { kind: 'resize', dMinutes: -15 }
                : { kind: 'move', dDay: 0, dMinutes: -15 }
        case 'ArrowDown':
            return e.shiftKey
                ? { kind: 'resize', dMinutes: 15 }
                : { kind: 'move', dDay: 0, dMinutes: 15 }
        case 'ArrowLeft':
            return e.shiftKey ? null : { kind: 'move', dDay: -1, dMinutes: 0 }
        case 'ArrowRight':
            return e.shiftKey ? null : { kind: 'move', dDay: 1, dMinutes: 0 }
        case 'Delete':
        case 'Backspace':
            return { kind: 'remove' }
        default:
            return null
    }
}

function renderPiece(
    col: HTMLElement,
    piece: WeekBlockPiece,
    model: WeekViewModel,
    callbacks: WeekCallbacks
): void {
    const el = col.createDiv({ cls: 'kap-week-block', attr: { role: 'button', tabindex: '0' } })
    el.dataset['key'] = piece.key
    el.dataset['path'] = piece.path
    el.dataset['day'] = String(piece.slot.day)
    el.dataset['start'] = String(piece.slot.start)
    el.dataset['end'] = String(piece.slot.end)
    if (piece.continuation) el.dataset['continuation'] = '1'
    el.style.top = `${piece.top}px`
    el.style.height = `${piece.height}px`
    if (piece.color) {
        el.addClass('kap-week-block-ctx')
        el.style.setProperty('--kap-ctx-color', piece.color)
    } else {
        el.addClass('kap-week-block-neutral')
    }
    if (piece.inactive) el.addClass('kap-week-block-inactive')
    if (model.selectedKeys.has(piece.key)) el.addClass('kap-week-block-selected')
    if (piece.continuation) el.addClass('kap-week-block-continuation')
    if (piece.clippedTop) el.addClass('kap-week-block-clipped-top')
    if (piece.clippedBottom) el.addClass('kap-week-block-clipped-bottom')
    const timeLabel = `${formatMinutes(piece.slot.start)}–${formatMinutes(piece.slot.end)}`
    el.title =
        `${piece.title}\n${timeLabel}${piece.contextLabel ? `\n${piece.contextLabel}` : ''}\n` +
        'Drag to move, drag the top/bottom edge to resize, the left/right edge to stretch across days, Alt-drop to copy, Ctrl-click to select. Keys: arrows move, Shift+↑↓ resize, Delete removes, Ctrl+C / Ctrl+V copy and paste at the pointer.'
    el.setAttribute('aria-label', `${piece.title}, ${timeLabel}`)
    if (!piece.continuation && piece.height >= 14) {
        el.createDiv({ cls: 'kap-week-block-title', text: piece.title })
    }
    if (piece.height >= 30) el.createDiv({ cls: 'kap-week-block-time', text: timeLabel })
    if (!piece.clippedTop && !piece.continuation) {
        el.createDiv({ cls: 'kap-week-handle kap-week-handle-top' })
    }
    if (!piece.clippedBottom && (piece.continuation || piece.slot.end <= 1440)) {
        el.createDiv({ cls: 'kap-week-handle kap-week-handle-bottom' })
    }
    if (!piece.continuation) {
        el.createDiv({ cls: 'kap-week-handle kap-week-handle-left' })
        el.createDiv({ cls: 'kap-week-handle kap-week-handle-right' })
    }
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        callbacks.onBlockContextMenu(piece.path, piece.slot, e)
    })
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            callbacks.onOpen(piece.path, e.ctrlKey || e.metaKey)
            return
        }
        const action = blockKeyAction(e)
        if (!action) return
        e.preventDefault()
        e.stopPropagation()
        callbacks.onBlockKey(piece.path, piece.slot, action)
    })
}
