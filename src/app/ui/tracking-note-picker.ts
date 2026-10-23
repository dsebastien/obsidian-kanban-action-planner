import { FuzzySuggestModal } from 'obsidian'
import type { App, FuzzyMatch, TFile } from 'obsidian'

/**
 * "Switch time tracking to…" (issue #228): a fuzzy note picker over the notes
 * in the order given (recently tracked first, then recently opened, then the
 * rest), with the folder as a hint and the note tracked right now marked.
 */
export class TrackingNotePickerModal extends FuzzySuggestModal<TFile> {
    constructor(
        app: App,
        private readonly files: readonly TFile[],
        private readonly trackedPath: string | null,
        private readonly onChoose: (file: TFile) => void
    ) {
        super(app)
        this.setPlaceholder('Switch time tracking to…')
    }

    override getItems(): TFile[] {
        return [...this.files]
    }

    override getItemText(file: TFile): string {
        return `${file.basename} ${file.parent?.path ?? ''}`
    }

    override renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
        const file = match.item
        const title = el.createDiv({ text: file.basename })
        if (file.path === this.trackedPath)
            title.createSpan({ cls: 'kap-suggest-tracking', text: 'Tracking now' })
        const parent = file.parent?.path
        if (parent && parent !== '/')
            el.createEl('small', { text: parent, cls: 'kap-suggest-path' })
    }

    override onChooseItem(file: TFile): void {
        this.onChoose(file)
    }
}
