import { Modal } from 'obsidian'
import type { App } from 'obsidian'

/** What the note will look like for the title typed so far. */
export interface CreateNotePreview {
    /** Full vault path the note will get (already uniquified). */
    path: string
    /** Template that will be applied, or `null` when there is none. */
    templatePath: string | null
}

/**
 * Quick-capture prompt (issue #46): a title input plus a live preview of where
 * the note will land and which template it will get.
 *
 * The preview matters because the note type's folder, name prefix/suffix and
 * template can all come from the Starter Kit rather than from anything typed
 * here — showing the resolved result makes that layering visible before the note
 * is created rather than after.
 */
export class CreateNoteModal extends Modal {
    private title = ''
    private previewEl: HTMLElement | null = null
    private templateEl: HTMLElement | null = null

    constructor(
        app: App,
        private readonly heading: string,
        private readonly subtitle: string,
        private readonly preview: (title: string) => CreateNotePreview,
        private readonly onSubmit: (title: string) => void
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText(this.heading)
        this.contentEl.createEl('p', { cls: 'kap-modal-subtitle', text: this.subtitle })

        const input = this.contentEl.createEl('input', {
            type: 'text',
            cls: 'kap-text-input',
            attr: { placeholder: 'Note name', spellcheck: 'false' }
        })
        this.previewEl = this.contentEl.createDiv({ cls: 'kap-create-preview' })
        this.templateEl = this.contentEl.createDiv({ cls: 'kap-create-preview' })

        const actions = this.contentEl.createDiv({ cls: 'kap-date-actions' })
        const cancel = actions.createEl('button', { text: 'Cancel' })
        cancel.addEventListener('click', () => this.close())
        const create = actions.createEl('button', { text: 'Create', cls: 'mod-cta' })

        const submit = (): void => {
            const value = this.title.trim()
            if (value.length === 0) return
            this.close()
            this.onSubmit(value)
        }
        create.addEventListener('click', submit)
        input.addEventListener('input', () => {
            this.title = input.value
            this.renderPreview()
        })
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                submit()
            }
        })

        this.renderPreview()
        window.setTimeout(() => input.focus(), 0)
    }

    private renderPreview(): void {
        if (!this.previewEl || !this.templateEl) return
        const typed = this.title.trim()
        if (typed.length === 0) {
            this.previewEl.setText('')
            this.templateEl.setText('')
            return
        }
        const preview = this.preview(typed)
        this.previewEl.setText(preview.path)
        this.templateEl.setText(
            preview.templatePath ? `Template: ${preview.templatePath}` : 'No template'
        )
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
