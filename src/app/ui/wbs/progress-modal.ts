import { Modal } from 'obsidian'
import type { App } from 'obsidian'
import { parseProgress } from '../../domain/wbs'

/**
 * A tiny progress prompt (WBS, issue #76): a native `<input type="number">`
 * (0–100) plus Set / Clear / Cancel — the progress sibling of
 * `EstimatePromptModal`. `onSubmit` receives the clamped 0–100 value, or
 * `null` when the user clears it (Clear only shows when a value exists).
 */
export class ProgressPromptModal extends Modal {
    constructor(
        app: App,
        private readonly heading: string,
        private readonly initial: number | null,
        private readonly onSubmit: (progress: number | null) => void
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        const input = this.contentEl.createEl('input', {
            type: 'number',
            cls: 'kap-date-input',
            value: this.initial !== null ? String(this.initial) : '',
            placeholder: '0–100',
            attr: { 'min': '0', 'max': '100', 'step': '1', 'aria-label': 'Progress (0–100)' }
        })
        const actions = this.contentEl.createDiv({ cls: 'kap-date-actions' })
        if (this.initial !== null) {
            const clear = actions.createEl('button', {
                text: 'Clear progress',
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
            const progress = parseProgress(input.value)
            if (progress !== null) {
                this.onSubmit(progress)
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
