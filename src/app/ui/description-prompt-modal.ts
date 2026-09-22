import { Modal } from 'obsidian'
import type { App } from 'obsidian'

export interface DescriptionPromptOptions {
    title: string
    /** One line under the title. */
    subtitle: string
    placeholder: string
    /** Prefilled value (the last description on the note, issue #197). */
    initial: string
    submitText: string
    /** Called with the trimmed value; an empty submit is a skip. */
    onSubmit: (value: string) => void
}

/**
 * A one-field text prompt. Used for the time entry's description after a
 * session stops (issue #197): the entry is already written when this opens,
 * so closing it any other way than Submit changes nothing — a prompt that is
 * ignored never blocks or loses a stop.
 */
export class DescriptionPromptModal extends Modal {
    private readonly options: DescriptionPromptOptions

    constructor(app: App, options: DescriptionPromptOptions) {
        super(app)
        this.options = options
    }

    override onOpen(): void {
        this.titleEl.setText(this.options.title)
        this.contentEl.createEl('p', { cls: 'kap-modal-subtitle', text: this.options.subtitle })
        const input = this.contentEl.createEl('input', {
            type: 'text',
            cls: 'kap-text-input',
            attr: { placeholder: this.options.placeholder, spellcheck: 'true' }
        })
        input.value = this.options.initial
        const actions = this.contentEl.createDiv({ cls: 'kap-date-actions' })
        const skip = actions.createEl('button', { text: 'Skip' })
        skip.addEventListener('click', () => this.close())
        const submit = actions.createEl('button', { text: this.options.submitText, cls: 'mod-cta' })
        const done = (): void => {
            const value = input.value.trim()
            this.close()
            if (value.length > 0) this.options.onSubmit(value)
        }
        submit.addEventListener('click', done)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                done()
            }
        })
        window.setTimeout(() => {
            input.focus()
            input.select()
        }, 0)
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
