import { Menu, Notice } from 'obsidian'
import type { App } from 'obsidian'
import type { ArchiveConfig, ColumnDef } from '../../domain/note-type'
import type { KanbanCard } from '../../ui/board/types'
import { deleteProperty, setProperty } from '../../services/frontmatter.service'
import { archiveNote } from '../../services/archive.service'
import { inclusiveKeyRange } from './selection-range'

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
     * mutate every card in the in-memory model and render ONCE, before the
     * sequential writes. The write echoes re-derive the same state and are
     * absorbed by the render-signature gate.
     */
    applyBulkStatus(cards: KanbanCard[], statusValue: string | null): void
    /**
     * Optimistically drop cards from the in-memory model and render once
     * (issue #105, finding 1.4) — archived notes leave the board, so the
     * board reflects the whole bulk archive up front instead of streaming
     * intermediate rebuilds.
     */
    removeCardsFromModel(keys: string[]): void
    /**
     * Re-derive the model from the current data — the rollback path when a
     * bulk write failed, so an optimistic mutation never sticks around for a
     * write that didn't land.
     */
    requestRebuild(): void
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
        if (!this.mode || this.keys.size === 0) {
            bar.addClass('kap-hidden')
            return
        }
        bar.removeClass('kap-hidden')
        bar.createSpan({ cls: 'kap-selection-count', text: `${String(this.keys.size)} selected` })
        const actions = bar.createDiv({ cls: 'kap-selection-actions' })
        const statusBtn = actions.createEl('button', {
            cls: 'kap-selection-btn',
            text: 'Set status'
        })
        statusBtn.addEventListener('click', (e) => this.openBulkStatusMenu(e))
        this.addButton(actions, 'Archive', () => void this.bulkArchive())
        this.addButton(actions, 'Open', () => this.bulkOpen())
        this.addButton(actions, 'Clear', () => this.clear())
    }

    private addButton(parent: HTMLElement, label: string, onClick: () => void): void {
        parent
            .createEl('button', { cls: 'kap-selection-btn', text: label })
            .addEventListener('click', onClick)
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
        for (const col of columns) {
            menu.addItem((item) =>
                item.setTitle(col.label).onClick(() => void this.bulkSetStatus(col.statusValue))
            )
        }
        menu.addSeparator()
        menu.addItem((item) =>
            item
                .setTitle('Clear status')
                .setIcon('x')
                .onClick(() => void this.bulkSetStatus(null))
        )
        menu.showAtMouseEvent(event)
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
        const writes: Array<{ card: KanbanCard; property: string }> = []
        for (const card of this.selectedCards()) {
            const property = this.host.statusPropertyFor(card)
            if (!property) {
                failed++
                continue
            }
            writes.push({ card, property })
        }
        this.host.applyBulkStatus(
            writes.map((w) => w.card),
            statusValue
        )
        let ok = 0
        for (const { card, property } of writes) {
            try {
                if (statusValue === null) await deleteProperty(this.host.app, card.file, property)
                else await setProperty(this.host.app, card.file, property, statusValue)
                ok++
            } catch {
                failed++
            }
        }
        if (failed > 0) this.host.requestRebuild()
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
        let failed = 0
        for (const { card, archive } of targets) {
            const result = await archiveNote(this.host.app, card.file, archive)
            if (result.ok) ok++
            else failed++
        }
        if (failed > 0) this.host.requestRebuild()
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
