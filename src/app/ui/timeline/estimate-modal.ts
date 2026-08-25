import { Modal } from 'obsidian'
import type { App } from 'obsidian'
import { DEFAULT_MINUTES_PER_DAY } from '../../constants'
import { formatUnitValue, parseEstimateInput } from '../../domain/estimate'
import type { EstimateUnit } from '../../domain/estimate'

/**
 * A tiny estimate prompt (timeline rework): a text input plus Set / Clear /
 * Cancel — the sibling of `DatePromptModal`. Accepts a bare number in the
 * card's own unit OR a generic duration ("2h", "90m", "0.5d", "1d 4h"),
 * converted to that unit via the minutes-per-day setting
 * ({@link parseEstimateInput}); a live hint shows the value that will be
 * written. `onSubmit` receives the parsed unit-native value, or `null` when
 * the user clears the estimate (Clear only shows when one exists).
 */
export class EstimatePromptModal extends Modal {
    constructor(
        app: App,
        private readonly heading: string,
        private readonly initial: number | null,
        private readonly onSubmit: (value: number | null) => void,
        private readonly unit: EstimateUnit = 'days',
        private readonly minutesPerDay: number = DEFAULT_MINUTES_PER_DAY
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        const unitLabel = this.unit === 'minutes' ? 'Minutes' : 'Days'
        const input = this.contentEl.createEl('input', {
            type: 'text',
            cls: 'kap-date-input',
            value: this.initial !== null ? String(this.initial) : '',
            placeholder: `${unitLabel} — or 2h, 90m, 0.5d`,
            attr: {
                'aria-label': `Estimate (${unitLabel.toLowerCase()}, or a duration like 2h)`,
                'autocomplete': 'off',
                'inputmode': 'text'
            }
        })
        // Live conversion feedback: what Set will actually write.
        const hint = this.contentEl.createDiv({ cls: 'kap-estimate-hint' })
        const updateHint = (): void => {
            const raw = input.value.trim()
            if (raw === '') {
                hint.setText('')
                return
            }
            const parsed = parseEstimateInput(raw, this.unit, this.minutesPerDay)
            hint.setText(
                parsed === null
                    ? 'Unrecognized — try 2h, 90m, 0.5d or a plain number'
                    : `= ${String(parsed)} ${this.unit} (${formatUnitValue(
                          parsed,
                          this.unit,
                          this.minutesPerDay
                      )})`
            )
            hint.toggleClass('kap-estimate-hint-invalid', parsed === null)
        }
        input.addEventListener('input', updateHint)
        updateHint()
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
            const value = parseEstimateInput(input.value, this.unit, this.minutesPerDay)
            if (value === null) return
            this.onSubmit(value)
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
