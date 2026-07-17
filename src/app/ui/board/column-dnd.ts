/**
 * Pointer-event drag-and-drop to reorder status columns (issue #24).
 *
 * Delegated listeners on the board container drag a `.kap-column-header`. The
 * Unmapped column is not draggable (its position is a separate option), and
 * clicks on the collapse toggle are ignored so collapsing still works. A drag
 * starts only past a small threshold; a vertical indicator shows the drop slot —
 * an absolutely positioned overlay on the board, so repositioning it never
 * re-widths the columns (issue #105, finding 5.7).
 * On drop the new left-to-right order of status column ids is reported, and the
 * view persists it to the per-view `statuses` list.
 *
 * Honors `prefers-reduced-motion` (no ghost-follow animation).
 *
 * Input correctness (issue #109): headers use `touch-action: pan-x`, so a
 * horizontal touch pan scrolls the board natively (`pointercancel` aborts the
 * pending drag) while a vertical touch gesture starts a reorder drag.
 * Listeners bind to the board's own window / document so drags work in
 * popout windows.
 */

import { insertionLineOffset } from './drop-indicator'

const DRAG_THRESHOLD_PX = 5
/** Indicator bar thickness (px) — keep in sync with `.kap-column-drop-indicator`. */
const INDICATOR_THICKNESS_PX = 3
/** Empty-board fallback offset ≈ the `.kap-board` padding (0.75rem). */
const INDICATOR_FALLBACK_PX = 12

export interface ColumnDndCallbacks {
    /** Committed reorder: status column ids in their new left-to-right order. */
    onReorder: (orderedColumnIds: string[]) => void
}

export class ColumnDnd {
    private readonly containerEl: HTMLElement
    private readonly callbacks: ColumnDndCallbacks
    private readonly unmappedId: string
    private readonly reducedMotion: boolean

    private pointerId: number | null = null
    /** Window owning the in-flight drag (popout-safe); set at pointerdown. */
    private dragWin: Window = window
    private startX = 0
    private startY = 0
    private dragging = false
    private sourceColumnEl: HTMLElement | null = null
    private boardEl: HTMLElement | null = null
    private ghostEl: HTMLElement | null = null
    private indicatorEl: HTMLElement | null = null
    private insertIndex = -1

    private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e)
    private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e)
    private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e)
    private readonly onPointerCancel = (): void => this.cleanup()

    constructor(containerEl: HTMLElement, unmappedId: string, callbacks: ColumnDndCallbacks) {
        this.containerEl = containerEl
        this.unmappedId = unmappedId
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

    /** Draggable status columns (excludes Unmapped) in a board's DOM order. */
    private draggableColumns(boardEl: HTMLElement): HTMLElement[] {
        return Array.from(boardEl.querySelectorAll<HTMLElement>(':scope > .kap-column')).filter(
            (c) => c.dataset['columnId'] !== this.unmappedId
        )
    }

    private handlePointerDown(e: PointerEvent): void {
        if (e.button !== 0) return
        const target = e.target as HTMLElement | null
        if (!target || target.closest('button')) return // let the collapse toggle work
        const header = target.closest<HTMLElement>('.kap-column-header')
        if (!header) return
        const columnEl = header.closest<HTMLElement>('.kap-column')
        const boardEl = columnEl?.closest<HTMLElement>('.kap-board') ?? null
        if (!columnEl || !boardEl || columnEl.dataset['columnId'] === this.unmappedId) return
        if (this.draggableColumns(boardEl).length < 2) return

        this.pointerId = e.pointerId
        this.dragWin = this.containerEl.win
        this.startX = e.clientX
        this.startY = e.clientY
        this.sourceColumnEl = columnEl
        this.boardEl = boardEl
        this.dragWin.addEventListener('pointermove', this.onPointerMove)
        this.dragWin.addEventListener('pointerup', this.onPointerUp)
        this.dragWin.addEventListener('pointercancel', this.onPointerCancel)
    }

    private handlePointerMove(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        if (!this.dragging) {
            if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < DRAG_THRESHOLD_PX)
                return
            this.beginDrag(e)
        }
        e.preventDefault()
        this.updateGhost(e)
        this.updateTarget(e)
    }

    private beginDrag(e: PointerEvent): void {
        if (!this.sourceColumnEl) return
        this.dragging = true
        this.sourceColumnEl.addClass('kap-column-dragging')
        try {
            this.sourceColumnEl.setPointerCapture(e.pointerId)
        } catch {
            // best-effort
        }
        const header = this.sourceColumnEl.querySelector<HTMLElement>('.kap-column-header')
        const ghost = (header ?? this.sourceColumnEl).cloneNode(true) as HTMLElement
        ghost.addClass('kap-column-ghost')
        ghost.style.width = `${String((header ?? this.sourceColumnEl).offsetWidth)}px`
        this.containerEl.doc.body.appendChild(ghost)
        this.ghostEl = ghost
        this.indicatorEl = createDiv({ cls: 'kap-column-drop-indicator' })
    }

    private updateGhost(e: PointerEvent): void {
        if (!this.ghostEl || this.reducedMotion) return
        this.ghostEl.style.transform = `translate(${String(e.clientX + 8)}px, ${String(e.clientY + 8)}px)`
    }

    private updateTarget(e: PointerEvent): void {
        if (!this.boardEl || !this.sourceColumnEl || !this.indicatorEl) return
        const cols = this.draggableColumns(this.boardEl).filter((c) => c !== this.sourceColumnEl)
        // Find the column the pointer is over (or nearest); drop before/after by half.
        let refEl: HTMLElement | null = null
        for (const col of cols) {
            const rect = col.getBoundingClientRect()
            if (e.clientX < rect.left + rect.width / 2) {
                refEl = col
                break
            }
        }
        this.insertIndex = refEl ? cols.indexOf(refEl) : cols.length
        // Overlay the indicator on the slot's gap (the board is its containing
        // block). Neighbors come from the FULL rendered column list (source and
        // Unmapped included) so the bar lands in the real visual gap.
        const all = Array.from(this.boardEl.querySelectorAll<HTMLElement>(':scope > .kap-column'))
        const nextIdx = refEl ? all.indexOf(refEl) : all.length
        const prev = all[nextIdx - 1] ?? null
        if (this.indicatorEl.parentElement !== this.boardEl) {
            this.boardEl.appendChild(this.indicatorEl)
        }
        this.indicatorEl.style.left = `${String(
            insertionLineOffset(
                {
                    prevEnd: prev ? prev.offsetLeft + prev.offsetWidth : null,
                    nextStart: refEl ? refEl.offsetLeft : null
                },
                INDICATOR_THICKNESS_PX,
                INDICATOR_FALLBACK_PX
            )
        )}px`
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        const order = this.committedOrder()
        const wasDragging = this.dragging
        const dragWin = this.dragWin
        this.cleanup()
        if (wasDragging) {
            const controller = new AbortController()
            dragWin.addEventListener(
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
        if (order) this.callbacks.onReorder(order)
    }

    /** The new order if the drag actually moved the source, else null. */
    private committedOrder(): string[] | null {
        if (!this.dragging || !this.boardEl || !this.sourceColumnEl || this.insertIndex < 0) {
            return null
        }
        const sourceId = this.sourceColumnEl.dataset['columnId']
        if (!sourceId) return null
        const others = this.draggableColumns(this.boardEl)
            .filter((c) => c !== this.sourceColumnEl)
            .map((c) => c.dataset['columnId'] ?? '')
        const current = this.draggableColumns(this.boardEl).map((c) => c.dataset['columnId'] ?? '')
        const next = [...others]
        next.splice(this.insertIndex, 0, sourceId)
        return next.join('\u0000') === current.join('\u0000') ? null : next
    }

    private cleanup(): void {
        this.dragWin.removeEventListener('pointermove', this.onPointerMove)
        this.dragWin.removeEventListener('pointerup', this.onPointerUp)
        this.dragWin.removeEventListener('pointercancel', this.onPointerCancel)
        this.sourceColumnEl?.removeClass('kap-column-dragging')
        this.ghostEl?.remove()
        this.indicatorEl?.remove()
        this.ghostEl = null
        this.indicatorEl = null
        this.sourceColumnEl = null
        this.boardEl = null
        this.insertIndex = -1
        this.dragging = false
        this.pointerId = null
    }
}
