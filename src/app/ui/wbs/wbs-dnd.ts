/**
 * Pointer-event drag-and-drop for the WBS view (issue #76).
 *
 * Mirrors `CalendarDnd` (one delegated listener set, pointer events for
 * mouse + touch, a 5px move threshold so clicks still open notes,
 * reduced-motion aware, post-drag click swallow). Drag sources are tree rows
 * (`.kap-wbs-row`) and left-pane cards (`.kap-wbs-pane-card`); the only drop
 * target is another tree row — dropping re-parents the dragged note (or sets
 * the parent for a pane card). The host validates targets live so invalid
 * drops (self / own descendant / current parent) highlight as such and are
 * never committed.
 */

const DRAG_THRESHOLD_PX = 5

export interface WbsDndCallbacks {
    /**
     * Whether dropping `sourceKey` (dragged from under `sourceParentKey`,
     * null for a pane card or root) onto `targetKey` would be a valid
     * re-parent — drives the live drop highlight.
     */
    canDrop: (sourceKey: string, sourceParentKey: string | null, targetKey: string) => boolean
    onDrop: (sourceKey: string, sourceParentKey: string | null, targetKey: string) => void
}

export class WbsDnd {
    private readonly containerEl: HTMLElement
    private readonly callbacks: WbsDndCallbacks

    private pointerId: number | null = null
    private startX = 0
    private startY = 0
    private dragging = false
    private sourceEl: HTMLElement | null = null
    private ghostEl: HTMLElement | null = null
    private dropEl: HTMLElement | null = null
    private currentTargetKey: string | null = null
    private currentTargetValid = false

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
        // Chips inside a row (estimate / date / progress) are buttons of their
        // own — pressing one must stay a click, never start a drag.
        if (target?.closest('.kap-wbs-chip-btn, .kap-wbs-toggle')) return
        const sourceEl =
            target?.closest<HTMLElement>('.kap-wbs-row[data-card-key], .kap-wbs-pane-card') ?? null
        if (!sourceEl || !this.containerEl.contains(sourceEl)) return

        this.pointerId = e.pointerId
        this.startX = e.clientX
        this.startY = e.clientY
        this.sourceEl = sourceEl
        window.addEventListener('pointermove', this.onPointerMove)
        window.addEventListener('pointerup', this.onPointerUp)
        window.addEventListener('pointercancel', this.onPointerCancel)
    }

    private handlePointerMove(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
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
    }

    private updateGhost(e: PointerEvent): void {
        // The transform is a direct position write (no transition), so it is
        // NOT motion to reduce — suppressing it would pin the ghost at the
        // viewport corner for the whole drag.
        if (!this.ghostEl) return
        this.ghostEl.style.transform = `translate(${String(e.clientX + 8)}px, ${String(e.clientY + 8)}px)`
    }

    private updateDropTarget(e: PointerEvent): void {
        const el = activeDocument.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const rowEl = el?.closest<HTMLElement>('.kap-wbs-row[data-card-key]') ?? null
        const targetKey = rowEl?.dataset['cardKey'] ?? null
        const sourceKey = this.sourceEl?.dataset['cardKey'] ?? null
        const valid =
            rowEl !== null &&
            targetKey !== null &&
            sourceKey !== null &&
            this.callbacks.canDrop(sourceKey, this.sourceParentKey(), targetKey)
        const nextDropEl = rowEl
        if (nextDropEl !== this.dropEl) {
            this.dropEl?.removeClass('kap-wbs-drop')
            this.dropEl?.removeClass('kap-wbs-drop-invalid')
            this.dropEl = nextDropEl
        }
        if (this.dropEl) {
            this.dropEl.toggleClass('kap-wbs-drop', valid)
            this.dropEl.toggleClass('kap-wbs-drop-invalid', !valid)
        }
        this.currentTargetKey = targetKey
        this.currentTargetValid = valid
    }

    /** The dragged row's context parent (absent on pane cards / roots). */
    private sourceParentKey(): string | null {
        const raw = this.sourceEl?.dataset['parentKey']
        return raw !== undefined && raw !== '' ? raw : null
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        const sourceKey = this.sourceEl?.dataset['cardKey'] ?? null
        const sourceParentKey = this.sourceParentKey()
        const targetKey = this.currentTargetKey
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
        if (wasDragging && valid && sourceKey && targetKey) {
            this.callbacks.onDrop(sourceKey, sourceParentKey, targetKey)
        }
    }

    private cleanup(): void {
        window.removeEventListener('pointermove', this.onPointerMove)
        window.removeEventListener('pointerup', this.onPointerUp)
        window.removeEventListener('pointercancel', this.onPointerCancel)
        this.sourceEl?.removeClass('kap-card-dragging')
        this.ghostEl?.remove()
        this.dropEl?.removeClass('kap-wbs-drop')
        this.dropEl?.removeClass('kap-wbs-drop-invalid')
        this.ghostEl = null
        this.dropEl = null
        this.sourceEl = null
        this.currentTargetKey = null
        this.currentTargetValid = false
        this.dragging = false
        this.pointerId = null
    }
}
