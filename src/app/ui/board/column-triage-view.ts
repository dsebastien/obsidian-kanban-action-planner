import { setIcon } from 'obsidian'
import { classifySwipe } from '../../views/kanban/triage'
import { claimPointerDrag } from '../pointer-claim'
import type { CardFieldView } from './types'

/**
 * Column triage v2 (issue #170): a Tinder-style one-card pass over a single
 * board column. Layout: full-height previous/next rails at the pane edges, a
 * card STACK in the middle (only the front face transforms), and a
 * STATIONARY action tray under the stack — every status of the card's own
 * type as a chip, plus Keep. Chips, Keep, and the rails all double as
 * drag-drop targets (hit-tested with `elementsFromPoint`, excluding the
 * moving face). Pure DOM from the passed data; the host view owns the
 * queue/state machine and every write.
 */

/** Drag distance (px) that turns a card drag into a swipe. */
const SWIPE_THRESHOLD = 110

/**
 * Cross-realm element check (popouts): a popout window's elements are NOT
 * `instanceof` the main realm's `HTMLElement`, so duck-type on `closest`.
 */
function asElement(node: unknown): HTMLElement | null {
    return node && typeof (node as HTMLElement).closest === 'function'
        ? (node as HTMLElement)
        : null
}
/** Movement (px) before a pointer-down starts dragging (clicks stay clicks). */
const DRAG_START_THRESHOLD = 6
/** Fallback (ms) in case the fly-out `animationend` never fires — must
 * outlast the stamp delay plus the fly-out duration. */
const ANIMATION_TIMEOUT_MS = 800

/** One status chip in the stationary tray. */
export interface ColumnTriageChip {
    /** The target column id (the drop/click payload). */
    id: string
    label: string
    /** Resolved CSS color for the chip dot. */
    cssColor: string
    /** The card's current status (highlighted, not actionable). */
    current: boolean
    /** 1-based keyboard hint, first nine chips only; null = no hint. */
    ordinal: number | null
}

/** Everything needed to render the current column-triage state. */
export interface ColumnTriageData {
    /** The column being triaged (the pass's source). */
    columnLabel: string
    title: string
    /** Read-only property fields, straight from the card display. */
    fields: CardFieldView[]
    /** The card's own type's status columns, in column order. */
    chips: ColumnTriageChip[]
    /** Rail labels — the carousel destinations (null = no move possible). */
    previousLabel: string | null
    nextLabel: string | null
    /** "Keep in <status>" — the Keep button label. */
    keepLabel: string
    /** Up to two upcoming card titles peeking behind the face. */
    stackTitles: string[]
    /** Decisions made so far (moves + keeps). */
    done: number
    /** The pass's initial card count. */
    total: number
}

export interface ColumnTriageCallbacks {
    onExit(): void
    onOpen(newTab: boolean): void
    /** Move the card one status to the left/right (carousel). */
    onMove(direction: -1 | 1): void
    /** Move the card straight to the chip's column. */
    onChooseChip(chipId: string): void
    /** Keep the card where it is and advance. */
    onKeep(): void
    /** Open the full card menu (right-click). */
    onMenu(event: MouseEvent): void
}

/** A decision's animation: direction, stamp text, stamp tint. */
export interface ColumnTriageDecisionAnimation {
    direction: 'left' | 'right' | 'keep'
    stampLabel: string
    /** Destination column color (null = neutral Keep tint). */
    stampColor: string | null
}

/** Remove the column-triage overlay from `host`. */
export function removeColumnTriageView(host: HTMLElement): void {
    host.querySelector(':scope > .kap-coltriage')?.remove()
    // The focus overlay (issue #160) shares the host class — keep it while
    // a focus overlay is still mounted.
    if (!host.querySelector(':scope > .kap-focus')) host.removeClass('kap-focus-open')
}

/**
 * Play the decision animation on the CURRENT overlay DOM: a passport-stamp
 * slam (destination label, tinted with the destination color) followed by
 * the face flying out in the decision direction. Resolves on the named
 * fly-out `animationend` (or an owning-window timeout — idempotent), and
 * immediately under reduced motion or when no face is mounted.
 */
export function animateColumnTriageDecision(
    host: HTMLElement,
    animation: ColumnTriageDecisionAnimation
): Promise<void> {
    const face = host.querySelector<HTMLElement>('.kap-coltriage-face')
    if (!face) return Promise.resolve()
    const win = face.win
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return Promise.resolve()
    }
    const stamp = face.createDiv({ cls: 'kap-coltriage-stamp', text: animation.stampLabel })
    if (animation.stampColor) stamp.setCssProps({ '--kap-stamp-color': animation.stampColor })
    const flyClass = `kap-coltriage-out-${animation.direction}`
    const flyName = `kap-coltriage-fly-${animation.direction}`
    face.addClass(flyClass)
    return new Promise((resolve) => {
        let settled = false
        const finish = (): void => {
            if (settled) return
            settled = true
            resolve()
        }
        face.addEventListener('animationend', (e) => {
            if (e.target === face && e.animationName === flyName) finish()
        })
        win.setTimeout(finish, ANIMATION_TIMEOUT_MS)
    })
}

/**
 * Render (or fully re-render) the column-triage overlay inside `host` (the
 * view's STABLE root element — it survives board re-renders, so only the
 * host view's signature gate decides when this runs). Keyboard: `1..9` jump
 * to a chip, ← / → move (carousel), ↓ / Space keep, Esc exits, O opens.
 */
export function renderColumnTriageView(
    host: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks
): void {
    host.querySelector(':scope > .kap-coltriage')?.remove()
    host.addClass('kap-focus-open')
    const root = host.createDiv({ cls: 'kap-focus kap-coltriage', attr: { tabindex: '-1' } })

    root.addEventListener('keydown', (e) => handleKey(e, data, callbacks))
    root.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onMenu(e)
    })

    renderHeader(root, data, callbacks)

    const body = root.createDiv({ cls: 'kap-coltriage-body' })
    const leftRail = renderRail(body, -1, data.previousLabel, callbacks)

    // Center: the card stack (face + up to two peeking cards) above the
    // STATIONARY action tray (chips + Keep) — only the face ever moves.
    const center = body.createDiv({ cls: 'kap-coltriage-center' })
    const stack = center.createDiv({ cls: 'kap-coltriage-stack' })
    for (let i = data.stackTitles.length - 1; i >= 0; i--) {
        const peek = stack.createDiv({
            cls: `kap-coltriage-peek kap-coltriage-peek-${String(i + 1)}`
        })
        peek.createDiv({ cls: 'kap-coltriage-peek-title', text: data.stackTitles[i] ?? '' })
    }
    const face = stack.createDiv({ cls: 'kap-focus-card kap-coltriage-face' })
    renderFace(face, data, callbacks)
    const tray = renderTray(center, data, callbacks)

    const rightRail = renderRail(body, 1, data.nextLabel, callbacks)

    attachDrag(root, face, data, callbacks, { left: leftRail, right: rightRail, tray })

    root.focus({ preventScroll: true })
}

/** Header: source column, decisions-done counter, progress bar, exit. */
function renderHeader(
    root: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks
): void {
    const header = root.createDiv({ cls: 'kap-focus-header' })
    header.createSpan({
        cls: 'kap-focus-count',
        text: `${String(Math.min(data.done + 1, data.total))} / ${String(data.total)}`
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
    const pct = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0
    const bar = root.createDiv({ cls: 'kap-triage-progress' })
    bar.createDiv({ cls: 'kap-triage-progress-fill' }).setCssProps({
        '--kap-progress': `${String(pct)}%`
    })
}

/** The moving card face: title, open button, read-only fields, hints. */
function renderFace(
    face: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks
): void {
    const titleRow = face.createDiv({ cls: 'kap-focus-title-row' })
    titleRow.createEl('h2', { cls: 'kap-focus-title', text: data.title })
    const open = titleRow.createEl('button', {
        cls: 'kap-triage-open',
        attr: { 'aria-label': 'Open note (O)', 'title': 'Open note (O)' }
    })
    setIcon(open.createSpan({ cls: 'kap-triage-open-icon' }), 'square-arrow-out-up-right')
    open.createSpan({ text: 'Open' })
    open.addEventListener('click', (e) => callbacks.onOpen(e.ctrlKey || e.metaKey))
    if (data.fields.length > 0) {
        const ctx = face.createDiv({ cls: 'kap-triage-context' })
        for (const field of data.fields) {
            const chip = ctx.createDiv({ cls: 'kap-triage-context-field' })
            if (field.label) {
                chip.createSpan({ cls: 'kap-triage-context-label', text: `${field.label}: ` })
            }
            chip.createSpan({ cls: 'kap-triage-context-value', text: field.text })
        }
    }
    face.createDiv({
        cls: 'kap-focus-hints',
        text: '1-9 status · ← / → move · ↓ keep · Esc exit · O open · or drag the card'
    })
}

/** The stationary action tray: one chip per status + Keep. */
function renderTray(
    center: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks
): HTMLElement {
    const tray = center.createDiv({ cls: 'kap-coltriage-tray' })
    const chips = tray.createDiv({ cls: 'kap-coltriage-chips', attr: { role: 'group' } })
    for (const chip of data.chips) {
        const btn = chips.createEl('button', {
            cls: chip.current
                ? 'kap-coltriage-chip kap-coltriage-chip-current'
                : 'kap-coltriage-chip',
            attr: {
                'type': 'button',
                'title': chip.current ? `Current status: ${chip.label}` : `Move to ${chip.label}`,
                'aria-pressed': String(chip.current),
                ...(chip.ordinal !== null && !chip.current
                    ? { 'aria-keyshortcuts': String(chip.ordinal) }
                    : {}),
                ...(chip.current ? {} : { 'data-coltriage-drop': `chip:${chip.id}` })
            }
        })
        btn.createSpan({ cls: 'kap-coltriage-chip-dot' }).setCssProps({
            '--kap-chip-color': chip.cssColor
        })
        btn.createSpan({ cls: 'kap-coltriage-chip-label', text: chip.label })
        if (chip.ordinal !== null && !chip.current) {
            btn.createSpan({ cls: 'kap-coltriage-chip-key', text: String(chip.ordinal) })
        }
        if (chip.current) btn.disabled = true
        else btn.addEventListener('click', () => callbacks.onChooseChip(chip.id))
    }
    const keep = tray.createEl('button', {
        cls: 'kap-triage-skip kap-coltriage-keep',
        attr: {
            'type': 'button',
            'title': 'Keep here and advance (↓ or Space)',
            'aria-keyshortcuts': 'ArrowDown Space',
            'data-coltriage-drop': 'keep'
        }
    })
    setIcon(keep.createSpan({ cls: 'kap-triage-action-icon' }), 'chevrons-down')
    keep.createSpan({ text: data.keepLabel })
    keep.addEventListener('click', () => callbacks.onKeep())
    return tray
}

/** One full-height side rail, labelled with its carousel destination. */
function renderRail(
    body: HTMLElement,
    direction: -1 | 1,
    label: string | null,
    callbacks: ColumnTriageCallbacks
): HTMLElement {
    const rail = body.createEl('button', {
        cls:
            direction === -1
                ? 'kap-coltriage-rail kap-coltriage-rail-left'
                : 'kap-coltriage-rail kap-coltriage-rail-right',
        attr: {
            'type': 'button',
            'title':
                label === null
                    ? 'No other status column'
                    : `Move to ${label} (${direction === -1 ? '←' : '→'})`,
            'aria-keyshortcuts': direction === -1 ? 'ArrowLeft' : 'ArrowRight',
            ...(label === null ? {} : { 'data-coltriage-drop': `move:${String(direction)}` })
        }
    })
    if (label === null) rail.disabled = true
    setIcon(
        rail.createSpan({ cls: 'kap-triage-action-icon' }),
        direction === -1 ? 'arrow-left' : 'arrow-right'
    )
    rail.createSpan({ cls: 'kap-coltriage-rail-label', text: label ?? '–' })
    rail.addEventListener('click', () => callbacks.onMove(direction))
    return rail
}

/** Keyboard triage; leaves focused controls and typing surfaces alone. */
function handleKey(
    e: KeyboardEvent,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks
): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const target = asElement(e.target)
    const onControl =
        target !== null &&
        target.closest('button, a, input, textarea, [contenteditable="true"]') !== null
    // Space/Enter must keep activating the focused control, not double-fire.
    if (onControl && (e.key === ' ' || e.key === 'Enter')) return
    if (e.key === 'Escape') {
        e.preventDefault()
        callbacks.onExit()
        return
    }
    if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (data.nextLabel !== null) callbacks.onMove(1)
        return
    }
    if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (data.previousLabel !== null) callbacks.onMove(-1)
        return
    }
    if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        callbacks.onKeep()
        return
    }
    if (e.key === 'o' || e.key === 'O') {
        callbacks.onOpen(false)
        return
    }
    if (/^[1-9]$/.test(e.key)) {
        const chip = data.chips[Number(e.key) - 1]
        if (chip && !chip.current) callbacks.onChooseChip(chip.id)
    }
}

/**
 * The face drag: follows the pointer (dampened vertically, slight rotation),
 * hit-tests the chips / Keep / rails as drop targets via the owning
 * document's `elementsFromPoint` (the face itself is excluded — it moves
 * with the pointer and would otherwise always be the top hit), and falls
 * back to swipe classification when released over nothing. Below both
 * thresholds the card snaps back and the pending click survives.
 */
function attachDrag(
    root: HTMLElement,
    face: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks,
    zones: { left: HTMLElement; right: HTMLElement; tray: HTMLElement }
): void {
    let startX = 0
    let startY = 0
    let pointerId = -1
    let tracking = false
    let dragging = false
    let armed: HTMLElement | null = null

    const armTarget = (el: HTMLElement | null): void => {
        if (armed === el) return
        armed?.removeClass('kap-coltriage-armed')
        armed = el
        armed?.addClass('kap-coltriage-armed')
    }
    /** The drop target under the pointer, excluding the moving face. */
    const dropTargetAt = (x: number, y: number): HTMLElement | null => {
        for (const node of face.doc.elementsFromPoint(x, y)) {
            const el = asElement(node)
            if (!el || face.contains(el)) continue
            const target = el.closest<HTMLElement>('[data-coltriage-drop]')
            if (target && root.contains(target) && !target.hasAttribute('disabled')) {
                return target
            }
        }
        return null
    }
    const reset = (): void => {
        tracking = false
        dragging = false
        root.removeClass('kap-coltriage-dragging')
        face.removeClass('kap-triage-card-dragging')
        armTarget(null)
        face.setCssProps({
            '--kap-swipe-x': '0px',
            '--kap-swipe-y': '0px',
            '--kap-swipe-rot': '0deg'
        })
    }
    const dispatch = (target: HTMLElement): void => {
        const drop = target.dataset['coltriageDrop'] ?? ''
        if (drop === 'keep') callbacks.onKeep()
        else if (drop === 'move:-1') callbacks.onMove(-1)
        else if (drop === 'move:1') callbacks.onMove(1)
        else if (drop.startsWith('chip:')) callbacks.onChooseChip(drop.slice('chip:'.length))
    }

    face.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        if (asElement(e.target)?.closest('button, a, input')) return
        claimPointerDrag(e)
        tracking = true
        dragging = false
        pointerId = e.pointerId
        startX = e.clientX
        startY = e.clientY
        face.setPointerCapture(e.pointerId)
    })
    face.addEventListener('pointermove', (e) => {
        if (!tracking || e.pointerId !== pointerId) return
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        if (!dragging) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_START_THRESHOLD) return
            dragging = true
            root.addClass('kap-coltriage-dragging')
            face.addClass('kap-triage-card-dragging')
        }
        face.setCssProps({
            '--kap-swipe-x': `${String(dx)}px`,
            '--kap-swipe-y': `${String(dy * 0.4)}px`,
            '--kap-swipe-rot': `${String(dx * 0.04)}deg`
        })
        // An element under the pointer wins; else preview-arm by direction.
        const target = dropTargetAt(e.clientX, e.clientY)
        if (target) {
            armTarget(target)
            return
        }
        const preview = classifySwipe(dx, dy, SWIPE_THRESHOLD)
        if (preview === 'left' && data.previousLabel !== null) armTarget(zones.left)
        else if (preview === 'right' && data.nextLabel !== null) armTarget(zones.right)
        else if (preview === 'down') armTarget(zones.tray)
        else armTarget(null)
    })
    face.addEventListener('pointerup', (e) => {
        if (!tracking || e.pointerId !== pointerId) return
        const wasDragging = dragging
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        // Recompute the drop target at release — the armed one may be stale.
        const target = wasDragging ? dropTargetAt(e.clientX, e.clientY) : null
        reset()
        if (!wasDragging) return
        if (target) {
            dispatch(target)
            return
        }
        const direction = classifySwipe(dx, dy, SWIPE_THRESHOLD)
        if (direction === 'right' && data.nextLabel !== null) callbacks.onMove(1)
        else if (direction === 'left' && data.previousLabel !== null) callbacks.onMove(-1)
        else if (direction === 'down') callbacks.onKeep()
    })
    face.addEventListener('pointercancel', (e) => {
        if (e.pointerId === pointerId) reset()
    })
    face.addEventListener('lostpointercapture', (e) => {
        if (e.pointerId === pointerId && tracking) reset()
    })
}
