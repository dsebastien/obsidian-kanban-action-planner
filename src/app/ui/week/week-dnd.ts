import type { Slot } from '../../domain/time-blocks'
import { GRID_MINUTES, MINUTES_PER_DAY, formatMinutes, snapToGrid } from '../../domain/time-blocks'
import type { WeekGridConfig } from '../../domain/week-planner'
import { minutesAtOffset } from '../../domain/week-planner'
import { claimPointerDrag } from '../pointer-claim'

/**
 * Ideal Week pointer gestures (issue #172, phase B), delegated from one
 * container:
 * - drag a block's body → move it (Alt held at drop = copy instead);
 * - drag a block's top / bottom handle → resize its start / end;
 * - drag a block's left / right handle → stretch its repeat across days;
 * - drag on an empty area → marquee-select the blocks it touches;
 * - click an empty spot of a day column → create a block there (a click
 *   while blocks are selected only clears the selection);
 * - Shift-click a block → toggle it in the selection; a plain click opens
 *   the note (Ctrl/Cmd-click in a new tab), on blocks and rail entries alike;
 * - drag a rail entry onto a day column → create a block for that note;
 * - Delete / Backspace with a selection → remove the selected blocks;
 * - Ctrl/Cmd+C copies the selection (or the focused block), Ctrl/Cmd+V
 *   pastes it at the grid cell under the mouse pointer (that cell is lit
 *   while the clipboard holds blocks);
 * - phase E: Alt-drag on the empty grid draws a new block; dragging a
 *   selected block moves the whole selection; Ctrl/Cmd+A selects all;
 *   Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or +Y) undo / redo; right-click on an
 *   empty cell opens the cell menu.
 *
 * Geometry is read live from the day columns' rects, so scrolling and
 * popout windows work. Every gesture previews in place and commits ONCE
 * on pointer-up through the callbacks; a `pointercancel` restores the
 * DOM and writes nothing. The controller validates (overlaps) on commit.
 */

const DRAG_THRESHOLD_PX = 5

export interface WeekDndCallbacks {
    /** Current grid config (scale, bounds). */
    config(): WeekGridConfig
    /** Length of a click-created block, in minutes. */
    newBlockMinutes(): number
    /** The keys currently selected (the controller owns the selection). */
    selectedKeys(): ReadonlySet<string>
    onMove(path: string, from: Slot, to: Slot, copy: boolean): void
    onResize(path: string, from: Slot, to: Slot): void
    /** Stretch the run of days of `from` by its `edge` to `toDay`. */
    onSpan(path: string, from: Slot, edge: 'left' | 'right', toDay: number): void
    onCreate(day: number, startMinutes: number): void
    onRailDrop(path: string, day: number, startMinutes: number): void
    /** A block or rail entry clicked without dragging (opens the note). */
    onBlockClick(path: string, newTab: boolean): void
    /** Replace the selection (marquee) / toggle one key (Shift-click). */
    onSelect(keys: string[]): void
    onToggleSelect(key: string): void
    /** Delete pressed with a non-empty selection. */
    onDeleteSelection(): void
    /** Ctrl+C on the given block keys; Ctrl+V at a grid cell (day, floored minutes). */
    onCopy(keys: string[]): void
    onPaste(day: number, startMinutes: number): void
    /** Phase E: the selection dragged as one (the dragged block's key is selected). */
    onMoveSelection(path: string, from: Slot, to: Slot, copy: boolean): void
    /** Alt-drag on the empty grid drew a block from `start` to `end` on `day`. */
    onCreateRange(day: number, startMinutes: number, endMinutes: number): void
    onSelectAll(): void
    onUndo(): void
    onRedo(): void
    /** Right-click on an empty cell. */
    onCellContextMenu(day: number, minutes: number, event: MouseEvent): void
    /** Whether the clipboard holds blocks (drives the paste-target highlight). */
    hasClipboard(): boolean
}

type Gesture =
    | { kind: 'move'; el: HTMLElement; path: string; from: Slot; grabOffsetMin: number }
    | { kind: 'resize'; el: HTMLElement; path: string; from: Slot; edge: 'start' | 'end' }
    | { kind: 'span'; el: HTMLElement; path: string; from: Slot; edge: 'left' | 'right' }
    | { kind: 'rail'; el: HTMLElement; path: string }
    | { kind: 'marquee'; gridEl: HTMLElement }
    | { kind: 'create'; dayEl: HTMLElement; day: number; anchor: number }

export class WeekDnd {
    private readonly containerEl: HTMLElement
    private readonly callbacks: WeekDndCallbacks
    private gesture: Gesture | null = null
    private startX = 0
    private startY = 0
    private moved = false
    private ghost: HTMLElement | null = null
    private label: HTMLElement | null = null
    private marqueeEl: HTMLElement | null = null
    /** The landing preview: a dashed outline where the drop would put the block. */
    private phantom: HTMLElement | null = null
    private preview: Slot | null = null
    private previewDay: number | null = null
    private previewKeys: string[] = []
    private previewDayEl: HTMLElement | null = null
    private dragWin: Window | null = null
    private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e)
    private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e)
    private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e)
    private readonly onPointerCancel = (): void => this.cancel()
    private readonly onClick = (e: MouseEvent): void => this.handleClick(e)
    private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e)
    private readonly onContextMenu = (e: MouseEvent): void => this.handleContextMenu(e)
    /** Last pointer position over the container (the paste target). */
    private lastPointer: { x: number; y: number } | null = null
    /** The paste-target highlight (phase E): the cell under the pointer while the clipboard holds blocks. */
    private pasteHint: HTMLElement | null = null
    private readonly onHover = (e: PointerEvent): void => {
        this.lastPointer = { x: e.clientX, y: e.clientY }
        this.updatePasteHint(e.clientX, e.clientY)
    }
    private readonly onLeave = (): void => this.hidePasteHint()

    constructor(containerEl: HTMLElement, callbacks: WeekDndCallbacks) {
        this.containerEl = containerEl
        this.callbacks = callbacks
        containerEl.addEventListener('pointerdown', this.onPointerDown)
        containerEl.addEventListener('click', this.onClick)
        containerEl.addEventListener('keydown', this.onKeyDown)
        containerEl.addEventListener('pointermove', this.onHover)
        containerEl.addEventListener('pointerleave', this.onLeave)
        containerEl.addEventListener('contextmenu', this.onContextMenu)
    }

    destroy(): void {
        this.containerEl.removeEventListener('pointerdown', this.onPointerDown)
        this.containerEl.removeEventListener('click', this.onClick)
        this.containerEl.removeEventListener('keydown', this.onKeyDown)
        this.containerEl.removeEventListener('pointermove', this.onHover)
        this.containerEl.removeEventListener('pointerleave', this.onLeave)
        this.containerEl.removeEventListener('contextmenu', this.onContextMenu)
        this.hidePasteHint()
        this.cancel()
    }

    // ── Pointer down ────────────────────────────────────────────────

    private handlePointerDown(e: PointerEvent): void {
        if (e.button !== 0) return
        const target = e.target as HTMLElement | null
        if (!target) return
        const handle = target.closest<HTMLElement>('.kap-week-handle')
        const block = target.closest<HTMLElement>('.kap-week-block')
        const rail = target.closest<HTMLElement>('.kap-week-rail-item')
        const gridEl = target.closest<HTMLElement>('.kap-week-grid')
        if (block && this.containerEl.contains(block)) {
            const from = slotOf(block)
            const path = block.dataset['path'] ?? ''
            if (!from || !path) return
            claimPointerDrag(e)
            const sideEdge = handle
                ? handle.hasClass('kap-week-handle-left')
                    ? 'left'
                    : handle.hasClass('kap-week-handle-right')
                      ? 'right'
                      : null
                : sideEdgeAt(block, e.clientX)
            if (sideEdge) {
                this.gesture = { kind: 'span', el: block, path, from, edge: sideEdge }
            } else if (handle) {
                const edge = handle.hasClass('kap-week-handle-top') ? 'start' : 'end'
                this.gesture = { kind: 'resize', el: block, path, from, edge }
            } else {
                const cfg = this.callbacks.config()
                const dayEl = block.closest<HTMLElement>('.kap-week-day')
                const rect = dayEl?.getBoundingClientRect()
                const pointerMin = rect
                    ? cfg.gridStart + (e.clientY - rect.top) / cfg.pxPerMinute
                    : from.start
                // Continuation pieces sit on the next day: the grab offset is
                // measured against the slot's real start on its own day.
                const continuation = block.dataset['continuation'] === '1'
                const grabOffsetMin = continuation
                    ? MINUTES_PER_DAY + pointerMin - from.start
                    : pointerMin - from.start
                this.gesture = { kind: 'move', el: block, path, from, grabOffsetMin }
            }
        } else if (rail && this.containerEl.contains(rail)) {
            const path = rail.dataset['path'] ?? ''
            if (!path) return
            claimPointerDrag(e)
            this.gesture = { kind: 'rail', el: rail, path }
        } else if (gridEl && this.containerEl.contains(gridEl) && target.closest('.kap-week-day')) {
            // Empty area of a day column: a drag becomes a marquee selection
            // (Alt-drag draws a new block instead), a plain click creates
            // (handled by the click listener).
            claimPointerDrag(e)
            const dayEl = target.closest<HTMLElement>('.kap-week-day')
            const day = Number(dayEl?.dataset['day'])
            if (e.altKey && dayEl && Number.isFinite(day)) {
                const cfg = this.callbacks.config()
                const rect = dayEl.getBoundingClientRect()
                const raw = cfg.gridStart + (e.clientY - rect.top) / cfg.pxPerMinute
                this.gesture = { kind: 'create', dayEl, day, anchor: floorToGrid(raw) }
            } else {
                this.gesture = { kind: 'marquee', gridEl }
            }
        } else {
            return
        }
        this.startX = e.clientX
        this.startY = e.clientY
        this.moved = false
        try {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
            // Best effort: the window listeners below carry the gesture anyway.
        }
        this.dragWin = this.containerEl.win
        this.dragWin.addEventListener('pointermove', this.onPointerMove)
        this.dragWin.addEventListener('pointerup', this.onPointerUp)
        this.dragWin.addEventListener('pointercancel', this.onPointerCancel)
    }

    // ── Pointer move ────────────────────────────────────────────────

    private handlePointerMove(e: PointerEvent): void {
        const gesture = this.gesture
        if (!gesture) return
        if (!this.moved) {
            if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < DRAG_THRESHOLD_PX) {
                return
            }
            this.moved = true
            this.beginDrag(gesture)
        }
        const cfg = this.callbacks.config()
        if (gesture.kind === 'marquee') {
            this.updateMarquee(gesture.gridEl, e.clientX, e.clientY)
            return
        }
        if (gesture.kind === 'create') {
            const rect = gesture.dayEl.getBoundingClientRect()
            const raw = cfg.gridStart + (e.clientY - rect.top) / cfg.pxPerMinute
            const cell = floorToGrid(raw)
            const start = Math.max(cfg.gridStart, Math.min(gesture.anchor, cell))
            const end = Math.min(cfg.gridEnd, Math.max(gesture.anchor, cell) + GRID_MINUTES)
            this.preview = { day: gesture.day, start, end: Math.max(start + GRID_MINUTES, end) }
            this.showPhantom(gesture.dayEl, this.preview, cfg)
            this.setLabel(
                `${formatMinutes(this.preview.start)}–${formatMinutes(this.preview.end)} · new block`
            )
            return
        }
        const hit = this.dayAt(e.clientX, e.clientY)
        if (gesture.kind === 'rail') {
            this.moveGhost(e.clientX, e.clientY)
            this.setDropHint(hit?.el ?? null)
            if (hit) {
                const start = clampStart(
                    floorToGrid(hit.minutes),
                    this.callbacks.newBlockMinutes(),
                    cfg
                )
                this.preview = {
                    day: hit.day,
                    start,
                    end: start + this.callbacks.newBlockMinutes()
                }
                this.showPhantom(hit.el, this.preview, cfg)
                this.setLabel(
                    `${formatMinutes(this.preview.start)}–${formatMinutes(this.preview.end)}`
                )
            } else {
                this.preview = null
                this.hidePhantom()
                this.setLabel('Drop on a day to plan a block')
            }
            return
        }
        if (gesture.kind === 'span') {
            if (!hit) return
            this.previewDay = hit.day
            this.setDropHint(hit.el)
            const from = gesture.from
            this.showPhantom(hit.el, from, cfg)
            const range =
                gesture.edge === 'right'
                    ? `${dayName(from.day)} → ${dayName(hit.day)}`
                    : `${dayName(hit.day)} → ${dayName(from.day)}`
            this.setLabel(`${range} · ${formatMinutes(from.start)}–${formatMinutes(from.end)}`)
            const rect = gesture.el.getBoundingClientRect()
            if (this.label)
                this.label.style.transform = `translate(${rect.left}px, ${rect.top - 28}px)`
            return
        }
        if (gesture.kind === 'move') {
            if (!hit) return
            const length = gesture.from.end - gesture.from.start
            const rawStart = hit.minutes - gesture.grabOffsetMin
            const start = clampStart(snapToGrid(rawStart), length, cfg)
            this.preview = { day: hit.day, start, end: start + length }
            this.showPhantom(hit.el, this.preview, cfg)
            const group = this.selectionSizeFor(gesture.path, gesture.from)
            this.setLabel(
                `${formatMinutes(this.preview.start)}–${formatMinutes(this.preview.end)}${group > 1 ? ` · ${group} blocks` : ''}${e.altKey ? ' · copy' : ''}`
            )
            return
        }
        // Resize: the slot's own day column decides the minute; only Y matters.
        const dayEl = gesture.el.closest<HTMLElement>('.kap-week-day')
        if (!dayEl) return
        const rect = dayEl.getBoundingClientRect()
        const continuation = gesture.el.dataset['continuation'] === '1'
        let minutes = minutesAtOffset(e.clientY - rect.top, cfg)
        if (continuation) minutes += MINUTES_PER_DAY
        const from = gesture.from
        let next: Slot
        if (gesture.edge === 'start') {
            const start = Math.min(from.end - GRID_MINUTES, Math.max(0, minutes))
            next = { day: from.day, start, end: from.end }
        } else {
            const end = Math.min(
                from.start + MINUTES_PER_DAY,
                Math.max(from.start + GRID_MINUTES, minutes)
            )
            next = { day: from.day, start: from.start, end }
        }
        this.preview = next
        this.previewResize(gesture.el, next, cfg, continuation)
        this.setLabel(`${formatMinutes(next.start)}–${formatMinutes(next.end)}`)
    }

    // ── Pointer up / cancel ─────────────────────────────────────────

    private handlePointerUp(e: PointerEvent): void {
        const gesture = this.gesture
        const preview = this.preview
        const previewDay = this.previewDay
        const previewKeys = this.previewKeys
        const moved = this.moved
        this.cleanupListeners()
        if (!gesture) return
        this.gesture = null
        if (!moved) {
            // A plain click: the click handler opens the note / creates a block.
            this.removeChrome()
            return
        }
        this.restore(gesture)
        this.removeChrome()
        this.swallowNextClick()
        if (gesture.kind === 'marquee') {
            this.callbacks.onSelect(previewKeys)
            gesture.gridEl.focus()
            return
        }
        if (gesture.kind === 'span') {
            if (previewDay !== null && previewDay !== gesture.from.day) {
                this.callbacks.onSpan(gesture.path, gesture.from, gesture.edge, previewDay)
            }
            return
        }
        if (!preview) return
        if (gesture.kind === 'create') {
            this.callbacks.onCreateRange(preview.day, preview.start, preview.end)
            return
        }
        if (gesture.kind === 'rail') {
            this.callbacks.onRailDrop(gesture.path, preview.day, preview.start)
        } else if (gesture.kind === 'move') {
            if (
                preview.day !== gesture.from.day ||
                preview.start !== gesture.from.start ||
                e.altKey
            ) {
                if (this.selectionSizeFor(gesture.path, gesture.from) > 1) {
                    this.callbacks.onMoveSelection(gesture.path, gesture.from, preview, e.altKey)
                } else {
                    this.callbacks.onMove(gesture.path, gesture.from, preview, e.altKey)
                }
            }
        } else if (preview.start !== gesture.from.start || preview.end !== gesture.from.end) {
            this.callbacks.onResize(gesture.path, gesture.from, preview)
        }
    }

    private cancel(): void {
        const gesture = this.gesture
        this.cleanupListeners()
        this.gesture = null
        if (gesture) this.restore(gesture)
        this.removeChrome()
    }

    private cleanupListeners(): void {
        const win = this.dragWin
        if (win) {
            win.removeEventListener('pointermove', this.onPointerMove)
            win.removeEventListener('pointerup', this.onPointerUp)
            win.removeEventListener('pointercancel', this.onPointerCancel)
        }
        this.dragWin = null
    }

    /** Eat the click the browser fires after a completed drag (it would open the note). */
    private swallowNextClick(): void {
        const doc = this.containerEl.ownerDocument
        const swallow = (ev: MouseEvent): void => {
            ev.stopPropagation()
            ev.preventDefault()
        }
        doc.addEventListener('click', swallow, { capture: true, once: true })
        this.containerEl.win.setTimeout(() => {
            doc.removeEventListener('click', swallow, { capture: true })
        }, 50)
    }

    // ── Clicks and keys ─────────────────────────────────────────────

    private handleClick(e: MouseEvent): void {
        const target = e.target as HTMLElement | null
        if (!target) return
        const block = target.closest<HTMLElement>('.kap-week-block')
        if (block) {
            const path = block.dataset['path']
            const key = block.dataset['key']
            // Shift-click toggles the selection; Ctrl/Cmd-click opens in a
            // new tab (Obsidian's convention, same as board cards).
            if (e.shiftKey) {
                if (key) this.callbacks.onToggleSelect(key)
                return
            }
            if (path) this.callbacks.onBlockClick(path, e.ctrlKey || e.metaKey)
            return
        }
        const rail = target.closest<HTMLElement>('.kap-week-rail-item')
        if (rail) {
            const path = rail.dataset['path']
            if (path) this.callbacks.onBlockClick(path, e.ctrlKey || e.metaKey)
            return
        }
        const dayEl = target.closest<HTMLElement>('.kap-week-day')
        if (!dayEl || !this.containerEl.contains(dayEl)) return
        // With a selection, a click on empty space only clears it.
        if (this.callbacks.selectedKeys().size > 0) {
            this.callbacks.onSelect([])
            return
        }
        const day = Number(dayEl.dataset['day'])
        if (!Number.isFinite(day)) return
        const cfg = this.callbacks.config()
        const rect = dayEl.getBoundingClientRect()
        // The cell the pointer is IN, not the nearest line: floor, never round.
        const raw = cfg.gridStart + (e.clientY - rect.top) / cfg.pxPerMinute
        const minutes = Math.min(
            cfg.gridEnd - GRID_MINUTES,
            Math.max(cfg.gridStart, floorToGrid(raw))
        )
        this.callbacks.onCreate(day, minutes)
    }

    private handleKeyDown(e: KeyboardEvent): void {
        const target = e.target as HTMLElement | null
        const focusedBlock = target?.closest<HTMLElement>('.kap-week-block') ?? null
        const mod = e.ctrlKey || e.metaKey
        if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault()
            if (e.shiftKey) this.callbacks.onRedo()
            else this.callbacks.onUndo()
            return
        }
        if (mod && !e.altKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault()
            this.callbacks.onRedo()
            return
        }
        if (mod && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
            if (target?.closest('input, textarea, [contenteditable]')) return
            e.preventDefault()
            this.callbacks.onSelectAll()
            return
        }
        if (mod && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
            const selected = [...this.callbacks.selectedKeys()]
            const keys =
                selected.length > 0
                    ? selected
                    : focusedBlock?.dataset['key']
                      ? [focusedBlock.dataset['key']]
                      : []
            if (keys.length === 0) return
            e.preventDefault()
            this.callbacks.onCopy(keys)
            return
        }
        if (mod && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
            const at = this.lastPointer
            const hit = at ? this.dayAt(at.x, at.y) : null
            if (!hit) return
            e.preventDefault()
            const cfg = this.callbacks.config()
            const minutes = Math.min(
                cfg.gridEnd - GRID_MINUTES,
                Math.max(cfg.gridStart, floorToGrid(hit.minutes))
            )
            this.callbacks.onPaste(hit.day, minutes)
            return
        }
        // A focused block handles its own edit keys (renderer); this is the
        // selection-wide path from the grid or the container itself.
        if (focusedBlock) return
        if (this.callbacks.selectedKeys().size === 0) return
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            this.callbacks.onDeleteSelection()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            this.callbacks.onSelect([])
        }
    }

    /** How many blocks move with a drag of `from`: the selection when it holds it, else one. */
    private selectionSizeFor(path: string, from: Slot): number {
        const selected = this.callbacks.selectedKeys()
        const key = `${path}|${from.day}|${from.start}|${from.end}`
        return selected.has(key) ? selected.size : 1
    }

    private handleContextMenu(e: MouseEvent): void {
        const target = e.target as HTMLElement | null
        if (!target || target.closest('.kap-week-block') || target.closest('.kap-week-rail-item'))
            return
        const dayEl = target.closest<HTMLElement>('.kap-week-day')
        if (!dayEl || !this.containerEl.contains(dayEl)) return
        const day = Number(dayEl.dataset['day'])
        if (!Number.isFinite(day)) return
        e.preventDefault()
        const cfg = this.callbacks.config()
        const rect = dayEl.getBoundingClientRect()
        const minutes = cfg.gridStart + (e.clientY - rect.top) / cfg.pxPerMinute
        this.callbacks.onCellContextMenu(day, minutes, e)
    }

    /** Light the cell under the pointer while the clipboard holds blocks (and no drag runs). */
    private updatePasteHint(x: number, y: number): void {
        if (this.gesture || !this.callbacks.hasClipboard()) {
            this.hidePasteHint()
            return
        }
        const hit = this.dayAt(x, y)
        if (!hit) {
            this.hidePasteHint()
            return
        }
        const cfg = this.callbacks.config()
        const start = Math.min(
            cfg.gridEnd - GRID_MINUTES,
            Math.max(cfg.gridStart, floorToGrid(hit.minutes))
        )
        if (!this.pasteHint) this.pasteHint = hit.el.createDiv({ cls: 'kap-week-paste-hint' })
        if (this.pasteHint.parentElement !== hit.el) hit.el.appendChild(this.pasteHint)
        this.pasteHint.style.top = `${(start - cfg.gridStart) * cfg.pxPerMinute}px`
        this.pasteHint.style.height = `${GRID_MINUTES * cfg.pxPerMinute}px`
    }

    private hidePasteHint(): void {
        this.pasteHint?.remove()
        this.pasteHint = null
    }

    // ── Preview helpers ─────────────────────────────────────────────

    private beginDrag(gesture: Gesture): void {
        const doc = this.containerEl.ownerDocument
        if (gesture.kind === 'marquee') {
            this.marqueeEl = gesture.gridEl.createDiv({ cls: 'kap-week-marquee' })
            this.previewKeys = []
            return
        }
        this.label = createFloatingLabel(doc)
        if (gesture.kind === 'create') return
        if (gesture.kind === 'rail') {
            this.ghost = gesture.el.cloneNode(true) as HTMLElement
            this.ghost.addClass('kap-card-ghost')
            this.ghost.style.width = `${gesture.el.getBoundingClientRect().width}px`
            doc.body.appendChild(this.ghost)
            gesture.el.addClass('kap-card-dragging')
        } else {
            gesture.el.addClass('kap-week-block-dragging')
        }
    }

    /** Draw the rubber band inside the grid and highlight the blocks it touches. */
    private updateMarquee(gridEl: HTMLElement, x: number, y: number): void {
        const marquee = this.marqueeEl
        if (!marquee) return
        const gridRect = gridEl.getBoundingClientRect()
        const left = Math.min(this.startX, x)
        const top = Math.min(this.startY, y)
        const right = Math.max(this.startX, x)
        const bottom = Math.max(this.startY, y)
        marquee.style.left = `${left - gridRect.left}px`
        marquee.style.top = `${top - gridRect.top}px`
        marquee.style.width = `${right - left}px`
        marquee.style.height = `${bottom - top}px`
        const keys: string[] = []
        for (const block of Array.from(gridEl.querySelectorAll<HTMLElement>('.kap-week-block'))) {
            const r = block.getBoundingClientRect()
            const hit = r.left < right && r.right > left && r.top < bottom && r.bottom > top
            block.toggleClass('kap-week-block-marquee', hit)
            const key = block.dataset['key']
            if (hit && key && !keys.includes(key)) keys.push(key)
        }
        this.previewKeys = keys
    }

    private moveGhost(x: number, y: number): void {
        if (this.ghost) this.ghost.style.transform = `translate(${x + 8}px, ${y + 8}px)`
        if (this.label) this.label.style.transform = `translate(${x + 14}px, ${y - 28}px)`
    }

    private setLabel(text: string): void {
        if (this.label) this.label.setText(text)
    }

    private setDropHint(dayEl: HTMLElement | null): void {
        if (this.previewDayEl !== dayEl) {
            this.previewDayEl?.removeClass('kap-cal-drop')
            dayEl?.addClass('kap-cal-drop')
            this.previewDayEl = dayEl
        }
    }

    /** Draw (or move) the landing outline in `dayEl` at `slot`. */
    private showPhantom(dayEl: HTMLElement, slot: Slot, cfg: WeekGridConfig): void {
        if (!this.phantom) this.phantom = dayEl.createDiv({ cls: 'kap-week-phantom' })
        if (this.phantom.parentElement !== dayEl) dayEl.appendChild(this.phantom)
        const start = Math.max(slot.start, cfg.gridStart)
        const end = Math.min(slot.end, cfg.gridEnd)
        this.phantom.style.top = `${(start - cfg.gridStart) * cfg.pxPerMinute}px`
        this.phantom.style.height = `${Math.max(4, (end - start) * cfg.pxPerMinute)}px`
        const rect = this.phantom.getBoundingClientRect()
        if (this.label) this.label.style.transform = `translate(${rect.left}px, ${rect.top - 28}px)`
    }

    private hidePhantom(): void {
        this.phantom?.remove()
        this.phantom = null
    }

    private previewResize(
        el: HTMLElement,
        slot: Slot,
        cfg: WeekGridConfig,
        continuation: boolean
    ): void {
        const start = continuation ? 0 : slot.start
        const end = continuation ? slot.end - MINUTES_PER_DAY : Math.min(slot.end, cfg.gridEnd)
        el.style.top = `${(Math.max(start, cfg.gridStart) - cfg.gridStart) * cfg.pxPerMinute}px`
        el.style.height = `${Math.max(4, (end - Math.max(start, cfg.gridStart)) * cfg.pxPerMinute)}px`
        const rect = el.getBoundingClientRect()
        if (this.label) this.label.style.transform = `translate(${rect.left}px, ${rect.top - 28}px)`
    }

    /** Put a dragged element back where the render left it (the commit re-renders anyway). */
    private restore(gesture: Gesture): void {
        if (gesture.kind === 'marquee') {
            for (const block of Array.from(
                gesture.gridEl.querySelectorAll<HTMLElement>('.kap-week-block-marquee')
            )) {
                block.removeClass('kap-week-block-marquee')
            }
            return
        }
        if (gesture.kind === 'rail') {
            gesture.el.removeClass('kap-card-dragging')
            return
        }
        if (gesture.kind === 'create') return
        gesture.el.removeClass('kap-week-block-dragging')
    }

    private removeChrome(): void {
        this.hidePhantom()
        this.ghost?.remove()
        this.ghost = null
        this.label?.remove()
        this.label = null
        this.marqueeEl?.remove()
        this.marqueeEl = null
        this.setDropHint(null)
        this.preview = null
        this.previewDay = null
        this.previewKeys = []
    }

    /** The day column under a point and the grid minute at that height. */
    private dayAt(x: number, y: number): { el: HTMLElement; day: number; minutes: number } | null {
        const doc = this.containerEl.ownerDocument
        const under = doc.elementFromPoint(x, y) as HTMLElement | null
        let dayEl = under?.closest<HTMLElement>('.kap-week-day') ?? null
        if (!dayEl) {
            // Horizontal hit-test against the columns (the pointer may sit on
            // a block, the ghost, or the label).
            for (const col of Array.from(
                this.containerEl.querySelectorAll<HTMLElement>('.kap-week-day')
            )) {
                const r = col.getBoundingClientRect()
                if (x >= r.left && x < r.right) {
                    dayEl = col
                    break
                }
            }
        }
        if (!dayEl || !this.containerEl.contains(dayEl)) return null
        const day = Number(dayEl.dataset['day'])
        if (!Number.isFinite(day)) return null
        const cfg = this.callbacks.config()
        const rect = dayEl.getBoundingClientRect()
        const raw = cfg.gridStart + (y - rect.top) / cfg.pxPerMinute
        return { el: dayEl, day, minutes: Math.min(cfg.gridEnd, Math.max(cfg.gridStart, raw)) }
    }
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayName(day: number): string {
    return DAY_NAMES[((day % 7) + 7) % 7] ?? ''
}

/** The slot a rendered block piece stands for (its full slot, not the piece). */
function slotOf(el: HTMLElement): Slot | null {
    const day = Number(el.dataset['day'])
    const start = Number(el.dataset['start'])
    const end = Number(el.dataset['end'])
    if (![day, start, end].every(Number.isFinite)) return null
    return { day, start, end }
}

/**
 * Width of the grab zone along a block's left / right edge, in pixels. The
 * handle elements are the visual affordance; the zone is measured against
 * the block's own rect so a real mouse landing a little inside the edge
 * (or on the title text over it) still stretches instead of moving.
 */
export const SIDE_EDGE_PX = 10

/**
 * The side edge a press at `clientX` sits on for a piece spanning
 * `left`..`right`, or null for the body. A piece too narrow to keep a body
 * between the two zones is all body (it can still be moved).
 */
export function sideEdgeOf(
    left: number,
    right: number,
    clientX: number,
    zone = SIDE_EDGE_PX
): 'left' | 'right' | null {
    if (right - left < zone * 3) return null
    if (clientX - left <= zone) return 'left'
    if (right - clientX <= zone) return 'right'
    return null
}

/** `sideEdgeOf` for a rendered piece (continuation pieces have no side edges). */
export function sideEdgeAt(block: HTMLElement, clientX: number): 'left' | 'right' | null {
    // The run of days is edited on the piece that starts the slot, never on
    // the second half of a midnight crosser.
    if (block.dataset['continuation'] === '1') return null
    const rect = block.getBoundingClientRect()
    return sideEdgeOf(rect.left, rect.right, clientX)
}

/** Snap DOWN to the grid step: the cell the pointer is in. */
function floorToGrid(minutes: number): number {
    return Math.floor(minutes / GRID_MINUTES) * GRID_MINUTES
}

/** Keep a block of `length` minutes inside the grid's vertical bounds. */
function clampStart(start: number, length: number, cfg: WeekGridConfig): number {
    const maxStart = Math.max(
        cfg.gridStart,
        cfg.gridEnd - Math.min(length, cfg.gridEnd - cfg.gridStart)
    )
    return Math.min(maxStart, Math.max(cfg.gridStart, start))
}

/**
 * A floating drag label: a fixed `.kap-root` wrapper (so plugin CSS applies
 * in popout windows too) that callers move with `style.transform`.
 */
function createFloatingLabel(doc: Document): HTMLElement {
    return doc.body.createDiv({ cls: 'kap-root kap-week-drag-label' })
}
