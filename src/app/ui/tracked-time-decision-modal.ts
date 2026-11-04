import { Modal, Setting } from 'obsidian'
import type { App } from 'obsidian'
import { TrackedTimeDecisionSession } from './tracked-time-decision-session'
import type { DecisionRowState, TrackedTimeDecisionRow } from './tracked-time-decision-session'

export interface TrackedTimeDecisionOptions {
    rows: readonly TrackedTimeDecisionRow[]
    /** Minutes in the display grammar ("1h 30m"). */
    format: (minutes: number) => string
}

/**
 * Keep or drop, per note, a stored tracked time above its entries and
 * sessions (business rule 79). The logic lives in
 * {@link TrackedTimeDecisionSession}; this renders it and patches each row
 * in place when its state changes. Closing leaves the open rows as they are.
 */
export class TrackedTimeDecisionModal extends Modal {
    private readonly options: TrackedTimeDecisionOptions
    private readonly session: TrackedTimeDecisionSession
    private readonly settings: Setting[] = []
    private bulkButtons: HTMLButtonElement[] = []
    private closeButton: HTMLButtonElement | null = null

    constructor(app: App, options: TrackedTimeDecisionOptions) {
        super(app)
        this.options = options
        this.session = new TrackedTimeDecisionSession(options.rows, options.format, () =>
            this.render()
        )
    }

    override onOpen(): void {
        const count = this.options.rows.length
        this.titleEl.setText(
            count === 1
                ? 'More time stored than tracked'
                : `${count} notes hold more time than tracked`
        )
        this.contentEl.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                'The stored time is above the time from entries and sessions. ' +
                'Keep adds the difference as a time entry named "Manual adjustment", ' +
                'dated on the day the note was created. Drop sets the stored time to ' +
                'the entries and sessions. Closing changes nothing.'
        })
        this.session.states.forEach((state, index) => {
            const setting = new Setting(this.contentEl).setName(state.row.title)
            this.settings[index] = setting
            this.renderRow(setting, state, index)
        })
        const actions = this.contentEl.createDiv({ cls: 'modal-button-container' })
        if (count > 1) {
            const keepAll = actions.createEl('button', { text: 'Keep all', cls: 'mod-cta' })
            keepAll.addEventListener('click', () => void this.session.decideAll('keep'))
            const dropAll = actions.createEl('button', { text: 'Drop all', cls: 'mod-warning' })
            dropAll.addEventListener('click', () => void this.session.decideAll('drop'))
            this.bulkButtons = [keepAll, dropAll]
        }
        this.closeButton = actions.createEl('button', { text: 'Decide later' })
        this.closeButton.addEventListener('click', () => this.close())
    }

    /** Patch every row from the session state. */
    private render(): void {
        this.session.states.forEach((state, index) => {
            const setting = this.settings[index]
            if (setting) this.renderRow(setting, state, index)
        })
        if (this.session.openCount === 0) {
            for (const button of this.bulkButtons) button.remove()
            this.bulkButtons = []
            this.closeButton?.setText('Done')
        }
    }

    private renderRow(setting: Setting, state: DecisionRowState, index: number): void {
        const format = this.options.format
        setting.controlEl.empty()
        if (state.status === 'open' || state.status === 'busy') {
            const { stored, computed, difference } = state.decision
            setting.setDesc(
                `Stored ${format(stored)} · entries and sessions ${format(computed)} · ` +
                    `difference ${format(difference)}`
            )
            const busy = state.status === 'busy'
            setting
                .addButton((button) =>
                    button
                        .setButtonText('Keep')
                        .setCta()
                        .setDisabled(busy)
                        .onClick(() => void this.session.decide(index, 'keep'))
                )
                .addButton((button) =>
                    button
                        .setButtonText('Drop')
                        .setDestructive()
                        .setDisabled(busy)
                        .onClick(() => void this.session.decide(index, 'drop'))
                )
            return
        }
        setting.setDesc(state.message ?? '')
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
