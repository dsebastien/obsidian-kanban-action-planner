import { ItemView, setIcon } from 'obsidian'
import type { ViewStateResult, WorkspaceLeaf } from 'obsidian'
import { POMODORO_VIEW_ICON, POMODORO_VIEW_TYPE } from '../constants'
import { pomodoroViewModel } from '../domain/pomodoro'
import type { PomodoroViewModel } from '../domain/pomodoro'
import {
    nextBreakType,
    pomodoroConfig,
    pomodoroLabel,
    skipPomodoroPhase,
    startPomodoro,
    stopPomodoro,
    stopTimeSession,
    togglePomodoroPause
} from '../services/time-tracking.service'
import type { KanbanActionPlannerPlugin } from '../plugin'

/** The view's persisted state: compact widget or full-screen variant. */
interface PomodoroViewState {
    full?: boolean
}

/** Ring geometry: radius 45 in a 100×100 box → circumference. */
const RING_R = 45
const RING_C = 2 * Math.PI * RING_R

/**
 * The visual pomodoro timer (issue #199): a ring that drains over the phase,
 * the phase name and the note it runs on, the remaining time readable from
 * across the room, and the pomodoro count in the current cycle, with the
 * controls in place (start, pause, skip, stop, next phase).
 *
 * Two placements share this one renderer: the compact widget (a sidebar
 * leaf, `open-pomodoro-timer`) and the full-screen variant (a main-area leaf
 * with `full: true`, Escape leaves it) — a rendered view, not a new window,
 * so the plugin's CSS isolation stays intact. Everything derives from the
 * persisted tracker state on a 1 s clock, exactly like the status bar, so it
 * is right after a reload. Content lives under its own `.kap-root`.
 */
export class PomodoroTimerView extends ItemView {
    override navigation = false
    private readonly plugin: KanbanActionPlannerPlugin
    private full = false
    private rootEl: HTMLElement | null = null
    private signature = ''
    /** Sidebars this view folded away on entering full screen (restored on leave). */
    private foldedSides: Array<'left' | 'right'> = []

    constructor(leaf: WorkspaceLeaf, plugin: KanbanActionPlannerPlugin) {
        super(leaf)
        this.plugin = plugin
        this.icon = POMODORO_VIEW_ICON
    }

    override getViewType(): string {
        return POMODORO_VIEW_TYPE
    }

    override getDisplayText(): string {
        return 'Pomodoro timer'
    }

    override getState(): Record<string, unknown> {
        return { full: this.full }
    }

    override async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const next = (state as PomodoroViewState | null)?.full === true
        if (next !== this.full) {
            this.full = next
            this.signature = ''
            if (next) this.foldSidebars()
            else this.restoreSidebars()
            this.render()
        }
        await super.setState(state, result)
    }

    protected override async onOpen(): Promise<void> {
        this.contentEl.empty()
        this.contentEl.addClass('kap-pomo-content')
        this.rootEl = this.contentEl.createDiv({ cls: 'kap-root kap-pomo-root' })
        this.rootEl.tabIndex = 0
        this.registerDomEvent(this.rootEl, 'keydown', (e) => this.onKey(e))
        this.render()
        this.registerInterval(window.setInterval(() => this.render(), 1000))
        await Promise.resolve()
    }

    protected override async onClose(): Promise<void> {
        this.restoreSidebars()
        this.contentEl.empty()
        this.rootEl = null
        await Promise.resolve()
    }

    /**
     * "The timer alone, everything else hidden": full screen folds both
     * sidebars away and remembers which ones IT folded, so leaving puts back
     * exactly what was open — a sidebar the user had already closed stays
     * closed.
     */
    private foldSidebars(): void {
        const { leftSplit, rightSplit } = this.app.workspace
        this.foldedSides = []
        for (const [side, split] of [
            ['left', leftSplit],
            ['right', rightSplit]
        ] as const) {
            if (!split.collapsed) {
                split.collapse()
                this.foldedSides.push(side)
            }
        }
    }

    private restoreSidebars(): void {
        const { leftSplit, rightSplit } = this.app.workspace
        for (const side of this.foldedSides) (side === 'left' ? leftSplit : rightSplit).expand()
        this.foldedSides = []
    }

    /** Keyboard: Escape leaves full screen, Space pauses/resumes, S skips. */
    private onKey(e: KeyboardEvent): void {
        if (e.key === 'Escape' && this.full) {
            e.preventDefault()
            void this.leaf.setViewState({ type: POMODORO_VIEW_TYPE, state: { full: false } })
            return
        }
        if (e.key === ' ' && this.plugin.settings.activePomodoro) {
            e.preventDefault()
            void togglePomodoroPause(this.plugin)
        }
    }

    /**
     * Repaint from the current state. The ring, digits and labels are
     * patched in place every second; the control row is rebuilt only when
     * the phase / pause / note signature changes, so buttons keep focus and
     * hover between ticks.
     */
    private render(): void {
        const root = this.rootEl
        if (!root) return
        const s = this.plugin.settings
        const model = pomodoroViewModel(
            {
                active: s.activePomodoro,
                completedWork: s.pomodoroCompletedWork,
                session: s.activeTimeSession
            },
            pomodoroConfig(this.plugin),
            Date.now()
        )
        root.toggleClass('kap-pomo-full', this.full)
        root.toggleClass('kap-pomo-paused', model.paused)
        for (const phase of ['work', 'short-break', 'long-break', 'idle'] as const) {
            root.toggleClass(`kap-pomo-${phase}`, model.phase === phase)
        }
        const signature = [
            model.phase,
            model.paused,
            model.note,
            this.full,
            s.activeTimeSession?.path
        ].join('|')
        if (signature !== this.signature) {
            this.signature = signature
            this.build(root, model)
        }
        this.patch(root, model)
    }

    /** Build the static structure for a phase (ring, labels, controls). */
    private build(root: HTMLElement, model: PomodoroViewModel): void {
        root.empty()
        root.setAttribute('role', 'timer')
        root.setAttribute('aria-live', 'polite')

        const head = root.createDiv({ cls: 'kap-pomo-head' })
        head.createSpan({ cls: 'kap-pomo-phase', text: model.phaseLabel })
        const fullBtn = head.createEl('button', {
            cls: 'kap-pomo-icon-btn',
            attr: {
                'type': 'button',
                'aria-label': this.full ? 'Leave full screen (Escape)' : 'Full screen'
            }
        })
        setIcon(fullBtn, this.full ? 'minimize-2' : 'maximize-2')
        fullBtn.addEventListener('click', () => void this.toggleFull())

        const dial = root.createDiv({ cls: 'kap-pomo-dial' })
        const svg = dial.createSvg('svg', {
            cls: 'kap-pomo-ring',
            attr: { 'viewBox': '0 0 100 100', 'aria-hidden': 'true' }
        })
        svg.createSvg('circle', {
            cls: 'kap-pomo-ring-track',
            attr: { cx: '50', cy: '50', r: String(RING_R) }
        })
        svg.createSvg('circle', {
            cls: 'kap-pomo-ring-fill',
            attr: {
                'cx': '50',
                'cy': '50',
                'r': String(RING_R),
                'stroke-dasharray': RING_C.toFixed(2),
                'stroke-dashoffset': '0'
            }
        })
        const centre = dial.createDiv({ cls: 'kap-pomo-centre' })
        centre.createDiv({ cls: 'kap-pomo-time', text: model.remaining || '—' })
        centre.createDiv({ cls: 'kap-pomo-state', text: model.paused ? 'Paused' : '' })

        if (model.note) {
            const note = root.createEl('button', {
                cls: 'kap-pomo-note',
                text: model.note,
                attr: { type: 'button', title: 'Open the note' }
            })
            note.addEventListener('click', (e) => {
                const path =
                    this.plugin.settings.activePomodoro?.path ??
                    this.plugin.settings.activeTimeSession?.path
                if (path) void this.app.workspace.openLinkText(path, '', e.ctrlKey || e.metaKey)
            })
        }
        root.createDiv({ cls: 'kap-pomo-cycle', text: model.cycle })

        const controls = root.createDiv({ cls: 'kap-pomo-controls' })
        const button = (label: string, icon: string, onClick: () => void, cta = false): void => {
            const btn = controls.createEl('button', {
                cls: cta ? 'kap-pomo-btn kap-pomo-btn-cta' : 'kap-pomo-btn',
                attr: { 'type': 'button', 'aria-label': label, 'title': label }
            })
            setIcon(btn.createSpan({ cls: 'kap-pomo-btn-icon' }), icon)
            btn.createSpan({ cls: 'kap-pomo-btn-label', text: label })
            btn.addEventListener('click', onClick)
        }
        const active = this.plugin.settings.activePomodoro
        const session = this.plugin.settings.activeTimeSession
        if (active) {
            button(
                model.paused ? 'Resume' : 'Pause',
                model.paused ? 'play' : 'pause',
                () => void togglePomodoroPause(this.plugin),
                true
            )
            button('Skip phase', 'skip-forward', () => void skipPomodoroPhase(this.plugin))
            button('Stop', 'circle-stop', () => void stopPomodoro(this.plugin))
        } else {
            button(
                session ? 'Start work on the tracked note' : 'Start work',
                'hourglass',
                () => void startPomodoro(this.plugin, session?.path ?? null, 'work'),
                true
            )
            const breakType = nextBreakType(this.plugin)
            button(
                `Start ${pomodoroLabel(breakType).toLowerCase()}`,
                'coffee',
                () => void startPomodoro(this.plugin, null, breakType)
            )
            if (session) {
                button('Stop time tracking', 'timer-off', () => void stopTimeSession(this.plugin))
            }
        }
    }

    /** Update the per-second parts in place. */
    private patch(root: HTMLElement, model: PomodoroViewModel): void {
        root.setAttribute('aria-label', model.ariaLabel)
        const time = root.querySelector<HTMLElement>('.kap-pomo-time')
        if (time && time.textContent !== (model.remaining || '—'))
            time.setText(model.remaining || '—')
        const state = root.querySelector<HTMLElement>('.kap-pomo-state')
        if (state) state.setText(model.paused ? 'Paused' : '')
        const fill = root.querySelector<SVGCircleElement>('.kap-pomo-ring-fill')
        if (fill) {
            // Drain: the visible arc is what is LEFT of the phase.
            fill.setAttribute('stroke-dashoffset', (RING_C * model.fraction).toFixed(2))
        }
        const cycle = root.querySelector<HTMLElement>('.kap-pomo-cycle')
        if (cycle && cycle.textContent !== model.cycle) cycle.setText(model.cycle)
    }

    private async toggleFull(): Promise<void> {
        if (this.full) {
            await this.leaf.setViewState({ type: POMODORO_VIEW_TYPE, state: { full: false } })
            return
        }
        // Full screen lives in the main area (a sidebar leaf is too narrow);
        // this widget stays where it is.
        await openPomodoroTimer(this.plugin, true)
    }
}

/**
 * Open the timer: the compact widget in the right sidebar, or the full-screen
 * variant as a main-area tab. Reuses an existing leaf of the same placement.
 */
export async function openPomodoroTimer(
    plugin: KanbanActionPlannerPlugin,
    full = false
): Promise<void> {
    const { workspace } = plugin.app
    const existing = workspace
        .getLeavesOfType(POMODORO_VIEW_TYPE)
        .find((leaf) =>
            leaf.view instanceof PomodoroTimerView ? leaf.view.getState()['full'] === full : false
        )
    if (existing) {
        await workspace.revealLeaf(existing)
        return
    }
    const leaf = full ? workspace.getLeaf('tab') : workspace.getRightLeaf(false)
    if (!leaf) return
    await leaf.setViewState({ type: POMODORO_VIEW_TYPE, active: true, state: { full } })
    await workspace.revealLeaf(leaf)
    if (full) leaf.view.containerEl.querySelector<HTMLElement>('.kap-pomo-root')?.focus()
}
