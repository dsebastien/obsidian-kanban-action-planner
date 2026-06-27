import { AbstractInputSuggest, TFolder } from 'obsidian'
import type { App } from 'obsidian'

/**
 * Inline folder-path autocomplete for a settings text input. Suggests existing
 * vault folders matching what's typed.
 *
 * Templated suffixes are preserved: the archive path may end in a `{{…}}`
 * placeholder (e.g. `Archive/{{year}}`), so only the static prefix is matched
 * and a chosen folder is spliced back in front of the template part.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    constructor(
        app: App,
        inputEl: HTMLInputElement,
        private readonly onPick: (path: string) => void
    ) {
        super(app, inputEl)
    }

    protected getSuggestions(query: string): TFolder[] {
        const needle = splitTemplate(query).staticPart.toLowerCase()
        return this.app.vault
            .getAllFolders(false)
            .filter((folder) => folder.path.toLowerCase().includes(needle))
            .sort((a, b) => a.path.length - b.path.length)
            .slice(0, this.limit)
    }

    override renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path)
    }

    override selectSuggestion(folder: TFolder): void {
        const { templatePart } = splitTemplate(this.getValue())
        const value = templatePart ? `${folder.path}/${templatePart}` : folder.path
        this.setValue(value)
        this.onPick(value)
        this.close()
    }
}

/** Split a path into the literal prefix and the first `{{…}}` template onward. */
function splitTemplate(value: string): { staticPart: string; templatePart: string } {
    const idx = value.indexOf('{{')
    return idx === -1
        ? { staticPart: value, templatePart: '' }
        : { staticPart: value.slice(0, idx), templatePart: value.slice(idx) }
}
