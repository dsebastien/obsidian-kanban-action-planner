import { BasesView } from 'obsidian'
import type { QueryController } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../../plugin'
import { CSS_ROOT_CLASS, KANBAN_VIEW_TYPE } from '../../constants'
import { log } from '../../../utils/log'

/**
 * The Kanban Bases view.
 *
 * Milestone 0 scaffold: registers, mounts a scoped root element, and renders a
 * placeholder. Board rendering, drag/drop, and calendar mode arrive in later
 * milestones. `data` is replaced on every update, so it is always re-read in
 * {@link onDataUpdated} and never cached.
 */
export class KanbanActionPlannerView extends BasesView {
    override readonly type = KANBAN_VIEW_TYPE

    private readonly containerEl: HTMLElement
    private readonly plugin: KanbanActionPlannerPlugin
    private rootEl: HTMLElement | null = null

    constructor(
        controller: QueryController,
        containerEl: HTMLElement,
        plugin: KanbanActionPlannerPlugin
    ) {
        super(controller)
        this.containerEl = containerEl
        this.plugin = plugin
    }

    override onload(): void {
        this.rootEl = this.containerEl.createDiv({ cls: CSS_ROOT_CLASS })
        this.render()
    }

    override onunload(): void {
        this.rootEl?.remove()
        this.rootEl = null
    }

    override onDataUpdated(): void {
        // `this.data` was just replaced — re-render from the fresh result set.
        this.render()
    }

    private render(): void {
        if (!this.rootEl) return
        this.rootEl.empty()

        const count = this.data?.data?.length ?? 0
        const statusProperty = this.plugin.settings.defaultStatusProperty
        log(`Rendering Kanban view with ${String(count)} entries`, 'debug')

        // Placeholder until the board renderer lands (Milestone 1).
        this.rootEl.createDiv({
            cls: 'kap-placeholder',
            text: `Kanban Action Planner — ${String(count)} note(s) in view (status property: "${statusProperty}").`
        })
    }
}
