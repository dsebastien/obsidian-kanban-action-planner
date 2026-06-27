import { App, PluginSettingTab, Setting } from 'obsidian'
import { produce } from 'immer'
import type KanbanActionPlannerPlugin from '../../main'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../assets/buy-me-a-coffee'

/** Settings keys whose value is a plain string (editable as text). */
type StringSettingKey = {
    [K in keyof PluginSettings]: PluginSettings[K] extends string ? K : never
}[keyof PluginSettings]

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
        this.renderFollowButton(containerEl)
        this.renderSupportHeader(containerEl)
    }

    private renderPropertySettings(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'setting-item-description',
            text:
                'Vault-wide defaults, used when a board or note type does not specify its own. ' +
                'Per-board options live in each board’s Bases "Configure view" panel; shared ' +
                'colors, cards, relationships, and archiving live in the board’s gear → ' +
                '"Configure board".'
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
