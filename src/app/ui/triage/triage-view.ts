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
    /** Open the "Configure triage" modal. */
    onConfigure(): void
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
    /** The active scope — passed explicitly so the header highlights the right
     * tab even in the empty "all clear" state, where `data` is null (issue #66). */
    activeScope: TriageScope,
    callbacks: TriageCallbacks
): void {
    // Preserve the body's vertical scroll across the full teardown below. A write
    // re-renders the whole view (the snapshot is rebuilt, not patched), so without
    // this the body jumps back to the top after every value selection.
    const prevScroll = container.querySelector<HTMLElement>('.kap-triage-body')?.scrollTop ?? 0

    container.empty()
    // The triage view fills the host and owns its own scroll: a fixed header above
    // a scrollable body, so nothing gets clipped however tall the card grows or how
    // far the UI is zoomed (#65). The Skip/Next actions live in a sticky side
    // column (see renderActions), not a full-width footer.
    const root = container.createDiv({ cls: 'kap-triage' })
    renderHeader(root, data, activeScope, callbacks)

    const body = root.createDiv({ cls: 'kap-triage-body' })

    if (!data) {
        const empty = body.createDiv({ cls: 'kap-triage-empty' })
        setIcon(empty.createDiv({ cls: 'kap-triage-empty-icon' }), 'check-check')
        empty.createDiv({ cls: 'kap-triage-empty-title', text: 'All clear' })
        empty.createDiv({
            cls: 'kap-triage-empty-text',
            text: 'Nothing to triage in this scope. Switch scope above, or exit triage.'
        })
        return
    }

    // Card on the left, the Skip/Next actions in a sticky column to its right —
    // so the actions stay beside the card (no wasted full-width footer) and stay
    // put while you scroll a tall card (#65). Wraps below on narrow widths.
    const layout = body.createDiv({ cls: 'kap-triage-layout' })
    const card = layout.createDiv({ cls: 'kap-triage-card' })

    const titleRow = card.createDiv({ cls: 'kap-triage-title-row' })
    titleRow.createEl('h2', { cls: 'kap-triage-title', text: data.title })
    const open = titleRow.createEl('button', {
        cls: 'kap-triage-open',
        attr: { 'aria-label': 'Open note', 'title': 'Open note' }
    })
    setIcon(open.createSpan({ cls: 'kap-triage-open-icon' }), 'square-arrow-out-up-right')
    open.createSpan({ text: 'Open' })
    open.addEventListener('click', () => callbacks.onOpen())

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

    renderActions(layout, data, callbacks)

    // Restore the scroll the predecessor body had — done last, once the body has
    // content (an empty body has no scroll range, so it would clamp to 0).
    if (prevScroll > 0) body.scrollTop = prevScroll
}

function renderHeader(
    root: HTMLElement,
    data: TriageCardData | null,
    scope: TriageScope,
    callbacks: TriageCallbacks
): void {
    const header = root.createDiv({ cls: 'kap-triage-header' })
    const main = header.createDiv({ cls: 'kap-triage-header-main' })

    const count = main.createDiv({ cls: 'kap-triage-count' })
    if (data) {
        count.createSpan({ cls: 'kap-triage-count-pos', text: String(data.position) })
        count.createSpan({ cls: 'kap-triage-count-sep', text: ' / ' })
        count.createSpan({ text: String(data.total) })
    } else {
        count.setText('All clear')
    }

    const switcher = main.createDiv({ cls: 'kap-triage-scope', attr: { role: 'tablist' } })
    addScopeButton(switcher, 'Needs clarification', scope === 'clarify', () =>
        callbacks.onScopeChange('clarify')
    )
    addScopeButton(switcher, 'All cards', scope === 'all', () => callbacks.onScopeChange('all'))
    addScopeButton(switcher, 'Due for review', scope === 'review', () =>
        callbacks.onScopeChange('review')
    )

    const configure = main.createEl('button', {
        cls: 'kap-triage-icon-btn',
        attr: { 'aria-label': 'Configure triage', 'title': 'Configure triage' }
    })
    setIcon(configure, 'settings')
    configure.addEventListener('click', () => callbacks.onConfigure())

    const exit = main.createEl('button', {
        cls: 'kap-triage-icon-btn',
        attr: { 'aria-label': 'Exit triage', 'title': 'Exit triage' }
    })
    setIcon(exit, 'x')
    exit.addEventListener('click', () => callbacks.onExit())

    // A thin progress bar shows how far through the queue you are (#65).
    const pct = data && data.total > 0 ? Math.round((data.position / data.total) * 100) : 0
    const bar = header.createDiv({ cls: 'kap-triage-progress' })
    bar.createDiv({ cls: 'kap-triage-progress-fill' }).style.width = `${String(pct)}%`
}

function renderEditableProp(
    parent: HTMLElement,
    prop: TriageEditableProp,
    callbacks: TriageCallbacks
): void {
    const row = parent.createDiv({ cls: 'kap-triage-prop' })
    // A property is "handled" when it has a value that no longer needs triage.
    const handled = prop.current !== null && !prop.needsTriage
    if (prop.needsTriage) row.addClass('kap-triage-prop-unset')
    if (handled) row.addClass('kap-triage-prop-done')
    const label = row.createDiv({ cls: 'kap-triage-prop-label' })
    // A leading check marks a handled property at a glance (issue #66).
    if (handled) setIcon(label.createSpan({ cls: 'kap-triage-prop-check' }), 'check')
    label.createSpan({ text: prop.displayName })
    if (prop.needsTriage) label.createSpan({ cls: 'kap-triage-prop-flag', text: ' • needs value' })

    const options = row.createDiv({ cls: 'kap-triage-options' })
    for (const value of prop.values) {
        const active = prop.current === value
        const btn = options.createEl('button', {
            cls: active ? 'kap-triage-option kap-triage-option-active' : 'kap-triage-option',
            attr: { 'aria-pressed': String(active) }
        })
        // The selected value gets accent fill; a check is added only when it's a
        // real, handled value (not a still-needs-triage selection like TBD).
        if (active && handled) setIcon(btn.createSpan({ cls: 'kap-triage-option-check' }), 'check')
        btn.createSpan({ text: value })
        btn.addEventListener('click', () => callbacks.onSetProperty(prop.name, value))
    }
    if (prop.current !== null) {
        const clear = options.createEl('button', { cls: 'kap-triage-option-clear', text: 'Clear' })
        clear.addEventListener('click', () => callbacks.onSetProperty(prop.name, null))
    }
}

/** Build a labelled action button with a leading icon. */
function actionButton(parent: HTMLElement, cls: string, icon: string, label: string): HTMLElement {
    const btn = parent.createEl('button', { cls })
    setIcon(btn.createSpan({ cls: 'kap-triage-action-icon' }), icon)
    btn.createSpan({ text: label })
    return btn
}

function renderActions(
    layout: HTMLElement,
    data: TriageCardData,
    callbacks: TriageCallbacks
): void {
    const actions = layout.createDiv({ cls: 'kap-triage-actions' })
    // Primary action on top: advance to the next card (review scope stamps first).
    if (data.scope === 'review') {
        actionButton(actions, 'kap-triage-next', 'check', 'Reviewed').addEventListener(
            'click',
            () => callbacks.onMarkReviewed()
        )
    } else {
        actionButton(actions, 'kap-triage-next', 'arrow-right', 'Next').addEventListener(
            'click',
            () => callbacks.onNext()
        )
    }
    actionButton(actions, 'kap-triage-skip', 'chevrons-right', 'Skip').addEventListener(
        'click',
        () => callbacks.onSkip()
    )
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
