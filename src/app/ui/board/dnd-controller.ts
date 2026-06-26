/**
 * Pointer-event drag-and-drop for the board.
 *
 * One delegated set of listeners on the board container drives dragging of any
 * `.kap-card`. Pointer events cover mouse, trackpad, and touch from a single
 * path. A drag begins only after the pointer moves past a small threshold (so
 * clicks still open notes). The drop target column + index are computed by
 * hit-testing column/card geometry, and shown with a placeholder line.
 *
 * Accessibility: a non-drag fallback (right-click / long-press menu) is provided
 * by the renderer; this controller honours `prefers-reduced-motion` by skipping
 * the float-follow animation.
 */

const DRAG_THRESHOLD_PX = 5

export interface DropTarget {
    /** Destination swimlane id (`''` for a single-lane board). */
    laneId: string
    columnId: string
    /** Insertion index within the destination column (0 = top). */
    index: number
}

export interface BoardDndCallbacks {
    /** Called on a committed drop. `index` is within the destination column. */
    onDrop: (cardKey: string, target: DropTarget) => void
}

export class BoardDnd {
    private readonly containerEl: HTMLElement
    private readonly callbacks: BoardDndCallbacks
    private readonly reducedMotion: boolean

    private pointerId: number | null = null
    private startX = 0
    private startY = 0
    private dragging = false
    private sourceCardEl: HTMLElement | null = null
    private ghostEl: HTMLElement | null = null
    private placeholderEl: HTMLElement | null = null
    private currentTarget: DropTarget | null = null

    private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e)
    private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e)
    private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e)
    private readonly onPointerCancel = (): void => this.cancel()

    constructor(containerEl: HTMLElement, callbacks: BoardDndCallbacks) {
        this.containerEl = containerEl
        this.callbacks = callbacks
        this.reducedMotion =
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        this.containerEl.addEventListener('pointerdown', this.onPointerDown)
    }

    destroy(): void {
        this.containerEl.removeEventListener('pointerdown', this.onPointerDown)
        this.cleanup()
    }

    private handlePointerDown(e: PointerEvent): void {
        if (e.button !== 0) return
        const target = e.target as HTMLElement | null
        const cardEl = target?.closest<HTMLElement>('.kap-card') ?? null
        if (!cardEl || !this.containerEl.contains(cardEl)) return

        this.pointerId = e.pointerId
        this.startX = e.clientX
        this.startY = e.clientY
        this.sourceCardEl = cardEl
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
        if (!this.sourceCardEl) return
        this.dragging = true
        this.sourceCardEl.addClass('kap-card-dragging')
        try {
            this.sourceCardEl.setPointerCapture(e.pointerId)
        } catch {
            // capture is best-effort
        }

        const ghost = this.sourceCardEl.cloneNode(true) as HTMLElement
        ghost.addClass('kap-card-ghost')
        ghost.style.width = `${String(this.sourceCardEl.offsetWidth)}px`
        document.body.appendChild(ghost)
        this.ghostEl = ghost

        this.placeholderEl = createDiv({ cls: 'kap-card-placeholder' })
    }

    private updateGhost(e: PointerEvent): void {
        if (!this.ghostEl || this.reducedMotion) return
        this.ghostEl.style.transform = `translate(${String(e.clientX + 8)}px, ${String(e.clientY + 8)}px)`
    }

    private updateDropTarget(e: PointerEvent): void {
        const columnEl = this.columnElementAt(e.clientX, e.clientY)
        if (!columnEl || !this.placeholderEl) {
            this.currentTarget = null
            this.placeholderEl?.remove()
            return
        }
        const columnId = columnEl.dataset['columnId'] ?? ''
        const laneId = columnEl.dataset['laneId'] ?? ''
        const listEl = columnEl.querySelector<HTMLElement>('.kap-column-cards')
        if (!listEl) return

        const cardEls = Array.from(
            listEl.querySelectorAll<HTMLElement>('.kap-card:not(.kap-card-dragging)')
        )
        let index = cardEls.length
        for (let i = 0; i < cardEls.length; i++) {
            const rect = cardEls[i]?.getBoundingClientRect()
            if (rect && e.clientY < rect.top + rect.height / 2) {
                index = i
                break
            }
        }

        const ref = cardEls[index] ?? null
        listEl.insertBefore(this.placeholderEl, ref)
        this.currentTarget = { laneId, columnId, index }
    }

    private columnElementAt(x: number, y: number): HTMLElement | null {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        return el?.closest<HTMLElement>('.kap-column') ?? null
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        const cardKey = this.sourceCardEl?.dataset['cardKey'] ?? null
        const target = this.currentTarget
        const wasDragging = this.dragging
        this.cleanup()
        if (wasDragging) {
            // Swallow the click the browser fires after a drag so it does not
            // also open the note. Auto-expires so a later genuine click is safe.
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
        if (wasDragging && cardKey && target) {
            this.callbacks.onDrop(cardKey, target)
        }
    }

    private cancel(): void {
        this.cleanup()
    }

    private cleanup(): void {
        window.removeEventListener('pointermove', this.onPointerMove)
        window.removeEventListener('pointerup', this.onPointerUp)
        window.removeEventListener('pointercancel', this.onPointerCancel)
        this.sourceCardEl?.removeClass('kap-card-dragging')
        this.ghostEl?.remove()
        this.placeholderEl?.remove()
        this.ghostEl = null
        this.placeholderEl = null
        this.sourceCardEl = null
        this.currentTarget = null
        this.dragging = false
        this.pointerId = null
    }
}
