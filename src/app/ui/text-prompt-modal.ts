import { Modal } from 'obsidian'
import type { App } from 'obsidian'

/**
 * A tiny single-line text prompt: a text input plus Add / Cancel. Used to add a
 * brand-new GTD context to a card (one not yet present on any board card).
 * `onSubmit` receives the trimmed value; it never fires for an empty input.
 */
export class TextPromptModal extends Modal {
    constructor(
        app: App,
        private readonly heading: string,
        private readonly placeholder: string,
        private readonly submitLabel: string,
        private readonly onSubmit: (value: string) => void
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        const input = this.contentEl.createEl('input', {
            type: 'text',
            cls: 'kap-text-input',
            attr: { placeholder: this.placeholder, spellcheck: 'false' }
        })
        const actions = this.contentEl.createDiv({ cls: 'kap-date-actions' })
        const cancel = actions.createEl('button', { text: 'Cancel' })
        cancel.addEventListener('click', () => this.close())
        const submitBtn = actions.createEl('button', { text: this.submitLabel, cls: 'mod-cta' })
        const submit = (): void => {
            const value = input.value.trim()
            if (value.length === 0) return
            this.onSubmit(value)
            this.close()
        }
        submitBtn.addEventListener('click', submit)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit()
        })
        window.setTimeout(() => input.focus(), 0)
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
