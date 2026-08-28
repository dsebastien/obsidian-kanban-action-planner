import { setIcon } from 'obsidian'
import { classifySwipe } from '../../views/kanban/triage'
import type { CardFieldView } from './types'

/**
 * Column triage (issue #170): a one-card pass over a single board column.
 * Swipe / arrow **right** moves the card to the next status column, **left**
 * to the previous one — carousel, so the ends wrap. Pure DOM from the passed
 * data; the host view owns the queue, the carousel resolution (the card's
 * OWN type's column vocabulary), and every write.
 */

/** Drag distance (px) that turns a card drag into a swipe. */
const SWIPE_THRESHOLD = 110

/** Everything needed to render the current column-triage card. */
export interface ColumnTriageData {
    /** The column being triaged (the pass's source). */
    columnLabel: string
    title: string
    /** Read-only property fields, straight from the card display. */
    fields: CardFieldView[]
    /** Target labels for the carousel moves (null = no move possible). */
    previousLabel: string | null
    nextLabel: string | null
    /** 1-based position in the pass. */
    position: number
    total: number
}

export interface ColumnTriageCallbacks {
    onExit(): void
    onOpen(newTab: boolean): void
    /** Move the card one status to the left/right (carousel) and advance. */
    onMove(direction: -1 | 1): void
    /** Keep the card where it is and advance. */
    onSkip(): void
    /** Open the full card menu (right-click). */
    onMenu(event: MouseEvent): void
}

/** Remove the column-triage overlay from `host`. */
export function removeColumnTriageView(host: HTMLElement): void {
    host.querySelector(':scope > .kap-coltriage')?.remove()
    // The focus overlay (issue #160) shares the host class — keep it while
    // a focus overlay is still mounted.
    if (!host.querySelector(':scope > .kap-focus')) host.removeClass('kap-focus-open')
}

/**
 * Render (or fully re-render) the column-triage overlay inside `host`.
 * Keyboard: ← / → move (carousel), ↓ or Space skip, Esc exits, O opens.
 */
export function renderColumnTriageView(
    host: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks
): void {
    host.querySelector(':scope > .kap-coltriage')?.remove()
    host.addClass('kap-focus-open')
    const root = host.createDiv({ cls: 'kap-focus kap-coltriage', attr: { tabindex: '-1' } })

    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault()
            callbacks.onExit()
        } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            if (data.nextLabel !== null) callbacks.onMove(1)
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            if (data.previousLabel !== null) callbacks.onMove(-1)
        } else if (e.key === 'ArrowDown' || e.key === ' ') {
            e.preventDefault()
            callbacks.onSkip()
        } else if (e.key === 'o' || e.key === 'O') {
            callbacks.onOpen(e.ctrlKey || e.metaKey)
        }
    })
    root.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onMenu(e)
    })

    const header = root.createDiv({ cls: 'kap-focus-header' })
    header.createSpan({
        cls: 'kap-focus-count',
        text: `${String(data.position)} / ${String(data.total)}`
    })
    header.createSpan({
        cls: 'kap-focus-mode-label',
        text: `Column triage — ${data.columnLabel}`
    })
    const exit = header.createEl('button', {
        cls: 'kap-triage-icon-btn',
        attr: { 'aria-label': 'Exit column triage (Esc)', 'title': 'Exit column triage (Esc)' }
    })
    setIcon(exit, 'x')
    exit.addEventListener('click', () => callbacks.onExit())

    const body = root.createDiv({ cls: 'kap-coltriage-body' })

    // Left move target.
    const leftBtn = renderMoveButton(body, -1, data.previousLabel, 'arrow-left', callbacks)

    const card = body.createDiv({ cls: 'kap-focus-card kap-coltriage-card' })
    const titleRow = card.createDiv({ cls: 'kap-focus-title-row' })
    titleRow.createEl('h2', { cls: 'kap-focus-title', text: data.title })
    const open = titleRow.createEl('button', {
        cls: 'kap-triage-open',
        attr: { 'aria-label': 'Open note (O)', 'title': 'Open note (O)' }
    })
    setIcon(open.createSpan({ cls: 'kap-triage-open-icon' }), 'square-arrow-out-up-right')
    open.createSpan({ text: 'Open' })
    open.addEventListener('click', (e) => callbacks.onOpen(e.ctrlKey || e.metaKey))
    if (data.fields.length > 0) {
        const ctx = card.createDiv({ cls: 'kap-triage-context' })
        for (const field of data.fields) {
            const chip = ctx.createDiv({ cls: 'kap-triage-context-field' })
            if (field.label) {
                chip.createSpan({ cls: 'kap-triage-context-label', text: `${field.label}: ` })
            }
            chip.createSpan({ cls: 'kap-triage-context-value', text: field.text })
        }
    }
    const skip = card.createEl('button', {
        cls: 'kap-triage-skip kap-coltriage-skip',
        attr: { title: 'Keep here and advance (↓ or Space)' }
    })
    setIcon(skip.createSpan({ cls: 'kap-triage-action-icon' }), 'chevrons-down')
    skip.createSpan({ text: 'Keep' })
    skip.addEventListener('click', () => callbacks.onSkip())
    card.createDiv({
        cls: 'kap-focus-hints',
        text: '← / → move · ↓ keep · Esc exit · O open · or drag the card'
    })

    // Right move target.
    const rightBtn = renderMoveButton(body, 1, data.nextLabel, 'arrow-right', callbacks)
    attachSwipe(card, data, callbacks, { left: leftBtn, right: rightBtn, keep: skip })

    root.focus({ preventScroll: true })
}

/** One side's move-target button, labelled with the destination column. */
function renderMoveButton(
    parent: HTMLElement,
    direction: -1 | 1,
    label: string | null,
    icon: string,
    callbacks: ColumnTriageCallbacks
): HTMLElement {
    const btn = parent.createEl('button', {
        cls: 'kap-coltriage-move',
        attr: {
            title:
                label === null
                    ? 'No other status column'
                    : `Move to ${label} (${direction === -1 ? '←' : '→'})`
        }
    })
    if (label === null) btn.disabled = true
    if (direction === 1) setIcon(btn.createSpan({ cls: 'kap-triage-action-icon' }), icon)
    btn.createSpan({ cls: 'kap-coltriage-move-label', text: label ?? '–' })
    if (direction === -1) setIcon(btn.createSpan({ cls: 'kap-triage-action-icon' }), icon)
    btn.addEventListener('click', () => callbacks.onMove(direction))
    return btn
}

/** Tinder-style drag on the column-triage card (the #122 gesture). */
function attachSwipe(
    card: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks,
    /** The drop targets, ARMED (highlighted) while a drag points at them. */
    targets: { left: HTMLElement; right: HTMLElement; keep: HTMLElement }
): void {
    let startX = 0
    let startY = 0
    let pointerId = -1
    let dragging = false
    const arm = (direction: 'left' | 'right' | 'down' | null): void => {
        targets.left.toggleClass('kap-coltriage-armed', direction === 'left')
        targets.right.toggleClass('kap-coltriage-armed', direction === 'right')
        targets.keep.toggleClass('kap-coltriage-armed', direction === 'down')
    }
    const reset = (): void => {
        dragging = false
        card.removeClass('kap-triage-card-dragging')
        arm(null)
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
        const preview = classifySwipe(dx, dy, 40)
        arm(
            preview === 'left' && data.previousLabel !== null
                ? 'left'
                : preview === 'right' && data.nextLabel !== null
                  ? 'right'
                  : preview === 'down'
                    ? 'down'
                    : null
        )
    })
    card.addEventListener('pointerup', (e) => {
        if (!dragging || e.pointerId !== pointerId) return
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        reset()
        const direction = classifySwipe(dx, dy, SWIPE_THRESHOLD)
        if (direction === 'right' && data.nextLabel !== null) callbacks.onMove(1)
        else if (direction === 'left' && data.previousLabel !== null) callbacks.onMove(-1)
        else if (direction === 'down') callbacks.onSkip()
    })
    card.addEventListener('pointercancel', (e) => {
        if (e.pointerId === pointerId) reset()
    })
}
