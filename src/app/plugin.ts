import { Plugin, View } from 'obsidian'
import { DEFAULT_SETTINGS, pluginSettingsSchema } from './types/plugin-settings.intf'
import type { PluginSettings, SettingsRefreshScope } from './types/plugin-settings.intf'
import { KanbanActionPlannerSettingTab } from './settings/settings-tab'
import { KanbanActionPlannerView } from './views/kanban/kanban-view'
import { getKanbanViewOptions } from './views/kanban/kanban-view-options'
import { KANBAN_VIEW_ICON, KANBAN_VIEW_NAME, KANBAN_VIEW_TYPE } from './constants'
import { log } from '../utils/log'
import { registerWhatsNewView } from './whats-new'
import { produce } from 'immer'

export class KanbanActionPlannerPlugin extends Plugin {
    /**
     * The plugin settings are immutable
     */
    // No `override`: `Plugin.settings` only exists in API 1.13+ typings and the
    // plugin supports 1.12 (latest public release line).
    settings: PluginSettings = produce(DEFAULT_SETTINGS, () => DEFAULT_SETTINGS)

    /**
     * Live kanban view instances, so a settings/noteType change can refresh every
     * open board immediately (see {@link saveSettings}). Views add/remove
     * themselves on load/unload.
     */
    private readonly openKanbanViews = new Set<KanbanActionPlannerView>()

    /** Register a live kanban view for settings-change notifications. */
    trackKanbanView(view: KanbanActionPlannerView): void {
        this.openKanbanViews.add(view)
    }

    /** Stop notifying a kanban view (called on its unload). */
    untrackKanbanView(view: KanbanActionPlannerView): void {
        this.openKanbanViews.delete(view)
    }

    /**
     * Executed as soon as the plugin loads
     */
    override async onload() {
        log('Initializing', 'debug')
        // Must run before anything can call saveData (fresh-install detection)
        registerWhatsNewView(this)
        await this.loadSettings()

        this.registerKanbanView()
        this.registerCommands()
        // Let the core "Page preview" plugin show note popovers when hovering a
        // card (issue #14 follow-up). `defaultMod` keeps it Ctrl/Cmd-gated by
        // default, matching Obsidian's editor link-preview behaviour.
        this.registerHoverLinkSource(KANBAN_VIEW_TYPE, {
            display: 'Kanban Action Planner',
            defaultMod: true
        })

        // Add a settings screen for the plugin
        this.addSettingTab(new KanbanActionPlannerSettingTab(this.app, this))
    }

    /**
     * The Kanban view in the active leaf, or null when none is focused. A Bases
     * leaf hosts our view as its current sub-view (`controller.view`); we read it
     * directly and `instanceof`-check, so background Kanban leaves never match.
     */
    private activeKanbanView(): KanbanActionPlannerView | null {
        // `getActiveViewOfType(View)` returns the active leaf's view (every view
        // extends View) without the deprecated `workspace.activeLeaf` accessor.
        const view = this.app.workspace.getActiveViewOfType(View)
        if (!view || view.getViewType() !== 'bases') return null
        const subView = (view as unknown as { controller?: { view?: unknown } }).controller?.view
        return subView instanceof KanbanActionPlannerView ? subView : null
    }

    /**
     * Command-palette commands acting on the active Kanban view (issue #27).
     * Each uses `checkCallback` so it only appears/runs when a Kanban view is
     * focused, and is hotkey-bindable.
     */
    private registerCommands(): void {
        const onActiveView =
            (run: (view: KanbanActionPlannerView) => void) =>
            (checking: boolean): boolean => {
                const view = this.activeKanbanView()
                if (!view) return false
                if (!checking) run(view)
                return true
            }

        this.addCommand({
            id: 'toggle-calendar-mode',
            name: 'Toggle board / calendar mode',
            checkCallback: onActiveView((view) => view.toggleMode())
        })
        this.addCommand({
            id: 'toggle-triage-mode',
            name: 'Toggle triage mode',
            checkCallback: onActiveView((view) => view.toggleTriage())
        })
        this.addCommand({
            id: 'toggle-timeline-mode',
            name: 'Toggle timeline mode',
            checkCallback: onActiveView((view) => view.toggleTimeline())
        })
        this.addCommand({
            id: 'toggle-wbs-mode',
            name: 'Toggle WBS mode',
            checkCallback: onActiveView((view) => view.toggleWbs())
        })
        this.addCommand({
            id: 'toggle-agenda-mode',
            name: 'Toggle agenda mode',
            checkCallback: onActiveView((view) => view.toggleAgenda())
        })
        this.addCommand({
            id: 'configure-triage',
            name: 'Configure triage',
            checkCallback: onActiveView((view) => view.openTriageConfig())
        })
        this.addCommand({
            id: 'focus-filter',
            name: 'Focus filter',
            checkCallback: onActiveView((view) => view.focusFilter())
        })
        this.addCommand({
            id: 'clear-filter',
            name: 'Clear filter',
            checkCallback: onActiveView((view) => view.clearFilter())
        })
        this.addCommand({
            id: 'next-swimlane',
            name: 'Go to next swimlane',
            checkCallback: onActiveView((view) => view.goToLane(1))
        })
        this.addCommand({
            id: 'previous-swimlane',
            name: 'Go to previous swimlane',
            checkCallback: onActiveView((view) => view.goToLane(-1))
        })
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
            options: () => getKanbanViewOptions(this.app, this.settings)
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
     * plugin. Full per-field migrations land alongside the note type store.
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
     * Save the plugin settings.
     *
     * `scope` controls how much of each open board refreshes (issue #67): a
     * cosmetic change (`chrome`/`cards`) applies instantly instead of running the
     * heavy full re-derivation. Views are notified **before** the async disk write
     * so the change is visible at once, not gated on `saveData`.
     */
    async saveSettings(scope: SettingsRefreshScope = 'full') {
        log('Saving settings', 'debug', this.settings)
        for (const view of this.openKanbanViews) view.onSettingsChanged(scope)
        await this.saveData(this.settings)
        log('Settings saved', 'debug', this.settings)
    }
}
