import { Modal } from 'obsidian'
import type { App } from 'obsidian'
import type { EstimateUnit } from '../../domain/estimate'

/**
 * A tiny estimate prompt (timeline rework): a native `<input type="number">`
 * (whole number ≥ 1, in the card's own unit — days or minutes) plus Set /
 * Clear / Cancel — the number-input sibling of `DatePromptModal`. `onSubmit`
 * receives the parsed unit-native value, or `null` when the user clears the
 * estimate (Clear only shows when one exists).
 */
export class EstimatePromptModal extends Modal {
    constructor(
        app: App,
        private readonly heading: string,
        private readonly initial: number | null,
        private readonly onSubmit: (value: number | null) => void,
        private readonly unit: EstimateUnit = 'days'
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        const unitLabel = this.unit === 'minutes' ? 'Minutes' : 'Days'
        const input = this.contentEl.createEl('input', {
            type: 'number',
            cls: 'kap-date-input',
            value: this.initial !== null ? String(this.initial) : '',
            placeholder: unitLabel,
            attr: { 'min': '1', 'step': '1', 'aria-label': `Estimate (${unitLabel})` }
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
            const raw = Number(input.value)
            if (!Number.isFinite(raw) || input.value.trim() === '') return
            // Days keep the historical ceil; minutes round to the minute.
            const whole = this.unit === 'days' ? Math.ceil(raw) : Math.round(raw)
            if (whole < 1) return
            this.onSubmit(whole)
            this.close()
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
