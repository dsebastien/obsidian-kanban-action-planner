import { setIcon } from 'obsidian'
import type { TriageScope } from '../../views/kanban/triage'

/** One read-only context field shown above the editable controls. */
export interface TriageContextField {
    label: string
    text: string
    /** 0–100 when the field is a percentage (rendered as a bar), else null. */
    progress: number | null
}

/** One editable enum property the triage card offers. */
export interface TriageEditableProp {
    name: string
    displayName: string
    values: string[]
    current: string | null
    /** Whether the current value still counts as unset (needs triage). */
    needsTriage: boolean
}

/** Everything needed to render the current triage card. */
export interface TriageCardData {
    title: string
    context: TriageContextField[]
    editable: TriageEditableProp[]
    /** 1-based position of this card in the queue. */
    position: number
    total: number
    scope: TriageScope
}

export interface TriageCallbacks {
    onSetProperty(name: string, value: string | null): void
    onNext(): void
    onSkip(): void
    /** Stamp the review fields and advance (review scope only, issue #57). */
    onMarkReviewed(): void
    onOpen(): void
    onExit(): void
    onRefresh(): void
    onScopeChange(scope: TriageScope): void
}

/**
 * Render the triage queue UI (issue #53) into `container`. `data` is the current
 * card, or `null` for the "all clear" empty state. Pure DOM from the passed data
 * — the caller assembles it and handles the callbacks (writes, navigation).
 */
export function renderTriageView(
    container: HTMLElement,
    data: TriageCardData | null,
    callbacks: TriageCallbacks
): void {
    container.empty()
    const root = container.createDiv({ cls: 'kap-triage' })
    renderHeader(root, data, callbacks)

    if (!data) {
        const empty = root.createDiv({ cls: 'kap-triage-empty' })
        setIcon(empty.createDiv({ cls: 'kap-triage-empty-icon' }), 'check-check')
        empty.createDiv({
            cls: 'kap-triage-empty-text',
            text: 'Nothing to triage in this scope. Switch scope (clarify / all cards / due for review), or exit.'
        })
        return
    }

    const card = root.createDiv({ cls: 'kap-triage-card' })

    const titleRow = card.createDiv({ cls: 'kap-triage-title-row' })
    const title = titleRow.createEl('button', { cls: 'kap-triage-title', text: data.title })
    title.addEventListener('click', () => callbacks.onOpen())

    if (data.context.length > 0) {
        const ctx = card.createDiv({ cls: 'kap-triage-context' })
        for (const field of data.context) {
            const chip = ctx.createDiv({ cls: 'kap-triage-context-field' })
            chip.createSpan({ cls: 'kap-triage-context-label', text: `${field.label}: ` })
            if (field.progress !== null) {
                const bar = chip.createDiv({ cls: 'kap-card-progress' })
                bar.createDiv({ cls: 'kap-card-progress-fill' }).style.width = `${field.progress}%`
            }
            chip.createSpan({ cls: 'kap-triage-context-value', text: field.text })
        }
    }

    const edit = card.createDiv({ cls: 'kap-triage-edit' })
    for (const prop of data.editable) {
        renderEditableProp(edit, prop, callbacks)
    }

    renderFooter(root, data, callbacks)
}

function renderHeader(
    root: HTMLElement,
    data: TriageCardData | null,
    callbacks: TriageCallbacks
): void {
    const header = root.createDiv({ cls: 'kap-triage-header' })
    const count = header.createDiv({ cls: 'kap-triage-count' })
    count.setText(data ? `${String(data.position)} of ${String(data.total)}` : 'All clear')

    const scope = data?.scope ?? 'clarify'
    const switcher = header.createDiv({ cls: 'kap-triage-scope', attr: { role: 'tablist' } })
    addScopeButton(switcher, 'Needs clarification', scope === 'clarify', () =>
        callbacks.onScopeChange('clarify')
    )
    addScopeButton(switcher, 'All cards', scope === 'all', () => callbacks.onScopeChange('all'))
    addScopeButton(switcher, 'Due for review', scope === 'review', () =>
        callbacks.onScopeChange('review')
    )

    const exit = header.createEl('button', {
        cls: 'kap-triage-exit',
        attr: { 'aria-label': 'Exit triage', 'title': 'Exit triage' }
    })
    setIcon(exit, 'x')
    exit.addEventListener('click', () => callbacks.onExit())
}

function renderEditableProp(
    parent: HTMLElement,
    prop: TriageEditableProp,
    callbacks: TriageCallbacks
): void {
    const row = parent.createDiv({ cls: 'kap-triage-prop' })
    if (prop.needsTriage) row.addClass('kap-triage-prop-unset')
    const label = row.createDiv({ cls: 'kap-triage-prop-label' })
    label.setText(prop.displayName)
    if (prop.needsTriage) label.createSpan({ cls: 'kap-triage-prop-flag', text: ' • needs value' })

    const options = row.createDiv({ cls: 'kap-triage-options' })
    for (const value of prop.values) {
        const active = prop.current === value
        const btn = options.createEl('button', {
            cls: active ? 'kap-triage-option kap-triage-option-active' : 'kap-triage-option',
            text: value,
            attr: { 'aria-pressed': String(active) }
        })
        btn.addEventListener('click', () => callbacks.onSetProperty(prop.name, value))
    }
    if (prop.current !== null) {
        const clear = options.createEl('button', { cls: 'kap-triage-option-clear', text: 'Clear' })
        clear.addEventListener('click', () => callbacks.onSetProperty(prop.name, null))
    }
}

function renderFooter(root: HTMLElement, data: TriageCardData, callbacks: TriageCallbacks): void {
    const footer = root.createDiv({ cls: 'kap-triage-footer' })
    const skip = footer.createEl('button', { cls: 'kap-triage-skip', text: 'Skip' })
    skip.addEventListener('click', () => callbacks.onSkip())
    if (data.scope === 'review') {
        const reviewed = footer.createEl('button', {
            cls: 'kap-triage-next',
            text: 'Reviewed'
        })
        reviewed.addEventListener('click', () => callbacks.onMarkReviewed())
    } else {
        const next = footer.createEl('button', { cls: 'kap-triage-next', text: 'Next' })
        next.addEventListener('click', () => callbacks.onNext())
    }
}

function addScopeButton(
    parent: HTMLElement,
    label: string,
    active: boolean,
    onClick: () => void
): void {
    const btn = parent.createEl('button', {
        cls: active ? 'kap-triage-scope-btn kap-triage-scope-btn-active' : 'kap-triage-scope-btn',
        text: label,
        attr: { 'type': 'button', 'role': 'tab', 'aria-selected': String(active) }
    })
    btn.addEventListener('click', onClick)
}
