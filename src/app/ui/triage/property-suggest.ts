import { AbstractInputSuggest } from 'obsidian'
import type { App } from 'obsidian'

/** A selectable property: its stored id and a human label. */
export interface PropertyOption {
    id: string
    label: string
}

/**
 * Inline autocomplete over a fixed list of base properties (issue #53 triage
 * config). Suggests by label/id substring, skipping ids already chosen, and
 * reports the picked id. The input is cleared after a pick so it acts as an
 * "add another" box.
 */
export class PropertySuggest extends AbstractInputSuggest<PropertyOption> {
    constructor(
        app: App,
        inputEl: HTMLInputElement,
        private readonly options: () => PropertyOption[],
        private readonly selected: () => ReadonlySet<string>,
        private readonly onPick: (id: string) => void
    ) {
        super(app, inputEl)
    }

    protected getSuggestions(query: string): PropertyOption[] {
        const needle = query.toLowerCase()
        const chosen = this.selected()
        return this.options()
            .filter((o) => !chosen.has(o.id))
            .filter(
                (o) => o.label.toLowerCase().includes(needle) || o.id.toLowerCase().includes(needle)
            )
            .slice(0, this.limit)
    }

    override renderSuggestion(option: PropertyOption, el: HTMLElement): void {
        el.createSpan({ text: option.label })
        if (option.label !== option.id) {
            el.createSpan({ cls: 'kap-suggest-hint', text: ` ${option.id}` })
        }
    }

    override selectSuggestion(option: PropertyOption): void {
        this.onPick(option.id)
        this.setValue('')
        this.close()
    }
}
