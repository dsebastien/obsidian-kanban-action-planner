import { setIcon } from 'obsidian'

export interface FilterBarCallbacks {
    /** Fired on every keystroke with the raw query (caller debounces). */
    onInput: (value: string) => void
    /** Fired when the query is cleared (× button or Esc). */
    onClear: () => void
    /** ✕ on the zoom chip: remove only the `parent:` term (issue #74). */
    onZoomDismiss: () => void
    /** Click on the zoom chip label: open the focused parent note. */
    onZoomOpen: (label: string) => void
}

/** One row of the syntax cheat-sheet popover. */
const HELP_ROWS: ReadonlyArray<{ syntax: string; desc: string }> = [
    { syntax: 'book project', desc: 'all words must match (AND)' },
    { syntax: 'book OR plan', desc: 'OR (or |) between groups' },
    { syntax: '-status:done', desc: 'exclude (also NOT)' },
    { syntax: 'parent:"PKM Library"', desc: 'property; quote for spaces' },
    { syntax: 'parent:="App"', desc: 'exact whole-value match (: is substring)' },
    { syntax: 'status:active,done', desc: 'comma = OR within a property' },
    { syntax: 'due:overdue', desc: 'today · overdue · none · week · month · quarter · year' },
    { syntax: 'due:>2026-01-01', desc: 'date compare: < > <= >=' }
]

const PROPERTY_HINT =
    'Properties: title, status, parent, ancestor (any transitive parent), child, sibling, blocked, tag, due, or any frontmatter property.'

/**
 * The persistent filter input in the view toolbar. Created once and kept alive
 * across rebuilds (never re-rendered) so typing never loses focus/caret. Emits
 * raw input; the view parses, filters, and reports the match count back.
 */
export class FilterBar {
    readonly el: HTMLElement
    private readonly inputEl: HTMLInputElement
    private readonly clearEl: HTMLElement
    private readonly countEl: HTMLElement
    private readonly helpBtn: HTMLElement
    private readonly zoomEl: HTMLElement
    private readonly zoomLabelEl: HTMLElement
    private zoomLabel = ''
    private helpBox: HTMLElement | null = null
    private readonly onDocPointerDown: (event: MouseEvent) => void

    constructor(parent: HTMLElement, initial: string, callbacks: FilterBarCallbacks) {
        this.el = parent.createDiv({ cls: 'kap-filter' })

        const icon = this.el.createSpan({ cls: 'kap-filter-icon' })
        setIcon(icon, 'search')

        // Zoom chip (issue #74): derived from the query's `parent:` term, so it
        // only renders when the view reports one via setZoomChip().
        this.zoomEl = this.el.createSpan({ cls: 'kap-filter-zoom kap-hidden' })
        this.zoomLabelEl = this.zoomEl.createEl('button', {
            cls: 'kap-filter-zoom-label',
            attr: { 'type': 'button', 'aria-label': 'Open the focused parent note' }
        })
        const zoomDismiss = this.zoomEl.createEl('button', {
            cls: 'kap-filter-zoom-dismiss',
            attr: { 'type': 'button', 'aria-label': 'Stop focusing on children' }
        })
        setIcon(zoomDismiss, 'x')
        this.zoomLabelEl.addEventListener('click', () => {
            if (this.zoomLabel) callbacks.onZoomOpen(this.zoomLabel)
        })
        zoomDismiss.addEventListener('click', () => callbacks.onZoomDismiss())

        this.inputEl = this.el.createEl('input', {
            cls: 'kap-filter-input',
            attr: {
                'type': 'text',
                'placeholder': 'Filter… e.g. book parent:"PKM" status:active OR overdue',
                'spellcheck': 'false',
                'aria-label': 'Filter cards'
            }
        })
        this.inputEl.value = initial

        this.countEl = this.el.createSpan({ cls: 'kap-filter-count' })

        this.clearEl = this.el.createEl('button', {
            cls: 'kap-filter-clear',
            attr: { 'type': 'button', 'aria-label': 'Clear filter' }
        })
        setIcon(this.clearEl, 'x')

        this.helpBtn = this.el.createEl('button', {
            cls: 'kap-filter-help',
            attr: { 'type': 'button', 'aria-label': 'Filter syntax help' }
        })
        setIcon(this.helpBtn, 'help-circle')

        this.inputEl.addEventListener('input', () => {
            this.syncClear()
            callbacks.onInput(this.inputEl.value)
        })
        this.inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.inputEl.value.length > 0) {
                event.preventDefault()
                this.clear(callbacks)
            }
        })
        this.clearEl.addEventListener('click', () => this.clear(callbacks))
        this.helpBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            this.toggleHelp()
        })

        this.onDocPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null
            if (
                this.helpBox &&
                target &&
                !this.helpBox.contains(target) &&
                target !== this.helpBtn
            ) {
                this.closeHelp()
            }
        }

        this.syncClear()
    }

    /** Sync the input value from persisted state without firing callbacks. */
    setValue(value: string): void {
        if (this.inputEl.value !== value) {
            this.inputEl.value = value
            this.syncClear()
        }
    }

    /**
     * Show (or hide, when `label` is null) the zoom chip: `▼ <parent title>`.
     * Derived state — the view recomputes it from the parsed query each render.
     */
    setZoomChip(label: string | null): void {
        this.zoomLabel = label ?? ''
        this.zoomEl.toggleClass('kap-hidden', label === null)
        if (label !== null) this.zoomLabelEl.setText(`▼ ${label}`)
    }

    /** Show "N matches" when a filter is active, or clear it when inactive. */
    setCount(matches: number | null): void {
        if (matches === null) {
            this.countEl.setText('')
            this.el.removeClass('kap-filter-active')
        } else {
            this.countEl.setText(`${String(matches)} ${matches === 1 ? 'match' : 'matches'}`)
            this.el.addClass('kap-filter-active')
        }
    }

    focus(): void {
        this.inputEl.focus()
    }

    /** Remove any open popover + its listener (call on view unload). */
    destroy(): void {
        this.closeHelp()
    }

    private clear(callbacks: FilterBarCallbacks): void {
        this.inputEl.value = ''
        this.syncClear()
        callbacks.onClear()
    }

    private syncClear(): void {
        this.clearEl.toggleClass('kap-hidden', this.inputEl.value.length === 0)
    }

    private toggleHelp(): void {
        if (this.helpBox) this.closeHelp()
        else this.openHelp()
    }

    private openHelp(): void {
        const box = this.el.createDiv({ cls: 'kap-filter-helpbox' })
        for (const row of HELP_ROWS) {
            const line = box.createDiv({ cls: 'kap-filter-helprow' })
            line.createEl('code', { cls: 'kap-filter-helpsyntax', text: row.syntax })
            line.createSpan({ cls: 'kap-filter-helpdesc', text: row.desc })
        }
        box.createDiv({ cls: 'kap-filter-helpnote', text: PROPERTY_HINT })
        this.helpBox = box
        this.el.ownerDocument.addEventListener('mousedown', this.onDocPointerDown)
    }

    private closeHelp(): void {
        if (!this.helpBox) return
        this.el.ownerDocument.removeEventListener('mousedown', this.onDocPointerDown)
        this.helpBox.remove()
        this.helpBox = null
    }
}
