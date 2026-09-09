import { Notice } from 'obsidian'
import type { App, Menu } from 'obsidian'
import type { KanbanCard } from '../../ui/board/types'
import { parseFrontmatterDate, startOfDay } from '../../domain/calendar'
import {
    GRID_MINUTES,
    MINUTES_PER_DAY,
    addSlot,
    findOverlap,
    formatMinutes,
    formatTimeBlocks,
    parseTimeBlocks,
    plannedMinutesPerWeek,
    removeSlot,
    replaceSlot,
    slotsOf,
    spanRun
} from '../../domain/time-blocks'
import type { OwnedSlot, Slot, TimeBlock } from '../../domain/time-blocks'
import {
    columnDays,
    groupByStatus,
    inWeekWindow,
    newBlockSlot,
    slotKey,
    slotPieces
} from '../../domain/week-planner'
import type { WeekEntry, WeekGridConfig } from '../../domain/week-planner'
import { renderWeek } from '../../ui/week/week-renderer'
import type { BlockKeyAction, WeekBlockPiece, WeekViewModel } from '../../ui/week/week-renderer'
import { WeekNotePickerModal } from '../../ui/week/week-note-picker'
import type { WeekPickerItem } from '../../ui/week/week-note-picker'
import { EstimatePromptModal } from '../../ui/timeline/estimate-modal'
import type { ContextLegendItem } from '../../ui/calendar/calendar-renderer'
import { contextColor } from '../../services/colors.service'
import { coerceOrder, getFrontmatterValue, setProperties } from '../../services/frontmatter.service'
import {
    WEEK_SCROLLER_SELECTORS,
    captureScrollBySelector,
    pruneStaleContent,
    restoreScrollBySelector
} from '../../ui/scroll-preservation'

/** Durable per-view ideal-week state. */
export interface WeekViewState {
    panelCollapsed: boolean
}

/** The settings the mode reads (resolved by the host). */
export interface WeekSettings {
    timeBlocksProperty: string
    plannedMinutesProperty: string
    targetMinutesProperty: string
    gridStartHour: number
    gridEndHour: number
    workStartMinutes: number
    workEndMinutes: number
    workDays: number[]
    blockMinutes: number
    pixelsPerHour: number
}

/** What the controller asks the view for (closures; nothing is cached). */
export interface WeekHost {
    readonly app: App
    boardEl(): HTMLElement | null
    refresh(): void
    isWeekMode(): boolean
    openCard(card: KanbanCard, newTab: boolean): void
    showCardMenu(card: KanbanCard, event: MouseEvent, extend?: (menu: Menu) => void): void
    cardForKey(key: string): KanbanCard | undefined
    /** Whether the card's status has the `active` planning role (or is open when roles are unknown). */
    isActiveCard(card: KanbanCard): boolean
    /** The card's start / due date property names (its type's calendar config). */
    startPropertyFor(card: KanbanCard): string
    duePropertyFor(card: KanbanCard): string
    noteTypeFor(card: KanbanCard): { id: string; name: string } | null
    /** The card's status label and its rank in the card's own column order (unmapped = last). */
    statusLabelFor(card: KanbanCard): string | null
    statusRankFor(card: KanbanCard): number
    firstDayOfWeek(): number
    minutesPerDay(): number
    settings(): WeekSettings
    restoreState(): WeekViewState
    persistState(state: WeekViewState): void
    contextLegend(): ContextLegendItem[]
    toggleContext(value: string): void
}

/**
 * Ideal Week mode (issue #172, phase B): how the user WANTS to spend a
 * week — the `time_blocks` of every ACTIVE note on the board on a date-less
 * weekly grid, edited by drag (move), edge-drag (resize), Alt-drag (copy),
 * keyboard, click (create via a picker) and rail drag (create for a note).
 * Every edit rewrites the note's list and its planned-minutes cache in one
 * transaction, after refusing any overlap with another shown note (the
 * conflict is named). A note without a weekly target is asked for one the
 * first time a block is planned for it.
 */
export class WeekController {
    private readonly host: WeekHost
    private panelCollapsed = false
    private loaded = false
    private lastScrollContentKeys = new Map<string, string>()
    /** The entries of the last render, by path (the edit paths read them). */
    private entries = new Map<string, WeekEntry>()
    /** Rail headers folded by the user (in memory; everything starts open). */
    private readonly collapsedGroups = new Set<string>()
    /** Selected block keys (`slotKey`), marquee or Ctrl-click; cleared by Escape / empty click. */
    private selected = new Set<string>()
    /** A block to focus after the next render (keyboard edits keep the focus). */
    private pendingFocus: { path: string; slot: Slot } | null = null
    private scrolledOnce = false

    constructor(host: WeekHost) {
        this.host = host
    }

    private ensureLoaded(): void {
        if (this.loaded) return
        this.loaded = true
        this.panelCollapsed = this.host.restoreState().panelCollapsed
    }

    private persist(): void {
        this.host.persistState({ panelCollapsed: this.panelCollapsed })
    }

    /** The grid config from the settings. */
    config(): WeekGridConfig {
        const s = this.host.settings()
        const gridStart = Math.max(0, Math.min(23, s.gridStartHour)) * 60
        const gridEnd = Math.max(gridStart + 60, Math.min(24, s.gridEndHour) * 60)
        return {
            gridStart,
            gridEnd,
            pxPerMinute: Math.max(12, s.pixelsPerHour) / 60,
            firstDayOfWeek: this.host.firstDayOfWeek(),
            workStart: s.workStartMinutes,
            workEnd: s.workEndMinutes,
            workDays: s.workDays
        }
    }

    newBlockMinutes(): number {
        return Math.max(GRID_MINUTES, this.host.settings().blockMinutes)
    }

    togglePanel(): void {
        this.ensureLoaded()
        this.panelCollapsed = !this.panelCollapsed
        this.persist()
        this.host.refresh()
    }

    // ── Render ──────────────────────────────────────────────────────

    /**
     * Every note of the board that carries the blocks property (the schema
     * decides, not a type name — tasks stay out), whatever its status: the
     * rail lists them all, grouped by status. Blocks are DRAWN for the ones
     * whose window contains today; the active ones (status role) count as
     * the ideal week proper, the others render dimmed.
     */
    private collectEntries(cards: readonly KanbanCard[]): WeekEntry[] {
        const today = startOfDay(new Date())
        const s = this.host.settings()
        const entries: WeekEntry[] = []
        for (const card of cards) {
            const rawBlocks = getFrontmatterValue(this.host.app, card.file, s.timeBlocksProperty)
            if (rawBlocks === undefined) continue
            const start = parseFrontmatterDate(
                getFrontmatterValue(this.host.app, card.file, this.host.startPropertyFor(card))
            )
            const due = parseFrontmatterDate(
                getFrontmatterValue(this.host.app, card.file, this.host.duePropertyFor(card))
            )
            const { blocks, errors } = parseTimeBlocks(rawBlocks)
            const target = coerceOrder(
                getFrontmatterValue(this.host.app, card.file, s.targetMinutesProperty)
            )
            entries.push({
                path: card.key,
                title: card.display.title,
                contexts: card.contexts,
                blocks,
                errors,
                targetMinutes: target !== null && target > 0 ? target : null,
                typeName: this.host.noteTypeFor(card)?.name ?? null,
                active: this.host.isActiveCard(card),
                onGrid: inWeekWindow(start, due, today, today),
                statusLabel: this.host.statusLabelFor(card) ?? 'No status',
                statusRank: this.host.statusRankFor(card)
            })
        }
        return entries.sort((a, b) => a.statusRank - b.statusRank || a.title.localeCompare(b.title))
    }

    render(cards: KanbanCard[]): void {
        this.ensureLoaded()
        const boardEl = this.host.boardEl()
        if (!boardEl) return
        const cfg = this.config()
        const entries = this.collectEntries(cards)
        this.entries = new Map(entries.map((e) => [e.path, e]))
        const pieces: WeekBlockPiece[] = []
        let plannedTotal = 0
        let targetTotal = 0
        const errors: WeekViewModel['errors'] = []
        for (const entry of entries) {
            if (entry.active) {
                plannedTotal += plannedMinutesPerWeek(entry.blocks)
                targetTotal += entry.targetMinutes ?? 0
            }
            if (!entry.onGrid) continue
            const context = entry.contexts[0] ?? null
            for (const slot of slotsOf(entry.blocks)) {
                for (const piece of slotPieces(slot, cfg)) {
                    pieces.push({
                        key: slotKey(entry.path, slot),
                        path: entry.path,
                        title: entry.title,
                        color: context ? contextColor(context) : null,
                        contextLabel: entry.contexts.join(', '),
                        inactive: !entry.active,
                        slot,
                        ...piece
                    })
                }
            }
            for (const error of entry.errors) {
                errors.push({ title: entry.title, entry: error.entry, error: error.error })
            }
        }
        const model: WeekViewModel = {
            cfg,
            columnDays: columnDays(cfg.firstDayOfWeek),
            pieces,
            sections: [
                {
                    key: 'unplanned',
                    label: 'Not planned yet',
                    groups: groupByStatus(entries.filter((e) => e.blocks.length === 0))
                },
                {
                    key: 'planned',
                    label: 'Planned',
                    groups: groupByStatus(entries.filter((e) => e.blocks.length > 0))
                }
            ].filter((sec) => sec.groups.length > 0),
            collapsedGroups: this.collapsedGroups,
            selectedKeys: this.selected,
            panelCollapsed: this.panelCollapsed,
            plannedTotal,
            targetTotal,
            errors,
            contextLegend: this.host.contextLegend(),
            contextColorOf: contextColor
        }
        const scrolls = captureScrollBySelector(boardEl, WEEK_SCROLLER_SELECTORS)
        const contentKeys = new Map<string, string>([
            ['.kap-week-rail', 'rail'],
            ['.kap-week-scroller', 'grid']
        ])
        pruneStaleContent(scrolls, this.lastScrollContentKeys, contentKeys)
        this.lastScrollContentKeys = contentKeys
        renderWeek(boardEl, model, {
            onTogglePanel: () => this.togglePanel(),
            onToggleGroup: (label) => {
                if (this.collapsedGroups.has(label)) this.collapsedGroups.delete(label)
                else this.collapsedGroups.add(label)
                this.host.refresh()
            },
            onOpen: (path, newTab) => this.open(path, newTab),
            onBlockContextMenu: (path, slot, event) => this.blockMenu(path, slot, event),
            onBlockKey: (path, slot, action) => void this.keyEdit(path, slot, action),
            onRailContextMenu: (path, event) => {
                const card = this.host.cardForKey(path)
                if (card) this.host.showCardMenu(card, event)
            },
            onToggleContext: (value) => this.host.toggleContext(value)
        })
        restoreScrollBySelector(boardEl, scrolls)
        this.scrollToWorkStart(boardEl, cfg)
        this.restoreFocus(boardEl)
    }

    /** On the first render, scroll the grid so the work band starts near the top. */
    private scrollToWorkStart(boardEl: HTMLElement, cfg: WeekGridConfig): void {
        if (this.scrolledOnce) return
        this.scrolledOnce = true
        const scroller = boardEl.querySelector<HTMLElement>('.kap-week-scroller')
        if (!scroller) return
        const target = cfg.workEnd > cfg.workStart ? cfg.workStart : cfg.gridStart
        scroller.scrollTop = Math.max(0, (target - cfg.gridStart - 60) * cfg.pxPerMinute)
    }

    /** After a keyboard edit the re-rendered block gets the focus back. */
    private restoreFocus(boardEl: HTMLElement): void {
        const pending = this.pendingFocus
        if (!pending) return
        this.pendingFocus = null
        const key = slotKey(pending.path, pending.slot)
        const el = Array.from(boardEl.querySelectorAll<HTMLElement>('.kap-week-block')).find(
            (b) => b.dataset['key'] === key && b.dataset['continuation'] !== '1'
        )
        el?.focus()
    }

    open(path: string, newTab: boolean): void {
        const card = this.host.cardForKey(path)
        if (card) this.host.openCard(card, newTab)
    }

    private blockMenu(path: string, slot: Slot, event: MouseEvent): void {
        const card = this.host.cardForKey(path)
        if (!card) return
        this.host.showCardMenu(card, event, (menu) => {
            menu.addSeparator()
            menu.addItem((item) =>
                item
                    .setTitle(
                        `Remove this block (${formatMinutes(slot.start)}–${formatMinutes(slot.end)})`
                    )
                    .setIcon('calendar-x')
                    .setSection('kap-week')
                    .onClick(() => void this.remove(path, slot))
            )
        })
    }

    // ── Edits ───────────────────────────────────────────────────────

    /** Every shown slot of every note but `path` (the overlap universe). */
    private otherSlots(path: string): OwnedSlot[] {
        const out: OwnedSlot[] = []
        for (const entry of this.entries.values()) {
            if (entry.path === path || !entry.onGrid) continue
            for (const slot of slotsOf(entry.blocks)) out.push({ ...slot, path: entry.path })
        }
        return out
    }

    /** Own slots of `path` minus the one being edited (a note may not overlap itself either). */
    private ownSlots(path: string, except: Slot | null): OwnedSlot[] {
        const entry = this.entries.get(path)
        if (!entry) return []
        return slotsOf(entry.blocks)
            .filter(
                (s) =>
                    !except ||
                    s.day !== except.day ||
                    s.start !== except.start ||
                    s.end !== except.end
            )
            .map((s) => ({ ...s, path }))
    }

    /** Null when `slot` is free for `path`; else the notice text naming the conflict. */
    private conflictOf(path: string, slot: Slot, except: Slot | null): string | null {
        const hit =
            findOverlap(slot, this.otherSlots(path)) ??
            findOverlap(slot, this.ownSlots(path, except))
        if (!hit) return null
        const owner = this.entries.get(hit.path)
        const who = hit.path === path ? 'another block of this note' : (owner?.title ?? hit.path)
        return `That slot overlaps ${who} (${formatMinutes(hit.start)}–${formatMinutes(hit.end)}). Nothing was changed.`
    }

    private async write(
        path: string,
        blocks: TimeBlock[],
        extra: Record<string, unknown> = {}
    ): Promise<void> {
        const card = this.host.cardForKey(path)
        if (!card) return
        const s = this.host.settings()
        await setProperties(this.host.app, card.file, {
            ...extra,
            [s.timeBlocksProperty]: formatTimeBlocks(blocks),
            [s.plannedMinutesProperty]: plannedMinutesPerWeek(blocks)
        })
    }

    /** Move (or copy) one occurrence; false when refused (overlap) or unknown. */
    async move(path: string, from: Slot, to: Slot, copy: boolean): Promise<boolean> {
        const entry = this.entries.get(path)
        if (!entry) return false
        const conflict = this.conflictOf(path, to, copy ? null : from)
        if (conflict) {
            new Notice(conflict)
            this.host.refresh()
            return false
        }
        const blocks = copy ? addSlot(entry.blocks, to) : replaceSlot(entry.blocks, from, to)
        await this.write(path, blocks)
        return true
    }

    /** Resize one occurrence; false when refused (overlap) or unknown. */
    async resize(path: string, from: Slot, to: Slot): Promise<boolean> {
        const entry = this.entries.get(path)
        if (!entry) return false
        const conflict = this.conflictOf(path, to, from)
        if (conflict) {
            new Notice(conflict)
            this.host.refresh()
            return false
        }
        await this.write(path, replaceSlot(entry.blocks, from, to))
        return true
    }

    async remove(path: string, slot: Slot): Promise<void> {
        const entry = this.entries.get(path)
        if (!entry) return
        await this.write(path, removeSlot(entry.blocks, slot))
    }

    /** Stretch the run of days of one occurrence by dragging its left / right edge. */
    async span(path: string, from: Slot, edge: 'left' | 'right', toDay: number): Promise<void> {
        const entry = this.entries.get(path)
        if (!entry) return
        const { blocks, addedDays } = spanRun(entry.blocks, from, edge, toDay)
        for (const day of addedDays) {
            const conflict = this.conflictOf(path, { day, start: from.start, end: from.end }, null)
            if (conflict) {
                new Notice(conflict)
                this.host.refresh()
                return
            }
        }
        await this.write(path, blocks)
    }

    // ── Selection ───────────────────────────────────────────────────

    selectedKeys(): ReadonlySet<string> {
        return this.selected
    }

    /** Replace the selection (an empty list clears it). */
    select(keys: string[]): void {
        this.selected = new Set(keys)
        this.applySelectionClasses()
    }

    toggleSelect(key: string): void {
        if (this.selected.has(key)) this.selected.delete(key)
        else this.selected.add(key)
        this.applySelectionClasses()
    }

    /** Sync the selected class without a re-render (selection is view state only). */
    private applySelectionClasses(): void {
        const boardEl = this.host.boardEl()
        if (!boardEl) return
        for (const block of Array.from(boardEl.querySelectorAll<HTMLElement>('.kap-week-block'))) {
            block.toggleClass(
                'kap-week-block-selected',
                this.selected.has(block.dataset['key'] ?? '')
            )
        }
    }

    // ── Clipboard ───────────────────────────────────────────────────

    /** Copied occurrences (Ctrl+C); pasted relative to the earliest one. */
    private clipboard: { path: string; slot: Slot }[] = []

    copy(keys: string[]): void {
        const items: { path: string; slot: Slot }[] = []
        for (const key of keys) {
            const parsed = parseSlotKey(key)
            if (parsed && this.entries.has(parsed.path)) items.push(parsed)
        }
        if (items.length === 0) return
        this.clipboard = items
        new Notice(
            `Copied ${items.length} block${items.length === 1 ? '' : 's'} — Ctrl+V pastes at the pointer`
        )
    }

    /**
     * Paste the clipboard at `day`/`start`: the earliest copied block lands
     * there, the others keep their offsets from it. Blocks that would fall
     * outside the week / grid or overlap something are skipped with a notice;
     * one write per note.
     */
    async paste(day: number, start: number): Promise<void> {
        if (this.clipboard.length === 0) {
            new Notice('Nothing to paste: select or focus a block and press Ctrl+C first.')
            return
        }
        const cfg = this.config()
        const anchor = [...this.clipboard].sort(
            (a, b) =>
                a.slot.day * MINUTES_PER_DAY +
                a.slot.start -
                (b.slot.day * MINUTES_PER_DAY + b.slot.start)
        )[0]
        if (!anchor) return
        const byPath = new Map<string, TimeBlock[]>()
        const skipped: string[] = []
        for (const item of this.clipboard) {
            const entry = this.entries.get(item.path)
            if (!entry) continue
            const length = item.slot.end - item.slot.start
            const newDay = day + (item.slot.day - anchor.slot.day)
            const newStart = start + (item.slot.start - anchor.slot.start)
            if (
                newDay < 0 ||
                newDay > 6 ||
                newStart < cfg.gridStart ||
                newStart + length > cfg.gridEnd
            ) {
                skipped.push(`${entry.title} (outside the week)`)
                continue
            }
            const slot: Slot = { day: newDay, start: newStart, end: newStart + length }
            const current = byPath.get(item.path) ?? entry.blocks
            const conflict = this.conflictOf(item.path, slot, null)
            const selfHit = findOverlap(
                slot,
                slotsOf(current).map((s) => ({ ...s, path: item.path }))
            )
            if (conflict || selfHit) {
                skipped.push(entry.title)
                continue
            }
            byPath.set(item.path, addSlot(current, slot))
        }
        for (const [path, blocks] of byPath) await this.write(path, blocks)
        if (skipped.length > 0) {
            new Notice(
                `Not pasted (overlap or outside the week): ${[...new Set(skipped)].join(', ')}`
            )
        }
    }

    /** Remove every selected block (one write per note), then clear the selection. */
    async removeSelected(): Promise<void> {
        const byPath = new Map<string, Slot[]>()
        for (const key of this.selected) {
            const parsed = parseSlotKey(key)
            if (!parsed) continue
            const list = byPath.get(parsed.path) ?? []
            list.push(parsed.slot)
            byPath.set(parsed.path, list)
        }
        this.selected = new Set()
        for (const [path, slots] of byPath) {
            const entry = this.entries.get(path)
            if (!entry) continue
            let blocks = entry.blocks
            for (const slot of slots) blocks = removeSlot(blocks, slot)
            await this.write(path, blocks)
        }
    }

    /** Keyboard edit of a focused block: move by a step, resize its end, or remove. */
    async keyEdit(path: string, slot: Slot, action: BlockKeyAction): Promise<void> {
        if (action.kind === 'remove') {
            await this.remove(path, slot)
            return
        }
        const cfg = this.config()
        if (action.kind === 'move') {
            const length = slot.end - slot.start
            const day = (((slot.day + action.dDay) % 7) + 7) % 7
            const start = Math.min(
                cfg.gridEnd - Math.min(length, cfg.gridEnd - cfg.gridStart),
                Math.max(cfg.gridStart, slot.start + action.dMinutes)
            )
            const to = { day, start, end: start + length }
            if (to.day === slot.day && to.start === slot.start) return
            // Focus follows the block: its new slot when the edit lands, its
            // old one when it was refused (the refresh re-renders it there).
            this.pendingFocus = { path, slot: to }
            if (!(await this.move(path, slot, to, false))) this.pendingFocus = { path, slot }
            return
        }
        const end = Math.min(
            slot.start + MINUTES_PER_DAY,
            Math.max(slot.start + GRID_MINUTES, slot.end + action.dMinutes)
        )
        if (end === slot.end) return
        const to = { day: slot.day, start: slot.start, end }
        this.pendingFocus = { path, slot: to }
        if (!(await this.resize(path, slot, to))) this.pendingFocus = { path, slot }
    }

    /**
     * A block for `path` at `day`/`start` with the default length (rail
     * drop, picker). A note without a weekly target is asked for one first;
     * the answer is written with the block (Cancel plans nothing).
     */
    async createFor(path: string, day: number, start: number): Promise<void> {
        const entry = this.entries.get(path)
        if (!entry) return
        const slot = newBlockSlot(day, start, this.newBlockMinutes(), this.config())
        const conflict = this.conflictOf(path, slot, null)
        if (conflict) {
            new Notice(conflict)
            return
        }
        const blocks = addSlot(entry.blocks, slot)
        if (!entry.onGrid) {
            new Notice(
                `${entry.title} is not current (its start and due dates do not include today), so its blocks are saved but not drawn.`
            )
        }
        if (entry.targetMinutes !== null) {
            await this.write(path, blocks)
            return
        }
        const s = this.host.settings()
        new EstimatePromptModal(
            this.host.app,
            `Weekly target for ${entry.title} (minutes per week, or 5h)`,
            null,
            (value) => {
                void this.write(
                    path,
                    blocks,
                    value !== null ? { [s.targetMinutesProperty]: value } : {}
                )
            },
            'minutes',
            this.host.minutesPerDay()
        ).open()
    }

    /** Click on an empty slot: pick the note, then create. */
    create(day: number, start: number): void {
        const items: WeekPickerItem[] = []
        for (const entry of this.entries.values()) {
            const planned = plannedMinutesPerWeek(entry.blocks)
            const parts: string[] = []
            parts.push(planned > 0 ? `${Math.round(planned / 60)}h planned` : 'nothing planned yet')
            parts.push(
                entry.targetMinutes !== null
                    ? `target ${Math.round(entry.targetMinutes / 60)}h/wk`
                    : 'no target yet'
            )
            if (!entry.active) parts.push(entry.statusLabel)
            if (entry.contexts.length > 0) parts.push(entry.contexts.join(', '))
            items.push({
                path: entry.path,
                title: entry.title,
                typeName: entry.typeName,
                detail: parts.join(' · ')
            })
        }
        if (items.length === 0) {
            new Notice(
                'No note to plan: the ideal week lists the active notes of this board that carry the time blocks property.'
            )
            return
        }
        new WeekNotePickerModal(this.host.app, items, (item) => {
            void this.createFor(item.path, day, start)
        }).open()
    }
}

/** The inverse of `slotKey`: `path|day|start|end`. */
function parseSlotKey(key: string): { path: string; slot: Slot } | null {
    const parts = key.split('|')
    if (parts.length < 4) return null
    const end = Number(parts.pop())
    const start = Number(parts.pop())
    const day = Number(parts.pop())
    if (![day, start, end].every(Number.isFinite)) return null
    return { path: parts.join('|'), slot: { day, start, end } }
}
