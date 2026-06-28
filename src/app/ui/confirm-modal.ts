import { Modal } from 'obsidian'
import type { App } from 'obsidian'

export interface ConfirmOptions {
    title: string
    message: string
    confirmText: string
    onConfirm: () => void
}

/**
 * A small themed yes/no confirmation (replaces the forbidden `window.confirm`).
 * Used for destructive actions like deleting a local note type.
 */
export class ConfirmModal extends Modal {
    private readonly options: ConfirmOptions

    constructor(app: App, options: ConfirmOptions) {
        super(app)
        this.options = options
    }

    override onOpen(): void {
        this.titleEl.setText(this.options.title)
        this.contentEl.createEl('p', { text: this.options.message })
        const actions = this.contentEl.createDiv({ cls: 'modal-button-container' })
        const cancel = actions.createEl('button', { text: 'Cancel' })
        cancel.addEventListener('click', () => this.close())
        const confirm = actions.createEl('button', {
            cls: 'mod-warning',
            text: this.options.confirmText
        })
        confirm.addEventListener('click', () => {
            this.close()
            this.options.onConfirm()
        })
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
