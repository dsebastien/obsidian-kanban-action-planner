import { Modal } from 'obsidian'
import type { App, TFile } from 'obsidian'
import type { RetentionScan } from '../services/retention.service'

/**
 * The retention review (issue #241): the done notes past their retention
 * period, each with a checkbox, and the notes that are kept with the reason.
 * Nothing is deleted before the user confirms; an unchecked note stays.
 */
export class RetentionReviewModal extends Modal {
    private readonly selected: Set<TFile>

    constructor(
        app: App,
        private readonly scan: RetentionScan,
        private readonly onDelete: (files: TFile[]) => void
    ) {
        super(app)
        this.selected = new Set(scan.due.map((due) => due.file))
    }

    override onOpen(): void {
        this.titleEl.setText('Done notes past their retention period')
        const root = this.contentEl.createDiv({ cls: 'kap-root kap-retention' })
        const { due, kept } = this.scan

        const actions = this.contentEl.createDiv({ cls: 'modal-button-container' })
        const cancel = actions.createEl('button', { text: due.length > 0 ? 'Cancel' : 'Close' })
        cancel.addEventListener('click', () => this.close())
        const confirm = due.length > 0 ? actions.createEl('button', { cls: 'mod-warning' }) : null
        const refreshConfirm = (): void => {
            if (!confirm) return
            const count = this.selected.size
            confirm.setText(count === 1 ? 'Delete 1 note' : `Delete ${String(count)} notes`)
            confirm.disabled = count === 0
        }
        confirm?.addEventListener('click', () => {
            this.close()
            this.onDelete([...this.selected])
        })
        refreshConfirm()

        if (due.length === 0) {
            root.createEl('p', { text: 'No note is due for deletion.' })
        } else {
            root.createEl('p', {
                cls: 'kap-modal-subtitle',
                text: 'These notes are done and older than their retention period. Deleted notes go where the deleted files setting of the app sends them. Clear a checkbox to keep a note this time.'
            })
            const list = root.createDiv({ cls: 'kap-retention-list' })
            for (const item of due) {
                const row = list.createEl('label', { cls: 'kap-retention-row' })
                const box = row.createEl('input', { type: 'checkbox' })
                box.checked = true
                box.addEventListener('change', () => {
                    if (box.checked) this.selected.add(item.file)
                    else this.selected.delete(item.file)
                    refreshConfirm()
                })
                const text = row.createDiv({ cls: 'kap-retention-text' })
                this.noteLink(text, item.file)
                const facts = [
                    `done ${item.completed}`,
                    `retention ${String(item.days)} ${item.days === 1 ? 'day' : 'days'}`
                ]
                if (item.backlinks > 0) {
                    facts.push(
                        item.backlinks === 1
                            ? '1 note links to it'
                            : `${String(item.backlinks)} notes link to it`
                    )
                }
                text.createDiv({ cls: 'kap-retention-facts', text: facts.join(' · ') })
            }
        }

        if (kept.length > 0) {
            root.createEl('h4', { text: 'Kept' })
            const list = root.createDiv({ cls: 'kap-retention-list' })
            for (const item of kept) {
                const text = list.createDiv({ cls: 'kap-retention-text' })
                this.noteLink(text, item.file)
                text.createDiv({ cls: 'kap-retention-facts', text: item.detail })
            }
        }
    }

    /** The note's name; a click opens it in a new tab (the dialog stays). */
    private noteLink(parent: HTMLElement, file: TFile): void {
        const link = parent.createEl('a', { cls: 'kap-retention-name', text: file.basename })
        link.setAttribute('aria-label', file.path)
        link.addEventListener('click', (event) => {
            event.preventDefault()
            void this.app.workspace.getLeaf('tab').openFile(file, { active: false })
        })
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
