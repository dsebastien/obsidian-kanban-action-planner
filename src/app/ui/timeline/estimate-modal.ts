import { Modal } from 'obsidian'
import type { App } from 'obsidian'
import { parseEstimate } from '../../domain/timeline'

/**
 * A tiny estimate prompt (timeline rework): a native `<input type="number">`
 * (whole days, minimum 1) plus Set / Clear / Cancel — the number-input sibling
 * of `DatePromptModal`. `onSubmit` receives the parsed day count, or `null`
 * when the user clears the estimate (Clear only shows when one exists).
 */
export class EstimatePromptModal extends Modal {
    constructor(
        app: App,
        private readonly heading: string,
        private readonly initial: number | null,
        private readonly onSubmit: (days: number | null) => void
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        const input = this.contentEl.createEl('input', {
            type: 'number',
            cls: 'kap-date-input',
            value: this.initial !== null ? String(this.initial) : '',
            placeholder: 'Days',
            attr: { 'min': '1', 'step': '1', 'aria-label': 'Estimate (days)' }
        })
        const actions = this.contentEl.createDiv({ cls: 'kap-date-actions' })
        if (this.initial !== null) {
            const clear = actions.createEl('button', {
                text: 'Clear estimate',
                cls: 'kap-date-clear'
            })
            clear.addEventListener('click', () => {
                this.onSubmit(null)
                this.close()
            })
        }
        const cancel = actions.createEl('button', { text: 'Cancel' })
        cancel.addEventListener('click', () => this.close())
        const set = actions.createEl('button', { text: 'Set', cls: 'mod-cta' })
        const submit = (): void => {
            const days = parseEstimate(input.value)
            if (days !== null) {
                this.onSubmit(days)
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
