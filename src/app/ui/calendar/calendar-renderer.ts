import type { CalendarBlock, CalendarRange, DateDimension } from '../../domain/calendar'
import type { KanbanCard } from '../board/types'

/** Everything the calendar view needs to render one frame. */
export interface CalendarViewModel {
    range: CalendarRange
    activeTab: DateDimension
    anchorLabel: string
    blocks: CalendarBlock[]
    /** Cards missing the active dimension's date (shown in the panel list). */
    panelCards: KanbanCard[]
    /** Cards that have the active dimension's date, bucketed by `YYYY-MM-DD`. */
    cardsByDay: Map<string, KanbanCard[]>
    panelCollapsed: boolean
    counts: { unplanned: number; noDeadline: number }
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
    onSetRange: (range: CalendarRange) => void
    onShiftAnchor: (direction: number) => void
    onToday: () => void
    onTogglePanel: () => void
    /** Zoom into a single day (`YYYY-MM-DD`). */
    onFocusDay: (dayKey: string) => void
    /** Leave the focused day, back to the grid. */
    onClearFocus: () => void
    /** Move the focused day by ±1. */
    onFocusShift: (direction: number) => void
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
    if (model.panelCards.length === 0) {
        list.createDiv({
            cls: 'kap-panel-empty',
            text:
                model.activeTab === 'scheduled'
                    ? 'Every card has a scheduled date.'
                    : 'Every card has a deadline.'
        })
    }
    for (const card of model.panelCards) renderChip(list, card, callbacks)
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

    const ranges = toolbar.createDiv({ cls: 'kap-calendar-ranges' })
    for (const { key, label } of RANGES) {
        const btn = ranges.createEl('button', { cls: 'kap-range-btn', text: label })
        if (key === model.range) btn.addClass('kap-range-btn-active')
        btn.addEventListener('click', () => callbacks.onSetRange(key))
    }

    const blocksEl = cal.createDiv({ cls: 'kap-calendar-blocks' })
    blocksEl.addClass(`kap-calendar-${model.range}`)
    for (const block of model.blocks) renderBlock(blocksEl, block, model, callbacks)
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
            const cards = model.cardsByDay.get(day.key) ?? []
            if (compact) {
                if (cards.length > 0) {
                    cell.createSpan({ cls: 'kap-cal-daycount', text: String(cards.length) })
                }
            } else {
                for (const card of cards) renderChip(cell, card, callbacks)
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
    navButton(nav, '›', 'Next day', () => callbacks.onFocusShift(1))
    header.createSpan({ cls: 'kap-calendar-anchor', text: model.focusedDayLabel })

    const dayEl = focus.createDiv({ cls: 'kap-cal-day kap-cal-focus-day' })
    dayEl.dataset['day'] = model.focusedDay ?? ''
    dayEl.setAttribute('role', 'list')
    const cards = model.cardsByDay.get(model.focusedDay ?? '') ?? []
    if (cards.length === 0) {
        dayEl.createDiv({ cls: 'kap-panel-empty', text: 'Nothing scheduled for this day.' })
    }
    for (const card of cards) renderChip(dayEl, card, callbacks)
}

function renderChip(parent: HTMLElement, card: KanbanCard, callbacks: CalendarCallbacks): void {
    const chip = parent.createDiv({ cls: 'kap-cal-card' })
    chip.dataset['cardKey'] = card.key
    chip.setAttribute('role', 'listitem')
    chip.setAttribute('tabindex', '0')
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
}

function navButton(parent: HTMLElement, text: string, label: string, onClick: () => void): void {
    const btn = parent.createEl('button', {
        cls: 'kap-calendar-navbtn',
        text,
        attr: { 'aria-label': label }
    })
    btn.addEventListener('click', onClick)
}
