import type { AgendaCardInput, AgendaEntry, AgendaModel, AgendaWindow } from '../../domain/agenda'

/**
 * Agenda mode DOM (issue #39): a flat, prioritized list of what to act on
 * now — Overdue / Today / Upcoming sections with lean rows (title + date +
 * status). Pure rendering; all state lives in the view.
 */

export interface AgendaViewState {
    window: AgendaWindow
    availableOnly: boolean
    /** Local midnight, for relative date labels. */
    today: Date
}

export interface AgendaViewCallbacks<T extends AgendaCardInput> {
    onOpen: (card: T, newTab: boolean) => void
    onContextMenu: (card: T, event: MouseEvent) => void
    onSetWindow: (window: AgendaWindow) => void
    onToggleAvailableOnly: () => void
}

const GROUP_LABELS: Record<string, string> = {
    overdue: 'Overdue',
    today: 'Today',
    upcoming: 'Upcoming'
}

/** Render the agenda into `host` (replaces its content). */
export function renderAgendaView<T extends AgendaCardInput>(
    host: HTMLElement,
    model: AgendaModel<T>,
    state: AgendaViewState,
    callbacks: AgendaViewCallbacks<T>
): void {
    host.empty()
    const root = host.createDiv({ cls: 'kap-agenda' })

    const bar = root.createDiv({ cls: 'kap-agenda-bar' })
    const windowSwitch = bar.createDiv({
        cls: 'kap-mode-switch',
        attr: { 'role': 'tablist', 'aria-label': 'Agenda window' }
    })
    addWindowButton(windowSwitch, 'Today', state.window === 'today', () =>
        callbacks.onSetWindow('today')
    )
    addWindowButton(windowSwitch, 'Week', state.window === 'week', () =>
        callbacks.onSetWindow('week')
    )
    const availBtn = bar.createEl('button', {
        cls: 'kap-agenda-available-toggle',
        text: 'Available only',
        attr: { 'type': 'button', 'aria-pressed': String(state.availableOnly) }
    })
    if (state.availableOnly) availBtn.addClass('kap-agenda-toggle-active')
    availBtn.addEventListener('click', callbacks.onToggleAvailableOnly)
    if (state.availableOnly && model.hiddenUnavailable > 0) {
        bar.createSpan({
            cls: 'kap-agenda-hidden-count',
            text: `${String(model.hiddenUnavailable)} unavailable hidden`
        })
    }

    if (model.count === 0) {
        root.createDiv({
            cls: 'kap-agenda-empty',
            text:
                state.window === 'today'
                    ? 'Nothing due or scheduled today.'
                    : 'Nothing due or scheduled in the next 7 days.'
        })
        return
    }

    for (const group of model.groups) {
        const section = root.createDiv({ cls: `kap-agenda-group kap-agenda-group-${group.id}` })
        const title = section.createDiv({ cls: 'kap-agenda-group-title' })
        title.createSpan({ text: GROUP_LABELS[group.id] ?? group.id })
        title.createSpan({
            cls: 'kap-agenda-group-count',
            text: String(group.entries.length)
        })
        const list = section.createDiv({ cls: 'kap-agenda-list', attr: { role: 'list' } })
        for (const entry of group.entries) renderRow(list, group.id, entry, state, callbacks)
    }
}

function addWindowButton(
    parent: HTMLElement,
    label: string,
    active: boolean,
    onClick: () => void
): void {
    const btn = parent.createEl('button', {
        cls: 'kap-mode-btn',
        text: label,
        attr: { 'type': 'button', 'role': 'tab', 'aria-selected': String(active) }
    })
    if (active) btn.addClass('kap-mode-btn-active')
    btn.addEventListener('click', onClick)
}

function renderRow<T extends AgendaCardInput>(
    parent: HTMLElement,
    groupId: string,
    entry: AgendaEntry<T>,
    state: AgendaViewState,
    callbacks: AgendaViewCallbacks<T>
): void {
    const row = parent.createDiv({
        cls: 'kap-agenda-row',
        attr: { role: 'listitem', tabindex: '0' }
    })
    if (!entry.card.available) row.addClass('kap-agenda-row-unavailable')
    row.createSpan({ cls: 'kap-agenda-row-title', text: entry.card.title })
    const chips = row.createDiv({ cls: 'kap-agenda-row-chips' })
    // Chips show the card's OWN dates (entry.date is just the group placer —
    // a card can be due and scheduled on different days).
    if (entry.isDue && entry.card.due) {
        chips.createSpan({
            cls: `kap-agenda-chip kap-agenda-chip-due kap-agenda-chip-${groupId}`,
            text: `due ${relativeDay(entry.card.due, state.today)}`
        })
    }
    if (entry.isScheduled && entry.card.scheduled) {
        chips.createSpan({
            cls: 'kap-agenda-chip kap-agenda-chip-scheduled',
            text: `sched ${relativeDay(entry.card.scheduled, state.today)}`
        })
    }
    row.addEventListener('click', (e) => callbacks.onOpen(entry.card, e.ctrlKey || e.metaKey))
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            callbacks.onOpen(entry.card, e.ctrlKey || e.metaKey)
        }
    })
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onContextMenu(entry.card, e)
    })
}

/** Compact relative date: `today`, `3d ago`, `in 2d`, else a short local date. */
export function relativeDay(date: Date, today: Date): string {
    const DAY = 86_400_000
    const diff = Math.round((date.getTime() - today.getTime()) / DAY)
    if (diff === 0) return 'today'
    if (diff === 1) return 'tomorrow'
    if (diff === -1) return 'yesterday'
    if (diff < 0) return `${String(-diff)}d ago`
    if (diff <= 14) return `in ${String(diff)}d`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
