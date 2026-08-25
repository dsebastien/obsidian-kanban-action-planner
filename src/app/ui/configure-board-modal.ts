import { Modal, Setting, setIcon } from 'obsidian'
import type { App } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../plugin'
import type {
    ArchiveConfig,
    AutomationAction,
    AutomationRule,
    AutomationTrigger,
    ColorSpec,
    DoneConfig,
    LaneGrouping,
    NoteType,
    PropertyOperator,
    RelationshipRole,
    RelationshipRule
} from '../domain/note-type'
import { FolderSuggest } from './folder-suggest'
import { FileSuggest } from './file-suggest'
import { defaultCreationConfig, emptyInheritedDefaults } from '../domain/note-creation'
import type { CreationConfig } from '../domain/note-creation'
import { creationDefaults, getNoteTypeById } from '../services/starter-kit.service'
import { isTemplaterAvailable, templaterTemplatesFolder } from '../services/templater.service'
import { splitStatusValue } from '../domain/status'
import { resolveDoneConfig } from '../domain/done'
import { doneIsStatusBased } from '../domain/automation'
import { isValidHex, paletteTokens, resolveColor } from '../services/colors.service'
import {
    DEFAULT_NOTE_TYPE_ID,
    clearColorOverride,
    findNoteType,
    setArchiveConfig,
    setAutoAssign,
    setAutomations,
    setColorOverride,
    setCreationConfig,
    setDoneConfig,
    setEstimateConfig,
    setLaneGrouping,
    setNoteTypeName,
    setEnumProperty,
    setRecognitionMappings,
    setRelationships,
    setWipLimit
} from '../services/note-type.service'
import { listEnumProperties, resolveAllowedValues } from '../services/enum.service'

const AUTO = '__auto__'
const NONE = '__none__'

type SectionId =
    | 'recognition'
    | 'colors'
    | 'enums'
    | 'swimlanes'
    | 'relationships'
    | 'archiving'
    | 'limits'
    | 'estimate'
    | 'done'
    | 'automation'
    | 'creation'

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; icon: string }> = [
    { id: 'recognition', label: 'Note type', icon: 'scan-search' },
    { id: 'colors', label: 'Colors', icon: 'palette' },
    { id: 'enums', label: 'Enums', icon: 'list' },
    { id: 'limits', label: 'WIP limits', icon: 'gauge' },
    { id: 'swimlanes', label: 'Swimlanes', icon: 'rows-3' },
    { id: 'relationships', label: 'Relationships', icon: 'git-fork' },
    { id: 'estimate', label: 'Estimate', icon: 'ruler' },
    { id: 'done', label: 'Done state', icon: 'circle-check' },
    { id: 'automation', label: 'Automations', icon: 'zap' },
    { id: 'creation', label: 'Creating notes', icon: 'file-plus' },
    { id: 'archiving', label: 'Archiving', icon: 'archive' }
]

/**
 * "Configure board" modal. Edits the active note type's shared settings
 * (colors, WIP limits, swimlanes, relationships, archiving). Every change
 * persists to the note type immediately and re-renders the board.
 */
export class ConfigureBoardModal extends Modal {
    private readonly plugin: KanbanActionPlannerPlugin
    private readonly noteTypeId: string
    private readonly statusValues: string[]
    private readonly availableProperties: string[]
    private readonly onChange: () => void
    private activeSection: SectionId = 'colors'
    /** Enum properties being defined in the UI that have no persisted values yet. */
    private readonly draftEnums = new Set<string>()
    private body!: HTMLElement

    constructor(
        app: App,
        plugin: KanbanActionPlannerPlugin,
        noteType: NoteType,
        statusValues: string[],
        availableProperties: string[],
        onChange: () => void,
        initialSection?: SectionId
    ) {
        super(app)
        this.plugin = plugin
        this.noteTypeId = noteType.id
        this.statusValues = statusValues
        this.availableProperties = availableProperties
        this.onChange = onChange
        if (initialSection) this.activeSection = initialSection
    }

    private noteType(): NoteType | undefined {
        return findNoteType(this.plugin, this.noteTypeId)
    }

    override onOpen(): void {
        this.titleEl.setText('Configure board — shared settings')
        this.modalEl.addClass('kap-config-modal')
        this.render()
    }

    override onClose(): void {
        this.contentEl.empty()
    }

    private render(): void {
        const noteType = this.noteType()
        this.contentEl.empty()
        if (!noteType) {
            this.contentEl.createDiv({ text: 'No note type is active for this board yet.' })
            return
        }

        this.contentEl.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                noteType.source === 'starter-kit'
                    ? `Note type "${noteType.name}" (recognized via the Obsidian Starter Kit). These shared settings apply to every board of this type. Per-board options (columns, filters, calendar) live in Bases "Configure view".`
                    : `Note type "${noteType.name}". These shared settings apply to every board using it. Per-board options (columns, filters, calendar) live in Bases "Configure view".`
        })

        const layout = this.contentEl.createDiv({ cls: 'kap-settings' })
        const nav = layout.createDiv({ cls: 'kap-settings-nav', attr: { role: 'tablist' } })
        for (const section of this.visibleSections()) {
            const active = section.id === this.activeSection
            const tab = nav.createDiv({
                cls: active ? 'kap-settings-tab kap-settings-tab-active' : 'kap-settings-tab',
                attr: { 'role': 'tab', 'tabindex': '0', 'aria-selected': String(active) }
            })
            setIcon(tab.createSpan({ cls: 'kap-settings-tab-icon' }), section.icon)
            tab.createSpan({ cls: 'kap-settings-tab-label', text: section.label })
            const select = (): void => {
                this.activeSection = section.id
                this.render()
            }
            tab.addEventListener('click', select)
            tab.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    select()
                }
            })
        }

        this.body = layout.createDiv({ cls: 'kap-settings-content' })
        this.renderActiveSection(noteType)
    }

    /** Whether this is an editable local note type (vs. Starter Kit / Default). */
    private isLocalNoteType(noteType: NoteType): boolean {
        return noteType.source === 'local' && noteType.id !== DEFAULT_NOTE_TYPE_ID
    }

    /** Sections to show — the "Note type" (recognition) tab is local-types only. */
    private visibleSections(): ReadonlyArray<{ id: SectionId; label: string; icon: string }> {
        const noteType = this.noteType()
        const local = noteType ? this.isLocalNoteType(noteType) : false
        return SECTIONS.filter((s) => s.id !== 'recognition' || local)
    }

    private renderActiveSection(noteType: NoteType): void {
        switch (this.activeSection) {
            case 'recognition':
                if (this.isLocalNoteType(noteType)) this.renderRecognition(noteType)
                else this.renderColors(noteType)
                return
            case 'colors':
                this.renderColors(noteType)
                return
            case 'enums':
                this.renderEnums(noteType)
                return
            case 'swimlanes':
                this.renderSwimlanes(noteType)
                return
            case 'relationships':
                this.renderRelationships(noteType)
                return
            case 'archiving':
                this.renderArchiving(noteType)
                return
            case 'limits':
                this.renderLimits(noteType)
                return
            case 'estimate':
                this.renderEstimate(noteType)
                return
            case 'done':
                this.renderDone(noteType)
                return
            case 'automation':
                this.renderAutomation(noteType)
                return
            case 'creation':
                this.renderCreation(noteType)
                return
        }
    }

    // ── Automations (per-type status-transition rules) ────────

    private renderAutomation(noteType: NoteType): void {
        new Setting(this.body).setName('Automations').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                `Run actions when a ${noteType.name} note transitions into a status ` +
                '(from a drag, a menu, a bulk edit, or triage) — once per transition. ' +
                'Values and folders support {{year}}, {{month}}, {{day}}, {{week}}, ' +
                '{{quarter}}, {{date}}, {{datetime}} and {{uuid}}.'
        })

        const rules = noteType.automations
        if (rules.length === 0) {
            this.body.createDiv({
                cls: 'kap-modal-empty',
                text: 'No automation rules yet — add one below.'
            })
        }

        rules.forEach((rule, index) => this.renderAutomationRule(noteType, rule, index))

        new Setting(this.body).setName('Add rule').addButton((b) =>
            b
                .setButtonText('Add')
                .setCta()
                .onClick(() => void this.addAutomationRule())
        )
    }

    private renderAutomationRule(noteType: NoteType, rule: AutomationRule, index: number): void {
        const block = this.body.createDiv({ cls: 'kap-automation-rule' })

        const heading = new Setting(block)
        heading
            .setName(rule.name.trim() || `Rule ${String(index + 1)}`)
            .addText((input) =>
                input
                    .setPlaceholder('Rule name')
                    .setValue(rule.name)
                    // Persist without re-rendering so typing keeps focus; the
                    // heading updates imperatively instead.
                    .onChange((value) => {
                        heading.setName(value.trim() || `Rule ${String(index + 1)}`)
                        void this.patchRule(index, { name: value }, false)
                    })
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(rule.enabled)
                    .setTooltip(rule.enabled ? 'Enabled' : 'Disabled')
                    .onChange((enabled) => void this.patchRule(index, { enabled }, true))
            )
            .addExtraButton((b) =>
                b
                    .setIcon('trash')
                    .setTooltip('Remove rule')
                    .onClick(() => void this.removeAutomationRule(index))
            )

        new Setting(block).setName('When the note').addDropdown((dd) => {
            dd.addOption('status-entered', 'Enters a status')
            dd.addOption('status-left', 'Leaves a status')
            dd.addOption('done-entered', 'Enters a done state')
            dd.addOption('archived', 'Is archived')
            dd.addOption('property-condition', 'Property matches a condition')
            dd.setValue(rule.trigger.kind)
            dd.onChange((value) => {
                void this.patchRule(
                    index,
                    { trigger: defaultTriggerFor(value, rule.trigger) },
                    true
                )
            })
        })

        switch (rule.trigger.kind) {
            case 'status-entered':
            case 'status-left':
                this.renderTriggerStatuses(block, rule, index)
                break
            case 'done-entered': {
                // Same predicate the engine uses — a re-derived check would
                // diverge on trim/case and mislead about whether the rule fires.
                const resolved = resolveDoneConfig(noteType)
                const statusBased =
                    resolved !== null && doneIsStatusBased(resolved, noteType.statusProperty)
                block.createDiv({
                    cls: 'kap-automation-hint kap-automation-nested',
                    text: statusBased
                        ? 'Fires when the note enters any of the done statuses configured in "Done state".'
                        : 'Define a status-based done state in the "Done state" tab first — this rule never fires without one.'
                })
                break
            }
            case 'archived':
                block.createDiv({
                    cls: 'kap-automation-hint kap-automation-nested',
                    text: 'Fires just before the note moves to its archive folder (manual, bulk, or status-triggered).'
                })
                break
            case 'property-condition':
                this.renderTriggerCondition(block, rule.trigger, index)
                break
        }

        new Setting(block).setName('Do').setHeading()
        if (rule.actions.length === 0) {
            block.createDiv({
                cls: 'kap-modal-empty kap-automation-nested',
                text: 'No actions yet.'
            })
        }
        const actions = block.createDiv({ cls: 'kap-automation-nested' })
        rule.actions.forEach((action, actionIndex) =>
            this.renderAutomationAction(actions, action, index, actionIndex)
        )
        new Setting(block).addExtraButton((b) =>
            b
                .setIcon('plus')
                .setTooltip('Add action')
                .onClick(() => void this.addAutomationAction(index))
        )
    }

    /** Per-status toggles selecting the trigger statuses (archive pattern). */
    private renderTriggerStatuses(block: HTMLElement, rule: AutomationRule, index: number): void {
        const kind = rule.trigger.kind
        if (kind !== 'status-entered' && kind !== 'status-left') return
        const selected = rule.trigger.statuses
        if (this.statusValues.length === 0) {
            block.createDiv({
                cls: 'kap-modal-empty kap-automation-nested',
                text: 'Trigger statuses appear here once this note type has status values.'
            })
            return
        }
        const container = block.createDiv({ cls: 'kap-automation-nested' })
        for (const statusValue of this.statusValues) {
            new Setting(container)
                .setName(splitStatusValue(statusValue).label)
                .addToggle((toggle) =>
                    toggle.setValue(selected.includes(statusValue)).onChange((on) => {
                        const current = this.noteType()?.automations[index]
                        if (!current || current.trigger.kind !== kind) return
                        const next = new Set(current.trigger.statuses)
                        if (on) next.add(statusValue)
                        else next.delete(statusValue)
                        void this.patchRule(
                            index,
                            { trigger: { kind, statuses: [...next] } },
                            false
                        )
                    })
                )
        }
    }

    /** Property + operator + value editor for a `property-condition` trigger. */
    private renderTriggerCondition(
        block: HTMLElement,
        trigger: Extract<AutomationTrigger, { kind: 'property-condition' }>,
        index: number
    ): void {
        const container = block.createDiv({ cls: 'kap-automation-nested' })
        const needsValue = trigger.operator !== 'set' && trigger.operator !== 'unset'
        const row = new Setting(container).setDesc(
            'Fires when the condition BECOMES true (numbers compare numerically; any edit source counts while a board shows the note).'
        )
        row.addText((input) =>
            input
                .setPlaceholder('property (e.g. progress)')
                .setValue(trigger.property)
                // Persist without re-rendering so typing keeps focus; merge
                // into the freshest stored trigger to avoid stale clobbers.
                .onChange(
                    (property) =>
                        void this.patchCondition(index, { property: property.trim() }, false)
                )
        )
        row.addDropdown((dd) => {
            dd.addOption('equals', '=')
            dd.addOption('not-equals', '≠')
            dd.addOption('gt', '>')
            dd.addOption('gte', '≥')
            dd.addOption('lt', '<')
            dd.addOption('lte', '≤')
            dd.addOption('set', 'is set')
            dd.addOption('unset', 'is unset')
            dd.setValue(trigger.operator)
            dd.onChange((operator) => {
                void this.patchCondition(index, { operator: operator as PropertyOperator }, true)
            })
        })
        if (needsValue) {
            row.addText((input) =>
                input
                    .setPlaceholder('value (e.g. 100)')
                    .setValue(trigger.value)
                    .onChange((value) => void this.patchCondition(index, { value }, false))
            )
        }
    }

    /** Merge fields into the freshest stored property-condition trigger. */
    private async patchCondition(
        index: number,
        patch: Partial<Extract<AutomationTrigger, { kind: 'property-condition' }>>,
        rerender: boolean
    ): Promise<void> {
        const current = this.noteType()?.automations[index]?.trigger
        if (!current || current.kind !== 'property-condition') return
        await this.patchRule(index, { trigger: { ...current, ...patch } }, rerender)
    }

    private renderAutomationAction(
        container: HTMLElement,
        action: AutomationAction,
        ruleIndex: number,
        actionIndex: number
    ): void {
        const row = new Setting(container)
        row.addDropdown((dd) => {
            dd.addOption('set-property', 'Set property')
            dd.addOption('remove-property', 'Remove property')
            dd.addOption('add-tag', 'Add tag')
            dd.addOption('remove-tag', 'Remove tag')
            dd.addOption('move-to-folder', 'Move to folder')
            dd.setValue(action.kind)
            dd.onChange((value) => {
                // Carry compatible fields across the kind switch (tag↔tag,
                // property↔property) so a misclick never loses typed input;
                // read the freshest stored action, not the render-time copy.
                const next = defaultActionFor(value)
                const stored =
                    this.noteType()?.automations[ruleIndex]?.actions[actionIndex] ?? action
                if (
                    (next.kind === 'set-property' || next.kind === 'remove-property') &&
                    (stored.kind === 'set-property' || stored.kind === 'remove-property')
                ) {
                    next.property = stored.property
                } else if (
                    (next.kind === 'add-tag' || next.kind === 'remove-tag') &&
                    (stored.kind === 'add-tag' || stored.kind === 'remove-tag')
                ) {
                    next.tag = stored.tag
                }
                void this.patchAction(ruleIndex, actionIndex, next, true)
            })
        })
        // Field edits MERGE into the freshest stored action (patchActionField)
        // rather than spreading the render-time `action` — with two text
        // fields on one row and no re-render while typing, a stale spread
        // would clobber the other field's just-typed value.
        switch (action.kind) {
            case 'set-property':
                row.addText((input) =>
                    input
                        .setPlaceholder('property')
                        .setValue(action.property)
                        .onChange(
                            (property) =>
                                void this.patchActionField(ruleIndex, actionIndex, {
                                    property: property.trim()
                                })
                        )
                )
                row.addText((input) =>
                    input
                        .setPlaceholder('value (e.g. 100, {{date}})')
                        .setValue(action.value)
                        .onChange(
                            (value) => void this.patchActionField(ruleIndex, actionIndex, { value })
                        )
                )
                break
            case 'remove-property':
                row.addText((input) =>
                    input
                        .setPlaceholder('property')
                        .setValue(action.property)
                        .onChange(
                            (property) =>
                                void this.patchActionField(ruleIndex, actionIndex, {
                                    property: property.trim()
                                })
                        )
                )
                break
            case 'add-tag':
            case 'remove-tag':
                row.addText((input) =>
                    input
                        .setPlaceholder('tag (e.g. done)')
                        .setValue(action.tag)
                        .onChange(
                            (tag) =>
                                void this.patchActionField(ruleIndex, actionIndex, {
                                    tag: tag.trim()
                                })
                        )
                )
                break
            case 'move-to-folder':
                row.addText((input) => {
                    input
                        .setPlaceholder('Folder/{{year}}')
                        .setValue(action.folder)
                        .onChange(
                            (folder) =>
                                void this.patchActionField(ruleIndex, actionIndex, {
                                    folder: folder.trim()
                                })
                        )
                    new FolderSuggest(this.app, input.inputEl, (path) => {
                        void this.patchActionField(ruleIndex, actionIndex, {
                            folder: path.trim()
                        })
                    })
                })
                break
        }
        row.addExtraButton((b) =>
            b
                .setIcon('trash')
                .setTooltip('Remove action')
                .onClick(() => void this.removeAutomationAction(ruleIndex, actionIndex))
        )
    }

    // Rule/action CRUD: read the freshest stored list, rebuild immutably,
    // persist the whole array (the recognition-mappings discipline).

    private async patchRule(
        index: number,
        patch: Partial<AutomationRule>,
        rerender: boolean
    ): Promise<void> {
        const current = this.noteType()?.automations
        if (!current) return
        const automations = current.map((r, i) => (i === index ? { ...r, ...patch } : r))
        await setAutomations(this.plugin, this.noteTypeId, automations)
        this.onChange()
        if (rerender) this.render()
    }

    private async addAutomationRule(): Promise<void> {
        const current = this.noteType()?.automations ?? []
        await setAutomations(this.plugin, this.noteTypeId, [
            ...current,
            {
                id: `rule-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(
                    36
                )}`,
                name: '',
                enabled: true,
                trigger: { kind: 'status-entered', statuses: [] },
                actions: []
            }
        ])
        this.onChange()
        this.render()
    }

    private async removeAutomationRule(index: number): Promise<void> {
        const current = this.noteType()?.automations
        if (!current) return
        await setAutomations(
            this.plugin,
            this.noteTypeId,
            current.filter((_, i) => i !== index)
        )
        this.onChange()
        this.render()
    }

    private async patchAction(
        ruleIndex: number,
        actionIndex: number,
        action: AutomationAction,
        rerender: boolean
    ): Promise<void> {
        const rule = this.noteType()?.automations[ruleIndex]
        if (!rule) return
        await this.patchRule(
            ruleIndex,
            { actions: rule.actions.map((a, i) => (i === actionIndex ? action : a)) },
            rerender
        )
    }

    /**
     * Merge fields into the FRESHEST stored action (not the render-time
     * copy) — two text fields on one row persist without re-rendering, so a
     * stale spread would clobber the other field's just-typed value.
     */
    private async patchActionField(
        ruleIndex: number,
        actionIndex: number,
        patch: Partial<AutomationAction>
    ): Promise<void> {
        const current = this.noteType()?.automations[ruleIndex]?.actions[actionIndex]
        if (!current) return
        await this.patchAction(
            ruleIndex,
            actionIndex,
            { ...current, ...patch } as AutomationAction,
            false
        )
    }

    private async addAutomationAction(ruleIndex: number): Promise<void> {
        const rule = this.noteType()?.automations[ruleIndex]
        if (!rule) return
        await this.patchRule(
            ruleIndex,
            { actions: [...rule.actions, defaultActionFor('set-property')] },
            true
        )
    }

    private async removeAutomationAction(ruleIndex: number, actionIndex: number): Promise<void> {
        const rule = this.noteType()?.automations[ruleIndex]
        if (!rule) return
        await this.patchRule(
            ruleIndex,
            { actions: rule.actions.filter((_, i) => i !== actionIndex) },
            true
        )
    }

    // ── Done state (issue #56; per-type done definition) ──────

    private renderDone(noteType: NoteType): void {
        new Setting(this.body).setName('Done state').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                `What marks a ${noteType.name} note as done. A done note counts as ` +
                '100% complete in WBS progress rollups, so a parent’s progress can ' +
                'derive from done children even when they carry no progress number.'
        })

        const done = noteType.done
        new Setting(this.body)
            .setName('Has a done state')
            .setDesc('Enable to define the property and value(s) that mean done.')
            .addToggle((toggle) =>
                toggle.setValue(done?.enabled ?? false).onChange((on) => {
                    const current = this.noteType()?.done
                    void this.mutate(() =>
                        setDoneConfig(this.plugin, this.noteTypeId, {
                            enabled: on,
                            property: current?.property ?? '',
                            values: current?.values ?? []
                        })
                    )
                })
            )

        if (!done?.enabled) return

        const statusProperty = noteType.statusProperty
        new Setting(this.body)
            .setName('Done property')
            .setDesc(
                `Frontmatter property holding the done signal. Empty = the status property ("${statusProperty}").`
            )
            .addText((input) => {
                input
                    .setPlaceholder(statusProperty)
                    .setValue(done.property)
                    // Persist without re-rendering so typing keeps focus; the
                    // value editor below depends on the property, so refresh
                    // it once the field loses focus.
                    .onChange((value) => void this.patchDone({ property: value.trim() }, false))
                input.inputEl.addEventListener('blur', () => this.render())
            })

        const usesStatusProperty = (done.property.trim() || statusProperty) === statusProperty
        if (usesStatusProperty && this.statusValues.length > 0) {
            new Setting(this.body)
                .setName('Done statuses')
                .setDesc('A note in any toggled status is done.')
                .setHeading()
            for (const statusValue of this.statusValues) {
                new Setting(this.body)
                    .setName(splitStatusValue(statusValue).label)
                    .addToggle((toggle) =>
                        toggle.setValue(done.values.includes(statusValue)).onChange((on) => {
                            const values = new Set(this.noteType()?.done?.values ?? [])
                            if (on) values.add(statusValue)
                            else values.delete(statusValue)
                            void this.patchDone({ values: [...values] }, false)
                        })
                    )
            }
            return
        }

        new Setting(this.body)
            .setName('Done values')
            .setClass('kap-enum-row')
            .setDesc(
                'One value per line, case-insensitive. Leave empty to treat a checkbox "true" as done.'
            )
            .addTextArea((area) => {
                area.inputEl.rows = Math.max(3, done.values.length)
                area.inputEl.addClass('kap-enum-values')
                area.setPlaceholder('80 - Done\n60 - Completed')
                    .setValue(done.values.join('\n'))
                    // Persist without re-rendering so the textarea keeps focus.
                    .onChange((text) => void this.patchDone({ values: splitLines(text) }, false))
            })
    }

    /**
     * Apply a partial change to the done config, reading the freshest stored
     * copy so property + value edits don't clobber each other. `rerender`
     * re-renders (skip it for text fields to keep focus).
     */
    private async patchDone(patch: Partial<DoneConfig>, rerender: boolean): Promise<void> {
        const current = this.noteType()?.done
        if (!current) return
        await setDoneConfig(this.plugin, this.noteTypeId, { ...current, ...patch })
        this.onChange()
        if (rerender) this.render()
    }

    // ── Estimate property + unit (per-type override; plugin-owned) ────

    private renderEstimate(noteType: NoteType): void {
        new Setting(this.body).setName('Estimate').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                `Which frontmatter property holds the time estimate for ${noteType.name} ` +
                'notes, and its unit. Leave the property empty to use the global default ' +
                `("${this.plugin.settings.defaultEstimateProperty}"). Minute-based estimates ` +
                'convert to days for rollups and timeline spans via the global ' +
                '"Minutes per day" setting.'
        })
        const current = noteType.estimate
        const persist = (property: string, unit: 'days' | 'minutes'): void => {
            const trimmed = property.trim()
            // Empty property + days = pure global default → store nothing.
            const next = trimmed === '' && unit === 'days' ? undefined : { property: trimmed, unit }
            void setEstimateConfig(this.plugin, this.noteTypeId, next).then(() => this.onChange())
        }
        new Setting(this.body)
            .setName('Estimate property')
            .setDesc('Empty = the global default property.')
            .addText((text) => {
                text.setPlaceholder(this.plugin.settings.defaultEstimateProperty)
                    .setValue(current?.property ?? '')
                    .onChange((value) => persist(value, this.noteType()?.estimate?.unit ?? 'days'))
            })
        new Setting(this.body)
            .setName('Unit')
            .setDesc('How the stored number is interpreted (and written).')
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('days', 'Days')
                    .addOption('minutes', 'Minutes')
                    .setValue(current?.unit ?? 'days')
                    .onChange((value) => {
                        persist(
                            this.noteType()?.estimate?.property ?? '',
                            value === 'minutes' ? 'minutes' : 'days'
                        )
                    })
            })
    }

    // ── Note type recognition (issue #31; local types only) ───

    private renderRecognition(noteType: NoteType): void {
        new Setting(this.body).setName('Note type').setHeading()
        new Setting(this.body)
            .setName('Name')
            .setDesc('Display name for this note type.')
            .addText((input) =>
                // Persist without re-rendering so the text input keeps focus.
                input.setValue(noteType.name).onChange((value) => void this.patchName(value))
            )

        new Setting(this.body).setName('Recognition rules').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text: 'A note is this type when ANY rule matches — by tag (incl. nested), folder (and subfolders), or a regular expression on the note path.'
        })

        const mappings = noteType.typeRecognition.mappings
        if (mappings.length === 0) {
            this.body.createDiv({
                cls: 'kap-modal-empty',
                text: 'No rules yet — add one below so this type is recognized.'
            })
        }

        mappings.forEach((mapping, index) => {
            new Setting(this.body)
                .addDropdown((dd) => {
                    dd.addOption('tag', 'Tag')
                    dd.addOption('folder', 'Folder')
                    dd.addOption('regex', 'Regex')
                    dd.setValue(mapping.type)
                    dd.onChange((value) => {
                        const type = value === 'folder' || value === 'regex' ? value : 'tag'
                        void this.updateMapping(index, { type }, true)
                    })
                })
                .addText((input) =>
                    input
                        .setPlaceholder(recognitionPlaceholder(mapping.type))
                        .setValue(mapping.value)
                        .onChange((value) => void this.updateMapping(index, { value }, false))
                )
                .addExtraButton((b) =>
                    b
                        .setIcon('trash')
                        .setTooltip('Remove rule')
                        .onClick(() => void this.removeMapping(index))
                )
        })

        new Setting(this.body)
            .setName('Add rule')
            .addButton((b) => b.setButtonText('Add').onClick(() => void this.addMapping()))
    }

    private async patchName(name: string): Promise<void> {
        await setNoteTypeName(this.plugin, this.noteTypeId, name)
        this.onChange()
    }

    /** Apply a partial change to one recognition mapping, reading the freshest copy. */
    private async updateMapping(
        index: number,
        patch: Partial<NoteType['typeRecognition']['mappings'][number]>,
        rerender: boolean
    ): Promise<void> {
        const current = this.noteType()?.typeRecognition.mappings
        if (!current) return
        const mappings = current.map((m, i) => (i === index ? { ...m, ...patch } : m))
        await setRecognitionMappings(this.plugin, this.noteTypeId, mappings)
        this.onChange()
        if (rerender) this.render()
    }

    private async removeMapping(index: number): Promise<void> {
        const current = this.noteType()?.typeRecognition.mappings
        if (!current) return
        await setRecognitionMappings(
            this.plugin,
            this.noteTypeId,
            current.filter((_, i) => i !== index)
        )
        this.onChange()
        this.render()
    }

    private async addMapping(): Promise<void> {
        const current = this.noteType()?.typeRecognition.mappings ?? []
        await setRecognitionMappings(this.plugin, this.noteTypeId, [
            ...current,
            { type: 'tag', value: '', enabled: true }
        ])
        this.onChange()
        this.render()
    }

    // ── WIP limits ────────────────────────────────────────────

    private renderLimits(noteType: NoteType): void {
        new Setting(this.body).setName('WIP limits').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text: 'Soft per-column limits. A column over its limit turns its count red; drops are never blocked. Leave blank for no limit.'
        })

        if (this.statusValues.length === 0) {
            this.body.createDiv({
                cls: 'kap-modal-empty',
                text: 'WIP limits appear here once this board has status values.'
            })
            return
        }

        for (const statusValue of this.statusValues) {
            const current = noteType.wipLimits[statusValue]
            new Setting(this.body).setName(splitStatusValue(statusValue).label).addText((input) => {
                input.inputEl.type = 'number'
                input.inputEl.min = '1'
                input.inputEl.addClass('kap-wip-input')
                input
                    .setPlaceholder('No limit')
                    .setValue(current ? String(current) : '')
                    .onChange((value) => {
                        const n = Number.parseInt(value, 10)
                        // Persist without re-rendering so the number input keeps focus.
                        void this.patchWipLimit(statusValue, Number.isFinite(n) && n > 0 ? n : null)
                    })
            })
        }
    }

    private async patchWipLimit(statusValue: string, limit: number | null): Promise<void> {
        await setWipLimit(this.plugin, this.noteTypeId, statusValue, limit)
        this.onChange()
    }

    // ── Enum allowed-values (issue #52) ───────────────────────

    private renderEnums(noteType: NoteType): void {
        new Setting(this.body).setName('Enums').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text: 'Allowed values for a property let you set it from a card (right-click → "Set <property>") and drive triage. Values are auto-detected from the Obsidian Starter Kit when present; define them here for local types or to override. One value per line, in order.'
        })

        // Property names with a manual list, plus any in-progress (empty) drafts.
        const names = [...new Set([...Object.keys(noteType.enumProperties), ...this.draftEnums])]
        if (names.length === 0) {
            this.body.createDiv({
                cls: 'kap-modal-empty',
                text: 'No manual enum properties yet. Add one below; Starter Kit enums work without any entry here.'
            })
        }

        for (const name of names) {
            const values = noteType.enumProperties[name] ?? []
            new Setting(this.body)
                .setName(name)
                .setClass('kap-enum-row')
                .addTextArea((area) => {
                    area.inputEl.rows = Math.max(3, values.length)
                    area.inputEl.addClass('kap-enum-values')
                    area.setPlaceholder('10 - Top\n20 - High\n…')
                        .setValue(values.join('\n'))
                        // Persist without re-rendering so the textarea keeps focus.
                        .onChange((text) => void this.patchEnumProperty(name, splitLines(text)))
                })
                .addExtraButton((b) =>
                    b
                        .setIcon('trash')
                        .setTooltip('Remove')
                        .onClick(() => {
                            this.draftEnums.delete(name)
                            void this.mutate(() =>
                                setEnumProperty(this.plugin, this.noteTypeId, name, [])
                            )
                        })
                )
        }

        let draft = ''
        new Setting(this.body)
            .setName('Add enum property')
            .setDesc('Frontmatter property name (e.g. priority, urgency, effort).')
            .addText((input) => {
                input.setPlaceholder('property name').onChange((v) => {
                    draft = v
                })
            })
            .addButton((btn) =>
                btn
                    .setButtonText('Add')
                    .setCta()
                    .onClick(() => {
                        const property = draft.trim()
                        if (!property) return
                        this.draftEnums.add(property)
                        // Seed from the Starter Kit's values when it knows this
                        // property, so the manual list starts as an editable override.
                        const seed = resolveAllowedValues(
                            this.app,
                            this.plugin,
                            this.noteTypeId,
                            property
                        )
                        void this.mutate(() =>
                            setEnumProperty(this.plugin, this.noteTypeId, property, seed)
                        )
                    })
            )

        const detected = listEnumProperties(this.app, this.plugin, this.noteTypeId)
            .map((d) => d.name)
            .filter((n) => !names.includes(n))
        if (detected.length > 0) {
            this.body.createEl('p', {
                cls: 'kap-modal-subtitle',
                text: `Detected enum properties (no manual entry needed): ${detected.join(', ')}.`
            })
        }
    }

    private async patchEnumProperty(name: string, values: string[]): Promise<void> {
        await setEnumProperty(this.plugin, this.noteTypeId, name, values)
        this.onChange()
    }

    // ── Archiving ─────────────────────────────────────────────

    private renderArchiving(noteType: NoteType): void {
        new Setting(this.body).setName('Archiving').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text: 'Archived notes of this type move into this folder and leave the board. Placeholders: {{year}}, {{month}}, {{week}}, {{quarter}}, {{day}}, {{date}}, {{datetime}}, {{uuid}}.'
        })

        this.renderArchiveControls(noteType.archive, this.statusValues, (patch, rerender) => {
            void this.patchArchive(patch, rerender)
        })
    }

    /** The folder + auto-archive-status controls, parameterized over a patch fn. */
    private renderArchiveControls(
        archive: ArchiveConfig,
        statusValues: string[],
        patch: (patch: Partial<ArchiveConfig>, rerender: boolean) => void
    ): void {
        new Setting(this.body)
            .setName('Archive folder')
            .setDesc('Destination folder for archived notes. Leave blank to disable archiving.')
            .addText((input) => {
                input
                    .setPlaceholder('Archive/{{year}}')
                    .setValue(archive.archiveFolder)
                    // Persist without re-rendering so typing keeps focus.
                    .onChange((value) => patch({ archiveFolder: value.trim() }, false))
                new FolderSuggest(this.app, input.inputEl, (path) =>
                    patch({ archiveFolder: path.trim() }, false)
                )
            })

        new Setting(this.body)
            .setName('Auto-archive on status')
            .setDesc(
                'Automatically archive a card when it enters any of the selected statuses. Opt-in.'
            )
            .setHeading()

        if (statusValues.length === 0) {
            this.body.createDiv({
                cls: 'kap-modal-empty',
                text: 'Auto-archive statuses appear here once this board has status values.'
            })
            return
        }

        for (const statusValue of statusValues) {
            new Setting(this.body)
                .setName(splitStatusValue(statusValue).label)
                .addToggle((toggle) =>
                    toggle
                        .setValue(archive.triggerStatuses.includes(statusValue))
                        .onChange((on) => {
                            const next = new Set(archive.triggerStatuses)
                            if (on) next.add(statusValue)
                            else next.delete(statusValue)
                            patch({ triggerStatuses: [...next] }, true)
                        })
                )
        }
    }

    /**
     * Apply a partial change to the active/default note type's archive config,
     * reading the freshest stored config so folder + trigger edits don't clobber
     * each other. `rerender` re-renders (skip it for the text field to keep focus).
     */
    private async patchArchive(patch: Partial<ArchiveConfig>, rerender: boolean): Promise<void> {
        const current = this.noteType()?.archive
        if (!current) return
        await setArchiveConfig(this.plugin, this.noteTypeId, { ...current, ...patch })
        this.onChange()
        if (rerender) this.render()
    }

    // ── Creating notes (quick capture, issue #46) ─────────────

    /**
     * Where a note created from the board's "Add card" affordance goes, which
     * template it gets, and how its name is decorated.
     *
     * Every field is "empty = inherit": blank falls back to the Starter Kit's
     * own settings for this type (folder, template, name prefix/suffix), then to
     * the Base's filters, then to Obsidian's default new-note folder. The
     * placeholders below therefore SHOW the inherited value, so it is obvious
     * what will happen without typing anything.
     */
    private renderCreation(noteType: NoteType): void {
        const creation = noteType.creation ?? defaultCreationConfig()
        const skType = getNoteTypeById(this.app, noteType.id)
        const inherited = skType ? creationDefaults(skType) : emptyInheritedDefaults()

        new Setting(this.body).setName('Creating notes').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                'Used by the "Add card" button in each column. Leave a field empty to inherit it' +
                (skType
                    ? ' from the Obsidian Starter Kit.'
                    : " from the Base's filters and Obsidian's defaults.") +
                ' Folder and name placeholders: {{year}}, {{month}}, {{week}}, {{quarter}},' +
                ' {{day}}, {{date}}, {{datetime}}, {{uuid}}.'
        })

        new Setting(this.body)
            .setName('Target folder')
            .setDesc('Folder new notes of this type are created in.')
            .addText((input) => {
                input
                    .setPlaceholder(inherited.folder || "The Base's folder filter")
                    .setValue(creation.folder)
                    .onChange((value) => void this.patchCreation({ folder: value.trim() }, false))
                new FolderSuggest(
                    this.app,
                    input.inputEl,
                    (path) => void this.patchCreation({ folder: path.trim() }, false)
                )
            })

        new Setting(this.body)
            .setName('Template')
            .setDesc(
                isTemplaterAvailable(this.app)
                    ? 'Applied with Templater before the card properties are written, so a template prompt can never override the column you clicked.'
                    : 'Templater is not enabled — the template is copied and the core Templates placeholders are substituted.'
            )
            .addText((input) => {
                input
                    .setPlaceholder(inherited.templatePath || 'No template')
                    .setValue(creation.templatePath)
                    .onChange(
                        (value) => void this.patchCreation({ templatePath: value.trim() }, false)
                    )
                new FileSuggest(
                    this.app,
                    input.inputEl,
                    (path) => void this.patchCreation({ templatePath: path.trim() }, false),
                    templaterTemplatesFolder(this.app)
                )
            })

        new Setting(this.body)
            .setName('Name prefix')
            .setDesc('Prepended to the typed name (skipped when the name already starts with it).')
            .addText((input) =>
                input
                    .setPlaceholder(inherited.namePrefix || 'None')
                    .setValue(creation.namePrefix)
                    // NOT trimmed: a prefix's trailing space is part of it.
                    .onChange((value) => void this.patchCreation({ namePrefix: value }, false))
            )

        new Setting(this.body)
            .setName('Name suffix')
            .setDesc(
                'Appended to the typed name (skipped when already present). Starter Kit types often recognize notes by this suffix.'
            )
            .addText((input) =>
                input
                    .setPlaceholder(inherited.nameSuffix || 'None')
                    .setValue(creation.nameSuffix)
                    // NOT trimmed: a suffix's leading space is part of it, and the
                    // Starter Kit's regex recognition expects exactly that spacing.
                    .onChange((value) => void this.patchCreation({ nameSuffix: value }, false))
            )

        new Setting(this.body)
            .setName('Open the note after creating it')
            .addToggle((toggle) =>
                toggle
                    .setValue(creation.openAfterCreate)
                    .onChange((on) => void this.patchCreation({ openAfterCreate: on }, false))
            )
    }

    /** Apply a partial change to the note type's creation config. */
    private async patchCreation(patch: Partial<CreationConfig>, rerender: boolean): Promise<void> {
        const current = this.noteType()?.creation ?? defaultCreationConfig()
        await setCreationConfig(this.plugin, this.noteTypeId, { ...current, ...patch })
        this.onChange()
        if (rerender) this.render()
    }

    // ── Relationships ─────────────────────────────────────────

    private renderRelationships(noteType: NoteType): void {
        new Setting(this.body).setName('Relationships').setHeading()
        this.body.createEl('p', {
            cls: 'kap-modal-subtitle',
            text: 'Link-properties whose wikilinks define each relationship. Inverse relations are detected automatically.'
        })

        for (const { role, label } of RELATIONSHIP_ROLES_UI) {
            const current = noteType.relationships.find((r) => r.role === role)
            new Setting(this.body).setName(label).addDropdown((dd) => {
                dd.addOption(NONE, 'None')
                for (const prop of this.availableProperties) dd.addOption(prop, prop)
                dd.setValue(
                    current && current.linkProperty.length > 0 ? current.linkProperty : NONE
                )
                dd.onChange((value) => {
                    void this.mutate(() =>
                        setRelationships(
                            this.plugin,
                            this.noteTypeId,
                            upsertRule(noteType.relationships, role, (rule) => ({
                                ...rule,
                                linkProperty: value === NONE ? '' : value
                            }))
                        )
                    )
                })
            })
        }

        const childRule = noteType.relationships.find((r) => r.role === 'child')
        new Setting(this.body)
            .setName('Detect children by tag')
            .setDesc(
                'Comma-separated tags; a tagged note that links to this one counts as a child.'
            )
            .addText((input) => {
                input
                    .setPlaceholder('#task, #action')
                    .setValue((childRule?.heuristic?.allowedTypeTags ?? []).join(', '))
                    .onChange((value) => {
                        const tags = value
                            .split(',')
                            .map((t) => t.trim())
                            .filter((t) => t.length > 0)
                        void this.mutate(() =>
                            setRelationships(
                                this.plugin,
                                this.noteTypeId,
                                upsertRule(noteType.relationships, 'child', (rule) => ({
                                    ...rule,
                                    heuristic:
                                        tags.length > 0
                                            ? { allowedTypeTags: tags, requiresLinkToSource: true }
                                            : undefined
                                }))
                            )
                        )
                    })
            })
    }

    // ── Swimlanes ─────────────────────────────────────────────

    private renderSwimlanes(noteType: NoteType): void {
        const grouping = noteType.laneGrouping
        new Setting(this.body).setName('Swimlanes').setHeading()

        new Setting(this.body)
            .setName('Group cards into lanes')
            .setDesc(
                'Default grouping for boards of this type (note type or a property value). A single board can override this in Configure view → Swimlanes.'
            )
            .addDropdown((dd) => {
                dd.addOption('none', 'None')
                dd.addOption('note-type', 'By note type')
                dd.addOption('property', 'By property')
                dd.setValue(grouping.kind)
                dd.onChange((value) => {
                    const next: LaneGrouping =
                        value === 'note-type'
                            ? { kind: 'note-type' }
                            : value === 'property'
                            ? {
                                  kind: 'property',
                                  property:
                                      grouping.kind === 'property'
                                          ? grouping.property
                                          : this.availableProperties[0] ?? ''
                              }
                            : { kind: 'none' }
                    void this.mutate(() => setLaneGrouping(this.plugin, this.noteTypeId, next))
                })
            })

        if (grouping.kind !== 'property') return

        new Setting(this.body)
            .setName('Group by property')
            .setDesc('Each distinct value of this property becomes a lane.')
            .addDropdown((dd) => {
                dd.addOption(NONE, 'Choose a property…')
                for (const prop of this.availableProperties) dd.addOption(prop, prop)
                dd.setValue(grouping.property || NONE)
                dd.onChange((value) => {
                    void this.mutate(() =>
                        setLaneGrouping(this.plugin, this.noteTypeId, {
                            kind: 'property',
                            property: value === NONE ? '' : value
                        })
                    )
                })
            })
    }

    // ── Colors ────────────────────────────────────────────────

    private renderColors(noteType: NoteType): void {
        new Setting(this.body).setName('Colors').setHeading()

        new Setting(this.body)
            .setName('Auto-assign colors')
            .setDesc('Give each status a palette color automatically when not set explicitly.')
            .addToggle((toggle) =>
                toggle.setValue(noteType.colors.autoAssign).onChange((value) => {
                    void this.mutate(() => setAutoAssign(this.plugin, this.noteTypeId, value))
                })
            )

        if (this.statusValues.length === 0) {
            this.body.createDiv({
                cls: 'kap-modal-empty',
                text: 'Status colors appear here once notes in this board have status values.'
            })
            return
        }

        for (const statusValue of this.statusValues) {
            this.renderStatusRow(noteType, statusValue)
        }
    }

    private renderStatusRow(noteType: NoteType, statusValue: string): void {
        const override = noteType.colors.overrides[statusValue]
        new Setting(this.body)
            .setName(splitStatusValue(statusValue).label)
            .addDropdown((dd) => {
                dd.addOption(AUTO, 'Auto')
                for (const token of paletteTokens()) dd.addOption(token, capitalize(token))
                dd.addOption('custom', 'Custom…')
                dd.setValue(dropdownValueFor(override))
                dd.onChange((value) => {
                    if (value === AUTO) {
                        void this.mutate(() =>
                            clearColorOverride(this.plugin, this.noteTypeId, statusValue)
                        )
                    } else if (value === 'custom') {
                        void this.mutate(() =>
                            setColorOverride(this.plugin, this.noteTypeId, statusValue, {
                                kind: 'hex',
                                value: currentHex(override)
                            })
                        )
                    } else {
                        void this.mutate(() =>
                            setColorOverride(this.plugin, this.noteTypeId, statusValue, {
                                kind: 'palette',
                                token: value
                            })
                        )
                    }
                })
            })
            .addColorPicker((picker) => {
                picker.setValue(currentHex(override))
                picker.onChange((hex) => {
                    if (!isValidHex(hex)) return
                    void this.mutate(() =>
                        setColorOverride(this.plugin, this.noteTypeId, statusValue, {
                            kind: 'hex',
                            value: hex
                        })
                    )
                })
            })
    }

    // ── Persistence ───────────────────────────────────────────

    private async mutate(action: () => Promise<void>): Promise<void> {
        await action()
        this.onChange()
        this.render()
    }
}

/** Relationship roles shown in the modal, in order. */
const RELATIONSHIP_ROLES_UI: Array<{ role: RelationshipRole; label: string }> = [
    { role: 'parent', label: 'Parents property' },
    { role: 'sibling', label: 'Siblings property' },
    { role: 'child', label: 'Children property' },
    { role: 'blocked_by', label: 'Blocked-by property' }
]

/** Replace (or insert) a role's rule via a mutator, returning the new rule list. */
function upsertRule(
    rules: ReadonlyArray<RelationshipRule>,
    role: RelationshipRole,
    mutator: (rule: RelationshipRule) => RelationshipRule
): RelationshipRule[] {
    const existing = rules.find((r) => r.role === role) ?? { role, linkProperty: '' }
    const next = mutator(existing)
    const others = rules.filter((r) => r.role !== role)
    return [...others, next]
}

/** Example value text for a recognition rule, by kind. */
function recognitionPlaceholder(type: 'tag' | 'folder' | 'regex'): string {
    if (type === 'folder') return 'Areas/Work'
    if (type === 'regex') return '^Projects/'
    return 'type/task'
}

function dropdownValueFor(spec: ColorSpec | undefined): string {
    if (!spec) return AUTO
    return spec.kind === 'hex' ? 'custom' : spec.token
}

function currentHex(spec: ColorSpec | undefined): string {
    if (spec?.kind === 'hex') return spec.value
    const resolved = spec ? resolveColor(spec) : '#4c78dd'
    return resolved.startsWith('#') ? resolved : '#4c78dd'
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/** A fresh trigger of the given kind, carrying statuses across status kinds. */
function defaultTriggerFor(kind: string, previous: AutomationTrigger): AutomationTrigger {
    const statuses =
        previous.kind === 'status-entered' || previous.kind === 'status-left'
            ? previous.statuses
            : []
    switch (kind) {
        case 'status-left':
            return { kind: 'status-left', statuses }
        case 'done-entered':
            return { kind: 'done-entered' }
        case 'archived':
            return { kind: 'archived' }
        case 'property-condition':
            return { kind: 'property-condition', property: '', operator: 'equals', value: '' }
        default:
            return { kind: 'status-entered', statuses }
    }
}

/** A fresh action of the given kind, with empty fields. */
function defaultActionFor(kind: string): AutomationAction {
    switch (kind) {
        case 'remove-property':
            return { kind: 'remove-property', property: '' }
        case 'add-tag':
            return { kind: 'add-tag', tag: '' }
        case 'remove-tag':
            return { kind: 'remove-tag', tag: '' }
        case 'move-to-folder':
            return { kind: 'move-to-folder', folder: '' }
        default:
            return { kind: 'set-property', property: '', value: '' }
    }
}

/** Split a textarea value into trimmed, non-empty lines (enum value entry). */
function splitLines(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}
