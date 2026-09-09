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

/**
 * Render the mode into `rootEl`. When a previous render of the same
 * structure (grid config, columns, panel state) is still there, the DOM is
 * PATCHED in place: pieces are reconciled by key (an untouched block keeps
 * its element, so the vault's echo of an optimistic edit never flashes or
 * reflows the grid), the rail / legend / errors are rebuilt only when their
 * content changed, and the toolbar text is updated. Otherwise it is built
 * from scratch.
 */
export function renderWeek(
    rootEl: HTMLElement,
    model: WeekViewModel,
    callbacks: WeekCallbacks
): void {
    const structure = structureKey(model)
    const existing = rootEl.querySelector<HTMLElement>(':scope > .kap-week-root')
    if (existing && existing.dataset['structure'] === structure) {
        if (patchWeek(existing, model, callbacks)) return
    }
    rootEl.empty()
    const root = rootEl.createDiv({ cls: 'kap-week-root' })
    root.dataset['structure'] = structure
    renderRail(root, model, callbacks)
    const main = root.createDiv({ cls: 'kap-week' })
    renderToolbar(main, model, callbacks)
    if (model.errors.length > 0) renderErrors(main, model)
    // The head lives INSIDE the scroller (sticky) so it shares the grid's
    // width: outside it, the scroller's scrollbar narrowed the day columns
    // but not the headers, and the two drifted apart towards the right.
    const scroller = main.createDiv({ cls: 'kap-week-scroller' })
    renderHead(scroller, model)
    renderGrid(scroller, model, callbacks)
}

/** What a full rebuild depends on; anything else is patched in place. */
function structureKey(model: WeekViewModel): string {
    return JSON.stringify([model.cfg, model.columnDays, model.panelCollapsed])
}

/** The rail's content identity (rebuilt only when it changes). */
function railKey(model: WeekViewModel): string {
    return JSON.stringify([
        model.sections.map((sec) => [
            sec.key,
            sec.groups.map((g) => [
                g.label,
                g.entries.map((e) => [
                    e.path,
                    e.title,
                    e.typeName,
                    e.statusLabel,
                    e.active,
                    e.targetMinutes,
                    e.contexts[0] ?? null,
                    plannedMinutesPerWeek(e.blocks)
                ])
            ])
        ]),
        [...model.collapsedGroups].sort()
    ])
}

function legendKey(model: WeekViewModel): string {
    return JSON.stringify(model.contextLegend)
}

function errorsKey(model: WeekViewModel): string {
    return JSON.stringify(model.errors)
}

/**
 * Update an existing render to `model` without rebuilding what did not
 * change; false when the previous DOM is not patchable (full build instead).
 */
function patchWeek(root: HTMLElement, model: WeekViewModel, callbacks: WeekCallbacks): boolean {
    const main = root.querySelector<HTMLElement>(':scope > .kap-week')
    const scroller = main?.querySelector<HTMLElement>(':scope > .kap-week-scroller')
    const grid = scroller?.querySelector<HTMLElement>(':scope > .kap-week-grid')
    const toolbar = main?.querySelector<HTMLElement>(':scope > .kap-week-toolbar')
    if (!main || !scroller || !grid || !toolbar) return false
    // Rail: rebuilt as a whole when its content changed (it is small and
    // its scroll position is captured / restored by the controller).
    const panel = root.querySelector<HTMLElement>(':scope > .kap-week-panel')
    const rail = railKey(model)
    if (!panel || panel.dataset['rail'] !== rail) {
        panel?.remove()
        const next = renderRail(root, model, callbacks)
        root.insertBefore(next, main)
    }
    // Toolbar: the summary text, and the legend when it changed.
    const summary = toolbar.querySelector<HTMLElement>('.kap-week-planned')
    if (summary) summary.setText(summaryText(model))
    const legend = toolbar.querySelector<HTMLElement>('.kap-cal-legend')
    const legendId = legendKey(model)
    if (!legend || legend.dataset['legend'] !== legendId) {
        legend?.remove()
        renderLegend(toolbar, model, callbacks)
    }
    // Errors strip: rebuilt when it changed, kept between toolbar and grid.
    const strip = main.querySelector<HTMLElement>(':scope > .kap-week-errors')
    const errorsId = errorsKey(model)
    if (!strip || strip.dataset['errors'] !== errorsId) {
        strip?.remove()
        if (model.errors.length > 0) {
            const next = renderErrors(main, model)
            main.insertBefore(next, scroller)
        }
    }
    reconcilePieces(grid, model, callbacks)
    return true
}

/**
 * Reconcile the grid's block elements with the model's pieces: a piece whose
 * signature is unchanged keeps its element (and its focus, hover, and
 * selection state), a changed one is re-rendered in place, a gone one is
 * removed, a new one is appended to its day column.
 */
function reconcilePieces(grid: HTMLElement, model: WeekViewModel, callbacks: WeekCallbacks): void {
    const columns = new Map<number, HTMLElement>()
    for (const col of Array.from(grid.querySelectorAll<HTMLElement>(':scope > .kap-week-day'))) {
        columns.set(Number(col.dataset['day']), col)
    }
    const existing = new Map<string, HTMLElement>()
    for (const el of Array.from(grid.querySelectorAll<HTMLElement>('.kap-week-block'))) {
        existing.set(pieceIdOf(el), el)
    }
    const seen = new Set<string>()
    for (const piece of model.pieces) {
        const id = pieceId(piece)
        seen.add(id)
        const col = columns.get(piece.day)
        if (!col) continue
        const signature = pieceSignature(piece, model)
        const current = existing.get(id)
        if (
            current &&
            current.dataset['signature'] === signature &&
            current.parentElement === col
        ) {
            continue
        }
        const next = renderPiece(col, piece, model, callbacks)
        if (current) {
            current.replaceWith(next)
        }
    }
    for (const [id, el] of existing) if (!seen.has(id)) el.remove()
}

/** DOM identity of a piece: its slot key plus which half of a crosser it is. */
function pieceId(piece: WeekBlockPiece): string {
    return `${piece.key}|${piece.continuation ? '1' : '0'}`
}

function pieceIdOf(el: HTMLElement): string {
    return `${el.dataset['key'] ?? ''}|${el.dataset['continuation'] === '1' ? '1' : '0'}`
}

/** Everything `renderPiece` bakes into an element (the patch gate). */
function pieceSignature(piece: WeekBlockPiece, model: WeekViewModel): string {
    return JSON.stringify([
        piece.path,
        piece.title,
        piece.color,
        piece.contextLabel,
        piece.inactive,
        piece.slot,
        piece.top,
        piece.height,
        piece.clippedTop,
        piece.clippedBottom,
        model.selectedKeys.has(piece.key)
    ])
}

/** "2h" / "1h 30m" / "45m". */
export function formatHoursMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function renderRail(
    parent: HTMLElement,
    model: WeekViewModel,
    callbacks: WeekCallbacks
): HTMLElement {
    const panel = parent.createDiv({ cls: 'kap-scheduling-panel kap-week-panel' })
    panel.dataset['rail'] = railKey(model)
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
    if (model.panelCollapsed) return panel
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
        return panel
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
    return panel
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
        '\nClick to open (Ctrl/Cmd-click in a new tab), drag onto the grid to plan a block'
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
    toolbar.createSpan({
        cls: 'kap-week-planned',
        text: summaryText(model),
        attr: {
            title: 'Minutes reserved per week by every block shown, against the notes’ weekly targets'
        }
    })
    renderLegend(toolbar, model, callbacks)
}

function summaryText(model: WeekViewModel): string {
    return model.targetTotal > 0
        ? `${formatHoursMinutes(model.plannedTotal)} planned of ${formatHoursMinutes(model.targetTotal)} targeted`
        : `${formatHoursMinutes(model.plannedTotal)} planned`
}

function renderLegend(toolbar: HTMLElement, model: WeekViewModel, callbacks: WeekCallbacks): void {
    if (model.contextLegend.length === 0) return
    const legend = toolbar.createDiv({ cls: 'kap-cal-legend' })
    legend.dataset['legend'] = legendKey(model)
    for (const item of model.contextLegend) {
        addContextLegendItem(legend, item, () => callbacks.onToggleContext(item.value))
    }
}

function renderErrors(parent: HTMLElement, model: WeekViewModel): HTMLElement {
    const strip = parent.createDiv({ cls: 'kap-week-errors', attr: { role: 'alert' } })
    strip.dataset['errors'] = errorsKey(model)
    strip.createSpan({
        cls: 'kap-week-errors-title',
        text: `${model.errors.length} block${model.errors.length === 1 ? '' : 's'} could not be read:`
    })
    for (const error of model.errors.slice(0, 5)) {
        strip.createSpan({ cls: 'kap-week-error', text: `${error.title}: ${error.error}` })
    }
    return strip
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
        // Labels are centred on their line; the first one would hang above
        // the grid and get clipped by the scroller, so it hangs below instead.
        if (mark === cfg.gridStart) label.addClass('kap-week-hour-first')
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
): HTMLElement {
    const el = col.createDiv({ cls: 'kap-week-block', attr: { role: 'button', tabindex: '0' } })
    el.dataset['key'] = piece.key
    el.dataset['signature'] = pieceSignature(piece, model)
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
        'Click to open (Ctrl/Cmd-click in a new tab), Shift-click to select. Drag to move, drag the top/bottom edge to resize, the left/right edge to stretch across days, Alt-drop to copy. Keys: arrows move, Shift+↑↓ resize, Delete removes, Ctrl+C / Ctrl+V copy and paste at the pointer.'
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
    return el
}

/**
 * A static, print-friendly copy of the grid (issue #172, phase E): the same
 * head, gutter and pieces as the live render, no rail, no toolbar, no
 * handles, inside a container the print stylesheet isolates. Returns the
 * container; the caller prints and removes it.
 */
export function renderWeekPrint(doc: Document, model: WeekViewModel, title: string): HTMLElement {
    const root = doc.body.createDiv({ cls: 'kap-root kap-week-print' })
    root.createDiv({ cls: 'kap-week-print-title', text: title })
    const summary = root.createDiv({ cls: 'kap-week-print-summary', text: summaryText(model) })
    summary.setAttribute('aria-hidden', 'true')
    const page = root.createDiv({ cls: 'kap-week kap-week-print-page' })
    const scroller = page.createDiv({ cls: 'kap-week-scroller kap-week-print-scroller' })
    renderHead(scroller, model)
    const noop: WeekCallbacks = {
        onTogglePanel: () => undefined,
        onToggleGroup: () => undefined,
        onOpen: () => undefined,
        onBlockContextMenu: () => undefined,
        onBlockKey: () => undefined,
        onRailContextMenu: () => undefined,
        onToggleContext: () => undefined
    }
    renderGrid(scroller, { ...model, selectedKeys: new Set<string>() }, noop)
    for (const handle of Array.from(root.querySelectorAll('.kap-week-handle'))) handle.remove()
    return root
}
