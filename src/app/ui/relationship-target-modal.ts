import { FuzzySuggestModal } from 'obsidian'
import type { App, FuzzyMatch, TFile } from 'obsidian'

/**
 * A fuzzy note picker for choosing a relationship target (issue #14). Lists the
 * vault's markdown files minus an exclude set (this note + already-linked
 * targets), shows the folder path as a hint, and calls back with the choice.
 */
export class RelationshipTargetModal extends FuzzySuggestModal<TFile> {
    constructor(
        app: App,
        roleLabel: string,
        private readonly excludePaths: ReadonlySet<string>,
        private readonly onChoose: (file: TFile) => void
    ) {
        super(app)
        this.setPlaceholder(`Add ${roleLabel.toLowerCase()} — pick a note…`)
    }

    override getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles().filter((f) => !this.excludePaths.has(f.path))
    }

    override getItemText(file: TFile): string {
        return `${file.basename} ${file.parent?.path ?? ''}`
    }

    override renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
        const file = match.item
        el.createDiv({ text: file.basename })
        const parent = file.parent?.path
        if (parent && parent !== '/')
            el.createEl('small', { text: parent, cls: 'kap-suggest-path' })
    }

    override onChooseItem(file: TFile): void {
        this.onChoose(file)
    }
}
