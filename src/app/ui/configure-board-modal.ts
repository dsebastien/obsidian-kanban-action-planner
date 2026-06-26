import { Modal, Setting } from 'obsidian'
import type { App } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../plugin'
import type {
    CardPresentation,
    ColorSpec,
    LaneGrouping,
    Profile,
    RelationshipRole,
    RelationshipRule
} from '../domain/profile'
import { splitStatusValue } from '../domain/status'
import { isValidHex, paletteTokens, resolveColor } from '../services/colors.service'
import {
    clearColorOverride,
    findProfile,
    setAutoAssign,
    setCardPresentation,
    setColorOverride,
    setLaneGrouping,
    setRelationships
} from '../services/profile-service'

const AUTO = '__auto__'
const NONE = '__none__'
const NOTE_NAME = '__note_name__'

/**
 * "Configure board" modal. Edits the active profile's colors and card
 * presentation (title source, body fields, cover image, wrapping). Every change
 * persists to the profile immediately and re-renders the board.
 */
export class ConfigureBoardModal extends Modal {
    private readonly plugin: KanbanActionPlannerPlugin
    private readonly profileId: string
    private readonly statusValues: string[]
    private readonly availableProperties: string[]
    private readonly onChange: () => void

    constructor(
        app: App,
        plugin: KanbanActionPlannerPlugin,
        profile: Profile,
        statusValues: string[],
        availableProperties: string[],
        onChange: () => void
    ) {
        super(app)
        this.plugin = plugin
        this.profileId = profile.id
        this.statusValues = statusValues
        this.availableProperties = availableProperties
        this.onChange = onChange
    }

    private profile(): Profile | undefined {
        return findProfile(this.plugin, this.profileId)
    }

    override onOpen(): void {
        this.titleEl.setText('Configure board')
        this.render()
    }

    override onClose(): void {
        this.contentEl.empty()
    }

    private render(): void {
        const profile = this.profile()
        this.contentEl.empty()
        if (!profile) {
            this.contentEl.createDiv({ text: 'No profile is active for this board yet.' })
            return
        }

        this.contentEl.createEl('p', {
            cls: 'kap-modal-subtitle',
            text:
                profile.source === 'starter-kit'
                    ? `Note type "${profile.name}" (from the Obsidian Starter Kit). Board settings are saved locally.`
                    : `Profile "${profile.name}". Board settings are saved locally.`
        })

        this.renderColors(profile)
        this.renderSwimlanes(profile)
        this.renderRelationships(profile)
        this.renderCard(profile)
    }

    // ── Relationships ─────────────────────────────────────────

    private renderRelationships(profile: Profile): void {
        new Setting(this.contentEl).setName('Relationships').setHeading()
        this.contentEl.createEl('p', {
            cls: 'kap-modal-subtitle',
            text: 'Link-properties whose wikilinks define each relationship. Inverse relations are detected automatically.'
        })

        for (const { role, label } of RELATIONSHIP_ROLES_UI) {
            const current = profile.relationships.find((r) => r.role === role)
            new Setting(this.contentEl).setName(label).addDropdown((dd) => {
                dd.addOption(NONE, 'None')
                for (const prop of this.availableProperties) dd.addOption(prop, prop)
                dd.setValue(
                    current && current.linkProperty.length > 0 ? current.linkProperty : NONE
                )
                dd.onChange((value) => {
                    void this.mutate(() =>
                        setRelationships(
                            this.plugin,
                            this.profileId,
                            upsertRule(profile.relationships, role, (rule) => ({
                                ...rule,
                                linkProperty: value === NONE ? '' : value
                            }))
                        )
                    )
                })
            })
        }

        const childRule = profile.relationships.find((r) => r.role === 'child')
        new Setting(this.contentEl)
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
                                this.profileId,
                                upsertRule(profile.relationships, 'child', (rule) => ({
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

    private renderSwimlanes(profile: Profile): void {
        const grouping = profile.laneGrouping
        new Setting(this.contentEl).setName('Swimlanes').setHeading()

        new Setting(this.contentEl)
            .setName('Group cards into lanes')
            .setDesc('Split the board into horizontal lanes by note type or a property value.')
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
                                            : (this.availableProperties[0] ?? '')
                                }
                              : { kind: 'none' }
                    void this.mutate(() => setLaneGrouping(this.plugin, this.profileId, next))
                })
            })

        if (grouping.kind !== 'property') return

        new Setting(this.contentEl)
            .setName('Group by property')
            .setDesc('Each distinct value of this property becomes a lane.')
            .addDropdown((dd) => {
                dd.addOption(NONE, 'Choose a property…')
                for (const prop of this.availableProperties) dd.addOption(prop, prop)
                dd.setValue(grouping.property || NONE)
                dd.onChange((value) => {
                    void this.mutate(() =>
                        setLaneGrouping(this.plugin, this.profileId, {
                            kind: 'property',
                            property: value === NONE ? '' : value
                        })
                    )
                })
            })
    }

    // ── Colors ────────────────────────────────────────────────

    private renderColors(profile: Profile): void {
        new Setting(this.contentEl).setName('Colors').setHeading()

        new Setting(this.contentEl)
            .setName('Auto-assign colors')
            .setDesc('Give each status a palette color automatically when not set explicitly.')
            .addToggle((toggle) =>
                toggle.setValue(profile.colors.autoAssign).onChange((value) => {
                    void this.mutate(() => setAutoAssign(this.plugin, this.profileId, value))
                })
            )

        if (this.statusValues.length === 0) {
            this.contentEl.createDiv({
                cls: 'kap-modal-empty',
                text: 'Status colors appear here once notes in this board have status values.'
            })
            return
        }

        for (const statusValue of this.statusValues) {
            this.renderStatusRow(profile, statusValue)
        }
    }

    private renderStatusRow(profile: Profile, statusValue: string): void {
        const override = profile.colors.overrides[statusValue]
        new Setting(this.contentEl)
            .setName(splitStatusValue(statusValue).label)
            .addDropdown((dd) => {
                dd.addOption(AUTO, 'Auto')
                for (const token of paletteTokens()) dd.addOption(token, capitalize(token))
                dd.addOption('custom', 'Custom…')
                dd.setValue(dropdownValueFor(override))
                dd.onChange((value) => {
                    if (value === AUTO) {
                        void this.mutate(() =>
                            clearColorOverride(this.plugin, this.profileId, statusValue)
                        )
                    } else if (value === 'custom') {
                        void this.mutate(() =>
                            setColorOverride(this.plugin, this.profileId, statusValue, {
                                kind: 'hex',
                                value: currentHex(override)
                            })
                        )
                    } else {
                        void this.mutate(() =>
                            setColorOverride(this.plugin, this.profileId, statusValue, {
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
                        setColorOverride(this.plugin, this.profileId, statusValue, {
                            kind: 'hex',
                            value: hex
                        })
                    )
                })
            })
    }

    // ── Card presentation ─────────────────────────────────────

    private renderCard(profile: Profile): void {
        const card = profile.card
        new Setting(this.contentEl).setName('Cards').setHeading()

        new Setting(this.contentEl)
            .setName('Title')
            .setDesc('Use the note name or a property as the card title.')
            .addDropdown((dd) => {
                dd.addOption(NOTE_NAME, 'Note name')
                for (const prop of this.availableProperties) dd.addOption(prop, prop)
                dd.setValue(
                    card.titleSource.kind === 'property' ? card.titleSource.property : NOTE_NAME
                )
                dd.onChange((value) => {
                    const titleSource: CardPresentation['titleSource'] =
                        value === NOTE_NAME
                            ? { kind: 'note-name' }
                            : { kind: 'property', property: value }
                    void this.mutateCard({ ...card, titleSource })
                })
            })

        new Setting(this.contentEl)
            .setName('Cover image')
            .setDesc('Property holding an image link, vault path, or URL.')
            .addDropdown((dd) => {
                dd.addOption(NONE, 'None')
                for (const prop of this.availableProperties) dd.addOption(prop, prop)
                dd.setValue(card.coverImageProperty ?? NONE)
                dd.onChange((value) => {
                    void this.mutateCard({
                        ...card,
                        coverImageProperty: value === NONE ? null : value
                    })
                })
            })

        new Setting(this.contentEl)
            .setName('Wrap long values')
            .setDesc('Wrap field values onto multiple lines instead of truncating.')
            .addToggle((toggle) =>
                toggle.setValue(card.wrapPropertyValues).onChange((value) => {
                    void this.mutateCard({ ...card, wrapPropertyValues: value })
                })
            )

        this.renderFieldsEditor(card)
    }

    private renderFieldsEditor(card: CardPresentation): void {
        new Setting(this.contentEl).setName('Displayed fields').setHeading()

        card.fields.forEach((field, index) => {
            new Setting(this.contentEl)
                .setName(field.property)
                .addToggle((toggle) =>
                    toggle
                        .setTooltip('Show label')
                        .setValue(field.showLabel)
                        .onChange((value) => {
                            const fields = card.fields.slice()
                            fields[index] = { ...field, showLabel: value }
                            void this.mutateCard({ ...card, fields })
                        })
                )
                .addExtraButton((b) =>
                    b
                        .setIcon('arrow-up')
                        .setTooltip('Move up')
                        .setDisabled(index === 0)
                        .onClick(
                            () =>
                                void this.mutateCard({
                                    ...card,
                                    fields: move(card.fields, index, index - 1)
                                })
                        )
                )
                .addExtraButton((b) =>
                    b
                        .setIcon('arrow-down')
                        .setTooltip('Move down')
                        .setDisabled(index === card.fields.length - 1)
                        .onClick(
                            () =>
                                void this.mutateCard({
                                    ...card,
                                    fields: move(card.fields, index, index + 1)
                                })
                        )
                )
                .addExtraButton((b) =>
                    b
                        .setIcon('trash')
                        .setTooltip('Remove')
                        .onClick(() => {
                            const fields = card.fields.filter((_, i) => i !== index)
                            void this.mutateCard({ ...card, fields })
                        })
                )
        })

        const remaining = this.availableProperties.filter(
            (p) => !card.fields.some((f) => f.property === p)
        )
        if (remaining.length > 0) {
            new Setting(this.contentEl).setName('Add field').addDropdown((dd) => {
                dd.addOption(NONE, 'Choose a property…')
                for (const prop of remaining) dd.addOption(prop, prop)
                dd.setValue(NONE)
                dd.onChange((value) => {
                    if (value === NONE) return
                    const fields = [
                        ...card.fields,
                        { property: value, showLabel: false, emphasis: 'normal' as const }
                    ]
                    void this.mutateCard({ ...card, fields })
                })
            })
        }
    }

    // ── Persistence ───────────────────────────────────────────

    private async mutate(action: () => Promise<void>): Promise<void> {
        await action()
        this.onChange()
        this.render()
    }

    private async mutateCard(card: CardPresentation): Promise<void> {
        await this.mutate(() => setCardPresentation(this.plugin, this.profileId, card))
    }
}

/** Relationship roles shown in the modal, in order. */
const RELATIONSHIP_ROLES_UI: Array<{ role: RelationshipRole; label: string }> = [
    { role: 'parent', label: 'Parent property' },
    { role: 'sibling', label: 'Sibling property' },
    { role: 'child', label: 'Child property' },
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

function move<T>(arr: ReadonlyArray<T>, from: number, to: number): T[] {
    const next = arr.slice()
    const [item] = next.splice(from, 1)
    if (item !== undefined) next.splice(to, 0, item)
    return next
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
