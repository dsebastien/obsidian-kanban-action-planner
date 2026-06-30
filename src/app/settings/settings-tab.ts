import { App, PluginSettingTab, Setting } from 'obsidian'
import { produce } from 'immer'
import type KanbanActionPlannerPlugin from '../../main'
import type { PluginSettings } from '../types/plugin-settings.intf'
import type { NoteType } from '../domain/note-type'
import { findStatusProperty, listNoteTypes } from '../services/starter-kit.service'
import {
    DEFAULT_NOTE_TYPE_ID,
    createLocalNoteType,
    deleteNoteType,
    findNoteType,
    getOrCreateNoteType
} from '../services/note-type.service'
import { ConfigureBoardModal } from '../ui/configure-board-modal'
import { ConfirmModal } from '../ui/confirm-modal'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../assets/buy-me-a-coffee'

/** A note type known to the plugin (Starter Kit or a stored local note type). */
interface NoteTypeRow {
    id: string
    name: string
    source: NoteType['source']
    statusValues: string[]
}

/** Settings keys whose value is a plain string (editable as text). */
// Keys whose value is a *plain* string (accepts any string) — excludes literal
// unions like `cardChipStyle`, which have their own dedicated updater.
type StringSettingKey = {
    [K in keyof PluginSettings]: string extends PluginSettings[K] ? K : never
}[keyof PluginSettings]

/** Full weekday names indexed by `Date.getDay()` (0 = Sunday). */
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export class KanbanActionPlannerSettingTab extends PluginSettingTab {
    plugin: KanbanActionPlannerPlugin

    constructor(app: App, plugin: KanbanActionPlannerPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    override display(): void {
        const { containerEl } = this
        containerEl.empty()

        this.renderPropertySettings(containerEl)
        this.renderNoteTypes(containerEl)
        this.renderFollowButton(containerEl)
        this.renderSupportHeader(containerEl)
    }

    /**
     * Central note-type management: every note type's shared config (statuses,
     * colors, cards, relationships, archiving) lives here, applied by any board
     * to its recognized notes — no per-board duplication. Starter Kit types sync
     * automatically; the Default applies to notes with no recognized type.
     */
    private renderNoteTypes(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Note types').setHeading()
        containerEl.createEl('p', {
            cls: 'setting-item-description',
            text:
                'Each note type carries its own statuses, colors, cards, relationships, and ' +
                'archiving. Any board applies these automatically to its recognized notes, so ' +
                'you configure a type once here instead of on every board. When the Obsidian ' +
                'Starter Kit is present, its note types are synchronized below.'
        })

        for (const type of this.knownNoteTypes()) {
            const setting = new Setting(containerEl)
                .setName(type.name)
                .setDesc(
                    type.source === 'starter-kit'
                        ? `Synced from the Obsidian Starter Kit${
                              type.statusValues.length
                                  ? ` · ${String(type.statusValues.length)} statuses`
                                  : ''
                          }.`
                        : 'Local note type — recognized by your own tag / folder / regex rules.'
                )
                .addButton((button) =>
                    button.setButtonText('Configure').onClick(() => void this.openTypeConfig(type))
                )
            if (type.source === 'local') {
                setting.addExtraButton((b) =>
                    b
                        .setIcon('trash')
                        .setTooltip('Delete note type')
                        .onClick(() => this.confirmDeleteNoteType(type))
                )
            }
        }

        new Setting(containerEl)
            .setName('Add a local note type')
            .setDesc(
                'Define a type recognized by tag, folder, or path regex — no Starter Kit needed.'
            )
            .addButton((button) =>
                button
                    .setButtonText('Add note type')
                    .setCta()
                    .onClick(() => void this.addLocalNoteType())
            )

        new Setting(containerEl)
            .setName('Default (unrecognized notes)')
            .setDesc('Applies to notes without a recognized type.')
            .addButton((button) =>
                button.setButtonText('Configure').onClick(
                    () =>
                        void this.openTypeConfig({
                            id: DEFAULT_NOTE_TYPE_ID,
                            name: 'Default',
                            source: 'local',
                            statusValues: this.plugin.settings.defaultStatuses
                        })
                )
            )
    }

    /** Merge Starter Kit note types with any stored local note types (deduped). */
    private knownNoteTypes(): NoteTypeRow[] {
        const map = new Map<string, NoteTypeRow>()
        for (const sk of listNoteTypes(this.app)) {
            const status = findStatusProperty(sk, this.plugin.settings.defaultStatusProperty)
            map.set(sk.id, {
                id: sk.id,
                name: sk.name,
                source: 'starter-kit',
                statusValues: status?.allowedValues ?? []
            })
        }
        for (const noteType of this.plugin.settings.noteTypes) {
            if (noteType.id === DEFAULT_NOTE_TYPE_ID || map.has(noteType.id)) continue
            map.set(noteType.id, {
                id: noteType.id,
                name: noteType.name,
                source: noteType.source,
                statusValues: noteType.columns.map((c) => c.statusValue)
            })
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
    }

    /** Open the shared note-type config (reuses the Configure-board editor). */
    private async openTypeConfig(type: NoteTypeRow): Promise<void> {
        const noteType = await getOrCreateNoteType(this.plugin, type.id, type.name, type.source)
        new ConfigureBoardModal(
            this.app,
            this.plugin,
            noteType,
            type.statusValues,
            this.propertiesForType(type.id),
            () => this.display()
        ).open()
    }

    /** Create a local note type and open its config (recognition first). */
    private async addLocalNoteType(): Promise<void> {
        const noteType = await createLocalNoteType(this.plugin, 'New type')
        this.display()
        new ConfigureBoardModal(
            this.app,
            this.plugin,
            noteType,
            this.plugin.settings.defaultStatuses,
            this.propertiesForType(noteType.id),
            () => this.display(),
            'recognition'
        ).open()
    }

    /** Confirm + delete a local note type (its notes are untouched). */
    private confirmDeleteNoteType(type: NoteTypeRow): void {
        new ConfirmModal(this.app, {
            title: `Delete note type "${type.name}"?`,
            message:
                'This removes the type and its configuration (colors, cards, relationships, ' +
                'archiving, recognition rules). Your notes are not changed.',
            confirmText: 'Delete',
            onConfirm: () => {
                void deleteNoteType(this.plugin, type.id).then(() => this.display())
            }
        }).open()
    }

    /** Best-available property names for a type's dropdowns (no board context). */
    private propertiesForType(id: string): string[] {
        const names = new Set<string>()
        const sk = listNoteTypes(this.app).find((t) => t.id === id)
        for (const prop of sk?.properties ?? []) names.add(prop.name)
        const noteType = findNoteType(this.plugin, id)
        if (noteType) {
            for (const rule of noteType.relationships) {
                if (rule.linkProperty) names.add(rule.linkProperty)
            }
            if (noteType.laneGrouping.kind === 'property') names.add(noteType.laneGrouping.property)
            names.add(noteType.statusProperty)
            names.add(noteType.orderProperty)
        }
        names.add(this.plugin.settings.defaultBlockedByProperty)
        return Array.from(names)
            .filter((n) => n.length > 0)
            .sort()
    }

    private renderPropertySettings(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'setting-item-description',
            text:
                'Vault-wide defaults, used when a board or note type does not specify its own. ' +
                'Per-note-type config (statuses, colors, cards, relationships, archiving) lives ' +
                'under "Note types" below; per-board options live in each board’s Bases ' +
                '"Configure view" panel.'
        })

        new Setting(containerEl).setName('Default property names').setHeading()

        const text = (
            name: string,
            desc: string,
            key: StringSettingKey,
            placeholder: string
        ): void => {
            new Setting(containerEl)
                .setName(name)
                .setDesc(desc)
                .addText((input) => {
                    input
                        .setPlaceholder(placeholder)
                        .setValue(this.plugin.settings[key])
                        .onChange((value) => {
                            const next = value.trim() || placeholder
                            void this.updateSetting(key, next)
                        })
                })
        }

        text(
            'Status property',
            'Property whose value places a note in a column. A board can override this.',
            'defaultStatusProperty',
            'status'
        )
        text(
            'Manual order property',
            'Property storing a card’s position within its column.',
            'defaultOrderProperty',
            'manual_order'
        )
        text(
            'Blocked-by property',
            'Property listing the notes a note is blocked by.',
            'defaultBlockedByProperty',
            'blocked_by'
        )
        text(
            'Scheduled date property',
            'Date a note is scheduled to be worked on.',
            'defaultScheduledDateProperty',
            'date_scheduled'
        )
        text('Due date property', 'Date a note is due.', 'defaultDueDateProperty', 'date_due')
        text(
            'Date format',
            'Moment.js format used when writing scheduling dates to notes.',
            'defaultDateFormat',
            'YYYY-MM-DD'
        )

        new Setting(containerEl).setName('Review (triage)').setHeading()
        text(
            'Last-reviewed property',
            'Date a note was last reviewed (triage “Due for review”).',
            'reviewedDateProperty',
            'last_reviewed'
        )
        text(
            'Review-interval property',
            'Days between reviews, read per note.',
            'reviewIntervalProperty',
            'review_interval'
        )
        text(
            'Review-count property',
            'Number of times a note has been reviewed (incremented on “Reviewed”).',
            'reviewCountProperty',
            'review_count'
        )
        new Setting(containerEl)
            .setName('Default review interval (days)')
            .setDesc('Used when a note has no review-interval value.')
            .addText((input) => {
                input.inputEl.type = 'number'
                input.inputEl.min = '1'
                input
                    .setPlaceholder('30')
                    .setValue(String(this.plugin.settings.defaultReviewIntervalDays))
                    .onChange((value) => {
                        const n = Number.parseInt(value, 10)
                        if (Number.isFinite(n) && n > 0) void this.updateReviewIntervalDays(n)
                    })
            })

        new Setting(containerEl)
            .setName('First day of the week')
            .setDesc('Which day calendar weeks start on.')
            .addDropdown((dd) => {
                for (let day = 0; day < WEEKDAY_NAMES.length; day++) {
                    dd.addOption(String(day), WEEKDAY_NAMES[day] ?? '')
                }
                dd.setValue(String(this.plugin.settings.firstDayOfWeek))
                dd.onChange((value) => {
                    const day = Number(value)
                    if (Number.isInteger(day) && day >= 0 && day <= 6) {
                        void this.updateFirstDayOfWeek(day)
                    }
                })
            })

        new Setting(containerEl)
            .setName('Card chip style')
            .setDesc(
                'How property values render on cards. Minimal: a clean stat list, no fills. ' +
                    'Tinted: color-filled pills (a heatmap). Rail: neutral pills with a colored edge.'
            )
            .addDropdown((dd) => {
                dd.addOption('minimal', 'Minimal (no fills)')
                dd.addOption('tinted', 'Tinted (color-filled)')
                dd.addOption('rail', 'Rail (colored edge)')
                dd.setValue(this.plugin.settings.cardChipStyle)
                dd.onChange((value) => {
                    if (value === 'minimal' || value === 'tinted' || value === 'rail') {
                        void this.updateChipStyle(value)
                    }
                })
            })

        new Setting(containerEl)
            .setName('Default statuses (columns)')
            .setDesc(
                'One status value per line, in column order. Used when a board does not define ' +
                    'its own statuses and no Starter Kit note type applies. Number prefixes ' +
                    '(e.g. "10 Todo") set order and are hidden on the column header.'
            )
            .addTextArea((area) => {
                area.setPlaceholder('10 Todo\n20 In progress\n30 Done')
                    .setValue(this.plugin.settings.defaultStatuses.join('\n'))
                    .onChange((value) => {
                        const statuses = value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0)
                        void this.updateStatuses(statuses)
                    })
            })
    }

    private async updateStatuses(statuses: string[]): Promise<void> {
        this.plugin.settings = produce(this.plugin.settings, (draft) => {
            draft.defaultStatuses = statuses
        })
        await this.plugin.saveSettings()
    }

    private async updateSetting(key: StringSettingKey, value: string): Promise<void> {
        this.plugin.settings = produce(this.plugin.settings, (draft) => {
            draft[key] = value
        })
        await this.plugin.saveSettings()
    }

    private async updateFirstDayOfWeek(day: number): Promise<void> {
        this.plugin.settings = produce(this.plugin.settings, (draft) => {
            draft.firstDayOfWeek = day
        })
        await this.plugin.saveSettings()
    }

    private async updateReviewIntervalDays(days: number): Promise<void> {
        this.plugin.settings = produce(this.plugin.settings, (draft) => {
            draft.defaultReviewIntervalDays = days
        })
        await this.plugin.saveSettings()
    }

    private async updateChipStyle(style: PluginSettings['cardChipStyle']): Promise<void> {
        this.plugin.settings = produce(this.plugin.settings, (draft) => {
            draft.cardChipStyle = style
        })
        await this.plugin.saveSettings()
    }

    private renderFollowButton(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Follow the author')
            .setDesc('Sébastien Dubois (@dSebastien)')
            .addButton((button) => {
                button.setCta()
                button.setButtonText('Follow on X').onClick(() => {
                    window.open('https://x.com/dSebastien')
                })
            })
    }

    private renderSupportHeader(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Support').setHeading()

        const supportDesc = new DocumentFragment()
        supportDesc.createDiv({
            text: 'Buy me a coffee to support the development of this plugin ❤️'
        })

        new Setting(containerEl).setDesc(supportDesc)

        this.renderBuyMeACoffeeBadge(containerEl)
        const spacing = containerEl.createDiv()
        spacing.classList.add('support-header-margin')
    }

    private renderBuyMeACoffeeBadge(contentEl: HTMLElement | DocumentFragment, width = 175): void {
        const linkEl = contentEl.createEl('a', {
            href: 'https://www.buymeacoffee.com/dsebastien'
        })
        const imgEl = linkEl.createEl('img')
        imgEl.src = BUY_ME_A_COFFEE_BADGE_DATA_URL
        imgEl.alt = 'Buy me a coffee'
        imgEl.width = width
    }
}
