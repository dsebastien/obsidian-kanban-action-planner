import { Modal, Setting } from 'obsidian'
import type { App } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../plugin'
import type { ColorSpec, Profile } from '../domain/profile'
import { splitStatusValue } from '../domain/status'
import { isValidHex, paletteTokens, resolveColor } from '../services/colors.service'
import {
    clearColorOverride,
    findProfile,
    setAutoAssign,
    setColorOverride
} from '../services/profile-service'

const AUTO = '__auto__'

/**
 * "Configure board" modal. Edits the active profile's colors: an auto-assign
 * toggle and, per status, a palette/auto dropdown plus a custom-color picker.
 * Changes persist to the profile immediately and re-render the board.
 */
export class ConfigureBoardModal extends Modal {
    private readonly plugin: KanbanActionPlannerPlugin
    private profileId: string
    private readonly statusValues: string[]
    private readonly onChange: () => void

    constructor(
        app: App,
        plugin: KanbanActionPlannerPlugin,
        profile: Profile,
        statusValues: string[],
        onChange: () => void
    ) {
        super(app)
        this.plugin = plugin
        this.profileId = profile.id
        this.statusValues = statusValues
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
                    ? `Note type "${profile.name}" (from the Obsidian Starter Kit). Colors are saved locally.`
                    : `Profile "${profile.name}". Colors are saved locally.`
        })

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
                text: 'Statuses appear here once notes in this board have status values.'
            })
            return
        }

        new Setting(this.contentEl).setName('Status colors').setHeading()

        for (const statusValue of this.statusValues) {
            this.renderStatusRow(profile, statusValue)
        }
    }

    private renderStatusRow(profile: Profile, statusValue: string): void {
        const override = profile.colors.overrides[statusValue]
        const label = splitStatusValue(statusValue).label

        new Setting(this.contentEl)
            .setName(label)
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
                        const spec: ColorSpec = { kind: 'hex', value: currentHex(override) }
                        void this.mutate(() =>
                            setColorOverride(this.plugin, this.profileId, statusValue, spec)
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

    private async mutate(action: () => Promise<void>): Promise<void> {
        await action()
        this.onChange()
        this.render()
    }
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
