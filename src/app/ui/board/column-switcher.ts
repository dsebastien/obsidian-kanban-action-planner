/**
 * Phone column switcher (issue #194).
 *
 * On a phone the board shows one column at a time (`.kap-phone` makes every
 * expanded column as wide as the board and snaps the horizontal scroll to
 * columns). A strip of chips above the board names every column with its card
 * count: tapping a chip scrolls to that column, and swiping the board moves
 * the highlight with it.
 *
 * The strip is read from the rendered board DOM after each render pass, so it
 * follows the board's own column order, collapse state and lanes without a
 * second source of truth. With swimlanes, a chip counts the column's cards
 * across every lane and scrolls every lane to the column.
 */

export interface SwitcherItem {
    columnId: string
    label: string
    count: number
}

/**
 * Index of the column that owns the scroll position: the last column whose
 * left edge is at or before the scroll offset (plus half a column of slack,
 * so a column more than half revealed wins). `offsets` are the columns' left
 * edges in the scroller's content coordinates, in order.
 */
export function activeColumnIndex(
    scrollLeft: number,
    offsets: readonly number[],
    columnWidth: number
): number {
    if (offsets.length === 0) return -1
    const probe = scrollLeft + columnWidth / 2
    let index = 0
    for (let i = 0; i < offsets.length; i++) {
        const offset = offsets[i]
        if (offset !== undefined && offset <= probe) index = i
    }
    return index
}

/** Whether two item lists render the same strip. */
export function sameItems(a: readonly SwitcherItem[], b: readonly SwitcherItem[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (item, i) =>
                item.columnId === b[i]?.columnId &&
                item.label === b[i]?.label &&
                item.count === b[i]?.count
        )
    )
}

/** Every horizontal column scroller on the board (one per lane). */
function boardScrollers(hostEl: HTMLElement): HTMLElement[] {
    return Array.from(
        hostEl.querySelectorAll<HTMLElement>(':scope > .kap-board, :scope > .kap-lanes .kap-board')
    )
}

/** The switcher items, read from the rendered board. */
function readItems(hostEl: HTMLElement): SwitcherItem[] {
    const items = new Map<string, SwitcherItem>()
    for (const board of boardScrollers(hostEl)) {
        for (const colEl of Array.from(
            board.querySelectorAll<HTMLElement>(':scope > .kap-column')
        )) {
            const columnId = colEl.dataset['columnId'] ?? ''
            const count = colEl.querySelectorAll('.kap-column-cards > .kap-card').length
            const existing = items.get(columnId)
            if (existing) {
                existing.count += count
                continue
            }
            const label = colEl.querySelector('.kap-column-title')?.textContent ?? columnId
            items.set(columnId, { columnId, label, count })
        }
    }
    return Array.from(items.values())
}

export class ColumnSwitcher {
    private readonly el: HTMLElement
    private hostEl: HTMLElement | null = null
    private items: SwitcherItem[] = []
    private activeId: string | null = null
    private frame: number | null = null
    private readonly reducedMotion: boolean

    private readonly onScroll = (e: Event): void => {
        const target = e.target as HTMLElement | null
        if (!target?.hasClass?.('kap-board')) return
        if (this.frame !== null) return
        this.frame = target.win.requestAnimationFrame(() => {
            this.frame = null
            this.updateActive(target)
        })
    }

    /** Mounts the (hidden) strip into `parentEl`, before `beforeEl`. */
    constructor(parentEl: HTMLElement, beforeEl: HTMLElement | null) {
        this.el = createDiv({
            cls: 'kap-column-switcher kap-hidden',
            attr: { 'role': 'tablist', 'aria-label': 'Columns' }
        })
        parentEl.insertBefore(this.el, beforeEl)
        this.reducedMotion =
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }

    /**
     * Refresh the strip from the board rendered in `hostEl`. Hidden when
     * `enabled` is false (not a phone, or not in board mode) or when no board
     * is mounted.
     */
    sync(hostEl: HTMLElement, enabled: boolean): void {
        if (this.hostEl !== hostEl) {
            this.hostEl?.removeEventListener('scroll', this.onScroll, true)
            this.hostEl = hostEl
            hostEl.addEventListener('scroll', this.onScroll, true)
        }
        const boards = enabled ? boardScrollers(hostEl) : []
        const items = boards.length > 0 ? readItems(hostEl) : []
        this.el.toggleClass('kap-hidden', items.length === 0)
        if (!sameItems(items, this.items)) {
            this.items = items
            this.render()
        }
        const first = boards[0]
        if (first) this.updateActive(first)
    }

    destroy(): void {
        this.hostEl?.removeEventListener('scroll', this.onScroll, true)
        if (this.frame !== null) this.el.win.cancelAnimationFrame(this.frame)
        this.el.remove()
    }

    private render(): void {
        this.el.empty()
        for (const item of this.items) {
            const chip = this.el.createEl('button', {
                cls: 'kap-column-switcher-chip',
                attr: { 'type': 'button', 'role': 'tab', 'aria-selected': 'false' }
            })
            chip.dataset['columnId'] = item.columnId
            chip.createSpan({ cls: 'kap-column-switcher-label', text: item.label })
            chip.createSpan({ cls: 'kap-column-switcher-count', text: String(item.count) })
            chip.addEventListener('click', () => this.scrollToColumn(item.columnId))
        }
        this.markActive()
    }

    /** Scroll every lane's board so `columnId` is the visible column. */
    private scrollToColumn(columnId: string): void {
        if (!this.hostEl) return
        for (const board of boardScrollers(this.hostEl)) {
            const colEl = Array.from(
                board.querySelectorAll<HTMLElement>(':scope > .kap-column')
            ).find((el) => el.dataset['columnId'] === columnId)
            if (!colEl) continue
            const padding = parseFloat(board.win.getComputedStyle(board).paddingLeft) || 0
            const left = Math.max(0, colEl.offsetLeft - padding)
            const from = board.scrollLeft
            board.scrollTo({ left, behavior: this.reducedMotion ? 'auto' : 'smooth' })
            // A smooth scroll that never starts (a throttled webview) would
            // leave the tap without effect: jump instead.
            board.win.setTimeout(() => {
                if (board.scrollLeft === from && Math.abs(from - left) > 1) board.scrollLeft = left
            }, 400)
        }
        this.activeId = columnId
        this.markActive()
    }

    private updateActive(board: HTMLElement): void {
        const columns = Array.from(board.querySelectorAll<HTMLElement>(':scope > .kap-column'))
        const padding = parseFloat(board.win.getComputedStyle(board).paddingLeft) || 0
        const index = activeColumnIndex(
            board.scrollLeft,
            columns.map((el) => el.offsetLeft - padding),
            board.clientWidth
        )
        const id = columns[index]?.dataset['columnId'] ?? null
        if (id === this.activeId) return
        this.activeId = id
        this.markActive()
    }

    private markActive(): void {
        for (const chip of Array.from(this.el.querySelectorAll<HTMLElement>('button'))) {
            const active = chip.dataset['columnId'] === this.activeId
            chip.toggleClass('kap-column-switcher-chip-active', active)
            chip.setAttribute('aria-selected', String(active))
            if (active) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
    }
}
