import { Modal } from 'obsidian'
import type { App } from 'obsidian'

export type RecoveryDecision = 'keep' | 'trim' | 'discard'

export interface SessionRecoveryOptions {
    title: string
    message: string
    /** Label of the trim choice, or null when no trim point applies. */
    trimText: string | null
    onDecide: (decision: RecoveryDecision) => void
}

/**
 * The keep / trim / discard prompt for a session found running after a
 * restart, or left idle (issue #197). Closing it without choosing KEEPS the
 * session: the guard never ends a session behind the user's back.
 */
export class SessionRecoveryModal extends Modal {
    private readonly options: SessionRecoveryOptions
    private decided = false

    constructor(app: App, options: SessionRecoveryOptions) {
        super(app)
        this.options = options
    }

    override onOpen(): void {
        this.titleEl.setText(this.options.title)
        this.contentEl.createEl('p', { text: this.options.message })
        const actions = this.contentEl.createDiv({ cls: 'modal-button-container' })
        const choose = (decision: RecoveryDecision): void => {
            this.decided = true
            this.close()
            this.options.onDecide(decision)
        }
        actions.createEl('button', { text: 'Keep running' }).addEventListener('click', () => {
            choose('keep')
        })
        if (this.options.trimText) {
            actions
                .createEl('button', { text: this.options.trimText, cls: 'mod-cta' })
                .addEventListener('click', () => choose('trim'))
        }
        actions
            .createEl('button', { text: 'Discard', cls: 'mod-warning' })
            .addEventListener('click', () => choose('discard'))
    }

    override onClose(): void {
        this.contentEl.empty()
        if (!this.decided) this.options.onDecide('keep')
    }
}
