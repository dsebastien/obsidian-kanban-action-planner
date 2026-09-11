import { Menu, Notice } from 'obsidian'
import type { App } from 'obsidian'
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
    matchesRailFilter,
    newBlockSlot,
    slotKey,
    slotPieces
} from '../../domain/week-planner'
import type { WeekEntry, WeekGridConfig } from '../../domain/week-planner'
import {
    availableMinutesPerWeek,
    groupByValue,
    raisedTarget,
    seededTarget,
    targetsGroups,
    totalsOf
} from '../../domain/week-targets'
import type { TargetsGroupBy, WeekGroupBy } from '../../domain/week-targets'
import { parseEstimateInput } from '../../domain/estimate'
import type { WeekProperties } from '../../services/week-properties.service'
import { formatHoursMinutes, renderWeek, renderWeekPrint } from '../../ui/week/week-renderer'
import type {
    BlockKeyAction,
    WeekBlockPiece,
    WeekSubMode,
    WeekViewModel
} from '../../ui/week/week-renderer'
import { WeekNotePickerModal } from '../../ui/week/week-note-picker'
import { WeekImportModal } from '../../ui/week/week-import-modal'
import type { ExportEntry, ImportedBlock } from '../../domain/week-planner-io'
import {
    matchImports,
    parseAppExport,
    toAppBlocks,
    toAppJson,
    toAppMarkdown,
    toTimeBlocks
} from '../../domain/week-planner-io'
import type { WeekPickerItem } from '../../ui/week/week-note-picker'
import { EstimatePromptModal } from '../../ui/timeline/estimate-modal'
import type { ContextLegendItem } from '../../ui/calendar/calendar-renderer'
import { contextColor } from '../../services/colors.service'
import { coerceOrder, getFrontmatterValue, setProperties } from '../../services/frontmatter.service'
import { stringifyForSearch } from '../../services/card-search.service'
import {
    WEEK_SCROLLER_SELECTORS,
    captureScrollBySelector,
    pruneStaleContent,
    restoreScrollBySelector
} from '../../ui/scroll-preservation'

/** Durable per-view ideal-week state. */
export interface WeekViewState {
    panelCollapsed: boolean
    /** Grid or targets table (issue #172, phase G). */
    subMode: WeekSubMode
    /** The rail's second grouping level (under Not planned / Planned). */
    railGroupBy: WeekGroupBy
    /** The targets table's grouping. */
    targetsGroupBy: TargetsGroupBy
}

/** The settings the mode reads (resolved by the host). */
export interface WeekSettings {
    gridStartHour: number
    gridEndHour: number
    workStartMinutes: number
    workEndMinutes: number
    workDays: number[]
    blockMinutes: number
    pixelsPerHour: number
    /** Available hours per week (null = grid hours × 7); phase G. */
    availableHours: number | null
    /** The day window that fills the pane (`end <= start` = the whole grid); phase G. */
    dayStartMinutes: number
    dayEndMinutes: number
    /** Raise a note's target to its planned minutes when an edit overshoots it; phase G. */
    targetFollowsPlanned: boolean
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
    /** The card's ideal-week property names (its type's override, else the globals). */
    weekPropertiesFor(card: KanbanCard): WeekProperties
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
 * conflict is named). A note without a weekly target gets one from its
 * planned minutes on the first edit (target follows planned, the default),
 * or is asked for one the first time a block is planned for it (setting
 * off).
 */
export class WeekController {
    private readonly host: WeekHost
    private panelCollapsed = false
    private subMode: WeekSubMode = 'grid'
    private railGroupBy: WeekGroupBy = 'status'
    private targetsGroupBy: TargetsGroupBy = 'none'
    /** The rail's quick filter (in memory; the grid is never filtered). */
    private railFilter = ''
    private loaded = false
    /** Targets raised inside the current batch (one notice at its end). */
    private raisedInBatch: string[] | null = null
    /** Same, for the targets seeded on notes that had none. */
    private seededInBatch: string[] | null = null
    private lastScrollContentKeys = new Map<string, string>()
    /** The entries of the last render, by path (the edit paths read them). */
    private entries = new Map<string, WeekEntry>()
    /**
     * Optimistic edits (issue #172): the blocks a note WILL carry once its
     * frontmatter write lands, keyed by path. Renders read through it so a
     * drop shows its result at once; the entry is dropped when the vault
     * echoes the same blocks back (or after a grace period, whatever the
     * echo looks like), so a linter rewrite can never pin a stale value.
     */
    private readonly overlay = new Map<
        string,
        { blocks: TimeBlock[]; target: number | null | undefined; at: number }
    >()
    /**
     * Undo / redo (issue #172, phase E): every write records the note's
     * block list before and after; a batch (paste, selection move, import,
     * multi-delete) records one item with several steps so one Ctrl+Z
     * reverts it whole. In memory only, capped, cleared when the view closes.
     */
    private history: HistoryItem[] = []
    private redoStack: HistoryItem[] = []
    private batch: HistoryStep[] | null = null
    private replaying = false
    /** The model of the latest render (printing reuses it). */
    private lastModel: WeekViewModel | null = null
    /** Rail headers folded by the user (in memory; everything starts open). */
    private readonly collapsedGroups = new Set<string>()
    /** Selected block keys (`slotKey`), marquee or Ctrl-click; cleared by Escape / empty click. */
    private selected = new Set<string>()
    /** A block to focus after the next render (keyboard edits keep the focus). */
    private pendingFocus: { path: string; slot: Slot } | null = null
    /** The scale of the last scroll-to-day-start (a new scale re-scrolls). */
    private scrolledAtPx: number | null = null
    private fitCheckPending = false

    constructor(host: WeekHost) {
        this.host = host
    }

    private ensureLoaded(): void {
        if (this.loaded) return
        this.loaded = true
        const state = this.host.restoreState()
        this.panelCollapsed = state.panelCollapsed
        this.subMode = state.subMode
        this.railGroupBy = state.railGroupBy
        this.targetsGroupBy = state.targetsGroupBy
    }

    private persist(): void {
        this.host.persistState({
            panelCollapsed: this.panelCollapsed,
            subMode: this.subMode,
            railGroupBy: this.railGroupBy,
            targetsGroupBy: this.targetsGroupBy
        })
    }

    /** Grid ↔ targets table (issue #172, phase G). */
    setSubMode(subMode: WeekSubMode): void {
        this.ensureLoaded()
        if (this.subMode === subMode) return
        this.subMode = subMode
        this.persist()
        this.host.refresh()
    }

    toggleTargets(): void {
        this.ensureLoaded()
        this.setSubMode(this.subMode === 'targets' ? 'grid' : 'targets')
    }

    isTargetsMode(): boolean {
        this.ensureLoaded()
        return this.subMode === 'targets'
    }

    setRailGroupBy(by: WeekGroupBy): void {
        this.ensureLoaded()
        if (this.railGroupBy === by) return
        this.railGroupBy = by
        this.persist()
        this.host.refresh()
    }

    /** Filter the rail's list (not the grid) by a substring of title, type, status, area or context. */
    setRailFilter(text: string): void {
        if (this.railFilter === text) return
        this.railFilter = text
        this.host.refresh()
    }

    setTargetsGroupBy(by: TargetsGroupBy): void {
        this.ensureLoaded()
        if (this.targetsGroupBy === by) return
        this.targetsGroupBy = by
        this.persist()
        this.host.refresh()
    }

    /** The minutes every share of the targets table is measured against. */
    availableMinutes(): number {
        const s = this.host.settings()
        return availableMinutesPerWeek({
            availableHours: s.availableHours,
            gridStartHour: s.gridStartHour,
            gridEndHour: s.gridEndHour
        })
    }

    /**
     * The day window (minutes) that fills the pane, clipped to the grid;
     * an empty setting means the whole grid.
     */
    dayWindow(gridStart: number, gridEnd: number): { start: number; end: number } {
        const s = this.host.settings()
        let start = s.dayStartMinutes
        let end = s.dayEndMinutes
        if (end <= start) {
            start = gridStart
            end = gridEnd
        }
        start = Math.max(gridStart, Math.min(gridEnd - GRID_MINUTES * 4, start))
        end = Math.max(start + GRID_MINUTES * 4, Math.min(gridEnd, end))
        return { start, end }
    }

    /**
     * The pane height the grid can fill: the scroller minus its sticky head
     * (0 before the first render; the fit check re-renders once it exists).
     */
    private paneHeight(): number {
        const boardEl = this.host.boardEl()
        const scroller = boardEl?.querySelector<HTMLElement>('.kap-week-scroller')
        if (!boardEl || !scroller) return 0
        const head = scroller.querySelector<HTMLElement>('.kap-week-head')
        // Never taller than the board itself: an unbounded scroller (an embed
        // whose height did not resolve) would otherwise grow with its own grid.
        const pane = Math.min(scroller.clientHeight, boardEl.clientHeight)
        return Math.max(0, pane - (head?.offsetHeight ?? 0))
    }

    /**
     * The grid config from the settings. The vertical scale FITS the day
     * window to the pane (phase G, decided 2026-09-10: the day is visible
     * whatever the window size), never below the minimum pixels per hour;
     * below it the grid scrolls, with the window start at the top.
     */
    config(): WeekGridConfig {
        const s = this.host.settings()
        const gridStart = Math.max(0, Math.min(23, s.gridStartHour)) * 60
        const gridEnd = Math.max(gridStart + 60, Math.min(24, s.gridEndHour) * 60)
        const minPx = Math.max(12, s.pixelsPerHour) / 60
        const window = this.dayWindow(gridStart, gridEnd)
        const pane = this.paneHeight()
        const fitted = pane > 0 ? pane / (window.end - window.start) : 0
        return {
            gridStart,
            gridEnd,
            pxPerMinute: Math.max(minPx, fitted),
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
        const entries: WeekEntry[] = []
        for (const card of cards) {
            const p = this.host.weekPropertiesFor(card)
            const rawBlocks = getFrontmatterValue(this.host.app, card.file, p.timeBlocks)
            const pending = this.overlay.get(card.key)
            if (rawBlocks === undefined && !pending) continue
            const start = parseFrontmatterDate(
                getFrontmatterValue(this.host.app, card.file, this.host.startPropertyFor(card))
            )
            const due = parseFrontmatterDate(
                getFrontmatterValue(this.host.app, card.file, this.host.duePropertyFor(card))
            )
            let { blocks, errors } = parseTimeBlocks(rawBlocks)
            let target = coerceOrder(getFrontmatterValue(this.host.app, card.file, p.targetMinutes))
            if (pending) {
                const echoed =
                    sameBlocks(pending.blocks, blocks) &&
                    (pending.target === undefined || pending.target === target)
                if (echoed || Date.now() - pending.at > OVERLAY_GRACE_MS) {
                    this.overlay.delete(card.key)
                } else {
                    blocks = pending.blocks
                    errors = []
                    if (pending.target !== undefined) target = pending.target
                }
            }
            entries.push({
                path: card.key,
                title: card.display.title,
                contexts: card.contexts,
                areas: stringifyForSearch(getFrontmatterValue(this.host.app, card.file, p.areas))
                    .map((v) => v.trim().replace(/^\[\[|\]\]$/g, ''))
                    .filter((v) => v.length > 0),
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
        const group = (list: WeekEntry[]): WeekViewModel['sections'][number]['groups'] =>
            this.railGroupBy === 'status'
                ? groupByStatus(list)
                : groupByValue(list, this.railGroupBy)
        const available = this.availableMinutes()
        const railEntries = entries.filter((e) => matchesRailFilter(e, this.railFilter))
        const model: WeekViewModel = {
            cfg,
            columnDays: columnDays(cfg.firstDayOfWeek),
            pieces,
            sections: [
                {
                    key: 'unplanned',
                    label: 'Not planned yet',
                    groups: group(railEntries.filter((e) => e.blocks.length === 0))
                },
                {
                    key: 'planned',
                    label: 'Planned',
                    groups: group(railEntries.filter((e) => e.blocks.length > 0))
                }
            ].filter((sec) => sec.groups.length > 0),
            railFilter: this.railFilter,
            railTotal: entries.length,
            collapsedGroups: this.collapsedGroups,
            selectedKeys: this.selected,
            panelCollapsed: this.panelCollapsed,
            subMode: this.subMode,
            railGroupBy: this.railGroupBy,
            targetsGroupBy: this.targetsGroupBy,
            targets: {
                groups: targetsGroups(entries, this.targetsGroupBy),
                totals: totalsOf(entries, available)
            },
            plannedTotal,
            targetTotal,
            available,
            errors,
            contextLegend: this.host.contextLegend(),
            contextColorOf: contextColor
        }
        const scrolls = captureScrollBySelector(boardEl, WEEK_SCROLLER_SELECTORS)
        const contentKeys = new Map<string, string>([
            ['.kap-week-rail', 'rail'],
            ['.kap-week-scroller', 'grid'],
            ['.kap-week-targets', 'targets']
        ])
        pruneStaleContent(scrolls, this.lastScrollContentKeys, contentKeys)
        this.lastScrollContentKeys = contentKeys
        this.lastModel = model
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
                if (card) {
                    this.host.showCardMenu(card, event, (menu) => {
                        menu.addSeparator()
                        this.addNoteMenuItems(menu, path)
                    })
                }
            },
            onToggleContext: (value) => this.host.toggleContext(value),
            onSetSubMode: (subMode) => this.setSubMode(subMode),
            onSetRailGroupBy: (by) => this.setRailGroupBy(by),
            onRailFilter: (text) => this.setRailFilter(text),
            onSetTargetsGroupBy: (by) => this.setTargetsGroupBy(by),
            onCommitTarget: (path, raw) => this.commitTarget(path, raw)
        })
        restoreScrollBySelector(boardEl, scrolls)
        this.scrollToDayStart(boardEl, cfg)
        this.restoreFocus(boardEl)
        this.scheduleFitCheck(cfg)
    }

    /**
     * On the first render, and whenever the scale changed (a fit after a
     * resize), scroll the grid so the day window starts at the top.
     */
    private scrollToDayStart(boardEl: HTMLElement, cfg: WeekGridConfig): void {
        if (this.scrolledAtPx === cfg.pxPerMinute) return
        const scroller = boardEl.querySelector<HTMLElement>('.kap-week-scroller')
        if (!scroller) return
        this.scrolledAtPx = cfg.pxPerMinute
        const { start } = this.dayWindow(cfg.gridStart, cfg.gridEnd)
        scroller.scrollTop = Math.max(0, (start - cfg.gridStart) * cfg.pxPerMinute)
    }

    /**
     * The pane is only measurable once the scroller exists: after a render,
     * recompute the fitted scale and re-render once when it differs (the
     * first render, a resize, a sub-mode switch back to the grid).
     */
    private scheduleFitCheck(rendered: WeekGridConfig): void {
        if (this.fitCheckPending || this.subMode !== 'grid') return
        this.fitCheckPending = true
        const win = this.host.boardEl()?.ownerDocument.defaultView ?? window
        win.requestAnimationFrame(() => {
            this.fitCheckPending = false
            if (!this.host.isWeekMode()) return
            if (Math.abs(this.config().pxPerMinute - rendered.pxPerMinute) > 0.001) {
                this.host.refresh()
            }
        })
    }

    /** The pane was resized: re-fit the day window when the scale changed. */
    onResize(): void {
        if (!this.host.isWeekMode() || !this.lastModel) return
        this.scheduleFitCheck(this.lastModel.cfg)
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
            this.addNoteMenuItems(menu, path)
        })
    }

    /** The note-level ideal-week items shared by the block and rail menus. */
    private addNoteMenuItems(menu: Menu, path: string): void {
        const entry = this.entries.get(path)
        if (!entry) return
        menu.addItem((item) =>
            item
                .setTitle(
                    entry.targetMinutes !== null
                        ? `Set weekly target… (now ${formatMinutes(entry.targetMinutes)} h)`
                        : 'Set weekly target…'
                )
                .setIcon('target')
                .setSection('kap-week')
                .onClick(() => this.setTarget(path))
        )
        const n = slotsOf(entry.blocks).length
        if (n > 0) {
            menu.addItem((item) =>
                item
                    .setTitle(`Remove every block of this note (${n})`)
                    .setIcon('calendar-off')
                    .setSection('kap-week')
                    .onClick(() => void this.removeAllOf(path))
            )
        }
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
        const p = this.host.weekPropertiesFor(card)
        const entry = this.entries.get(path)
        if (entry && !this.replaying) {
            const step: HistoryStep = { path, before: entry.blocks, after: blocks }
            if (this.batch) this.batch.push(step)
            else this.record([step])
        }
        // Target follows planned (issue #172, phase G): an edit that plans
        // more than the note's target raises the target to the planned
        // minutes (never lowers it), and a note without a target gets one
        // from its planned minutes instead of a prompt; one notice, or one
        // per batch.
        if (entry && this.host.settings().targetFollowsPlanned && !(p.targetMinutes in extra)) {
            const planned = plannedMinutesPerWeek(blocks)
            const seeded = seededTarget(entry.targetMinutes, planned)
            const raised = seeded === null ? raisedTarget(entry.targetMinutes, planned) : null
            const next = seeded ?? raised
            if (next !== null) {
                extra = { ...extra, [p.targetMinutes]: next }
                const label = `${entry.title} (${formatHoursMinutes(next)})`
                if (seeded !== null) {
                    if (this.seededInBatch) this.seededInBatch.push(label)
                    else new Notice(`Weekly target set from the planned blocks: ${label}`)
                } else if (this.raisedInBatch) this.raisedInBatch.push(label)
                else new Notice(`Weekly target raised to match the planned blocks: ${label}`)
            }
        }
        // Optimistic (issue #172): show the result now, write in the background.
        const target = p.targetMinutes in extra ? coerceOrder(extra[p.targetMinutes]) : undefined
        this.overlay.set(path, { blocks, target, at: Date.now() })
        this.host.refresh()
        try {
            await setProperties(this.host.app, card.file, {
                ...extra,
                [p.timeBlocks]: formatTimeBlocks(blocks),
                [p.plannedMinutes]: plannedMinutesPerWeek(blocks)
            })
        } catch (error) {
            this.overlay.delete(path)
            this.host.refresh()
            throw error
        }
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

    // ── Undo / redo, batches (issue #172, phase E) ──────────────────

    private record(steps: HistoryStep[]): void {
        if (steps.length === 0) return
        this.history.push({ steps })
        if (this.history.length > HISTORY_LIMIT) this.history.shift()
        this.redoStack = []
    }

    /** Run `fn` so every write inside becomes ONE undo item. */
    private async batched(fn: () => Promise<void>): Promise<void> {
        if (this.batch) return fn()
        this.batch = []
        this.raisedInBatch = []
        this.seededInBatch = []
        try {
            await fn()
        } finally {
            const steps = this.batch
            const raised = this.raisedInBatch
            const seeded = this.seededInBatch
            this.batch = null
            this.raisedInBatch = null
            this.seededInBatch = null
            if (!this.replaying) this.record(steps)
            if (seeded && seeded.length > 0) {
                new Notice(`Weekly targets set from the planned blocks: ${seeded.join(', ')}`, 8000)
            }
            if (raised && raised.length > 0) {
                new Notice(
                    `Weekly targets raised to match the planned blocks: ${raised.join(', ')}`,
                    8000
                )
            }
        }
    }

    canUndo(): boolean {
        return this.history.length > 0
    }

    canRedo(): boolean {
        return this.redoStack.length > 0
    }

    async undo(): Promise<void> {
        const item = this.history.pop()
        if (!item) {
            new Notice('Nothing to undo in the ideal week.')
            return
        }
        await this.replay(item, 'before')
        this.redoStack.push(item)
    }

    async redo(): Promise<void> {
        const item = this.redoStack.pop()
        if (!item) {
            new Notice('Nothing to redo in the ideal week.')
            return
        }
        await this.replay(item, 'after')
        this.history.push(item)
    }

    private async replay(item: HistoryItem, side: 'before' | 'after'): Promise<void> {
        this.replaying = true
        try {
            const steps = side === 'before' ? [...item.steps].reverse() : item.steps
            for (const step of steps) {
                if (!this.host.cardForKey(step.path)) continue
                await this.write(step.path, step[side])
            }
        } finally {
            this.replaying = false
        }
    }

    /** Select every block drawn on the grid (Ctrl+A). */
    selectAll(): void {
        const keys: string[] = []
        for (const entry of this.entries.values()) {
            if (!entry.onGrid) continue
            for (const slot of slotsOf(entry.blocks)) keys.push(slotKey(entry.path, slot))
        }
        this.select(keys)
    }

    /**
     * Move (or copy) the whole selection by the offset the dragged block
     * travelled: all-or-nothing — one refused slot (overlap, outside the
     * week) cancels the move and names the note — then one write per note,
     * one undo item.
     */
    async moveSelection(_path: string, from: Slot, to: Slot, copy: boolean): Promise<boolean> {
        const dDay = to.day - from.day
        const dMinutes = to.start - from.start
        if (dDay === 0 && dMinutes === 0 && !copy) return false
        const cfg = this.config()
        const moving: { path: string; from: Slot; to: Slot }[] = []
        for (const key of this.selected) {
            const parsed = parseSlotKey(key)
            if (!parsed || !this.entries.has(parsed.path)) continue
            const length = parsed.slot.end - parsed.slot.start
            const day = parsed.slot.day + dDay
            const start = parsed.slot.start + dMinutes
            if (day < 0 || day > 6 || start < cfg.gridStart || start + length > cfg.gridEnd) {
                new Notice(
                    `${this.entries.get(parsed.path)?.title ?? parsed.path} would leave the week. Nothing was moved.`
                )
                this.host.refresh()
                return false
            }
            moving.push({
                path: parsed.path,
                from: parsed.slot,
                to: { day, start, end: start + length }
            })
        }
        if (moving.length === 0) return false
        // The universe: every slot except the ones being moved (a copy keeps them).
        const movingKeys = new Set(moving.map((m) => slotKey(m.path, m.from)))
        const universe: OwnedSlot[] = []
        for (const entry of this.entries.values()) {
            if (!entry.onGrid) continue
            for (const slot of slotsOf(entry.blocks)) {
                if (!copy && movingKeys.has(slotKey(entry.path, slot))) continue
                universe.push({ ...slot, path: entry.path })
            }
        }
        for (const m of moving) universe.push({ ...m.to, path: m.path })
        for (const m of moving) {
            const others = universe.filter(
                (u) =>
                    !(
                        u.path === m.path &&
                        u.day === m.to.day &&
                        u.start === m.to.start &&
                        u.end === m.to.end
                    )
            )
            const hit = findOverlap(m.to, others)
            if (hit) {
                const owner = this.entries.get(hit.path)
                new Notice(
                    `${this.entries.get(m.path)?.title ?? m.path} would overlap ${owner?.title ?? hit.path} (${formatMinutes(hit.start)}–${formatMinutes(hit.end)}). Nothing was moved.`
                )
                this.host.refresh()
                return false
            }
        }
        // Remove every origin first, then add every target: two slots of one
        // note that shift onto each other's days must not cancel out.
        const byPath = new Map<string, TimeBlock[]>()
        for (const m of moving) {
            const current = byPath.get(m.path) ?? this.entries.get(m.path)?.blocks ?? []
            byPath.set(m.path, copy ? current : removeSlot(current, m.from))
        }
        for (const m of moving) {
            byPath.set(m.path, addSlot(byPath.get(m.path) ?? [], m.to))
        }
        const nextKeys = moving.map((m) => slotKey(m.path, m.to))
        await this.batched(async () => {
            for (const [p, blocks] of byPath) await this.write(p, blocks)
        })
        this.select(copy ? [...this.selected] : nextKeys)
        return true
    }

    /** A drag on the empty grid drew a block over `days`: ask which note, then plan it at that size. */
    createRange(days: number[], start: number, end: number): void {
        const cfg = this.config()
        const slots = days.map((day) =>
            newBlockSlot(day, start, Math.max(GRID_MINUTES, end - start), cfg)
        )
        this.pickNote((path) => void this.planSlots(path, slots))
    }

    /** Right-click on an empty cell: plan a block here, paste here. */
    cellMenu(day: number, minutes: number, event: MouseEvent): void {
        const menu = new Menu()
        const start = Math.min(
            this.config().gridEnd - GRID_MINUTES,
            Math.max(this.config().gridStart, Math.floor(minutes / GRID_MINUTES) * GRID_MINUTES)
        )
        menu.addItem((item) =>
            item
                .setTitle(`Plan a block here (${formatMinutes(start)})…`)
                .setIcon('calendar-plus')
                .onClick(() => this.create(day, start))
        )
        const n = this.clipboard.length
        menu.addItem((item) =>
            item
                .setTitle(
                    n > 0 ? `Paste ${n} block${n === 1 ? '' : 's'} here` : 'Paste (nothing copied)'
                )
                .setIcon('clipboard-paste')
                .setDisabled(n === 0)
                .onClick(() => void this.paste(day, start))
        )
        menu.showAtMouseEvent(event)
    }

    /** Remove every block of one note (one write, one undo item). */
    async removeAllOf(path: string): Promise<void> {
        const entry = this.entries.get(path)
        if (!entry || entry.blocks.length === 0) return
        await this.write(path, [])
    }

    /** Ask for (or clear) a note's weekly target (issue #186). */
    setTarget(path: string): void {
        const entry = this.entries.get(path)
        const card = this.host.cardForKey(path)
        if (!entry || !card) return
        new EstimatePromptModal(
            this.host.app,
            `Weekly target for ${entry.title} (minutes per week, or 5h)`,
            entry.targetMinutes,
            (value) => this.writeTarget(path, value),
            'minutes',
            this.host.minutesPerDay()
        ).open()
    }

    /** Write a note's weekly target (null clears it), optimistically; blocks untouched. */
    writeTarget(path: string, value: number | null): void {
        const entry = this.entries.get(path)
        const card = this.host.cardForKey(path)
        if (!entry || !card) return
        if (entry.targetMinutes === value) return
        const targetProperty = this.host.weekPropertiesFor(card).targetMinutes
        this.overlay.set(path, { blocks: entry.blocks, target: value, at: Date.now() })
        this.host.refresh()
        void setProperties(this.host.app, card.file, { [targetProperty]: value ?? null })
    }

    /**
     * A target typed in the targets table (issue #172, phase G): minutes or
     * a duration (`5h`, `1h 30m`); empty clears. False when unreadable
     * (nothing is written; the cell shows it).
     */
    commitTarget(path: string, raw: string): boolean {
        const text = raw.trim()
        if (text === '') {
            this.writeTarget(path, null)
            return true
        }
        const value = parseEstimateInput(text, 'minutes', this.host.minutesPerDay())
        if (value === null) return false
        this.writeTarget(path, value)
        return true
    }

    /** Whether the clipboard holds blocks (the paste-target highlight). */
    hasClipboard(): boolean {
        return this.clipboard.length > 0
    }

    /**
     * Print the ideal week (issue #172, phase E): a static copy of the grid
     * in a print-only container, the OS print dialog, then the copy goes.
     */
    print(): void {
        this.ensureLoaded()
        const model = this.lastModel
        if (!model || model.pieces.length === 0) {
            new Notice('Nothing to print: the ideal week has no block.')
            return
        }
        const doc = this.host.boardEl()?.ownerDocument ?? document
        const win = doc.defaultView ?? window
        const root = renderWeekPrint(doc, model, 'Ideal week')
        doc.body.addClass('kap-week-printing')
        const done = (): void => {
            win.removeEventListener('afterprint', done)
            doc.body.removeClass('kap-week-printing')
            root.remove()
        }
        win.addEventListener('afterprint', done)
        win.setTimeout(() => {
            win.print()
            // Some platforms never fire afterprint: clean up on a timer too.
            win.setTimeout(done, 60_000)
        }, 50)
    }

    // ── Week-planner app import / export (issue #172, phase D) ──────

    /** Open the import dialog, then match, ask about the rest, and apply. */
    importFromApp(): void {
        this.ensureLoaded()
        new WeekImportModal(this.host.app, (text, replace) => {
            void this.runImport(text, replace)
        }).open()
    }

    private async runImport(text: string, replace: boolean): Promise<void> {
        const parsed = parseAppExport(text)
        if (parsed.blocks.length === 0) {
            new Notice(
                parsed.errors.length > 0
                    ? `Nothing to import: ${parsed.errors[0]?.entry ?? ''} — ${parsed.errors[0]?.error ?? ''}`
                    : 'Nothing to import: no block found in the text.'
            )
            return
        }
        const candidates = [...this.entries.values()].map((e) => ({ path: e.path, title: e.title }))
        const matched = matchImports(parsed.blocks, candidates)
        const assignments = new Map<string, ImportedBlock[]>()
        const push = (path: string, block: ImportedBlock): void => {
            const list = assignments.get(path) ?? []
            list.push(block)
            assignments.set(path, list)
        }
        for (const m of matched) if (m.path) push(m.path, m.block)
        // Ask about every unmatched text once (Escape skips it).
        const unmatched = new Map<string, ImportedBlock[]>()
        for (const m of matched) {
            if (m.path) continue
            const list = unmatched.get(m.block.text) ?? []
            list.push(m.block)
            unmatched.set(m.block.text, list)
        }
        const skipped: string[] = []
        for (const [text, blocks] of unmatched) {
            const path = await this.askNoteFor(text)
            if (path) for (const block of blocks) push(path, block)
            else skipped.push(text)
        }
        const result = await this.applyImport(assignments, replace)
        const parts = [`${result.written} note${result.written === 1 ? '' : 's'} updated`]
        if (result.refused.length > 0) parts.push(`refused (overlap): ${result.refused.join(', ')}`)
        if (skipped.length > 0) parts.push(`not matched: ${skipped.join(', ')}`)
        if (parsed.errors.length > 0)
            parts.push(
                `${parsed.errors.length} unreadable entr${parsed.errors.length === 1 ? 'y' : 'ies'}`
            )
        new Notice(`Ideal week import: ${parts.join(' · ')}`, 8000)
    }

    /** The picker for an imported text nothing matched; null when dismissed. */
    private askNoteFor(text: string): Promise<string | null> {
        const items: WeekPickerItem[] = [...this.entries.values()].map((entry) => ({
            path: entry.path,
            title: entry.title,
            typeName: entry.typeName,
            detail: `for “${text}”`
        }))
        return new Promise((resolve) => {
            let picked = false
            const modal = new WeekNotePickerModal(this.host.app, items, (item) => {
                picked = true
                resolve(item.path)
            })
            modal.setPlaceholder(`Which note is “${text}”? Escape skips it`)
            modal.onClose = () => {
                if (!picked) resolve(null)
            }
            modal.open()
        })
    }

    /**
     * Write the imported blocks: a note's list is replaced (or extended)
     * and checked against every other note's slots, the other imported
     * notes included; a note whose result overlaps is refused, named.
     */
    private async applyImport(
        assignments: Map<string, ImportedBlock[]>,
        replace: boolean
    ): Promise<{ written: number; refused: string[] }> {
        const finals = new Map<string, TimeBlock[]>()
        for (const [path, imported] of assignments) {
            const entry = this.entries.get(path)
            if (!entry) continue
            let blocks = replace ? [] : entry.blocks
            for (const slot of slotsOf(toTimeBlocks(imported))) blocks = addSlot(blocks, slot)
            finals.set(path, blocks)
        }
        const refused: string[] = []
        let written = 0
        await this.batched(async () => {
            for (const [path, blocks] of finals) {
                const entry = this.entries.get(path)
                if (!entry) continue
                const universe: OwnedSlot[] = []
                for (const other of this.entries.values()) {
                    if (other.path === path || !other.onGrid) continue
                    const otherBlocks = finals.get(other.path) ?? other.blocks
                    for (const slot of slotsOf(otherBlocks))
                        universe.push({ ...slot, path: other.path })
                }
                const own = slotsOf(blocks)
                const conflict =
                    own.map((slot) => findOverlap(slot, universe)).find((hit) => hit !== null) ??
                    own
                        .map((slot, i) =>
                            findOverlap(
                                slot,
                                own.filter((_, j) => j !== i).map((s) => ({ ...s, path }))
                            )
                        )
                        .find((hit) => hit !== null) ??
                    null
                if (conflict) {
                    refused.push(entry.title)
                    continue
                }
                await this.write(path, blocks)
                written++
            }
        })
        return { written, refused }
    }

    /** Save the ideal week as the app's JSON or Markdown file next to the attachments. */
    async exportToApp(format: 'json' | 'markdown'): Promise<void> {
        this.ensureLoaded()
        const entries: ExportEntry[] = [...this.entries.values()]
            .filter((e) => e.onGrid && e.blocks.length > 0)
            .map((e) => {
                const context = e.contexts[0]
                const color = context ? contextColor(context) : null
                return {
                    title: e.title,
                    blocks: e.blocks,
                    color: color?.startsWith('#') ? color : null
                }
            })
        if (entries.length === 0) {
            new Notice('Nothing to export: the ideal week has no block.')
            return
        }
        const now = new Date()
        const { blocks, rounded } = toAppBlocks(entries)
        const s = this.host.settings()
        const text =
            format === 'json'
                ? toAppJson(blocks, { startHour: s.gridStartHour, endHour: s.gridEndHour }, now)
                : toAppMarkdown(blocks, now)
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const name = `Ideal week ${stamp}.${format === 'json' ? 'json' : 'md'}`
        const path = await this.host.app.fileManager.getAvailablePathForAttachment(name)
        await this.host.app.vault.create(path, text)
        const parts = [`${blocks.length} block${blocks.length === 1 ? '' : 's'} written to ${path}`]
        if (rounded.length > 0) {
            parts.push(
                `${rounded.length} rounded to the app's 30-minute grid: ${rounded
                    .slice(0, 3)
                    .map((r) => `${r.title} ${r.from} → ${r.to}`)
                    .join('; ')}${rounded.length > 3 ? '…' : ''}`
            )
        }
        new Notice(`Ideal week exported: ${parts.join(' · ')}`, 8000)
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
        await this.batched(async () => {
            for (const [path, blocks] of byPath) await this.write(path, blocks)
        })
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
        await this.batched(async () => {
            for (const [path, slots] of byPath) {
                const entry = this.entries.get(path)
                if (!entry) continue
                let blocks = entry.blocks
                for (const slot of slots) blocks = removeSlot(blocks, slot)
                await this.write(path, blocks)
            }
        })
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
     * drop, picker). See {@link planSlots} for a note without a weekly target.
     */
    async createFor(
        path: string,
        day: number,
        start: number,
        minutes = this.newBlockMinutes()
    ): Promise<void> {
        await this.planSlots(path, [newBlockSlot(day, start, minutes, this.config())])
    }

    /**
     * Plan `slots` on a note in one write: every slot is checked for overlaps
     * (a conflict refuses the whole plan, named). A note without a weekly
     * target gets one from its planned minutes in the same write when the
     * target follows planned (the default; {@link write} seeds it), else it
     * is asked for one first (Cancel plans nothing).
     */
    async planSlots(path: string, slots: Slot[]): Promise<void> {
        const entry = this.entries.get(path)
        if (!entry || slots.length === 0) return
        let blocks = entry.blocks
        for (const slot of slots) {
            const conflict = this.conflictOf(path, slot, null)
            const selfHit = findOverlap(
                slot,
                slotsOf(blocks).map((s) => ({ ...s, path }))
            )
            if (conflict || selfHit) {
                new Notice(
                    conflict ??
                        `That slot overlaps another block of ${entry.title} (${formatMinutes(selfHit?.start ?? 0)}–${formatMinutes(selfHit?.end ?? 0)}). Nothing was changed.`
                )
                return
            }
            blocks = addSlot(blocks, slot)
        }
        if (!entry.onGrid) {
            new Notice(
                `${entry.title} is not current (its start and due dates do not include today), so its blocks are saved but not drawn.`
            )
        }
        if (entry.targetMinutes !== null || this.host.settings().targetFollowsPlanned) {
            await this.write(path, blocks)
            return
        }
        const card = this.host.cardForKey(path)
        if (!card) return
        const targetProperty = this.host.weekPropertiesFor(card).targetMinutes
        new EstimatePromptModal(
            this.host.app,
            `Weekly target for ${entry.title} (minutes per week, or 5h)`,
            null,
            (value) => {
                void this.write(path, blocks, value !== null ? { [targetProperty]: value } : {})
            },
            'minutes',
            this.host.minutesPerDay()
        ).open()
    }

    /** Click on an empty slot: pick the note, then create. */
    create(day: number, start: number): void {
        this.pickNote((path) => void this.createFor(path, day, start))
    }

    /** The type-aware note picker of the ideal week; `onPick` gets the chosen path. */
    private pickNote(onPick: (path: string) => void): void {
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
        new WeekNotePickerModal(this.host.app, items, (item) => onPick(item.path)).open()
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

/** How long an optimistic overlay may outlive its write before the vault's value wins again. */
const OVERLAY_GRACE_MS = 10_000

/** Whether two block lists spell the same entries. */
function sameBlocks(a: readonly TimeBlock[], b: readonly TimeBlock[]): boolean {
    const left = formatTimeBlocks(a)
    const right = formatTimeBlocks(b)
    return left.length === right.length && left.every((entry, i) => entry === right[i])
}

/** One note's block list before and after one write (undo / redo). */
interface HistoryStep {
    path: string
    before: TimeBlock[]
    after: TimeBlock[]
}

/** One undoable edit: one step, or several for a batch. */
interface HistoryItem {
    steps: HistoryStep[]
}

const HISTORY_LIMIT = 100
