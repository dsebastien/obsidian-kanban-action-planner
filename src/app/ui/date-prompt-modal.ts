import { Modal } from 'obsidian'
import type { App } from 'obsidian'

/**
 * A tiny date picker: a native `<input type="date">` plus Set / Clear / Cancel.
 * Used to schedule a card or set its deadline precisely (the calendar drag
 * handles the visual case). `onSubmit` receives a `YYYY-MM-DD` string, or `null`
 * when the user clears the date.
 */
export class DatePromptModal extends Modal {
    constructor(
        app: App,
        private readonly heading: string,
        private readonly initial: string,
        private readonly onSubmit: (isoDate: string | null) => void
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        const input = this.contentEl.createEl('input', {
            type: 'date',
            cls: 'kap-date-input',
            value: this.initial
        })
        const actions = this.contentEl.createDiv({ cls: 'kap-date-actions' })
        if (this.initial) {
            const clear = actions.createEl('button', { text: 'Clear date', cls: 'kap-date-clear' })
            clear.addEventListener('click', () => {
                this.onSubmit(null)
                this.close()
            })
        }
        const cancel = actions.createEl('button', { text: 'Cancel' })
        cancel.addEventListener('click', () => this.close())
        const set = actions.createEl('button', { text: 'Set', cls: 'mod-cta' })
        const submit = (): void => {
            if (input.value) {
                this.onSubmit(input.value)
                this.close()
            }
        }
        set.addEventListener('click', submit)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit()
        })
        window.setTimeout(() => input.focus(), 0)
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
