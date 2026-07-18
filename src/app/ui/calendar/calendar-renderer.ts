import type { CalendarBlock, CalendarRange, DateDimension } from '../../domain/calendar'
import type { KanbanCard } from '../board/types'
import { contextColor } from '../../services/colors.service'

/** One entry in the context legend: a GTD context, its color, and whether it's filtered. */
export interface ContextLegendItem {
    value: string
    active: boolean
}

/**
 * How a chip sits on a day: by its `scheduled` date (blue), its `deadline`
 * (orange), `both` when the two land on the same day (split edge), or `span`
 * — a dimmed continuation of a multi-day start + estimate span (issue #86;
 * not draggable, the start-day chip moves the card).
 */
export type CalendarEntryKind = 'scheduled' | 'deadline' | 'both' | 'span'

/** One card placed on a day by one (or both) of its dates. */
export interface CalendarEntry {
    card: KanbanCard
    kind: CalendarEntryKind
    /** A deadline that's already in the past (drawn red). */
    overdue: boolean
    /** Span continuations only: `day 2 of 5` (tooltip suffix). */
    spanLabel?: string
}

/** One status subgroup of panel cards (collapse key `typeId::status`). */
export interface PanelStatusGroupModel {
    key: string
    label: string
    collapsed: boolean
    cards: KanbanCard[]
    /** The owning note type id — pane-group drops are same-type only. */
    typeId: string
    /** The raw status value this group holds ('' = no status). */
    status: string
}

/** One note-type group of panel cards (collapse key = the type id). */
export interface PanelTypeGroupModel {
    key: string
    label: string
    count: number
    collapsed: boolean
    groups: PanelStatusGroupModel[]
}

/** Everything the calendar view needs to render one frame. */
export interface CalendarViewModel {
    range: CalendarRange
    activeTab: DateDimension
    anchorLabel: string
    blocks: CalendarBlock[]
    /**
     * The active backlog grouped by note type → status (all collapsed by
     * default). Type headers render only when {@link panelGrouped}.
     */
    panelGroups: PanelTypeGroupModel[]
    /** Whether type headers render (the backlog spans more than one type). */
    panelGrouped: boolean
    /** Card placements bucketed by `YYYY-MM-DD` — both dimensions, color-coded. */
    cardsByDay: Map<string, CalendarEntry[]>
    panelCollapsed: boolean
    counts: { unplanned: number; noDeadline: number }
    /** Legend toggles: which dimensions are currently shown on the grid. */
    showScheduled: boolean
    showDeadlines: boolean
    /** GTD contexts present on the board (color-key + click-to-filter); empty = no legend. */
    contextLegend: ContextLegendItem[]
    /** Weekday header labels, ordered for the configured first day of week. */
    weekdays: string[]
    /** When set (`YYYY-MM-DD`), the grid is replaced by a focused single-day view. */
    focusedDay: string | null
    /** Long label for the focused day, e.g. "Thursday, June 18, 2026". */
    focusedDayLabel: string
}

export interface CalendarCallbacks {
    onOpen: (card: KanbanCard, newTab: boolean) => void
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
    onSwitchTab: (dim: DateDimension) => void
    /** Toggle a dimension's visibility on the grid (the legend). */
    onToggleDimension: (dim: DateDimension) => void
    /** Toggle a GTD context in the filter (context legend click). */
    onToggleContext: (value: string) => void
    onSetRange: (range: CalendarRange) => void
    onShiftAnchor: (direction: number) => void
    onToday: () => void
    onTogglePanel: () => void
    /** Toggle one panel group's collapse (key: `typeId` or `typeId::status`). */
    onTogglePanelGroup: (key: string) => void
    /** Zoom into a single day (`YYYY-MM-DD`). */
    onFocusDay: (dayKey: string) => void
    /** Leave the focused day, back to the grid. */
    onClearFocus: () => void
    /** Move the focused day by ±1. */
    onFocusShift: (direction: number) => void
    /** Enter the single-day view on today (the "Day" range button / day "Today"). */
    onFocusToday: () => void
}

const RANGES: Array<{ key: CalendarRange; label: string }> = [
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: 'quarter', label: 'Quarter' },
    { key: 'year', label: 'Year' }
]

/**
 * Render the scheduling view: a collapsible left panel with Unplanned /
 * No-Deadline tabs, plus a CSS-grid calendar on the right. The active tab
 * selects which date dimension (scheduled vs due) the calendar shows.
 *
 * `data-day` (day cells), `data-card-key` (chips) and `data-calendar-panel`
 * (panel list) are the contract the calendar DnD controller relies on.
 */
export function renderCalendar(
    rootEl: HTMLElement,
    model: CalendarViewModel,
    callbacks: CalendarCallbacks
): void {
    rootEl.empty()
    const root = rootEl.createDiv({ cls: 'kap-calendar-root' })
    renderPanel(root, model, callbacks)
    renderCalendarGrid(root, model, callbacks)
}

function renderPanel(
    root: HTMLElement,
    model: CalendarViewModel,
    callbacks: CalendarCallbacks
): void {
    const panel = root.createDiv({ cls: 'kap-scheduling-panel' })
    if (model.panelCollapsed) panel.addClass('kap-scheduling-panel-collapsed')

    const header = panel.createDiv({ cls: 'kap-panel-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-panel-toggle',
        text: model.panelCollapsed ? '»' : '«',
        attr: { 'aria-label': model.panelCollapsed ? 'Expand panel' : 'Collapse panel' }
    })
    toggle.addEventListener('click', () => callbacks.onTogglePanel())
    header.createSpan({ cls: 'kap-panel-title', text: 'Scheduling' })

    if (model.panelCollapsed) return

    const tabs = panel.createDiv({ cls: 'kap-panel-tabs' })
    addTab(tabs, 'Unplanned', model.counts.unplanned, model.activeTab === 'scheduled', () =>
        callbacks.onSwitchTab('scheduled')
    )
    addTab(tabs, 'No deadline', model.counts.noDeadline, model.activeTab === 'deadline', () =>
        callbacks.onSwitchTab('deadline')
    )

    const list = panel.createDiv({ cls: 'kap-panel-list' })
    list.dataset['calendarPanel'] = model.activeTab
    list.setAttribute('role', 'list')
    const total = model.panelGroups.reduce((sum, g) => sum + g.count, 0)
    if (total === 0) {
        list.createDiv({
            cls: 'kap-panel-empty',
            text:
                model.activeTab === 'scheduled'
                    ? 'Every card has a scheduled date.'
                    : 'Every card has a deadline.'
        })
        return
    }
    // The backlog groups by note type → status (all collapsed by default);
    // single-type boards skip the type level. Dragging a chip sets the active
    // dimension's date.
    for (const group of model.panelGroups) {
        let host = list
        if (model.panelGrouped) {
            renderGroupHeader(
                list,
                'kap-cal-ugroup',
                group.label,
                group.count,
                group.collapsed,
                () => callbacks.onTogglePanelGroup(group.key)
            )
            if (group.collapsed) continue
            host = list.createDiv({ cls: 'kap-cal-ugroup-body' })
        }
        for (const sub of group.groups) {
            const subHeader = renderGroupHeader(
                host,
                'kap-cal-usubgroup',
                sub.label,
                sub.cards.length,
                sub.collapsed,
                () => callbacks.onTogglePanelGroup(sub.key)
            )
            // Pane-group DnD contract: a panel chip dropped on another status
            // group (header or chip) of the SAME type sets that status.
            subHeader.dataset['paneDropType'] = sub.typeId
            subHeader.dataset['paneDropStatus'] = sub.status
            if (sub.collapsed) continue
            for (const card of sub.cards) {
                const chip = renderChip(
                    host,
                    { card, kind: model.activeTab, overdue: false },
                    callbacks
                )
                chip.dataset['paneDropType'] = sub.typeId
                chip.dataset['paneDropStatus'] = sub.status
            }
        }
    }
}

/**
 * A full-width collapsible group header: chevron + label + count badge.
 * Shared with the WBS pane (same `kap-cal-ugroup*` chrome, custom `cls`).
 */
export function renderGroupHeader(
    parent: HTMLElement,
    cls: string,
    label: string,
    count: number,
    collapsed: boolean,
    onToggle: () => void
): HTMLElement {
    const header = parent.createEl('button', {
        cls: collapsed ? cls : `${cls} ${cls}-open`,
        attr: { 'type': 'button', 'aria-expanded': String(!collapsed) }
    })
    header.createSpan({ cls: 'kap-cal-ugroup-chevron', text: collapsed ? '▸' : '▾' })
    header.createSpan({ cls: 'kap-cal-ugroup-label', text: label })
    header.createSpan({ cls: 'kap-cal-ugroup-count', text: String(count) })
    header.addEventListener('click', onToggle)
    return header
}

function addTab(
    tabsEl: HTMLElement,
    label: string,
    count: number,
    active: boolean,
    onClick: () => void
): void {
    const tab = tabsEl.createEl('button', { cls: 'kap-panel-tab' })
    if (active) tab.addClass('kap-panel-tab-active')
    tab.createSpan({ cls: 'kap-panel-tab-label', text: label })
    tab.createSpan({ cls: 'kap-panel-tab-count', text: String(count) })
    tab.addEventListener('click', onClick)
}

/**
 * The legend doubles as a filter: each swatch toggles whether that dimension's
 * chips show on the grid. Both on by default — the whole point is seeing planned
 * work and deadlines together.
 */
function renderLegend(
    parent: HTMLElement,
    model: CalendarViewModel,
    callbacks: CalendarCallbacks
): void {
    const legend = parent.createDiv({ cls: 'kap-cal-legend' })
    addLegendItem(legend, 'Scheduled', 'scheduled', model.showScheduled, () =>
        callbacks.onToggleDimension('scheduled')
    )
    addLegendItem(legend, 'Deadlines', 'deadline', model.showDeadlines, () =>
        callbacks.onToggleDimension('deadline')
    )
    for (const item of model.contextLegend) {
        addContextLegendItem(legend, item, () => callbacks.onToggleContext(item.value))
    }
}

/** One context legend chip: colored swatch + label, click toggles the context filter. */
export function addContextLegendItem(
    parent: HTMLElement,
    item: ContextLegendItem,
    onClick: () => void
): void {
    const el = parent.createDiv({
        cls: 'kap-cal-legend-item kap-cal-legend-context',
        attr: {
            'role': 'button',
            'tabindex': '0',
            'aria-pressed': String(item.active),
            'title': item.active ? `Stop filtering by ${item.value}` : `Filter by ${item.value}`
        }
    })
    // The swatch is always a color key; a pinned outline marks an active filter.
    if (item.active) el.addClass('kap-cal-legend-pinned')
    const swatch = el.createSpan({ cls: 'kap-cal-legend-swatch' })
    swatch.style.setProperty('--kap-ctx-color', contextColor(item.value))
    el.createSpan({ cls: 'kap-cal-legend-label', text: item.value })
    el.addEventListener('click', onClick)
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
        }
    })
}

function addLegendItem(
    parent: HTMLElement,
    label: string,
    dim: DateDimension,
    active: boolean,
    onClick: () => void
): void {
    const item = parent.createDiv({
        cls: `kap-cal-legend-item kap-cal-legend-${dim}`,
        attr: {
            'role': 'button',
            'tabindex': '0',
            'aria-pressed': String(active),
            'title': `Toggle ${label}`
        }
    })
    if (!active) item.addClass('kap-cal-legend-off')
    item.createSpan({ cls: 'kap-cal-legend-swatch' })
    item.createSpan({ cls: 'kap-cal-legend-label', text: label })
    item.addEventListener('click', onClick)
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
        }
    })
}

function renderCalendarGrid(
    root: HTMLElement,
    model: CalendarViewModel,
    callbacks: CalendarCallbacks
): void {
    const cal = root.createDiv({ cls: 'kap-calendar' })

    if (model.focusedDay !== null) {
        renderFocusedDay(cal, model, callbacks)
        return
    }

    const toolbar = cal.createDiv({ cls: 'kap-calendar-toolbar' })
    const nav = toolbar.createDiv({ cls: 'kap-calendar-nav' })
    navButton(nav, '‹', 'Previous', () => callbacks.onShiftAnchor(-1))
    navButton(nav, 'Today', 'Jump to today', () => callbacks.onToday())
    navButton(nav, '›', 'Next', () => callbacks.onShiftAnchor(1))
    toolbar.createSpan({ cls: 'kap-calendar-anchor', text: model.anchorLabel })
    renderLegend(toolbar, model, callbacks)
    renderRanges(toolbar, model, callbacks)

    const blocksEl = cal.createDiv({ cls: 'kap-calendar-blocks' })
    blocksEl.addClass(`kap-calendar-${model.range}`)
    for (const block of model.blocks) renderBlock(blocksEl, block, model, callbacks)
}

/**
 * The range switcher: a first-class **Day** entry (enters the single-day view on
 * today) followed by Week · Month · Quarter · Year. "Day" is active while a day
 * is focused; the grid ranges are active otherwise.
 */
function renderRanges(
    parent: HTMLElement,
    model: CalendarViewModel,
    callbacks: CalendarCallbacks
): void {
    const ranges = parent.createDiv({ cls: 'kap-calendar-ranges' })
    const dayBtn = ranges.createEl('button', { cls: 'kap-range-btn', text: 'Day' })
    if (model.focusedDay !== null) dayBtn.addClass('kap-range-btn-active')
    dayBtn.addEventListener('click', () => callbacks.onFocusToday())
    for (const { key, label } of RANGES) {
        const btn = ranges.createEl('button', { cls: 'kap-range-btn', text: label })
        if (model.focusedDay === null && key === model.range) btn.addClass('kap-range-btn-active')
        btn.addEventListener('click', () => callbacks.onSetRange(key))
    }
}

function renderBlock(
    parent: HTMLElement,
    block: CalendarBlock,
    model: CalendarViewModel,
    callbacks: CalendarCallbacks
): void {
    const blockEl = parent.createDiv({ cls: 'kap-cal-block' })
    if (model.range !== 'week') blockEl.createDiv({ cls: 'kap-cal-block-label', text: block.label })

    const grid = blockEl.createDiv({ cls: 'kap-cal-grid' })
    const head = grid.createDiv({ cls: 'kap-cal-weekrow kap-cal-weekhead' })
    for (const wd of model.weekdays) head.createSpan({ cls: 'kap-cal-weekday', text: wd })

    const compact = model.range === 'quarter' || model.range === 'year'
    for (const week of block.weeks) {
        const row = grid.createDiv({ cls: 'kap-cal-weekrow' })
        for (const day of week) {
            const cell = row.createDiv({ cls: 'kap-cal-day' })
            cell.dataset['day'] = day.key
            if (!day.inCurrentMonth) cell.addClass('kap-cal-day-other')
            if (day.isToday) cell.addClass('kap-cal-day-today')
            const num = cell.createSpan({
                cls: 'kap-cal-daynum',
                text: String(day.date.getDate()),
                attr: { 'aria-label': 'Zoom into day', 'title': 'Zoom into day' }
            })
            num.addEventListener('click', (e) => {
                e.stopPropagation()
                callbacks.onFocusDay(day.key)
            })
            // Clicking empty cell space (not a card chip) also zooms into the day.
            cell.addEventListener('click', (e) => {
                if (!(e.target as HTMLElement).closest('.kap-cal-card')) {
                    callbacks.onFocusDay(day.key)
                }
            })
            const entries = model.cardsByDay.get(day.key) ?? []
            if (compact) {
                if (entries.length > 0) {
                    cell.createSpan({ cls: 'kap-cal-daycount', text: String(entries.length) })
                }
            } else {
                for (const entry of entries) renderChip(cell, entry, callbacks)
            }
        }
    }
}

/**
 * The zoomed-in single-day view: a header (back + day nav) and a full-width list
 * of the focused day's cards. The list keeps the `.kap-cal-day` + `data-day`
 * contract so the calendar DnD still works — drag a card from the panel here to
 * schedule it for this day, or drag one out to the panel to clear it.
 */
function renderFocusedDay(
    cal: HTMLElement,
    model: CalendarViewModel,
    callbacks: CalendarCallbacks
): void {
    const focus = cal.createDiv({ cls: 'kap-cal-focus' })

    const header = focus.createDiv({ cls: 'kap-cal-focus-header' })
    const back = header.createEl('button', {
        cls: 'kap-calendar-navbtn kap-cal-focus-back',
        text: '‹ Back',
        attr: { 'aria-label': 'Back to calendar' }
    })
    back.addEventListener('click', () => callbacks.onClearFocus())
    const nav = header.createDiv({ cls: 'kap-calendar-nav' })
    navButton(nav, '‹', 'Previous day', () => callbacks.onFocusShift(-1))
    navButton(nav, 'Today', 'Jump to today', () => callbacks.onFocusToday())
    navButton(nav, '›', 'Next day', () => callbacks.onFocusShift(1))
    header.createSpan({ cls: 'kap-calendar-anchor', text: model.focusedDayLabel })
    renderRanges(header, model, callbacks)

    const dayEl = focus.createDiv({ cls: 'kap-cal-day kap-cal-focus-day' })
    dayEl.dataset['day'] = model.focusedDay ?? ''
    dayEl.setAttribute('role', 'list')
    const entries = model.cardsByDay.get(model.focusedDay ?? '') ?? []
    if (entries.length === 0) {
        dayEl.createDiv({ cls: 'kap-panel-empty', text: 'Nothing on this day.' })
    }
    for (const entry of entries) renderChip(dayEl, entry, callbacks)
}

function renderChip(
    parent: HTMLElement,
    entry: CalendarEntry,
    callbacks: CalendarCallbacks
): HTMLElement {
    const { card, kind, overdue } = entry
    const chip = parent.createDiv({ cls: 'kap-cal-card' })
    // Color-code by placement: scheduled = blue (default), deadline = orange,
    // both-same-day = split edge, span continuation = dimmed; an overdue
    // deadline goes red.
    if (kind === 'deadline') chip.addClass('kap-cal-card-deadline')
    else if (kind === 'both') chip.addClass('kap-cal-card-both')
    else if (kind === 'span') chip.addClass('kap-cal-card-span')
    if (overdue) chip.addClass('kap-cal-card-overdue')
    // Span continuations carry NO cardKey/dimension: the DnD controller then
    // ignores them (dragging a middle day is ambiguous — move the start chip).
    if (kind !== 'span') {
        chip.dataset['cardKey'] = card.key
        // Which date a drag of THIS chip moves (the DnD controller reads it).
        chip.dataset['dimension'] = kind
    }
    chip.setAttribute('role', 'listitem')
    chip.setAttribute('tabindex', '0')
    // Full title on hover — chips can clamp/truncate, so keep the text reachable.
    chip.setAttribute(
        'title',
        entry.spanLabel ? `${card.display.title} — ${entry.spanLabel}` : card.display.title
    )
    // Context color dot (first context wins; deterministic per value).
    const context = card.contexts[0]
    if (context !== undefined) {
        const dot = chip.createSpan({ cls: 'kap-cal-card-ctx' })
        dot.style.setProperty('--kap-ctx-color', contextColor(context))
        dot.setAttribute('title', card.contexts.join(', '))
    }
    chip.createSpan({ cls: 'kap-cal-card-title', text: card.display.title })
    chip.addEventListener('click', (e) => callbacks.onOpen(card, e.ctrlKey || e.metaKey))
    chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            callbacks.onOpen(card, e.ctrlKey || e.metaKey)
        }
    })
    chip.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onContextMenu(card, e)
    })
    return chip
}

function navButton(parent: HTMLElement, text: string, label: string, onClick: () => void): void {
    const btn = parent.createEl('button', {
        cls: 'kap-calendar-navbtn',
        text,
        attr: { 'aria-label': label }
    })
    btn.addEventListener('click', onClick)
}
