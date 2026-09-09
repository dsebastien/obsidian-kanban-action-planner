import { Modal, Setting } from 'obsidian'
import type { App } from 'obsidian'

/**
 * "Import ideal week" dialog (issue #172, phase D): paste the week-planner
 * app's JSON or Markdown export, or pick the file; choose whether the
 * imported blocks replace the matched notes' current blocks or join them.
 */
export class WeekImportModal extends Modal {
    private text = ''
    private replace = true
    private readonly onImport: (text: string, replace: boolean) => void

    constructor(app: App, onImport: (text: string, replace: boolean) => void) {
        super(app)
        this.onImport = onImport
    }

    override onOpen(): void {
        const { contentEl } = this
        contentEl.addClass('kap-root')
        contentEl.createEl('h2', { text: 'Import an ideal week' })
        contentEl.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                'Paste the week-planner app’s JSON or Markdown export, or choose the file. ' +
                'Each block’s text names the note it belongs to (exact, then case-insensitive); ' +
                'you are asked about the rest. Styling is not imported: contexts colour the blocks.'
        })
        const area = contentEl.createEl('textarea', {
            cls: 'kap-week-import-text',
            attr: {
                rows: '12',
                placeholder: '{ "version": "1.0", "blocks": [ … ] }  or  ## Monday …'
            }
        })
        area.addEventListener('input', () => {
            this.text = area.value
        })
        new Setting(contentEl)
            .setName('Choose a file')
            .setDesc('A .json or .md export of the app.')
            .addButton((btn) =>
                btn.setButtonText('Browse…').onClick(() => {
                    const input = contentEl.createEl('input', {
                        type: 'file',
                        attr: { accept: '.json,.md,.markdown,.txt', hidden: 'true' }
                    })
                    input.addEventListener('change', () => {
                        const file = input.files?.[0]
                        if (!file) return
                        void file.text().then((content) => {
                            this.text = content
                            area.value = content
                            input.remove()
                        })
                    })
                    input.click()
                })
            )
        new Setting(contentEl)
            .setName('Replace the notes’ current blocks')
            .setDesc('Off: the imported blocks are added to what the notes already carry.')
            .addToggle((toggle) =>
                toggle.setValue(this.replace).onChange((value) => {
                    this.replace = value
                })
            )
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText('Import')
                    .setCta()
                    .onClick(() => {
                        const text = this.text.trim()
                        if (text === '') return
                        this.close()
                        this.onImport(text, this.replace)
                    })
            )
            .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
