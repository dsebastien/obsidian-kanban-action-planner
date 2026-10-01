/**
 * Pointer-event drag-and-drop for the board.
 *
 * One delegated set of listeners on the board container drives dragging of any
 * `.kap-card`. Pointer events cover mouse, trackpad, and touch from a single
 * path. A drag begins only after the pointer moves past a small threshold (so
 * clicks still open notes). The drop target column + index are computed by
 * hit-testing column/card geometry, and shown with a placeholder line — an
 * absolutely positioned overlay in the card list, so repositioning it never
 * shifts cards or changes scroll extents (issue #105, finding 5.7).
 *
 * Accessibility: a non-drag fallback (right-click / long-press menu) is provided
 * by the renderer; this controller honours `prefers-reduced-motion` by skipping
 * the float-follow animation.
 *
 * Touch (issue #194, replacing the issue-#109 horizontal-swipe drag): a card
 * is picked up by a LONG PRESS. Cards use `touch-action: pan-x pan-y`, so any
 * swipe scrolls natively (the column vertically, the board sideways — on a
 * phone, to the next column); a finger that moves before the press completes
 * is a scroll and never a drag. Once the card is lifted, a non-passive
 * `touchmove` listener cancels the browser's pan, so the finger drags the
 * card in any direction. Lifting the finger without moving opens the card
 * menu: the touch counterpart of a right-click, and the only menu path on iOS
 * (which never fires `contextmenu`). The native long-press `contextmenu`
 * (Android) is swallowed during a touch press so the menu never opens
 * mid-drag. Mouse and pen keep the plain move-threshold drag.
 *
 * Edge auto-scroll: while dragging, holding the card near the edge of the
 * board, a column's card list or the lane stack scrolls it (see
 * `auto-scroll.ts`); scroll snapping is suspended for the drag
 * (`.kap-dragging` on the container).
 *
 * Move/up/cancel listeners bind to the card's own window (`containerEl.win`)
 * and hit-testing/ghost-parenting use its own document, so drags started in
 * popout windows track and complete there.
 */

import { insertionLineOffset } from './drop-indicator'
import { claimPointerDrag } from '../pointer-claim'
import { canScroll, edgeScrollStep } from './auto-scroll'

const DRAG_THRESHOLD_PX = 5
/** How long a finger must rest on a card to pick it up (touch only). */
export const LONG_PRESS_MS = 350
/** Finger travel (px) that turns a pending long press into a scroll. */
export const TOUCH_SLOP_PX = 8
/** Container class while a drag is in flight (suspends scroll snapping). */
const DRAGGING_CLASS = 'kap-dragging'
/** Card class while lifted by a long press, before it moves. */
const LIFTED_CLASS = 'kap-card-lifted'
/** Placeholder line thickness (px) — keep in sync with `.kap-card-placeholder`. */
const PLACEHOLDER_THICKNESS_PX = 2
/** Empty-list fallback offset ≈ the `.kap-column-cards` padding (0.5rem). */
const PLACEHOLDER_FALLBACK_PX = 8
/** Highlight class on a COLLAPSED column under the drag (issue #183). */
const COLLAPSED_DROP_CLASS = 'kap-column-drop-target'

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
    /** Window owning the in-flight drag (popout-safe); set at pointerdown. */
    private dragWin: Window = window
    private startX = 0
    private startY = 0
    private dragging = false
    private sourceCardEl: HTMLElement | null = null
    private ghostEl: HTMLElement | null = null
    private placeholderEl: HTMLElement | null = null
    private currentTarget: DropTarget | null = null
    /** The collapsed column currently highlighted as the drop target (#183). */
    private highlightedColumnEl: HTMLElement | null = null
    /** The in-flight press comes from a finger (long-press pick-up). */
    private touchPress = false
    /** A touch press completed its long press: the card is picked up. */
    private lifted = false
    private longPressTimer: number | null = null
    /** Last pointer position during a drag (drives the auto-scroll loop). */
    private lastX = 0
    private lastY = 0
    private scrollFrame: number | null = null
    /** Set while this controller re-dispatches `contextmenu` itself. */
    private dispatchingMenu = false

    private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e)
    private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e)
    private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e)
    private readonly onPointerCancel = (): void => this.cancel()
    /** Cancels the browser's pan once a card is lifted (must be non-passive). */
    private readonly onTouchMove = (e: TouchEvent): void => {
        if (this.lifted && e.cancelable) e.preventDefault()
    }
    /** Swallows the native long-press menu while a touch press is in flight. */
    private readonly onContextMenu = (e: MouseEvent): void => {
        if (this.dispatchingMenu || !this.touchPress || this.pointerId === null) return
        e.preventDefault()
        e.stopPropagation()
    }

    constructor(containerEl: HTMLElement, callbacks: BoardDndCallbacks) {
        this.containerEl = containerEl
        this.callbacks = callbacks
        this.reducedMotion =
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        this.containerEl.addEventListener('pointerdown', this.onPointerDown)
        this.containerEl.addEventListener('touchmove', this.onTouchMove, { passive: false })
        this.containerEl.addEventListener('contextmenu', this.onContextMenu, true)
    }

    destroy(): void {
        this.containerEl.removeEventListener('pointerdown', this.onPointerDown)
        this.containerEl.removeEventListener('touchmove', this.onTouchMove)
        this.containerEl.removeEventListener('contextmenu', this.onContextMenu, true)
        this.cleanup()
    }

    private handlePointerDown(e: PointerEvent): void {
        if (e.button !== 0) return
        const target = e.target as HTMLElement | null
        const cardEl = target?.closest<HTMLElement>('.kap-card') ?? null
        if (!cardEl || !this.containerEl.contains(cardEl)) return
        claimPointerDrag(e)

        this.pointerId = e.pointerId
        this.dragWin = this.containerEl.win
        this.startX = e.clientX
        this.startY = e.clientY
        this.sourceCardEl = cardEl
        this.touchPress = e.pointerType === 'touch'
        if (this.touchPress) {
            this.longPressTimer = this.dragWin.setTimeout(() => this.lift(), LONG_PRESS_MS)
        }
        this.dragWin.addEventListener('pointermove', this.onPointerMove)
        this.dragWin.addEventListener('pointerup', this.onPointerUp)
        this.dragWin.addEventListener('pointercancel', this.onPointerCancel)
    }

    /** The long press completed: pick the card up (touch only). */
    private lift(): void {
        this.longPressTimer = null
        if (!this.sourceCardEl) return
        this.lifted = true
        this.sourceCardEl.addClass(LIFTED_CLASS)
        // A short buzz where the platform offers one (Android); a no-op elsewhere.
        try {
            this.dragWin.navigator.vibrate?.(10)
        } catch {
            // vibration is best-effort
        }
    }

    private handlePointerMove(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return

        if (!this.dragging) {
            const moved = Math.hypot(e.clientX - this.startX, e.clientY - this.startY)
            if (this.touchPress && !this.lifted) {
                // Moving before the long press completes is a scroll: let the
                // browser have it (it may already have sent pointercancel).
                if (moved > TOUCH_SLOP_PX) this.cleanup()
                return
            }
            if (moved < DRAG_THRESHOLD_PX) return
            this.beginDrag(e)
        }

        e.preventDefault()
        this.lastX = e.clientX
        this.lastY = e.clientY
        this.updateGhost(e)
        this.updateDropTarget(e.clientX, e.clientY)
    }

    private beginDrag(e: PointerEvent): void {
        if (!this.sourceCardEl) return
        this.dragging = true
        this.sourceCardEl.removeClass(LIFTED_CLASS)
        this.sourceCardEl.addClass('kap-card-dragging')
        this.containerEl.addClass(DRAGGING_CLASS)
        try {
            this.sourceCardEl.setPointerCapture(e.pointerId)
        } catch {
            // capture is best-effort
        }

        // Body-parenting the ghost (to escape the pane's stacking contexts)
        // drops the card's cascade context: ancestor-scoped rules — notably
        // compact title-only mode — no longer match a bare clone, so the
        // ghost rendered the full card content overflowing the compact
        // height (issue #171). A host div restores that context around the
        // clone; `.kap-card-ghost` (positioning, opacity, shadow) sits on
        // the host, the clone keeps its plain `.kap-card` look.
        const ghost = this.containerEl.doc.body.createDiv({ cls: 'kap-card-ghost' })
        if (this.containerEl.hasClass('kap-compact')) ghost.addClass('kap-compact')
        const clone = this.sourceCardEl.cloneNode(true) as HTMLElement
        // Cloned AFTER the source got its dragging style — strip it, or the
        // host's 0.9 opacity would multiply with the source's 0.4.
        clone.removeClass('kap-card-dragging')
        clone.style.width = `${String(this.sourceCardEl.offsetWidth)}px`
        // The board's --kap-card-height var doesn't reach the body-parented
        // ghost, so copy the equalized height too — otherwise the ghost falls
        // back to the min-height floor and visibly shrinks at drag start
        // (issue #105, finding 5.8).
        clone.style.height = `${String(this.sourceCardEl.offsetHeight)}px`
        ghost.appendChild(clone)
        this.ghostEl = ghost

        this.placeholderEl = createDiv({ cls: 'kap-card-placeholder' })
        this.scrollFrame = this.dragWin.requestAnimationFrame(() => this.autoScroll())
    }

    /**
     * One auto-scroll frame: scroll whatever scroller the pointer is holding
     * the card near the edge of, then re-aim the drop target (the content
     * moved under a still pointer). Re-schedules itself for the whole drag.
     */
    private autoScroll(): void {
        this.scrollFrame = null
        if (!this.dragging) return
        const x = this.lastX
        const y = this.lastY
        const under = this.containerEl.doc.elementFromPoint(x, y) as HTMLElement | null
        const board =
            under?.closest<HTMLElement>('.kap-board') ??
            this.sourceCardEl?.closest<HTMLElement>('.kap-board') ??
            null
        let scrolled = false
        if (board && this.containerEl.contains(board)) {
            const r = board.getBoundingClientRect()
            const step = edgeScrollStep(x, r.left, r.right)
            if (canScroll(step, board.scrollLeft, board.scrollWidth, board.clientWidth)) {
                board.scrollLeft += step
                scrolled = true
            }
        }
        // The innermost vertical scroller under the pointer that can move: a
        // column's card list first, then the lane stack.
        const verticals = [
            under?.closest<HTMLElement>('.kap-column-cards') ?? null,
            under?.closest<HTMLElement>('.kap-lanes') ?? null
        ]
        for (const el of verticals) {
            if (!el || !this.containerEl.contains(el)) continue
            const r = el.getBoundingClientRect()
            const step = edgeScrollStep(y, r.top, r.bottom)
            if (canScroll(step, el.scrollTop, el.scrollHeight, el.clientHeight)) {
                el.scrollTop += step
                scrolled = true
                break
            }
        }
        if (scrolled) this.updateDropTarget(x, y)
        this.scrollFrame = this.dragWin.requestAnimationFrame(() => this.autoScroll())
    }

    private updateGhost(e: PointerEvent): void {
        if (!this.ghostEl || this.reducedMotion) return
        this.ghostEl.style.transform = `translate(${String(e.clientX + 8)}px, ${String(
            e.clientY + 8
        )}px)`
    }

    private updateDropTarget(clientX: number, clientY: number): void {
        const columnEl = this.columnElementAt(clientX, clientY)
        if (!columnEl || !this.placeholderEl) {
            this.clearDropFeedback()
            this.currentTarget = null
            return
        }
        const columnId = columnEl.dataset['columnId'] ?? ''
        const laneId = columnEl.dataset['laneId'] ?? ''
        const listEl = columnEl.querySelector<HTMLElement>('.kap-column-cards')
        if (!listEl) {
            // No card list to aim at: drop nowhere rather than keeping the
            // previous target, which would land the card in a column the
            // pointer has already left.
            this.clearDropFeedback()
            this.currentTarget = null
            return
        }

        const cardEls = Array.from(
            listEl.querySelectorAll<HTMLElement>('.kap-card:not(.kap-card-dragging)')
        )

        // A COLLAPSED column still accepts a drop (park a card in a lane you
        // are not looking at), but its card list is `display: none`, so the
        // insertion line lands inside a hidden box and the column reads as
        // inert. Highlight the whole bar instead and append at the end — there
        // is no visible order to aim within (issue #183).
        if (columnEl.hasClass('kap-column-collapsed')) {
            this.setHighlightedColumn(columnEl)
            this.placeholderEl.remove()
            this.currentTarget = { laneId, columnId, index: cardEls.length }
            return
        }
        this.setHighlightedColumn(null)

        let index = cardEls.length
        for (let i = 0; i < cardEls.length; i++) {
            const rect = cardEls[i]?.getBoundingClientRect()
            if (rect && clientY < rect.top + rect.height / 2) {
                index = i
                break
            }
        }

        // Overlay the insertion line on the slot (the card list is the
        // placeholder's containing block): cards never move to make room.
        const next = cardEls[index] ?? null
        const prev = cardEls[index - 1] ?? null
        if (this.placeholderEl.parentElement !== listEl) listEl.appendChild(this.placeholderEl)
        this.placeholderEl.style.top = `${String(
            insertionLineOffset(
                {
                    prevEnd: prev ? prev.offsetTop + prev.offsetHeight : null,
                    nextStart: next ? next.offsetTop : null
                },
                PLACEHOLDER_THICKNESS_PX,
                PLACEHOLDER_FALLBACK_PX
            )
        )}px`
        this.currentTarget = { laneId, columnId, index }
    }

    /** Move the collapsed-column highlight, or clear it when passed null. */
    private setHighlightedColumn(columnEl: HTMLElement | null): void {
        if (this.highlightedColumnEl === columnEl) return
        this.highlightedColumnEl?.removeClass(COLLAPSED_DROP_CLASS)
        columnEl?.addClass(COLLAPSED_DROP_CLASS)
        this.highlightedColumnEl = columnEl
    }

    /** Drop every visual drop affordance (highlight + insertion line). */
    private clearDropFeedback(): void {
        this.setHighlightedColumn(null)
        this.placeholderEl?.remove()
    }

    private columnElementAt(x: number, y: number): HTMLElement | null {
        const el = this.containerEl.doc.elementFromPoint(x, y) as HTMLElement | null
        return el?.closest<HTMLElement>('.kap-column') ?? null
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerId !== e.pointerId) return
        const cardEl = this.sourceCardEl
        const cardKey = cardEl?.dataset['cardKey'] ?? null
        const target = this.currentTarget
        const wasDragging = this.dragging
        // Lifted by a long press, then released in place: the card menu.
        const openMenu = this.lifted && !this.dragging
        const dragWin = this.dragWin
        this.cleanup()
        if (wasDragging || openMenu) {
            // Swallow the click the browser fires after a drag so it does not
            // also open the note. Auto-expires so a later genuine click is safe.
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
        if (wasDragging && cardKey && target) {
            this.callbacks.onDrop(cardKey, target)
        }
        if (openMenu && cardEl?.isConnected) {
            // Through the card's own contextmenu handler, so the touch menu is
            // exactly the right-click menu.
            this.dispatchingMenu = true
            try {
                cardEl.dispatchEvent(
                    new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        clientX: e.clientX,
                        clientY: e.clientY
                    })
                )
            } finally {
                this.dispatchingMenu = false
            }
        }
    }

    private cancel(): void {
        this.cleanup()
    }

    private cleanup(): void {
        if (this.longPressTimer !== null) this.dragWin.clearTimeout(this.longPressTimer)
        if (this.scrollFrame !== null) this.dragWin.cancelAnimationFrame(this.scrollFrame)
        this.longPressTimer = null
        this.scrollFrame = null
        this.touchPress = false
        this.lifted = false
        this.containerEl.removeClass(DRAGGING_CLASS)
        this.sourceCardEl?.removeClass(LIFTED_CLASS)
        this.dragWin.removeEventListener('pointermove', this.onPointerMove)
        this.dragWin.removeEventListener('pointerup', this.onPointerUp)
        this.dragWin.removeEventListener('pointercancel', this.onPointerCancel)
        this.sourceCardEl?.removeClass('kap-card-dragging')
        this.ghostEl?.remove()
        this.clearDropFeedback()
        this.ghostEl = null
        this.placeholderEl = null
        this.sourceCardEl = null
        this.currentTarget = null
        this.dragging = false
        this.pointerId = null
    }
}
