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
    /** The rendered card's identity — an in-place patch that changes it
     * cancels any in-flight drag (the pointer was captured on another card). */
    cardKey: string
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
    /** Step back to the previously decided card, cancelling that decision. */
    onStepBack(): void
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

/** Remove the column-triage overlay (and any in-flight decision ghost) from `host`. */
export function removeColumnTriageView(host: HTMLElement): void {
    host.querySelector(':scope > .kap-coltriage')?.remove()
    for (const ghost of Array.from(host.querySelectorAll(':scope > .kap-coltriage-ghost'))) {
        ghost.remove()
    }
    // The focus overlay (issue #160) shares the host class — keep it while
    // a focus overlay is still mounted.
    if (!host.querySelector(':scope > .kap-focus')) host.removeClass('kap-focus-open')
}

/**
 * Play the decision animation on a detached GHOST so the pass can advance
 * optimistically: the current face is cloned at its exact on-screen position,
 * appended to the stable host OUTSIDE the overlay root (the immediate
 * re-render with the next card cannot tear it down), and plays the
 * passport-stamp slam plus fly-out while the real overlay already shows the
 * next card. Cloning copies classes but not listeners, and the ghost CSS
 * disables pointer events, so the clone is inert. It removes itself on the
 * named fly-out `animationend` (or an owning-window timeout — idempotent).
 * No-op under reduced motion or when no face is mounted.
 */
export function spawnColumnTriageDecisionGhost(
    host: HTMLElement,
    animation: ColumnTriageDecisionAnimation
): void {
    // Scoped to the overlay root: a still-flying ghost of a previous decision
    // also carries the face class and must never be re-cloned.
    const face = host.querySelector<HTMLElement>(':scope > .kap-coltriage .kap-coltriage-face')
    if (!face) return
    const win = face.win
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // The post-layout cache avoids forcing a synchronous whole-pane style
    // recalc here: background passes (write echoes) can leave the layout
    // dirty at decision time, and a live rect read then costs ~50ms on
    // stylesheet-heavy vaults. Fallback to live rects when no frame has
    // cached the position yet (a decision within the very first frame).
    const cached = FACE_RECTS.get(face)
    const position =
        cached ??
        ((): { left: number; top: number; width: number } => {
            const faceRect = face.getBoundingClientRect()
            const hostRect = host.getBoundingClientRect()
            return {
                left: faceRect.left - hostRect.left,
                top: faceRect.top - hostRect.top,
                width: faceRect.width
            }
        })()
    const ghost = face.cloneNode(true) as HTMLElement
    ghost.addClass('kap-coltriage-ghost')
    ghost.setCssProps({
        left: `${String(position.left)}px`,
        top: `${String(position.top)}px`,
        width: `${String(position.width)}px`
    })
    const stamp = ghost.createDiv({ cls: 'kap-coltriage-stamp', text: animation.stampLabel })
    if (animation.stampColor) stamp.setCssProps({ '--kap-stamp-color': animation.stampColor })
    const flyClass = `kap-coltriage-out-${animation.direction}`
    const flyName = `kap-coltriage-fly-${animation.direction}`
    ghost.addClass(flyClass)
    host.appendChild(ghost)
    let removed = false
    const remove = (): void => {
        if (removed) return
        removed = true
        ghost.remove()
    }
    ghost.addEventListener('animationend', (e) => {
        if (e.target === ghost && e.animationName === flyName) remove()
    })
    win.setTimeout(remove, ANIMATION_TIMEOUT_MS)
}

/** The mutable render inputs every listener reads through (in-place patch). */
interface ColumnTriageRef {
    data: ColumnTriageData
    callbacks: ColumnTriageCallbacks
}

/**
 * Host-relative face position, measured post-layout (rAF) after every
 * render/patch, so {@link spawnColumnTriageDecisionGhost} never forces a
 * synchronous reflow at decision time. Refreshed per decision; a pane resize
 * mid-pass can leave it one frame stale, which only offsets the ghost's
 * start position (cosmetic). GC'd with the face element.
 */
const FACE_RECTS = new WeakMap<HTMLElement, { left: number; top: number; width: number }>()

/**
 * In-place updaters for mounted overlays, keyed by overlay root. A re-render
 * with a mounted overlay patches its data-driven DOM instead of remounting:
 * on stylesheet-heavy vaults a full remount costs a whole-subtree style
 * recalc per decision (~50–100ms measured), while the patch touches a
 * handful of small elements. GC'd with the root element.
 */
const UPDATERS = new WeakMap<
    HTMLElement,
    (data: ColumnTriageData, callbacks: ColumnTriageCallbacks) => void
>()

/**
 * Render the column-triage overlay inside `host` (the view's STABLE root
 * element — it survives board re-renders, so only the host view's signature
 * gate decides when this runs). A mounted overlay is patched IN PLACE (see
 * {@link UPDATERS}); the full skeleton is built once per pass. Keyboard:
 * `1..9` jump to a chip, ← / → move (carousel), ↓ / Space keep, O opens.
 * Esc exits via the host view's keymap scope (focus-independent), not a DOM
 * listener.
 */
export function renderColumnTriageView(
    host: HTMLElement,
    data: ColumnTriageData,
    callbacks: ColumnTriageCallbacks
): void {
    const mounted = host.querySelector<HTMLElement>(':scope > .kap-coltriage')
    if (mounted) {
        const update = UPDATERS.get(mounted)
        if (update) {
            update(data, callbacks)
            return
        }
        mounted.remove()
    }
    host.addClass('kap-focus-open')
    const ref: ColumnTriageRef = { data, callbacks }
    const root = host.createDiv({ cls: 'kap-focus kap-coltriage', attr: { tabindex: '-1' } })

    root.addEventListener('keydown', (e) => handleKey(e, ref.data, ref.callbacks))
    root.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        ref.callbacks.onMenu(e)
    })

    // ── Static skeleton (built once per pass) ─────────────────
    const header = root.createDiv({ cls: 'kap-focus-header' })
    const countEl = header.createSpan({ cls: 'kap-focus-count' })
    const modeEl = header.createSpan({ cls: 'kap-focus-mode-label' })
    const exit = header.createEl('button', {
        cls: 'kap-triage-icon-btn',
        attr: { 'aria-label': 'Exit column triage (Esc)', 'title': 'Exit column triage (Esc)' }
    })
    setIcon(exit, 'x')
    exit.addEventListener('click', () => ref.callbacks.onExit())
    const bar = root.createDiv({ cls: 'kap-triage-progress' })
    const fill = bar.createDiv({ cls: 'kap-triage-progress-fill' })

    const body = root.createDiv({ cls: 'kap-coltriage-body' })
    const leftRail = buildRail(body, -1, ref)

    // Center: the card stack (face + up to two peeking cards) above the
    // STATIONARY action tray (chips + Keep) — only the face ever moves.
    const center = body.createDiv({ cls: 'kap-coltriage-center' })
    const stack = center.createDiv({ cls: 'kap-coltriage-stack' })
    const face = stack.createDiv({ cls: 'kap-focus-card kap-coltriage-face' })
    const titleRow = face.createDiv({ cls: 'kap-focus-title-row' })
    const titleEl = titleRow.createEl('h2', { cls: 'kap-focus-title' })
    const open = titleRow.createEl('button', {
        cls: 'kap-triage-open',
        attr: { 'aria-label': 'Open note (O)', 'title': 'Open note (O)' }
    })
    setIcon(open.createSpan({ cls: 'kap-triage-open-icon' }), 'square-arrow-out-up-right')
    open.createSpan({ text: 'Open' })
    open.addEventListener('click', (e) => ref.callbacks.onOpen(e.ctrlKey || e.metaKey))
    const fieldsEl = face.createDiv({ cls: 'kap-triage-context' })
    face.createDiv({
        cls: 'kap-focus-hints',
        text: '1-9 status · ← / → move · ↓ keep · ↑ back · Esc exit · O open · or drag the card'
    })

    const tray = center.createDiv({ cls: 'kap-coltriage-tray' })
    const chipsEl = tray.createDiv({ cls: 'kap-coltriage-chips', attr: { role: 'group' } })
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
    const keepLabelEl = keep.createSpan()
    keep.addEventListener('click', () => ref.callbacks.onKeep())

    const rightRail = buildRail(body, 1, ref)

    // ── Data-driven pass (initial render + every in-place patch) ──
    const apply = (): void => {
        const d = ref.data
        countEl.setText(`${String(Math.min(d.done + 1, d.total))} / ${String(d.total)}`)
        modeEl.setText(`Column triage — ${d.columnLabel}`)
        const pct = d.total > 0 ? Math.round((d.done / d.total) * 100) : 0
        fill.setCssProps({ '--kap-progress': `${String(pct)}%` })

        // Peeks sit BEHIND the face in DOM order — rebuild them before it.
        for (const peek of Array.from(stack.querySelectorAll(':scope > .kap-coltriage-peek'))) {
            peek.remove()
        }
        for (let i = d.stackTitles.length - 1; i >= 0; i--) {
            const peek = stack.createDiv({
                cls: `kap-coltriage-peek kap-coltriage-peek-${String(i + 1)}`
            })
            peek.createDiv({ cls: 'kap-coltriage-peek-title', text: d.stackTitles[i] ?? '' })
            stack.insertBefore(peek, face)
        }

        titleEl.setText(d.title)
        fieldsEl.empty()
        fieldsEl.toggleClass('kap-hidden', d.fields.length === 0)
        for (const field of d.fields) {
            const chip = fieldsEl.createDiv({ cls: 'kap-triage-context-field' })
            if (field.label) {
                chip.createSpan({ cls: 'kap-triage-context-label', text: `${field.label}: ` })
            }
            chip.createSpan({ cls: 'kap-triage-context-value', text: field.text })
        }

        renderChips(chipsEl, d, ref)
        keepLabelEl.setText(d.keepLabel)
        applyRail(leftRail, -1, d.previousLabel)
        applyRail(rightRail, 1, d.nextLabel)
    }

    // Cache the face position once layout has settled (see FACE_RECTS).
    const cacheFaceRect = (): void => {
        face.win.requestAnimationFrame(() => {
            if (!face.isConnected) return
            const faceRect = face.getBoundingClientRect()
            const hostRect = host.getBoundingClientRect()
            FACE_RECTS.set(face, {
                left: faceRect.left - hostRect.left,
                top: faceRect.top - hostRect.top,
                width: faceRect.width
            })
        })
    }

    apply()
    const cancelDrag = attachDrag(root, face, ref, { left: leftRail, right: rightRail, tray })
    UPDATERS.set(root, (nextData, nextCallbacks) => {
        // A patch that swaps the CARD must kill any captured drag first, or
        // releasing the original pointer would act on the NEW card (the old
        // remount discarded the face and its capture — adversarial review
        // 2026-08-28, finding 3). Same-card patches keep the drag alive.
        if (nextData.cardKey !== ref.data.cardKey) cancelDrag()
        ref.data = nextData
        ref.callbacks = nextCallbacks
        apply()
        // Behavior parity with the old remount: each decision re-centers
        // keyboard focus on the overlay root.
        root.focus({ preventScroll: true })
        cacheFaceRect()
    })

    root.focus({ preventScroll: true })
    cacheFaceRect()
}

/** (Re)build the status chips row: one chip per status of the card's type. */
function renderChips(chipsEl: HTMLElement, data: ColumnTriageData, ref: ColumnTriageRef): void {
    chipsEl.empty()
    for (const chip of data.chips) {
        const btn = chipsEl.createEl('button', {
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
        else btn.addEventListener('click', () => ref.callbacks.onChooseChip(chip.id))
    }
}

/** Build one full-height side rail's static skeleton (labelled by applyRail). */
function buildRail(body: HTMLElement, direction: -1 | 1, ref: ColumnTriageRef): HTMLElement {
    const rail = body.createEl('button', {
        cls:
            direction === -1
                ? 'kap-coltriage-rail kap-coltriage-rail-left'
                : 'kap-coltriage-rail kap-coltriage-rail-right',
        attr: {
            'type': 'button',
            'aria-keyshortcuts': direction === -1 ? 'ArrowLeft' : 'ArrowRight'
        }
    })
    setIcon(
        rail.createSpan({ cls: 'kap-triage-action-icon' }),
        direction === -1 ? 'arrow-left' : 'arrow-right'
    )
    rail.createSpan({ cls: 'kap-coltriage-rail-label' })
    rail.addEventListener('click', () => ref.callbacks.onMove(direction))
    return rail
}

/** Stamp a rail's carousel destination (or disable it when there is none). */
function applyRail(rail: HTMLElement, direction: -1 | 1, label: string | null): void {
    rail.setAttribute(
        'title',
        label === null
            ? 'No other status column'
            : `Move to ${label} (${direction === -1 ? '←' : '→'})`
    )
    if (label === null) {
        rail.setAttribute('disabled', '')
        rail.removeAttribute('data-coltriage-drop')
    } else {
        rail.removeAttribute('disabled')
        rail.setAttribute('data-coltriage-drop', `move:${String(direction)}`)
    }
    rail.querySelector(':scope > .kap-coltriage-rail-label')?.setText(label ?? '–')
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
    // Esc is NOT handled here: the host view pushes a keymap scope for it,
    // so exiting works even after DOM focus leaves the overlay root (and a
    // menu opened above the pass gets to close itself first).
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
    if (e.key === 'ArrowUp') {
        e.preventDefault()
        callbacks.onStepBack()
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
    ref: ColumnTriageRef,
    zones: { left: HTMLElement; right: HTMLElement; tray: HTMLElement }
): () => void {
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
        if (drop === 'keep') ref.callbacks.onKeep()
        else if (drop === 'move:-1') ref.callbacks.onMove(-1)
        else if (drop === 'move:1') ref.callbacks.onMove(1)
        else if (drop.startsWith('chip:')) ref.callbacks.onChooseChip(drop.slice('chip:'.length))
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
        if (preview === 'left' && ref.data.previousLabel !== null) armTarget(zones.left)
        else if (preview === 'right' && ref.data.nextLabel !== null) armTarget(zones.right)
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
        if (direction === 'right' && ref.data.nextLabel !== null) ref.callbacks.onMove(1)
        else if (direction === 'left' && ref.data.previousLabel !== null) ref.callbacks.onMove(-1)
        else if (direction === 'down') ref.callbacks.onKeep()
    })
    face.addEventListener('pointercancel', (e) => {
        if (e.pointerId === pointerId) reset()
    })
    face.addEventListener('lostpointercapture', (e) => {
        if (e.pointerId === pointerId && tracking) reset()
    })
    // Cancel hook for the in-place updater: after this, the released pointer
    // is ignored (tracking is false), so a drag started on the previous card
    // can never dispatch against the newly rendered one.
    return () => {
        reset()
    }
}
