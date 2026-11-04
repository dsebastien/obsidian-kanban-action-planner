import { Modal, Setting } from 'obsidian'
import type { App } from 'obsidian'
import type { LowerChoice, TrackedTimeDecision } from '../domain/tracked-time-decision'

/** One note (or one rollup) whose stored time is above the computed one. */
export interface TrackedTimeDecisionRow {
    /** Shown as the row name. */
    title: string
    decision: TrackedTimeDecision
    /** Write the user's choice; the row shows the result once it resolves. */
    apply: (choice: LowerChoice) => Promise<void>
}

export interface TrackedTimeDecisionOptions {
    rows: readonly TrackedTimeDecisionRow[]
    /** Minutes in the display grammar ("1h 30m"). */
    format: (minutes: number) => string
}

/**
 * Keep or drop, per note, a stored tracked time above its entries and
 * sessions (business rule 79). Each choice is written at once; "Keep all" /
 * "Drop all" answer every row still open. Closing leaves the open rows as
 * they are: nothing is ever lowered without a choice.
 */
export class TrackedTimeDecisionModal extends Modal {
    private readonly options: TrackedTimeDecisionOptions
    private readonly open_ = new Map<TrackedTimeDecisionRow, Setting>()
    private bulkButtons: HTMLButtonElement[] = []
    private closeButton: HTMLButtonElement | null = null

    constructor(app: App, options: TrackedTimeDecisionOptions) {
        super(app)
        this.options = options
    }

    override onOpen(): void {
        const { rows, format } = this.options
        this.titleEl.setText(
            rows.length === 1
                ? 'More time stored than tracked'
                : `${rows.length} notes hold more time than tracked`
        )
        this.contentEl.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                'The stored time is above the time from entries and sessions. ' +
                'Keep adds the difference as a time entry named "Manual adjustment", ' +
                'dated on the day the note was created. Drop sets the stored time to ' +
                'the entries and sessions. Closing changes nothing.'
        })
        for (const row of rows) {
            const { stored, computed, difference } = row.decision
            const setting = new Setting(this.contentEl)
                .setName(row.title)
                .setDesc(
                    `Stored ${format(stored)} · entries and sessions ${format(computed)} · ` +
                        `difference ${format(difference)}`
                )
                .addButton((button) =>
                    button
                        .setButtonText('Keep')
                        .setCta()
                        .onClick(() => void this.decide(row, 'keep'))
                )
                .addButton((button) =>
                    button
                        .setButtonText('Drop')
                        .setDestructive()
                        .onClick(() => void this.decide(row, 'drop'))
                )
            this.open_.set(row, setting)
        }
        const actions = this.contentEl.createDiv({ cls: 'modal-button-container' })
        if (rows.length > 1) {
            const keepAll = actions.createEl('button', { text: 'Keep all', cls: 'mod-cta' })
            keepAll.addEventListener('click', () => void this.decideAll('keep'))
            const dropAll = actions.createEl('button', { text: 'Drop all', cls: 'mod-warning' })
            dropAll.addEventListener('click', () => void this.decideAll('drop'))
            this.bulkButtons = [keepAll, dropAll]
        }
        this.closeButton = actions.createEl('button', { text: 'Decide later' })
        this.closeButton.addEventListener('click', () => this.close())
    }

    /** Answer every row still open, one after the other. */
    private async decideAll(choice: LowerChoice): Promise<void> {
        for (const row of [...this.open_.keys()]) await this.decide(row, choice)
    }

    /** Write one row's choice, then replace its buttons with the result. */
    private async decide(row: TrackedTimeDecisionRow, choice: LowerChoice): Promise<void> {
        const setting = this.open_.get(row)
        if (!setting) return
        this.open_.delete(row)
        setting.controlEl.empty()
        const { stored, computed, difference } = row.decision
        const format = this.options.format
        try {
            await row.apply(choice)
            setting.setDesc(
                choice === 'keep'
                    ? `Kept ${format(stored)}: ${format(difference)} added as a manual adjustment`
                    : `Set to ${format(computed)}`
            )
        } catch {
            setting.setDesc('Not saved: the note could not be written')
        }
        if (this.open_.size === 0) {
            for (const button of this.bulkButtons) button.remove()
            this.closeButton?.setText('Done')
        }
    }

    override onClose(): void {
        this.open_.clear()
        this.contentEl.empty()
    }
}
