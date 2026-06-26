import { Plugin } from 'obsidian'
import { DEFAULT_SETTINGS, pluginSettingsSchema } from './types/plugin-settings.intf'
import type { PluginSettings } from './types/plugin-settings.intf'
import { KanbanActionPlannerSettingTab } from './settings/settings-tab'
import { KanbanActionPlannerView } from './views/kanban/kanban-view'
import { getKanbanViewOptions } from './views/kanban/kanban-view-options'
import { KANBAN_VIEW_ICON, KANBAN_VIEW_NAME, KANBAN_VIEW_TYPE } from './constants'
import { log } from '../utils/log'
import { produce } from 'immer'

export class KanbanActionPlannerPlugin extends Plugin {
    /**
     * The plugin settings are immutable
     */
    override settings: PluginSettings = produce(DEFAULT_SETTINGS, () => DEFAULT_SETTINGS)

    /**
     * Executed as soon as the plugin loads
     */
    override async onload() {
        log('Initializing', 'debug')
        await this.loadSettings()

        this.registerKanbanView()

        // Add a settings screen for the plugin
        this.addSettingTab(new KanbanActionPlannerSettingTab(this.app, this))
    }

    override onunload() {}

    /**
     * Register the custom Kanban view type with Bases.
     */
    private registerKanbanView(): void {
        const registered = this.registerBasesView(KANBAN_VIEW_TYPE, {
            name: KANBAN_VIEW_NAME,
            icon: KANBAN_VIEW_ICON,
            factory: (controller, containerEl) =>
                new KanbanActionPlannerView(controller, containerEl, this),
            options: (config) => getKanbanViewOptions(config)
        })

        if (registered) {
            log('Kanban view registered', 'debug')
        } else {
            log('Failed to register Kanban view', 'warn')
        }
    }

    /**
     * Load the plugin settings.
     *
     * Loaded data is shallow-merged onto the defaults (so newly-added keys get
     * sensible values) and validated with Zod. Invalid data falls back to
     * defaults rather than throwing, so a corrupt `data.json` never breaks the
     * plugin. Full per-field migrations land alongside the profile store.
     */
    async loadSettings() {
        log('Loading settings', 'debug')
        const loadedData: unknown = await this.loadData()

        if (!loadedData || typeof loadedData !== 'object') {
            log('Using default settings', 'debug')
            this.settings = produce(DEFAULT_SETTINGS, () => {})
            return
        }

        const merged = { ...DEFAULT_SETTINGS, ...(loadedData as Partial<PluginSettings>) }
        const parsed = pluginSettingsSchema.safeParse(merged)

        if (parsed.success) {
            this.settings = produce(parsed.data, () => {})
            log('Settings loaded', 'debug', parsed.data)
        } else {
            log('Invalid settings; using defaults', 'warn', parsed.error)
            this.settings = produce(DEFAULT_SETTINGS, () => {})
        }
    }

    /**
     * Save the plugin settings
     */
    async saveSettings() {
        log('Saving settings', 'debug', this.settings)
        await this.saveData(this.settings)
        log('Settings saved', 'debug', this.settings)
    }
}
