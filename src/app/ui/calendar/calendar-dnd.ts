/**
 * Pointer-event drag-and-drop for the calendar / scheduling view.
 *
 * Mirrors the board's `BoardDnd` (one delegated listener set, pointer events for
 * mouse + touch, a move threshold so clicks still open notes, reduced-motion
 * aware), but the drop targets are calendar **day cells** (`.kap-cal-day` →
 * sets the active date), the **panel list** (`[data-calendar-panel]` → clears
 * it; day-sourced chips only), and the panel's **status groups**
 * (`[data-pane-drop-*]` → sets the status; panel-sourced chips only). The
 * view decides which property to write from the active tab.
 */

const DRAG_THRESHOLD_PX = 5

export type CalendarDropTarget =
    | { kind: 'day'; dayKey: string }
    | { kind: 'panel' }
    /** A panel status group (`data-pane-drop-*`): set the card's status. */
    | { kind: 'paneGroup'; typeId: string; status: string }

export interface CalendarDndCallbacks {
    /** `dimension` is the dragged chip's `data-dimension` (`scheduled`/`deadline`/`both`). */
    onDrop: (cardKey: string, target: CalendarDropTarget, dimension: string) => void
    /** Live validity for pane-group targets (day/panel targets are always lit). */
    canDrop: (cardKey: string, target: CalendarDropTarget) => boolean
}

export class CalendarDnd {
    private readonly containerEl: HTMLElement
    private readonly callbacks: CalendarDndCallbacks
    private readonly reducedMotion: boolean

    private pointerId: number | null = null
    private startX = 0
    private startY = 0
    private dragging = false
    private sourceCardEl: HTMLElement | null = null
    /** Whether the drag started on a panel chip (unlocks pane-group targets). */
    private sourceInPanel = false
    private ghostEl: HTMLElement | null = null
    private dropEl: HTMLElement | null = null
    private currentTarget: CalendarDropTarget | null = null
    private currentTargetValid = false

    private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e)
    private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e)
    private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e)
    private readonly onPointerCancel = (): void => this.cleanup()

    constructor(containerEl: HTMLElement, callbacks: CalendarDndCallbacks) {
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
        const cardEl = target?.closest<HTMLElement>('.kap-cal-card') ?? null
        if (!cardEl || !this.containerEl.contains(cardEl)) return

        this.pointerId = e.pointerId
        this.startX = e.clientX
        this.startY = e.clientY
        this.sourceCardEl = cardEl
        this.sourceInPanel = cardEl.closest('[data-calendar-panel]') !== null
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
        activeDocument.body.appendChild(ghost)
        this.ghostEl = ghost
    }

    private updateGhost(e: PointerEvent): void {
        if (!this.ghostEl || this.reducedMotion) return
        this.ghostEl.style.transform = `translate(${String(e.clientX + 8)}px, ${String(e.clientY + 8)}px)`
    }

    private updateDropTarget(e: PointerEvent): void {
        const el = activeDocument.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const dayEl = el?.closest<HTMLElement>('.kap-cal-day') ?? null
        // Pane status groups accept PANEL-sourced chips only (set status); a
        // chip dragged off a day keeps the whole panel as its clear target.
        const groupEl =
            dayEl || !this.sourceInPanel
                ? null
                : (el?.closest<HTMLElement>('[data-pane-drop-status]') ?? null)
        const panelEl =
            dayEl || this.sourceInPanel
                ? null
                : (el?.closest<HTMLElement>('[data-calendar-panel]') ?? null)

        let target: CalendarDropTarget | null = null
        if (dayEl) {
            const dayKey = dayEl.dataset['day'] ?? ''
            target = dayKey ? { kind: 'day', dayKey } : null
        } else if (groupEl) {
            target = {
                kind: 'paneGroup',
                typeId: groupEl.dataset['paneDropType'] ?? '',
                status: groupEl.dataset['paneDropStatus'] ?? ''
            }
        } else if (panelEl) target = { kind: 'panel' }

        const cardKey = this.sourceCardEl?.dataset['cardKey'] ?? null
        const valid = target !== null && cardKey !== null && this.callbacks.canDrop(cardKey, target)

        const nextDropEl = dayEl ?? groupEl ?? panelEl
        if (nextDropEl !== this.dropEl) {
            this.dropEl?.removeClass('kap-cal-drop')
            this.dropEl?.removeClass('kap-cal-drop-invalid')
            this.dropEl = nextDropEl
        }
        if (this.dropEl) {
            this.dropEl.toggleClass('kap-cal-drop', valid)
            this.dropEl.toggleClass('kap-cal-drop-invalid', !valid)
        }
        this.currentTarget = target
        this.currentTargetValid = valid
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        const cardKey = this.sourceCardEl?.dataset['cardKey'] ?? null
        const dimension = this.sourceCardEl?.dataset['dimension'] ?? 'scheduled'
        const target = this.currentTargetValid ? this.currentTarget : null
        const wasDragging = this.dragging
        this.cleanup()
        if (wasDragging) {
            // Swallow the post-drag click so the card doesn't also open the note.
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
            this.callbacks.onDrop(cardKey, target, dimension)
        }
    }

    private cleanup(): void {
        window.removeEventListener('pointermove', this.onPointerMove)
        window.removeEventListener('pointerup', this.onPointerUp)
        window.removeEventListener('pointercancel', this.onPointerCancel)
        this.sourceCardEl?.removeClass('kap-card-dragging')
        this.ghostEl?.remove()
        this.dropEl?.removeClass('kap-cal-drop')
        this.dropEl?.removeClass('kap-cal-drop-invalid')
        this.ghostEl = null
        this.dropEl = null
        this.sourceCardEl = null
        this.sourceInPanel = false
        this.currentTarget = null
        this.currentTargetValid = false
        this.dragging = false
        this.pointerId = null
    }
}
