/**
 * Pointer-event drag-and-drop for the WBS view (issue #76).
 *
 * Mirrors `CalendarDnd` (one delegated listener set, pointer events for
 * mouse + touch, a 5px move threshold so clicks still open notes, post-drag
 * click swallow). Drag sources are tree rows (`.kap-wbs-row`, minus context
 * rows) and left-pane cards (`.kap-wbs-pane-card`); drop targets are tree
 * rows — context rows included (re-parent / set parent) — and the panel
 * (detach a row from its parent). The host validates
 * targets live so invalid drops highlight as such and are never committed.
 *
 * Ergonomics: while dragging, the tree auto-scrolls when the pointer nears
 * its top/bottom edge (rAF loop — pointermove alone stalls when the pointer
 * rests), and hovering a collapsed branch for a beat expands it so a drop
 * can land deeper. The source element is re-resolved by key when a mid-drag
 * refresh rebuilds its node.
 */

import { cssEscapeAttr } from '../../utils/css-escape'

const DRAG_THRESHOLD_PX = 5
const AUTOSCROLL_EDGE_PX = 48
const AUTOSCROLL_MAX_STEP_PX = 14
const HOVER_EXPAND_DELAY_MS = 600

export type WbsDropTarget = { kind: 'row'; targetKey: string } | { kind: 'panel' }

export interface WbsDndCallbacks {
    /**
     * Whether dropping `sourceKey` (dragged from under `sourceParentKey`,
     * null for a pane card or root) onto `target` would commit — drives the
     * live drop highlight.
     */
    canDrop: (sourceKey: string, sourceParentKey: string | null, target: WbsDropTarget) => boolean
    onDrop: (sourceKey: string, sourceParentKey: string | null, target: WbsDropTarget) => void
    /** The pointer lingered over a collapsed branch — expand it. */
    onHoverExpand: (targetKey: string) => void
}

export class WbsDnd {
    private readonly containerEl: HTMLElement
    private readonly callbacks: WbsDndCallbacks

    private pointerId: number | null = null
    private startX = 0
    private startY = 0
    private lastX = 0
    private lastY = 0
    private dragging = false
    private sourceEl: HTMLElement | null = null
    // Captured at pointerdown so a mid-drag refresh (node rebuilt) can't
    // lose the drag's identity.
    private sourceKey: string | null = null
    private sourceParentKey: string | null = null
    private sourceIsRow = false
    private ghostEl: HTMLElement | null = null
    private dropEl: HTMLElement | null = null
    private currentTarget: WbsDropTarget | null = null
    private currentTargetValid = false
    private autoScrollHandle: number | null = null
    private hoverExpandHandle: number | null = null
    private hoverExpandKey: string | null = null

    private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e)
    private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e)
    private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e)
    private readonly onPointerCancel = (): void => this.cleanup()

    constructor(containerEl: HTMLElement, callbacks: WbsDndCallbacks) {
        this.containerEl = containerEl
        this.callbacks = callbacks
        this.containerEl.addEventListener('pointerdown', this.onPointerDown)
    }

    destroy(): void {
        this.containerEl.removeEventListener('pointerdown', this.onPointerDown)
        this.cleanup()
    }

    private handlePointerDown(e: PointerEvent): void {
        if (e.button !== 0) return
        const target = e.target as HTMLElement | null
        // Chips inside a row (estimate / dates / due / progress) are buttons
        // of their own — pressing one must stay a click, never start a drag.
        if (target?.closest('.kap-wbs-chip-btn, .kap-wbs-toggle')) return
        const sourceEl =
            target?.closest<HTMLElement>('.kap-wbs-row[data-card-key], .kap-wbs-pane-card') ?? null
        if (!sourceEl || !this.containerEl.contains(sourceEl)) return
        // Context rows (ancestors outside the view's results) are drop
        // targets only — their own frontmatter is never dragged around.
        if (sourceEl.dataset['wbsContext'] === '1') return

        this.pointerId = e.pointerId
        this.startX = e.clientX
        this.startY = e.clientY
        this.lastX = e.clientX
        this.lastY = e.clientY
        this.sourceEl = sourceEl
        this.sourceKey = sourceEl.dataset['cardKey'] ?? null
        const rawParent = sourceEl.dataset['parentKey']
        this.sourceParentKey = rawParent !== undefined && rawParent !== '' ? rawParent : null
        this.sourceIsRow = sourceEl.hasClass('kap-wbs-row')
        window.addEventListener('pointermove', this.onPointerMove)
        window.addEventListener('pointerup', this.onPointerUp)
        window.addEventListener('pointercancel', this.onPointerCancel)
    }

    private handlePointerMove(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        this.lastX = e.clientX
        this.lastY = e.clientY
        if (!this.dragging) {
            const moved = Math.hypot(e.clientX - this.startX, e.clientY - this.startY)
            if (moved < DRAG_THRESHOLD_PX) return
            this.beginDrag(e)
        }
        e.preventDefault()
        this.updateGhost(e)
        this.updateDropTarget(e)
    }

    private beginDrag(e: PointerEvent): void {
        if (!this.sourceEl) return
        this.dragging = true
        this.sourceEl.addClass('kap-card-dragging')
        try {
            this.sourceEl.setPointerCapture(e.pointerId)
        } catch {
            // capture is best-effort
        }
        // Body-level ghost inside a `.kap-root` wrapper so the plugin-scoped
        // styles apply outside the view's own subtree (popout-safe).
        const wrap = activeDocument.body.createDiv({ cls: 'kap-root kap-wbs-ghost-wrap' })
        const ghost = this.sourceEl.cloneNode(true) as HTMLElement
        ghost.addClass('kap-card-ghost')
        ghost.style.width = `${String(Math.min(this.sourceEl.offsetWidth, 320))}px`
        wrap.appendChild(ghost)
        this.ghostEl = wrap
        // A dragged tree row can be dropped on the panel to detach it —
        // reveal the panel's hint for the whole gesture.
        if (this.sourceIsRow && this.sourceParentKey !== null) {
            this.panelEl()?.addClass('kap-wbs-drop-ready')
        }
        this.startAutoScroll()
    }

    private panelEl(): HTMLElement | null {
        return this.containerEl.querySelector<HTMLElement>('.kap-wbs-panel')
    }

    private treeEl(): HTMLElement | null {
        return this.containerEl.querySelector<HTMLElement>('.kap-wbs-tree')
    }

    private updateGhost(e: PointerEvent): void {
        // The transform is a direct position write (no transition), so it is
        // NOT motion to reduce — suppressing it would pin the ghost at the
        // viewport corner for the whole drag.
        if (!this.ghostEl) return
        this.ghostEl.style.transform = `translate(${String(e.clientX + 8)}px, ${String(e.clientY + 8)}px)`
    }

    /**
     * Keep the tree scrolling while the pointer rests near its top/bottom
     * edge — pointermove stops firing on a stationary pointer, so a rAF loop
     * drives the scroll for as long as the drag lives.
     */
    private startAutoScroll(): void {
        const step = (): void => {
            if (!this.dragging) {
                this.autoScrollHandle = null
                return
            }
            const tree = this.treeEl()
            if (tree) {
                const rect = tree.getBoundingClientRect()
                if (this.lastX >= rect.left && this.lastX <= rect.right) {
                    const fromTop = this.lastY - rect.top
                    const fromBottom = rect.bottom - this.lastY
                    if (fromTop >= 0 && fromTop < AUTOSCROLL_EDGE_PX) {
                        tree.scrollTop -= this.autoScrollStep(fromTop)
                    } else if (fromBottom >= 0 && fromBottom < AUTOSCROLL_EDGE_PX) {
                        tree.scrollTop += this.autoScrollStep(fromBottom)
                    }
                }
            }
            this.autoScrollHandle = window.requestAnimationFrame(step)
        }
        this.autoScrollHandle = window.requestAnimationFrame(step)
    }

    /** Scroll faster the closer the pointer is to the edge. */
    private autoScrollStep(distance: number): number {
        const strength = 1 - distance / AUTOSCROLL_EDGE_PX
        return Math.max(2, Math.round(strength * AUTOSCROLL_MAX_STEP_PX))
    }

    private updateDropTarget(e: PointerEvent): void {
        // A mid-drag refresh may have rebuilt the source's node — re-resolve
        // it so the dimmed style follows the drag.
        if (this.sourceEl && !this.sourceEl.isConnected) this.resolveSourceEl()

        const el = activeDocument.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const rowEl = el?.closest<HTMLElement>('.kap-wbs-row[data-card-key]') ?? null
        const panelEl = rowEl ? null : (el?.closest<HTMLElement>('.kap-wbs-panel') ?? null)
        const targetKey = rowEl?.dataset['cardKey'] ?? null

        let target: WbsDropTarget | null = null
        if (rowEl && targetKey) target = { kind: 'row', targetKey }
        else if (panelEl && this.sourceIsRow) target = { kind: 'panel' }

        const valid =
            target !== null &&
            this.sourceKey !== null &&
            this.callbacks.canDrop(this.sourceKey, this.sourceParentKey, target)

        const nextDropEl = rowEl ?? (target?.kind === 'panel' ? panelEl : null)
        if (nextDropEl !== this.dropEl) {
            this.dropEl?.removeClass('kap-wbs-drop')
            this.dropEl?.removeClass('kap-wbs-drop-invalid')
            this.dropEl = nextDropEl
            this.scheduleHoverExpand(rowEl, targetKey, valid)
        }
        if (this.dropEl) {
            this.dropEl.toggleClass('kap-wbs-drop', valid)
            this.dropEl.toggleClass('kap-wbs-drop-invalid', !valid)
        }
        this.currentTarget = target
        this.currentTargetValid = valid
    }

    /** Linger over a collapsed branch (valid target) → expand it in place. */
    private scheduleHoverExpand(
        rowEl: HTMLElement | null,
        targetKey: string | null,
        valid: boolean
    ): void {
        if (this.hoverExpandHandle !== null) {
            window.clearTimeout(this.hoverExpandHandle)
            this.hoverExpandHandle = null
        }
        this.hoverExpandKey = null
        if (!rowEl || !targetKey || !valid) return
        if (rowEl.dataset['wbsCollapsed'] !== '1') return
        this.hoverExpandKey = targetKey
        this.hoverExpandHandle = window.setTimeout(() => {
            this.hoverExpandHandle = null
            if (this.dragging && this.hoverExpandKey === targetKey) {
                this.callbacks.onHoverExpand(targetKey)
            }
        }, HOVER_EXPAND_DELAY_MS)
    }

    /** Re-find the dragged element after its node was rebuilt by a refresh. */
    private resolveSourceEl(): void {
        if (this.sourceKey === null) return
        const selector = this.sourceIsRow
            ? `.kap-wbs-row[data-card-key="${cssEscapeAttr(this.sourceKey)}"][data-parent-key="${cssEscapeAttr(this.sourceParentKey ?? '')}"]`
            : `.kap-wbs-pane-card[data-card-key="${cssEscapeAttr(this.sourceKey)}"]`
        const el = this.containerEl.querySelector<HTMLElement>(selector)
        if (el) {
            el.addClass('kap-card-dragging')
            this.sourceEl = el
        }
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        const sourceKey = this.sourceKey
        const sourceParentKey = this.sourceParentKey
        const target = this.currentTarget
        const valid = this.currentTargetValid
        const wasDragging = this.dragging
        this.cleanup()
        if (wasDragging) {
            // Swallow the post-drag click so the row doesn't also open the note.
            const controller = new AbortController()
            window.addEventListener(
                'click',
                (ev) => {
                    ev.stopPropagation()
                    ev.preventDefault()
                    controller.abort()
                },
                { capture: true, signal: controller.signal }
            )
            window.setTimeout(() => controller.abort(), 50)
        }
        if (wasDragging && valid && sourceKey && target) {
            this.callbacks.onDrop(sourceKey, sourceParentKey, target)
        }
    }

    private cleanup(): void {
        window.removeEventListener('pointermove', this.onPointerMove)
        window.removeEventListener('pointerup', this.onPointerUp)
        window.removeEventListener('pointercancel', this.onPointerCancel)
        if (this.autoScrollHandle !== null) {
            window.cancelAnimationFrame(this.autoScrollHandle)
            this.autoScrollHandle = null
        }
        if (this.hoverExpandHandle !== null) {
            window.clearTimeout(this.hoverExpandHandle)
            this.hoverExpandHandle = null
        }
        this.hoverExpandKey = null
        this.sourceEl?.removeClass('kap-card-dragging')
        this.panelEl()?.removeClass('kap-wbs-drop-ready')
        this.ghostEl?.remove()
        this.dropEl?.removeClass('kap-wbs-drop')
        this.dropEl?.removeClass('kap-wbs-drop-invalid')
        this.ghostEl = null
        this.dropEl = null
        this.sourceEl = null
        this.sourceKey = null
        this.sourceParentKey = null
        this.sourceIsRow = false
        this.currentTarget = null
        this.currentTargetValid = false
        this.dragging = false
        this.pointerId = null
    }
}
