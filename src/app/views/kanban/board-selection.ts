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
    columns(): ReadonlyArray<ColumnDef>
    statusProperty(): string | null
    archiveConfigFor(card: KanbanCard): ArchiveConfig
    /** Re-render the toolbar so the Select toggle reflects the new mode. */
    onModeChanged(): void
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
        const menu = new Menu()
        for (const col of this.host.columns()) {
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

    /** Bulk-write the status on all selected cards (sequential; summary notice). */
    private async bulkSetStatus(statusValue: string | null): Promise<void> {
        const property = this.host.statusProperty()
        if (!property) return
        let ok = 0
        let failed = 0
        for (const card of this.selectedCards()) {
            try {
                if (statusValue === null) await deleteProperty(this.host.app, card.file, property)
                else await setProperty(this.host.app, card.file, property, statusValue)
                ok++
            } catch {
                failed++
            }
        }
        new Notice(
            `Set status on ${String(ok)} card(s)${failed ? `, ${String(failed)} failed` : ''}.`
        )
        this.clear()
    }

    private async bulkArchive(): Promise<void> {
        let ok = 0
        let skipped = 0
        let failed = 0
        for (const card of this.selectedCards()) {
            const archive = this.host.archiveConfigFor(card)
            if (archive.archiveFolder.trim().length === 0) {
                skipped++
                continue
            }
            const result = await archiveNote(this.host.app, card.file, archive)
            if (result.ok) ok++
            else failed++
        }
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
