import { Menu, Notice } from 'obsidian'
import type { App } from 'obsidian'
import type { ArchiveConfig, ColumnDef } from '../../domain/note-type'
import type { KanbanCard } from '../../ui/board/types'
import { deleteProperty, setProperty } from '../../services/frontmatter.service'
import { archiveNote } from '../../services/archive.service'
import { inclusiveKeyRange } from './selection-range'
import { log } from '../../../utils/log'

/**
 * What {@link BoardSelection} needs from the host view (the subset of view state
 * + services it touches), passed as closures so it never reaches into privates.
 */
export interface SelectionHost {
    readonly app: App
    boardEl(): HTMLElement | null
    barEl(): HTMLElement | null
    /** Currently visible cards, keyed by card key. */
    visibleCards(): Map<string, KanbanCard>
    /** Visible card keys in board order (lane → column → card). */
    flatCardKeys(): string[]
    /**
     * Shared column set for a bulk selection, or `null` when the selection
     * mixes note types (their status vocabularies differ, so bulk set-status
     * is unavailable) — a card's own type is authoritative for status writes.
     */
    columnsForSelection(cards: KanbanCard[]): ReadonlyArray<ColumnDef> | null
    /** The status property a write to THIS card must use (its own type's). */
    statusPropertyFor(card: KanbanCard): string | null
    archiveConfigFor(card: KanbanCard): ArchiveConfig
    /** Re-render the toolbar so the Select toggle reflects the new mode. */
    onModeChanged(): void
    /**
     * Optimistically apply a bulk status change (issue #105, finding 1.4):
     * mutate every listed card in the in-memory model and render ONCE, before
     * the sequential writes. The write echoes re-derive the same state and
     * are absorbed by the render-signature gate. Per-entry values so the
     * failure path can revert just the cards whose write failed.
     */
    applyBulkStatus(entries: ReadonlyArray<{ card: KanbanCard; statusValue: string | null }>): void
    /**
     * Optimistically drop cards from the in-memory model and render once
     * (issue #105, finding 1.4) — archived notes leave the board, so the
     * board reflects the whole bulk archive up front instead of streaming
     * intermediate rebuilds.
     */
    removeCardsFromModel(keys: string[]): void
    /**
     * Re-add cards whose archive failed (the files never moved) and render
     * once — the precise rollback for a partial bulk archive.
     */
    restoreCardsToModel(cards: KanbanCard[]): void
    /**
     * Run a write sequence with the host's data-event rebuild deferred until
     * the sequence ends — a bulk loop can outlast the host's non-resetting
     * rebuild debounce, which would otherwise re-derive a PARTIAL on-disk
     * state mid-sequence and visibly revert the optimistic render.
     */
    runExclusiveWrites(writes: () => Promise<void>): Promise<void>
    /**
     * Run the card's note type's automation rules for a status transition
     * (post-write; exactly once per actual transition). Bulk writes must
     * fire these too — automations apply on EVERY status write path.
     */
    runStatusAutomations(card: KanbanCard, from: string | null, to: string | null): Promise<void>
    /** Run the card's `archived`-trigger rules (just before the move). */
    runArchiveAutomations(card: KanbanCard): Promise<void>
}

/**
 * Multi-select + bulk actions (issue #18). Owns the selection state (mode,
 * selected keys, range anchor), the selection action bar, and the bulk writes.
 * Extracted from the view to keep that file focused; the view delegates clicks
 * and calls {@link refresh} after every board render.
 */
export class BoardSelection {
    private mode = false
    private readonly keys = new Set<string>()
    private lastKey: string | null = null

    constructor(private readonly host: SelectionHost) {}

    /** Whether selection mode is active (drives the toolbar toggle + card cursor). */
    get active(): boolean {
        return this.mode
    }

    toggleMode(): void {
        this.mode = !this.mode
        if (!this.mode) {
            this.keys.clear()
            this.lastKey = null
        }
        this.host.onModeChanged()
        this.refresh()
    }

    /**
     * End the select session (no-op when inactive). The host calls this when
     * the view leaves board mode — selection is board-only, and the bar's
     * session-long reservation (issue #105, finding 5.4) would otherwise sit
     * stuck over the other modes with no toggle to close it.
     */
    exitMode(): void {
        if (this.mode) this.toggleMode()
    }

    /**
     * Handle a card click. Returns true when consumed (selection mode), so the
     * caller opens the note only when this returns false.
     */
    handleClick(card: KanbanCard, event: MouseEvent): boolean {
        if (!this.mode) return false
        event.preventDefault()
        if (event.shiftKey && this.lastKey) this.selectRange(card.key)
        else if (this.keys.has(card.key)) this.keys.delete(card.key)
        else this.keys.add(card.key)
        this.lastKey = card.key
        this.refresh()
        return true
    }

    /**
     * Handle a card context-menu. Returns true when consumed: selection mode
     * is active and the card is part of a multi-card selection, so the bulk
     * menu (the selection bar's actions) opens instead of the single-card
     * menu — a right-click acts on the whole selection (issue #129).
     * Right-clicking an unselected card (or a lone selected card) falls back
     * to the regular card menu.
     */
    handleContextMenu(card: KanbanCard, event: MouseEvent): boolean {
        if (!this.mode || !this.keys.has(card.key) || this.keys.size < 2) return false
        event.preventDefault()
        this.buildBulkMenu().showAtMouseEvent(event)
        return true
    }

    /**
     * Keyboard twin of {@link handleContextMenu} (issue #130): the ContextMenu
     * key / Shift+F10 on a card belonging to a multi-card selection opens the
     * bulk menu anchored below the card, matching the single-card keyboard
     * menu's placement. Returns true when consumed.
     */
    handleContextMenuAt(card: KanbanCard, cardEl: HTMLElement): boolean {
        if (!this.mode || !this.keys.has(card.key) || this.keys.size < 2) return false
        const rect = cardEl.getBoundingClientRect()
        this.buildBulkMenu().showAtPosition({ x: rect.left, y: rect.bottom })
        return true
    }

    /** Re-apply selected styling to card nodes and (re)render the action bar. */
    refresh(): void {
        const boardEl = this.host.boardEl()
        if (!boardEl) return
        const cards = this.host.visibleCards()
        // Drop selections no longer on the board (archived / filtered out).
        for (const key of [...this.keys]) {
            if (!cards.has(key)) this.keys.delete(key)
        }
        boardEl.toggleClass('kap-board-selecting', this.mode)
        for (const el of Array.from(boardEl.querySelectorAll<HTMLElement>('.kap-card'))) {
            el.toggleClass('kap-card-selected', this.keys.has(el.dataset['cardKey'] ?? ''))
        }
        this.renderBar()
    }

    private clear(): void {
        this.keys.clear()
        this.lastKey = null
        this.refresh()
    }

    /** Select the inclusive range from the last-selected card to `toKey`. */
    private selectRange(toKey: string): void {
        for (const key of inclusiveKeyRange(this.host.flatCardKeys(), this.lastKey, toKey)) {
            this.keys.add(key)
        }
    }

    private selectedCards(): KanbanCard[] {
        const cards = this.host.visibleCards()
        const out: KanbanCard[] = []
        for (const key of this.keys) {
            const card = cards.get(key)
            if (card) out.push(card)
        }
        return out
    }

    private renderBar(): void {
        const bar = this.host.barEl()
        if (!bar) return
        bar.empty()
        // The bar's height is reserved for the whole select session (issue
        // #105, finding 5.4): it appears/disappears on the MODE toggle — the
        // deliberate layout moment — never on first-select/last-deselect, so
        // selection count changes cannot shift the board under the pointer.
        // With nothing selected the actions render disabled.
        if (!this.mode) {
            bar.addClass('kap-hidden')
            return
        }
        bar.removeClass('kap-hidden')
        const disabled = this.keys.size === 0
        bar.createSpan({ cls: 'kap-selection-count', text: `${String(this.keys.size)} selected` })
        const actions = bar.createDiv({ cls: 'kap-selection-actions' })
        const statusBtn = actions.createEl('button', {
            cls: 'kap-selection-btn',
            text: 'Set status'
        })
        statusBtn.disabled = disabled
        statusBtn.addEventListener('click', (e) => this.openBulkStatusMenu(e))
        this.addButton(actions, 'Archive', disabled, () => void this.bulkArchive())
        this.addButton(actions, 'Open', disabled, () => this.bulkOpen())
        this.addButton(actions, 'Clear', disabled, () => this.clear())
    }

    private addButton(
        parent: HTMLElement,
        label: string,
        disabled: boolean,
        onClick: () => void
    ): void {
        const btn = parent.createEl('button', { cls: 'kap-selection-btn', text: label })
        btn.disabled = disabled
        btn.addEventListener('click', onClick)
    }

    private openBulkStatusMenu(event: MouseEvent): void {
        // A card's own type is authoritative for status writes: a mixed-type
        // selection has no shared vocabulary, so bulk set-status is refused.
        const columns = this.host.columnsForSelection(this.selectedCards())
        if (columns === null) {
            new Notice(
                'The selection mixes note types with different statuses — select cards of one type to set their status.'
            )
            return
        }
        const menu = new Menu()
        this.addBulkStatusItems(menu, columns, '')
        menu.addSeparator()
        menu.addItem((item) =>
            item
                .setTitle('Clear status')
                .setIcon('x')
                .onClick(() => void this.bulkSetStatus(null))
        )
        menu.showAtMouseEvent(event)
    }

    /** One `Set status` entry per shared column, with an optional title prefix. */
    private addBulkStatusItems(
        menu: Menu,
        columns: ReadonlyArray<ColumnDef>,
        prefix: string
    ): void {
        for (const col of columns) {
            menu.addItem((item) =>
                item
                    .setTitle(`${prefix}${col.label}`)
                    .onClick(() => void this.bulkSetStatus(col.statusValue))
            )
        }
    }

    /**
     * The bulk context menu (issues #129/#130): the selection bar's actions
     * at the pointer or the focused card. Status entries mirror the
     * single-card menu's `Set status: …` naming; a mixed-type selection
     * shows a disabled hint instead (a silently missing section would read
     * as a bug).
     */
    private buildBulkMenu(): Menu {
        const menu = new Menu()
        const count = this.keys.size
        const columns = this.host.columnsForSelection(this.selectedCards())
        if (columns === null) {
            menu.addItem((item) =>
                item.setTitle('Set status: selection mixes note types').setDisabled(true)
            )
        } else {
            this.addBulkStatusItems(menu, columns, `Set status (${String(count)} cards): `)
            menu.addItem((item) =>
                item
                    .setTitle('Clear status')
                    .setIcon('x')
                    .onClick(() => void this.bulkSetStatus(null))
            )
        }
        menu.addSeparator()
        menu.addItem((item) =>
            item
                .setTitle(`Archive ${String(count)} cards`)
                .setIcon('archive')
                .onClick(() => void this.bulkArchive())
        )
        menu.addItem((item) =>
            item
                .setTitle(`Open ${String(count)} cards`)
                .setIcon('file-symlink')
                .onClick(() => this.bulkOpen())
        )
        menu.addItem((item) =>
            item
                .setTitle('Clear selection')
                .setIcon('x-circle')
                .onClick(() => this.clear())
        )
        return menu
    }

    /**
     * Bulk-write the status on all selected cards. Optimistic (issue #105,
     * finding 1.4): every writeable card is mutated in the model and rendered
     * ONCE up front (the applyMove pattern), then the writes run sequentially
     * (parallel vault writes risk races) — their echoes re-derive the same
     * state. A failed write triggers a rebuild so the board never keeps an
     * optimistic status that didn't land.
     */
    private async bulkSetStatus(statusValue: string | null): Promise<void> {
        let failed = 0
        // `previous` is captured BEFORE the optimistic mutation — it is the
        // revert value for a write that fails.
        const writes: Array<{ card: KanbanCard; property: string; previous: string | null }> = []
        for (const card of this.selectedCards()) {
            const property = this.host.statusPropertyFor(card)
            if (!property) {
                failed++
                continue
            }
            writes.push({ card, property, previous: card.statusValue })
        }
        this.host.applyBulkStatus(writes.map(({ card }) => ({ card, statusValue })))
        let ok = 0
        const failedWrites: Array<{ card: KanbanCard; statusValue: string | null }> = []
        await this.host.runExclusiveWrites(async () => {
            for (const { card, property, previous } of writes) {
                try {
                    if (statusValue === null)
                        await deleteProperty(this.host.app, card.file, property)
                    else await setProperty(this.host.app, card.file, property, statusValue)
                    ok++
                } catch {
                    failed++
                    failedWrites.push({ card, statusValue: previous })
                    continue
                }
                // Own guard: an automation failure after a LANDED write must
                // not be counted as a write failure (which would revert the
                // model status disk already holds).
                try {
                    await this.host.runStatusAutomations(card, previous, statusValue)
                } catch (error: unknown) {
                    log('Status automations failed after a bulk status write.', 'error', error)
                }
            }
        })
        // Precise rollback (issue #105 review): only the failed cards revert
        // to their pre-bulk status — a full rebuild here would re-derive from
        // the still-stale data set and briefly snap EVERY card back.
        if (failedWrites.length > 0) this.host.applyBulkStatus(failedWrites)
        new Notice(
            `Set status on ${String(ok)} card(s)${failed ? `, ${String(failed)} failed` : ''}.`
        )
        this.clear()
    }

    /**
     * Bulk archive. Optimistic (issue #105, finding 1.4): the archivable
     * cards leave the model in ONE render up front, then the moves run
     * sequentially. A failed move triggers a rebuild so its card reappears.
     */
    private async bulkArchive(): Promise<void> {
        let skipped = 0
        const targets: Array<{ card: KanbanCard; archive: ArchiveConfig }> = []
        for (const card of this.selectedCards()) {
            const archive = this.host.archiveConfigFor(card)
            if (archive.archiveFolder.trim().length === 0) {
                skipped++
                continue
            }
            targets.push({ card, archive })
        }
        this.host.removeCardsFromModel(targets.map((t) => t.card.key))
        let ok = 0
        const failedCards: KanbanCard[] = []
        await this.host.runExclusiveWrites(async () => {
            for (const { card, archive } of targets) {
                try {
                    await this.host.runArchiveAutomations(card)
                } catch (error: unknown) {
                    log('Archive automations failed; archiving anyway.', 'error', error)
                }
                const result = await archiveNote(this.host.app, card.file, archive)
                if (result.ok) ok++
                else failedCards.push(card)
            }
        })
        // Precise rollback: only the cards whose archive failed return to the
        // board — their files never moved (issue #105 review).
        if (failedCards.length > 0) this.host.restoreCardsToModel(failedCards)
        const failed = failedCards.length
        const parts = [`Archived ${String(ok)}`]
        if (skipped) parts.push(`${String(skipped)} skipped (no folder)`)
        if (failed) parts.push(`${String(failed)} failed`)
        new Notice(`${parts.join(', ')}.`)
        this.clear()
    }

    private bulkOpen(): void {
        for (const card of this.selectedCards()) {
            void this.host.app.workspace.getLeaf('tab').openFile(card.file)
        }
        this.clear()
    }
}
