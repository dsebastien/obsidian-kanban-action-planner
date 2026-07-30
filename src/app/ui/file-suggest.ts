import { AbstractInputSuggest, TFile } from 'obsidian'
import type { App } from 'obsidian'

/**
 * Inline markdown-file autocomplete for a settings text input — used to pick a
 * note type's template file (issue #46).
 *
 * When a template folder is known (Templater's, or the core Templates plugin's)
 * its files are offered first, so the common case is a couple of keystrokes,
 * while any other note in the vault stays selectable.
 */
export class FileSuggest extends AbstractInputSuggest<TFile> {
    constructor(
        app: App,
        inputEl: HTMLInputElement,
        private readonly onPick: (path: string) => void,
        private readonly preferredFolder: string | null = null
    ) {
        super(app, inputEl)
    }

    protected getSuggestions(query: string): TFile[] {
        const needle = query.toLowerCase()
        const preferred = this.preferredFolder?.toLowerCase() ?? null
        return this.app.vault
            .getMarkdownFiles()
            .filter((file) => file.path.toLowerCase().includes(needle))
            .sort((a, b) => {
                const rank = (file: TFile): number =>
                    preferred !== null && file.path.toLowerCase().startsWith(preferred) ? 0 : 1
                const byRank = rank(a) - rank(b)
                return byRank !== 0 ? byRank : a.path.localeCompare(b.path)
            })
            .slice(0, this.limit)
    }

    override renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path)
    }

    override selectSuggestion(file: TFile): void {
        this.setValue(file.path)
        this.onPick(file.path)
        this.close()
    }
}
