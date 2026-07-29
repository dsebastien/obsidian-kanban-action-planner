import { Modal } from 'obsidian'
import type { App } from 'obsidian'
import { toDateKey } from '../domain/calendar'
import { formatNaturalDatePreview, parseNaturalDate } from '../domain/natural-date'

/**
 * A tiny date picker: a natural-language text input ("tomorrow", "next mon",
 * "in 3 days" — issue #116) with a live preview hint, above a native
 * `<input type="date">`, plus Set / Clear / Cancel. Typing a recognized
 * phrase resolves it into the date input ({@link parseNaturalDate}, anchored
 * on the global first-day-of-week); the picker remains for precise dates.
 * `onSubmit` receives a `YYYY-MM-DD` string, or `null` when the user clears
 * the date.
 */
export class DatePromptModal extends Modal {
    constructor(
        app: App,
        private readonly heading: string,
        private readonly initial: string,
        private readonly onSubmit: (isoDate: string | null) => void,
        private readonly firstDayOfWeek: number = 1
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        const nlInput = this.contentEl.createEl('input', {
            type: 'text',
            cls: 'kap-date-input',
            placeholder: 'tomorrow, fri, next mon, in 3 days…',
            attr: {
                'aria-label': 'Type a date in words',
                'autocomplete': 'off',
                'spellcheck': 'false'
            }
        })
        // Live resolution feedback: which day Set will actually write.
        const hint = this.contentEl.createDiv({ cls: 'kap-date-hint' })
        const input = this.contentEl.createEl('input', {
            type: 'date',
            cls: 'kap-date-input',
            value: this.initial,
            attr: { 'aria-label': 'Date' }
        })
        const updateHint = (): void => {
            const raw = nlInput.value.trim()
            if (raw === '') {
                hint.setText('')
                hint.removeClass('kap-date-hint-invalid')
                return
            }
            const parsed = parseNaturalDate(raw, new Date(), this.firstDayOfWeek)
            if (parsed) {
                input.value = toDateKey(parsed)
                hint.setText(`→ ${formatNaturalDatePreview(parsed, new Date())}`)
            } else {
                hint.setText('Unrecognized — try tomorrow, fri, next mon, in 3 days')
            }
            hint.toggleClass('kap-date-hint-invalid', parsed === null)
        }
        nlInput.addEventListener('input', updateHint)
        // Adjusting the picker directly supersedes whatever was typed.
        input.addEventListener('input', () => {
            nlInput.value = ''
            updateHint()
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
            // An unrecognized typed phrase must not silently submit a stale date.
            if (nlInput.value.trim() !== '' && hint.hasClass('kap-date-hint-invalid')) return
            if (input.value) {
                this.onSubmit(input.value)
                this.close()
            }
        }
        set.addEventListener('click', submit)
        const submitOnEnter = (e: KeyboardEvent): void => {
            if (e.key === 'Enter') submit()
        }
        nlInput.addEventListener('keydown', submitOnEnter)
        input.addEventListener('keydown', submitOnEnter)
        window.setTimeout(() => nlInput.focus(), 0)
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
