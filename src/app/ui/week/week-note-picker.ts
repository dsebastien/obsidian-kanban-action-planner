import { SuggestModal } from 'obsidian'
import type { App } from 'obsidian'

/**
 * The note picker behind "click an empty slot to plan a block" (issue #172,
 * phase B): a filtering list of the notes eligible for the ideal week, type
 * aware — when the board mixes note types the entries are grouped by type
 * (a type header precedes each group) and each row names its type.
 */

export interface WeekPickerItem {
    path: string
    title: string
    typeName: string | null
    /** Secondary line: target / planned minutes, contexts… */
    detail: string
}

export class WeekNotePickerModal extends SuggestModal<WeekPickerItem> {
    private readonly items: WeekPickerItem[]
    private readonly onPick: (item: WeekPickerItem) => void
    private readonly grouped: boolean

    constructor(app: App, items: WeekPickerItem[], onPick: (item: WeekPickerItem) => void) {
        super(app)
        this.onPick = onPick
        const types = new Set(items.map((i) => i.typeName ?? ''))
        this.grouped = types.size > 1
        this.items = [...items].sort((a, b) => {
            const ta = a.typeName ?? ''
            const tb = b.typeName ?? ''
            if (this.grouped && ta !== tb) return ta.localeCompare(tb)
            return a.title.localeCompare(b.title)
        })
        this.setPlaceholder('Which note gets this block? Type to filter…')
        this.setInstructions([
            { command: '↑↓', purpose: 'navigate' },
            { command: '↵', purpose: 'plan the block' },
            { command: 'esc', purpose: 'cancel' }
        ])
    }

    getSuggestions(query: string): WeekPickerItem[] {
        const q = query.trim().toLowerCase()
        if (q === '') return this.items
        const terms = q.split(/\s+/)
        return this.items.filter((item) => {
            const hay = `${item.title} ${item.typeName ?? ''} ${item.detail}`.toLowerCase()
            return terms.every((t) => hay.includes(t))
        })
    }

    renderSuggestion(item: WeekPickerItem, el: HTMLElement): void {
        el.addClass('kap-week-pick')
        const row = el.createDiv({ cls: 'kap-week-pick-row' })
        if (this.grouped && this.isFirstOfType(item)) {
            el.addClass('kap-week-pick-first')
            el.setAttribute('data-type-group', item.typeName ?? '')
        }
        row.createSpan({ cls: 'kap-week-pick-title', text: item.title })
        if (this.grouped && item.typeName) {
            row.createSpan({ cls: 'kap-week-pick-type', text: item.typeName })
        }
        if (item.detail) el.createDiv({ cls: 'kap-week-pick-detail', text: item.detail })
    }

    onChooseSuggestion(item: WeekPickerItem): void {
        this.onPick(item)
    }

    private isFirstOfType(item: WeekPickerItem): boolean {
        const shown = this.getSuggestions(this.inputEl.value)
        const first = shown.find((i) => (i.typeName ?? '') === (item.typeName ?? ''))
        return first?.path === item.path
    }
}
