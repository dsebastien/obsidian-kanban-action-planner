import { Modal } from 'obsidian'
import type { App } from 'obsidian'

/**
 * Milestone creation prompt (issue #77): a date input (pre-filled from the
 * double-clicked track position, still editable) plus an optional label.
 * `onSubmit` receives the `YYYY-MM-DD` date and the trimmed label (may be '').
 */
export class MilestoneModal extends Modal {
    constructor(
        app: App,
        private readonly cardTitle: string,
        private readonly initialDate: string,
        private readonly onSubmit: (isoDate: string, label: string) => void
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(`Add milestone — ${this.cardTitle}`)
        const dateInput = this.contentEl.createEl('input', {
            type: 'date',
            cls: 'kap-date-input',
            value: this.initialDate
        })
        const labelInput = this.contentEl.createEl('input', {
            cls: 'kap-milestone-label-input',
            attr: {
                'type': 'text',
                'placeholder': 'Label (optional), e.g. Beta release',
                'aria-label': 'Milestone label'
            }
        })
        const actions = this.contentEl.createDiv({ cls: 'kap-date-actions' })
        const cancel = actions.createEl('button', { text: 'Cancel' })
        cancel.addEventListener('click', () => this.close())
        const add = actions.createEl('button', { text: 'Add milestone', cls: 'mod-cta' })
        const submit = (): void => {
            if (dateInput.value) {
                this.onSubmit(dateInput.value, labelInput.value.trim())
                this.close()
            }
        }
        add.addEventListener('click', submit)
        for (const input of [dateInput, labelInput]) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit()
            })
        }
        window.setTimeout(() => labelInput.focus(), 0)
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
