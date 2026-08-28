import { setIcon } from 'obsidian'
import { classifySwipe } from '../../views/kanban/triage'
import type { TriageScope } from '../../views/kanban/triage'
import { cssEscapeAttr } from '../../utils/css-escape'

/** Drag distance (px) that turns a card drag into a swipe (issue #122). */
const SWIPE_THRESHOLD = 110

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

/** One selectable card in the triage queue pane. */
export interface TriagePaneItem {
    key: string
    title: string
    /** The card currently shown on the right. */
    selected: boolean
    /** Still needs triage in the active scope (else a muted, done look). */
    needsTriage: boolean
}

/** One status subgroup of queue cards (collapse key `typeId::status`). */
export interface TriagePaneStatusGroup {
    key: string
    label: string
    collapsed: boolean
    items: TriagePaneItem[]
}

/** One note-type group of queue cards (collapse key = the type id). */
export interface TriagePaneTypeGroup {
    key: string
    label: string
    count: number
    collapsed: boolean
    groups: TriagePaneStatusGroup[]
}

/**
 * The left navigation pane: the whole triage queue grouped by note type →
 * status; clicking an item shows it on the right. Type headers render only on
 * multi-type boards; groups default expanded (it's a navigation list).
 */
export interface TriagePaneModel {
    collapsed: boolean
    grouped: boolean
    groups: TriagePaneTypeGroup[]
    total: number
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
    /** Show the queue card with this key on the right (left-pane click). */
    onSelect(key: string): void
    /** Collapse/expand the whole left queue pane. */
    onTogglePane(): void
    /** Toggle one pane group's collapse (key: `typeId` or `typeId::status`). */
    onTogglePaneGroup(key: string): void
    // Quick actions (issue #122): keyboard + swipe triage.
    /** Set the card's status to its own type's nth column (1-based). */
    onQuickStatus(index: number): void
    /** Bump the priority-like enum one step (−1 = toward the list start). */
    onBumpProperty(delta: -1 | 1): void
    /** Send the card to the top/bottom of its column (manual order). */
    onSendEdge(edge: 'top' | 'bottom'): void
}

/** Render-time options that don't belong to the card data itself. */
export interface TriageRenderOptions {
    /** Start the body at the top instead of preserving the previous scroll —
     * set when moving to a new card (Next/Skip/auto-advance), not on in-place writes. */
    scrollToTop?: boolean
    /** When `data` is null, whether the queue was finished (true → celebratory "all
     * done") versus simply empty for this scope (false → neutral "all clear"). */
    completedAll?: boolean
}

/**
 * Render the triage queue UI (issue #53) into `container`. `data` is the current
 * card, or `null` for the empty state ("all done" when `completedAll`, else "all
 * clear"). Pure DOM from the passed data — the caller assembles it and handles the
 * callbacks (writes, navigation).
 */
export function renderTriageView(
    container: HTMLElement,
    data: TriageCardData | null,
    /** The active scope — passed explicitly so the header highlights the right
     * tab even in the empty "all clear" state, where `data` is null (issue #66). */
    activeScope: TriageScope,
    /** The left navigation pane (the whole queue, grouped) — always rendered. */
    pane: TriagePaneModel,
    callbacks: TriageCallbacks,
    options: TriageRenderOptions = {}
): void {
    // Preserve the body's vertical scroll across the full teardown below. A write
    // re-renders the whole view (the snapshot is rebuilt, not patched), so without
    // this the body jumps back to the top after every value selection. On a move to
    // a new card the caller asks to reset, so the next card starts at its title.
    const prevScroll = options.scrollToTop
        ? 0
        : (container.querySelector<HTMLElement>('.kap-triage-body')?.scrollTop ?? 0)

    // Preserve keyboard focus across the full teardown (issue #105, finding
    // 4.2): interactive elements carry a stable `data-kap-focus` key; when one
    // is focused, its re-rendered counterpart is re-focused after the rebuild,
    // so a value click / Next / queue selection doesn't drop focus to <body>.
    const active = container.ownerDocument.activeElement
    const focusKey =
        active instanceof HTMLElement && container.contains(active)
            ? (active.closest<HTMLElement>('[data-kap-focus]')?.dataset['kapFocus'] ?? null)
            : null
    const restoreFocus = (): void => {
        if (!focusKey) return
        // preventScroll: the body scroll was already restored above — focusing
        // must not shift it (visual stability).
        container
            .querySelector<HTMLElement>(`[data-kap-focus="${cssEscapeAttr(focusKey)}"]`)
            ?.focus({ preventScroll: true })
    }

    container.empty()
    // The triage view fills the host and owns its own scroll: a fixed header above
    // a scrollable body, so nothing gets clipped however tall the card grows or how
    // far the UI is zoomed (#65). The Skip/Next actions live in a sticky side
    // column (see renderActions), not a full-width footer.
    const root = container.createDiv({ cls: 'kap-triage', attr: { tabindex: '-1' } })
    // Keyboard triage (issue #122): arrows advance/skip and bump priority,
    // digits quick-set the status, O opens the note. Typing surfaces (the
    // toolbar filter box) are left alone.
    root.addEventListener('keydown', (e) => handleTriageKey(e, data, callbacks))
    renderHeader(root, data, activeScope, callbacks)

    // A flex row below the header: the queue navigation pane (left) + the card
    // body (right). The pane always renders so you can jump between cards even
    // in the empty / all-done state.
    const main = root.createDiv({ cls: 'kap-triage-main' })
    renderQueuePane(main, pane, callbacks)
    const body = main.createDiv({ cls: 'kap-triage-body' })

    if (!data) {
        renderEmptyState(body, options.completedAll ?? false)
        restoreFocus()
        return
    }

    // Card on the left, the Skip/Next actions in a sticky column to its right —
    // so the actions stay beside the card (no wasted full-width footer) and stay
    // put while you scroll a tall card (#65). Wraps below on narrow widths.
    const layout = body.createDiv({ cls: 'kap-triage-layout' })
    const card = layout.createDiv({ cls: 'kap-triage-card' })
    // Tinder-style card drag (issue #122): right = next, left = skip,
    // up/down = priority bump. Below the threshold the card snaps back.
    attachCardSwipe(card, data, callbacks)

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
    restoreFocus()
    // No prior focus to restore: focus the triage root so the keyboard
    // shortcuts work immediately — but never steal from a typing surface
    // (the toolbar filter box re-renders triage on every keystroke).
    if (!focusKey) {
        const active2 = container.ownerDocument.activeElement
        const typing =
            active2 instanceof HTMLElement &&
            (active2.tagName === 'INPUT' ||
                active2.tagName === 'TEXTAREA' ||
                active2.isContentEditable)
        if (!typing) root.focus({ preventScroll: true })
    }
}

/** Keyboard triage (issue #122); ignores events from typing surfaces. */
function handleTriageKey(
    e: KeyboardEvent,
    data: TriageCardData | null,
    callbacks: TriageCallbacks
): void {
    const target = e.target
    if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
        return
    }
    if (!data) return
    if (e.key === 'ArrowRight' && !e.shiftKey) {
        e.preventDefault()
        if (data.scope === 'review') callbacks.onMarkReviewed()
        else callbacks.onNext()
        return
    }
    if (e.key === 'ArrowLeft' && !e.shiftKey) {
        e.preventDefault()
        callbacks.onSkip()
        return
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (e.shiftKey) callbacks.onSendEdge('top')
        else callbacks.onBumpProperty(-1)
        return
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (e.shiftKey) callbacks.onSendEdge('bottom')
        else callbacks.onBumpProperty(1)
        return
    }
    if (e.key === 'o' || e.key === 'O') {
        callbacks.onOpen()
        return
    }
    if (/^[1-9]$/.test(e.key)) {
        callbacks.onQuickStatus(Number(e.key))
    }
}

/**
 * Tinder-style swipe on the triage card (issue #122): drag right = next
 * (reviewed in review scope), left = skip, up/down = priority bump. The card
 * follows the pointer (dampened vertically, slight rotation); releasing below
 * the threshold snaps it back. Drags starting on a button are left alone so
 * clicks keep working.
 */
function attachCardSwipe(
    card: HTMLElement,
    data: TriageCardData,
    callbacks: TriageCallbacks
): void {
    let startX = 0
    let startY = 0
    let pointerId = -1
    let dragging = false
    const reset = (): void => {
        dragging = false
        card.removeClass('kap-triage-card-dragging')
        card.setCssProps({
            '--kap-swipe-x': '0px',
            '--kap-swipe-y': '0px',
            '--kap-swipe-rot': '0deg'
        })
    }
    card.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        if (e.target instanceof HTMLElement && e.target.closest('button, a, input')) return
        dragging = true
        pointerId = e.pointerId
        startX = e.clientX
        startY = e.clientY
        card.setPointerCapture(e.pointerId)
        card.addClass('kap-triage-card-dragging')
    })
    card.addEventListener('pointermove', (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        card.setCssProps({
            '--kap-swipe-x': `${String(dx)}px`,
            '--kap-swipe-y': `${String(dy * 0.4)}px`,
            '--kap-swipe-rot': `${String(dx * 0.04)}deg`
        })
    })
    card.addEventListener('pointerup', (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        reset()
        const direction = classifySwipe(dx, dy, SWIPE_THRESHOLD)
        if (direction === 'right') {
            if (data.scope === 'review') callbacks.onMarkReviewed()
            else callbacks.onNext()
        } else if (direction === 'left') callbacks.onSkip()
        else if (direction === 'up') callbacks.onBumpProperty(-1)
        else if (direction === 'down') callbacks.onBumpProperty(1)
    })
    card.addEventListener('pointercancel', (e) => {
        if (e.pointerId === pointerId) reset()
    })
}

/**
 * The left queue pane: a collapsible panel (reusing the calendar's scheduling-
 * panel shell) listing every card in the queue grouped by note type → status.
 * Clicking a card shows it on the right; the current card is highlighted.
 * Groups default expanded (this is the navigation list, not a drag-backlog);
 * type headers only render on multi-type boards.
 */
function renderQueuePane(
    parent: HTMLElement,
    pane: TriagePaneModel,
    callbacks: TriageCallbacks
): void {
    const panel = parent.createDiv({ cls: 'kap-scheduling-panel kap-triage-panel' })
    if (pane.collapsed) panel.addClass('kap-scheduling-panel-collapsed')

    const header = panel.createDiv({ cls: 'kap-panel-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-panel-toggle',
        text: pane.collapsed ? '»' : '«',
        attr: {
            'aria-label': pane.collapsed ? 'Expand queue' : 'Collapse queue',
            'data-kap-focus': 'pane-toggle'
        }
    })
    toggle.addEventListener('click', () => callbacks.onTogglePane())
    header.createSpan({ cls: 'kap-panel-title', text: `Queue (${String(pane.total)})` })
    if (pane.collapsed) return

    const list = panel.createDiv({ cls: 'kap-panel-list' })
    if (pane.total === 0) {
        list.createDiv({ cls: 'kap-panel-empty', text: 'Nothing in this scope.' })
        return
    }
    for (const group of pane.groups) {
        let host = list
        if (pane.grouped) {
            renderPaneHeader(
                list,
                'kap-cal-ugroup',
                group.label,
                group.count,
                group.collapsed,
                `group:${group.key}`,
                () => callbacks.onTogglePaneGroup(group.key)
            )
            if (group.collapsed) continue
            host = list.createDiv({ cls: 'kap-cal-ugroup-body' })
        }
        for (const sub of group.groups) {
            renderPaneHeader(
                host,
                'kap-cal-usubgroup',
                sub.label,
                sub.items.length,
                sub.collapsed,
                `group:${sub.key}`,
                () => callbacks.onTogglePaneGroup(sub.key)
            )
            if (sub.collapsed) continue
            for (const item of sub.items) {
                const row = host.createEl('button', {
                    cls: 'kap-triage-queue-item',
                    attr: {
                        'type': 'button',
                        'title': item.title,
                        'data-kap-focus': `queue:${item.key}`
                    }
                })
                if (item.selected) row.addClass('kap-triage-queue-item-active')
                if (!item.needsTriage) row.addClass('kap-triage-queue-item-done')
                row.createSpan({ cls: 'kap-triage-queue-item-title', text: item.title })
                row.addEventListener('click', () => callbacks.onSelect(item.key))
            }
        }
    }
}

/** A full-width collapsible pane group header: chevron + label + count badge. */
function renderPaneHeader(
    parent: HTMLElement,
    cls: string,
    label: string,
    count: number,
    collapsed: boolean,
    focusKey: string,
    onToggle: () => void
): void {
    const header = parent.createEl('button', {
        cls: collapsed ? cls : `${cls} ${cls}-open`,
        attr: {
            'type': 'button',
            'aria-expanded': String(!collapsed),
            'data-kap-focus': focusKey
        }
    })
    header.createSpan({ cls: 'kap-cal-ugroup-chevron', text: collapsed ? '▸' : '▾' })
    header.createSpan({ cls: 'kap-cal-ugroup-label', text: label })
    header.createSpan({ cls: 'kap-cal-ugroup-count', text: String(count) })
    header.addEventListener('click', onToggle)
}

/**
 * The empty state. `completedAll` ⇒ a celebratory "all done" (the user cleared the
 * whole queue); otherwise a neutral "all clear" (the scope had nothing to triage).
 */
function renderEmptyState(body: HTMLElement, completedAll: boolean): void {
    const empty = body.createDiv({ cls: 'kap-triage-empty' })
    if (completedAll) {
        setIcon(empty.createDiv({ cls: 'kap-triage-empty-icon' }), 'party-popper')
        empty.createDiv({ cls: 'kap-triage-empty-title', text: 'All done! 🎉' })
        empty.createDiv({
            cls: 'kap-triage-empty-text',
            text: 'Inbox zero, triage hero — every card in this scope is sorted. Switch scope above, or exit triage.'
        })
        return
    }
    setIcon(empty.createDiv({ cls: 'kap-triage-empty-icon' }), 'check-check')
    empty.createDiv({ cls: 'kap-triage-empty-title', text: 'All clear' })
    empty.createDiv({
        cls: 'kap-triage-empty-text',
        text: 'Nothing to triage in this scope. Switch scope above, or exit triage.'
    })
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
            attr: { 'aria-pressed': String(active), 'data-kap-focus': `opt:${prop.name}:${value}` }
        })
        // The selected value gets accent fill; a check is added only when it's a
        // real, handled value (not a still-needs-triage selection like TBD).
        if (active && handled) setIcon(btn.createSpan({ cls: 'kap-triage-option-check' }), 'check')
        btn.createSpan({ text: value })
        btn.addEventListener('click', () => callbacks.onSetProperty(prop.name, value))
    }
    if (prop.current !== null) {
        const clear = options.createEl('button', {
            cls: 'kap-triage-option-clear',
            text: 'Clear',
            attr: { 'data-kap-focus': `clear:${prop.name}` }
        })
        clear.addEventListener('click', () => callbacks.onSetProperty(prop.name, null))
    }
}

/** Build a labelled action button with a leading icon (+ focus-restore key). */
function actionButton(
    parent: HTMLElement,
    cls: string,
    icon: string,
    label: string,
    focusKey: string
): HTMLElement {
    const btn = parent.createEl('button', { cls, attr: { 'data-kap-focus': focusKey } })
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
        actionButton(
            actions,
            'kap-triage-next',
            'check',
            'Reviewed',
            'action:next'
        ).addEventListener('click', () => callbacks.onMarkReviewed())
    } else {
        actionButton(
            actions,
            'kap-triage-next',
            'arrow-right',
            'Next',
            'action:next'
        ).addEventListener('click', () => callbacks.onNext())
    }
    actionButton(
        actions,
        'kap-triage-skip',
        'chevrons-right',
        'Skip',
        'action:skip'
    ).addEventListener('click', () => callbacks.onSkip())
    // Shortcut hints (issue #122): keyboard + swipe triage discoverability.
    actions.createDiv({
        cls: 'kap-triage-hints',
        text: '→ next · ← skip · ↑↓ priority · ⇧↑/⇧↓ top/bottom · 1-9 status · O open · or drag the card'
    })
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
