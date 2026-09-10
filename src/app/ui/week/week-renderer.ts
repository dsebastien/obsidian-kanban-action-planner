import type { WeekEntry, WeekGridConfig } from '../../domain/week-planner'
import { gridHeight, hourMarks, workBand } from '../../domain/week-planner'
import { formatShare, repartitionBar, subtotalOf } from '../../domain/week-targets'
import type { TargetsGroupBy, WeekGroup, WeekGroupBy, WeekTotals } from '../../domain/week-targets'
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

/** The two faces of the ideal week (issue #172, phase G): the grid, or the targets table. */
export type WeekSubMode = 'grid' | 'targets'

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
    /** The rail's quick filter text and the unfiltered note count (phase G). */
    railFilter: string
    railTotal: number
    /** Folded rail headers, keyed `section` or `section|status`. */
    collapsedGroups: ReadonlySet<string>
    /** Selected block keys (marquee / Ctrl-click). */
    selectedKeys: ReadonlySet<string>
    panelCollapsed: boolean
    subMode: WeekSubMode
    /** The rail's second grouping level (phase G). */
    railGroupBy: WeekGroupBy
    /** The targets table's grouping and content (phase G). */
    targetsGroupBy: TargetsGroupBy
    targets: { groups: WeekGroup[]; totals: WeekTotals }
    /** Planned minutes across every shown note. */
    plannedTotal: number
    /** Target minutes across every shown note carrying one. */
    targetTotal: number
    /** Available minutes per week (the base of every share). */
    available: number
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
    onSetSubMode: (subMode: WeekSubMode) => void
    onSetRailGroupBy: (by: WeekGroupBy) => void
    onRailFilter: (text: string) => void
    onSetTargetsGroupBy: (by: TargetsGroupBy) => void
    /** A target typed in the table; false = unreadable (nothing written). */
    onCommitTarget: (path: string, raw: string) => boolean
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
    // The toolbar spans the whole width above the rail and the pane, so the
    // Grid / Targets switch stays put when the rail comes and goes.
    renderToolbar(root, model, callbacks)
    const body = root.createDiv({ cls: 'kap-week-body' })
    // The targets table (phase G) takes the whole pane: no rail, no grid.
    if (model.subMode === 'targets') {
        const main = body.createDiv({ cls: 'kap-week' })
        renderTargets(main, model, callbacks)
        return
    }
    renderRail(body, model, callbacks)
    const main = body.createDiv({ cls: 'kap-week' })
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
    return JSON.stringify([model.cfg, model.columnDays, model.panelCollapsed, model.subMode])
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
        [...model.collapsedGroups].sort(),
        model.railGroupBy,
        model.railFilter,
        model.railTotal
    ])
}

/** The targets table's content identity (rebuilt, focus kept, when it changes). */
function targetsKey(model: WeekViewModel): string {
    return JSON.stringify([
        model.targetsGroupBy,
        model.available,
        model.targets.groups.map((g) => [
            g.key,
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
    const toolbar = root.querySelector<HTMLElement>(':scope > .kap-week-toolbar')
    const body = root.querySelector<HTMLElement>(':scope > .kap-week-body')
    const main = body?.querySelector<HTMLElement>(':scope > .kap-week')
    if (!body || !main || !toolbar) return false
    if (model.subMode === 'targets') {
        const table = main.querySelector<HTMLElement>(':scope > .kap-week-targets')
        if (!table) return false
        patchToolbar(toolbar, model, callbacks)
        if (table.dataset['targets'] !== targetsKey(model)) {
            // Rebuild, keeping the focused target cell (Enter moved it already).
            const focused = table.querySelector<HTMLInputElement>('.kap-week-target-input:focus')
            const focusPath = focused?.dataset['path'] ?? null
            const next = renderTargets(main, model, callbacks)
            table.replaceWith(next)
            if (focusPath !== null) {
                const again = Array.from(
                    next.querySelectorAll<HTMLInputElement>('.kap-week-target-input')
                ).find((el) => el.dataset['path'] === focusPath)
                again?.focus()
                again?.select()
            }
        }
        return true
    }
    const scroller = main.querySelector<HTMLElement>(':scope > .kap-week-scroller')
    const grid = scroller?.querySelector<HTMLElement>(':scope > .kap-week-grid')
    if (!scroller || !grid) return false
    // Rail: rebuilt as a whole when its content changed (it is small and
    // its scroll position is captured / restored by the controller).
    const panel = body.querySelector<HTMLElement>(':scope > .kap-week-panel')
    const rail = railKey(model)
    if (!panel || panel.dataset['rail'] !== rail) {
        // Typing in the filter rebuilds the rail: keep the caret in the box.
        const filterFocused =
            panel?.querySelector<HTMLInputElement>('.kap-week-rail-filter') ===
            panel?.ownerDocument.activeElement
        panel?.remove()
        const next = renderRail(body, model, callbacks)
        body.insertBefore(next, main)
        if (filterFocused) {
            const input = next.querySelector<HTMLInputElement>('.kap-week-rail-filter')
            if (input) {
                input.focus()
                input.setSelectionRange(input.value.length, input.value.length)
            }
        }
    }
    patchToolbar(toolbar, model, callbacks)
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

/** Toolbar: the summary text, and the legend when it changed. */
function patchToolbar(toolbar: HTMLElement, model: WeekViewModel, callbacks: WeekCallbacks): void {
    const summary = toolbar.querySelector<HTMLElement>('.kap-week-planned')
    if (summary) {
        summary.setText(summaryText(model))
        summary.title = summaryTitle(model)
    }
    const legend = toolbar.querySelector<HTMLElement>('.kap-cal-legend')
    const legendId = legendKey(model)
    if (!legend || legend.dataset['legend'] !== legendId) {
        legend?.remove()
        renderLegend(toolbar, model, callbacks)
    }
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
    const filtered = model.railFilter.trim() !== ''
    header.createSpan({
        cls: 'kap-panel-title',
        text: filtered ? `Notes (${total} of ${model.railTotal})` : `Notes (${model.railTotal})`
    })
    const groupBy = header.createEl('select', {
        cls: 'dropdown kap-week-rail-groupby',
        attr: { 'aria-label': 'Group the rail by' }
    })
    const choices: [WeekGroupBy, string][] = [
        ['status', 'By status'],
        ['area', 'By area'],
        ['context', 'By context']
    ]
    for (const [value, label] of choices) {
        groupBy.createEl('option', { value, text: label })
    }
    groupBy.value = model.railGroupBy
    groupBy.addEventListener('change', () => {
        const value = groupBy.value
        if (value === 'status' || value === 'area' || value === 'context') {
            callbacks.onSetRailGroupBy(value)
        }
    })
    // Quick filter (phase G): narrows this list only; the grid keeps every block.
    const tools = panel.createDiv({ cls: 'kap-week-rail-tools' })
    const filter = tools.createEl('input', {
        cls: 'kap-week-rail-filter',
        attr: {
            'type': 'search',
            'placeholder': 'Filter this list',
            'aria-label': 'Filter the rail (the grid is not filtered)',
            'autocomplete': 'off',
            'spellcheck': 'false'
        }
    })
    filter.value = model.railFilter
    filter.addEventListener('input', () => callbacks.onRailFilter(filter.value))
    filter.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault()
            filter.value = ''
            callbacks.onRailFilter('')
        }
    })
    const list = panel.createDiv({ cls: 'kap-panel-list kap-week-rail', attr: { role: 'list' } })
    if (total === 0) {
        list.createDiv({
            cls: 'kap-panel-empty',
            text: filtered
                ? `No note matches “${model.railFilter.trim()}”. The grid still shows every block.`
                : 'Nothing here: the rail lists the notes of this board that carry the time blocks property.'
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
    // Grid / Targets (issue #172, phase G): the two faces of the ideal week.
    const switcher = toolbar.createDiv({
        cls: 'kap-calendar-nav kap-week-submode',
        attr: { role: 'tablist' }
    })
    const faces: [WeekSubMode, string, string][] = [
        ['grid', 'Grid', 'When the blocks fall'],
        ['targets', 'Targets', 'How much each note gets per week']
    ]
    for (const [subMode, label, title] of faces) {
        const btn = switcher.createEl('button', {
            cls: 'kap-range-btn',
            text: label,
            attr: {
                'type': 'button',
                'role': 'tab',
                'aria-selected': String(model.subMode === subMode),
                title
            }
        })
        if (model.subMode === subMode) btn.addClass('kap-range-btn-active')
        btn.addEventListener('click', () => callbacks.onSetSubMode(subMode))
    }
    const summary = toolbar.createEl('button', {
        cls: 'kap-week-planned',
        text: summaryText(model),
        attr: { type: 'button', title: summaryTitle(model) }
    })
    summary.addEventListener('click', () => callbacks.onSetSubMode('targets'))
    renderLegend(toolbar, model, callbacks)
}

/** `Targets 32h · planned 30h · available 168h` (the active notes). */
function summaryText(model: WeekViewModel): string {
    const parts: string[] = []
    if (model.targetTotal > 0) parts.push(`Targets ${formatHoursMinutes(model.targetTotal)}`)
    parts.push(
        `${model.targetTotal > 0 ? 'planned' : 'Planned'} ${formatHoursMinutes(model.plannedTotal)}`
    )
    parts.push(`available ${formatHoursMinutes(model.available)}`)
    return parts.join(' · ')
}

function summaryTitle(model: WeekViewModel): string {
    const t = model.targets.totals
    return (
        `Active notes: targets ${formatHoursMinutes(t.target)} (${formatShare(t.target, t.available)} of the available time), ` +
        `planned ${formatHoursMinutes(t.planned)} (${formatShare(t.planned, t.available)}), ` +
        `${formatSigned(t.remaining)} left after the targets, ${formatSigned(t.unplanned)} not planned. Click for the targets table.`
    )
}

/** `2h` / `−2h` (a negative amount reads as an overshoot). */
function formatSigned(minutes: number): string {
    return minutes < 0 ? `−${formatHoursMinutes(-minutes)}` : formatHoursMinutes(minutes)
}

// ── Targets table (issue #172, phase G) ─────────────────────────────

/**
 * The targets table: every note of the rail with its weekly target editable
 * in place (minutes or `5h`; Enter commits and moves down, Escape reverts),
 * its planned minutes with the gap to the target, and the share of the
 * available time the target takes; groups (by area or context, first value
 * wins) carry subtotals and a repartition bar; a totals row closes it.
 */
function renderTargets(
    parent: HTMLElement,
    model: WeekViewModel,
    callbacks: WeekCallbacks
): HTMLElement {
    const root = parent.createDiv({ cls: 'kap-week-targets' })
    root.dataset['targets'] = targetsKey(model)
    const head = root.createDiv({ cls: 'kap-week-targets-head' })
    head.createSpan({ cls: 'kap-week-targets-title', text: 'Weekly targets' })
    const groupBy = head.createEl('select', {
        cls: 'dropdown kap-week-targets-groupby',
        attr: { 'aria-label': 'Group the targets by' }
    })
    const choices: [TargetsGroupBy, string][] = [
        ['none', 'No grouping'],
        ['area', 'By area'],
        ['context', 'By context']
    ]
    for (const [value, label] of choices) groupBy.createEl('option', { value, text: label })
    groupBy.value = model.targetsGroupBy
    groupBy.addEventListener('change', () => {
        const value = groupBy.value
        if (value === 'none' || value === 'area' || value === 'context') {
            callbacks.onSetTargetsGroupBy(value)
        }
    })
    head.createSpan({
        cls: 'kap-week-targets-hint',
        text: 'Type minutes or 5h; Enter saves and moves down, Escape reverts, empty clears'
    })
    const total = model.targets.groups.reduce((n, g) => n + g.entries.length, 0)
    if (total === 0) {
        root.createDiv({
            cls: 'kap-panel-empty',
            text: 'Nothing here: the targets table lists the notes of this board that carry the time blocks property.'
        })
        return root
    }
    const table = root.createEl('table', { cls: 'kap-week-targets-table' })
    const thead = table.createEl('thead')
    const hr = thead.createEl('tr')
    hr.createEl('th', { text: 'Note', cls: 'kap-week-targets-note' })
    hr.createEl('th', { text: 'Target / week', cls: 'kap-week-targets-num' })
    hr.createEl('th', { text: 'Planned', cls: 'kap-week-targets-num' })
    hr.createEl('th', {
        text: 'Share',
        cls: 'kap-week-targets-num',
        attr: { title: `Of the ${formatHoursMinutes(model.available)} available per week` }
    })
    const tbody = table.createEl('tbody')
    const grouped = model.targetsGroupBy !== 'none'
    for (const group of model.targets.groups) {
        if (grouped) renderTargetsGroupRow(tbody, group, model)
        for (const entry of group.entries) renderTargetsRow(parent, tbody, entry, model, callbacks)
    }
    renderTargetsTotals(table.createEl('tfoot'), model)
    return root
}

function renderTargetsGroupRow(tbody: HTMLElement, group: WeekGroup, model: WeekViewModel): void {
    const sub = subtotalOf(group.entries)
    const tr = tbody.createEl('tr', { cls: 'kap-week-targets-group' })
    const label = tr.createEl('td', { cls: 'kap-week-targets-note' })
    label.createSpan({ cls: 'kap-week-targets-group-label', text: group.label })
    label.createSpan({ cls: 'kap-week-targets-group-count', text: String(group.entries.length) })
    renderBar(label, sub.target, sub.planned, model.available)
    tr.createEl('td', { cls: 'kap-week-targets-num', text: formatHoursMinutes(sub.target) })
    tr.createEl('td', { cls: 'kap-week-targets-num', text: formatHoursMinutes(sub.planned) })
    tr.createEl('td', {
        cls: 'kap-week-targets-num',
        text: formatShare(sub.target, model.available)
    })
}

/** A repartition bar: the target's share of the available time, the planned share over it. */
function renderBar(parent: HTMLElement, target: number, planned: number, available: number): void {
    const bar = repartitionBar(target, planned, available)
    const el = parent.createDiv({
        cls: 'kap-week-bar',
        attr: {
            title: `Target ${formatHoursMinutes(target)} (${formatShare(target, available)}), planned ${formatHoursMinutes(planned)} (${formatShare(planned, available)}) of ${formatHoursMinutes(available)} available`
        }
    })
    if (bar.over) el.addClass('kap-week-bar-over')
    el.createDiv({ cls: 'kap-week-bar-target' }).style.width = `${(bar.target * 100).toFixed(1)}%`
    el.createDiv({ cls: 'kap-week-bar-planned' }).style.width = `${(bar.planned * 100).toFixed(1)}%`
}

function renderTargetsRow(
    container: HTMLElement,
    tbody: HTMLElement,
    entry: WeekEntry,
    model: WeekViewModel,
    callbacks: WeekCallbacks
): void {
    const planned = plannedMinutesPerWeek(entry.blocks)
    const tr = tbody.createEl('tr', { cls: 'kap-week-targets-row' })
    tr.dataset['path'] = entry.path
    if (!entry.active) tr.addClass('kap-week-targets-inactive')
    // The flex layout lives on an inner wrapper: a `td` that is itself a
    // flex container leaves table-cell layout and its row drifts.
    const note = tr
        .createEl('td', { cls: 'kap-week-targets-note' })
        .createDiv({ cls: 'kap-week-targets-note-inner' })
    const context = entry.contexts[0]
    if (context) {
        const dot = note.createSpan({ cls: 'kap-cal-card-ctx' })
        dot.style.setProperty('--kap-ctx-color', model.contextColorOf(context))
    }
    const link = note.createEl('a', {
        cls: 'kap-week-targets-link',
        text: entry.title,
        attr: { href: '#', title: 'Open the note; hold ctrl or cmd for a new tab' }
    })
    link.addEventListener('click', (e) => {
        e.preventDefault()
        callbacks.onOpen(entry.path, e.ctrlKey || e.metaKey)
    })
    const meta: string[] = []
    if (entry.typeName) meta.push(entry.typeName)
    if (!entry.active) meta.push(`${entry.statusLabel} · not counted`)
    if (meta.length > 0) note.createSpan({ cls: 'kap-week-targets-meta', text: meta.join(' · ') })
    // Target: editable in place.
    const cell = tr.createEl('td', { cls: 'kap-week-targets-num kap-week-targets-target' })
    const input = cell.createEl('input', {
        cls: 'kap-week-target-input',
        attr: {
            'type': 'text',
            'inputmode': 'text',
            'placeholder': 'No target',
            'autocomplete': 'off',
            'aria-label': `Weekly target of ${entry.title}`
        }
    })
    input.dataset['path'] = entry.path
    const initial = entry.targetMinutes !== null ? formatHoursMinutes(entry.targetMinutes) : ''
    input.value = initial
    const commit = (): boolean => {
        if (input.value.trim() === initial.trim()) return true
        const ok = callbacks.onCommitTarget(entry.path, input.value)
        input.toggleClass('kap-week-target-invalid', !ok)
        return ok
    }
    // A commit re-renders the table (the cell is rebuilt), so the row to
    // focus next is resolved BEFORE the commit and found again by path.
    const moveTo = (step: 1 | -1): void => {
        const nextPath = targetSiblingPath(input, step)
        if (!commit() || nextPath === null) return
        const next = Array.from(
            container.querySelectorAll<HTMLInputElement>('.kap-week-target-input')
        ).find((el) => el.dataset['path'] === nextPath)
        next?.focus()
        next?.select()
    }
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            moveTo(1)
        } else if (e.key === 'Escape') {
            e.preventDefault()
            input.value = initial
            input.removeClass('kap-week-target-invalid')
            input.blur()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            moveTo(e.key === 'ArrowDown' ? 1 : -1)
        }
    })
    input.addEventListener('blur', () => void commit())
    input.addEventListener('focus', () => input.select())
    // Planned, with the gap to the target.
    const plannedCell = tr.createEl('td', { cls: 'kap-week-targets-num' })
    plannedCell.createSpan({ text: formatHoursMinutes(planned) })
    if (entry.targetMinutes !== null && planned !== entry.targetMinutes) {
        const delta = planned - entry.targetMinutes
        const gap = plannedCell.createSpan({
            cls: `kap-week-targets-gap ${delta < 0 ? 'kap-week-targets-under' : 'kap-week-targets-over'}`,
            text: delta < 0 ? `−${formatHoursMinutes(-delta)}` : `+${formatHoursMinutes(delta)}`
        })
        gap.title = delta < 0 ? 'Planned below the target' : 'Planned above the target'
    }
    tr.createEl('td', {
        cls: 'kap-week-targets-num',
        text: entry.targetMinutes !== null ? formatShare(entry.targetMinutes, model.available) : '–'
    })
}

/** The path of the previous / next target cell of the table, in document order. */
function targetSiblingPath(input: HTMLInputElement, step: 1 | -1): string | null {
    const table = input.closest<HTMLElement>('.kap-week-targets')
    if (!table) return null
    const inputs = Array.from(table.querySelectorAll<HTMLInputElement>('.kap-week-target-input'))
    const next = inputs[inputs.indexOf(input) + step]
    return next?.dataset['path'] ?? null
}

function renderTargetsTotals(tfoot: HTMLElement, model: WeekViewModel): void {
    const t = model.targets.totals
    const tr = tfoot.createEl('tr', { cls: 'kap-week-targets-totals' })
    const label = tr.createEl('td', { cls: 'kap-week-targets-note' })
    label.createSpan({
        cls: 'kap-week-targets-group-label',
        text: `Total (${t.counted} active note${t.counted === 1 ? '' : 's'})`
    })
    renderBar(label, t.target, t.planned, t.available)
    label.createSpan({
        cls: 'kap-week-targets-meta',
        text: `${formatHoursMinutes(t.available)} available · ${formatSigned(t.remaining)} left after the targets · ${formatSigned(t.unplanned)} not planned`
    })
    tr.createEl('td', { cls: 'kap-week-targets-num', text: formatHoursMinutes(t.target) })
    tr.createEl('td', { cls: 'kap-week-targets-num', text: formatHoursMinutes(t.planned) })
    tr.createEl('td', { cls: 'kap-week-targets-num', text: formatShare(t.target, t.available) })
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
        onToggleContext: () => undefined,
        onSetSubMode: () => undefined,
        onSetRailGroupBy: () => undefined,
        onRailFilter: () => undefined,
        onSetTargetsGroupBy: () => undefined,
        onCommitTarget: () => true
    }
    renderGrid(scroller, { ...model, selectedKeys: new Set<string>() }, noop)
    for (const handle of Array.from(root.querySelectorAll('.kap-week-handle'))) handle.remove()
    return root
}
