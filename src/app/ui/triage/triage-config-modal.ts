import { Modal, Setting, setIcon } from 'obsidian'
import type { App } from 'obsidian'
import type { TriageScope } from '../../views/kanban/triage'
import { PropertySuggest } from './property-suggest'
import type { PropertyOption } from './property-suggest'

/** The full per-view triage config the modal edits. */
export interface TriageConfigData {
    scope: TriageScope
    editable: string[]
    gating: string[]
    context: string[]
    tokens: string[]
}

/** What the modal needs from the view (property list + read/write of config). */
export interface TriageConfigModalHost {
    /** Every base property id with a display label and its kind. */
    properties(): Array<PropertyOption & { kind: 'note' | 'computed' }>
    /** The current stored config (raw — gating/context empty means "default"). */
    current(): TriageConfigData
    /** Persist the whole config (writes to the view config + re-renders). */
    save(data: TriageConfigData): void
}

/**
 * "Configure triage" modal (issue #53): edit the per-view triage config with
 * real property pickers instead of free-text ids. Each change persists
 * immediately via {@link TriageConfigModalHost.save}.
 */
export class TriageConfigModal extends Modal {
    private readonly host: TriageConfigModalHost
    private data: TriageConfigData
    private readonly labels: Map<string, string>
    private body!: HTMLElement

    constructor(app: App, host: TriageConfigModalHost) {
        super(app)
        this.host = host
        this.data = host.current()
        this.labels = new Map(host.properties().map((p) => [p.id, p.label]))
    }

    override onOpen(): void {
        this.titleEl.setText('Configure triage')
        this.modalEl.addClass('kap-config-modal')
        this.body = this.contentEl.createDiv({ cls: 'kap-settings-content' })
        this.render()
    }

    override onClose(): void {
        this.contentEl.empty()
    }

    private noteOptions(): PropertyOption[] {
        return this.host.properties().filter((p) => p.kind === 'note')
    }

    private allOptions(): PropertyOption[] {
        return this.host.properties()
    }

    private persist(): void {
        this.host.save(this.data)
    }

    private labelFor(id: string): string {
        return this.labels.get(id) ?? id
    }

    private render(): void {
        this.body.empty()

        new Setting(this.body)
            .setName('Scope')
            .setDesc('Which cards the queue contains.')
            .addDropdown((dd) => {
                dd.addOption('clarify', 'Needs clarification')
                dd.addOption('all', 'All cards (re-prioritize)')
                dd.addOption('review', 'Due for review')
                dd.setValue(this.data.scope)
                dd.onChange((value) => {
                    this.data = { ...this.data, scope: value as TriageScope }
                    this.persist()
                })
            })

        this.renderPropertySection(
            'Editable properties',
            'Enum properties triage lets you set one-click.',
            'editable',
            this.noteOptions()
        )
        this.renderPropertySection(
            'Gating properties',
            'Which properties decide “unclarified”. Leave empty to use the editable set.',
            'gating',
            this.noteOptions()
        )
        this.renderPropertySection(
            'Context properties',
            'Read-only info shown on the card (formulas allowed). Leave empty to use the view’s displayed properties.',
            'context',
            this.allOptions()
        )

        this.renderTokensSection()
    }

    private renderPropertySection(
        name: string,
        desc: string,
        key: 'editable' | 'gating' | 'context',
        options: PropertyOption[]
    ): void {
        new Setting(this.body).setName(name).setDesc(desc).setHeading()
        const ids = this.data[key]
        this.renderChips(ids, (id) => {
            this.data = { ...this.data, [key]: ids.filter((x) => x !== id) }
            this.persist()
            this.render()
        })

        const adder = new Setting(this.body).setName('Add property')
        adder.addText((input) => {
            input.setPlaceholder('Type to search…')
            new PropertySuggest(
                this.app,
                input.inputEl,
                () => options,
                () => new Set(this.data[key]),
                (id) => {
                    if (this.data[key].includes(id)) return
                    this.data = { ...this.data, [key]: [...this.data[key], id] }
                    this.persist()
                    this.render()
                }
            )
        })
    }

    private renderTokensSection(): void {
        new Setting(this.body)
            .setName('Needs-triage values')
            .setDesc('Values that count as unset (e.g. TBD, No Target), beyond empty/invalid.')
            .setHeading()
        const tokens = this.data.tokens
        this.renderChips(
            tokens,
            (token) => {
                this.data = { ...this.data, tokens: tokens.filter((t) => t !== token) }
                this.persist()
                this.render()
            },
            (token) => token
        )

        let draft = ''
        const adder = new Setting(this.body).setName('Add value')
        adder.addText((input) => {
            input.setPlaceholder('e.g. TBD').onChange((v) => {
                draft = v
            })
            input.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault()
                    this.addToken(draft)
                    draft = ''
                    input.setValue('')
                }
            })
        })
        adder.addButton((btn) =>
            btn.setButtonText('Add').onClick(() => {
                this.addToken(draft)
                draft = ''
            })
        )
    }

    private addToken(raw: string): void {
        const token = raw.trim()
        if (!token || this.data.tokens.includes(token)) return
        this.data = { ...this.data, tokens: [...this.data.tokens, token] }
        this.persist()
        this.render()
    }

    /** Render a removable chip row; `display` defaults to the property label. */
    private renderChips(
        values: string[],
        onRemove: (value: string) => void,
        display: (value: string) => string = (id) => this.labelFor(id)
    ): void {
        const row = this.body.createDiv({ cls: 'kap-triage-chips' })
        if (values.length === 0) {
            row.createSpan({ cls: 'kap-triage-chips-empty', text: 'None' })
            return
        }
        for (const value of values) {
            const chip = row.createDiv({ cls: 'kap-triage-chip' })
            chip.createSpan({ text: display(value) })
            const remove = chip.createEl('button', {
                cls: 'kap-triage-chip-remove',
                attr: { 'aria-label': `Remove ${display(value)}` }
            })
            setIcon(remove, 'x')
            remove.addEventListener('click', () => onRemove(value))
        }
    }
}
