import { setIcon } from 'obsidian'
import { renderGearButton } from './gear-button'

export interface ViewToolbarState {
    /** Whether the view is in calendar mode (vs board mode). */
    calendarMode: boolean
    /** Whether to show the up/down swimlane navigation (board mode, >1 lane). */
    showLaneNav: boolean
}

export interface ViewToolbarCallbacks {
    /** Switch between board and calendar mode (persists to the view config). */
    onSetCalendarMode: (calendar: boolean) => void
    /** Open the shared (note-type) settings modal. */
    onConfigure: () => void
    /** Scroll to the previous swimlane. */
    onLanePrev: () => void
    /** Scroll to the next swimlane. */
    onLaneNext: () => void
}

/**
 * Render the view's top toolbar: a Board / Calendar mode switch on the left and,
 * on the right, the up/down swimlane navigation (only with multiple lanes) plus
 * the "Configure board" gear. Re-render (the caller empties the host) whenever
 * the mode or lane count changes so the controls stay in sync.
 */
export function renderViewToolbar(
    parentEl: HTMLElement,
    state: ViewToolbarState,
    callbacks: ViewToolbarCallbacks
): void {
    parentEl.empty()

    const modeSwitch = parentEl.createDiv({
        cls: 'kap-mode-switch',
        attr: { 'role': 'tablist', 'aria-label': 'View mode' }
    })
    addModeButton(modeSwitch, 'Board', !state.calendarMode, () =>
        callbacks.onSetCalendarMode(false)
    )
    addModeButton(modeSwitch, 'Calendar', state.calendarMode, () =>
        callbacks.onSetCalendarMode(true)
    )

    const actions = parentEl.createDiv({ cls: 'kap-toolbar-actions' })
    if (state.showLaneNav) {
        addIconButton(actions, 'chevron-up', 'Previous swimlane', callbacks.onLanePrev)
        addIconButton(actions, 'chevron-down', 'Next swimlane', callbacks.onLaneNext)
    }
    renderGearButton(actions, callbacks.onConfigure)
}

function addModeButton(
    parent: HTMLElement,
    label: string,
    active: boolean,
    onClick: () => void
): void {
    const btn = parent.createEl('button', {
        cls: 'kap-mode-btn',
        text: label,
        attr: { 'type': 'button', 'role': 'tab', 'aria-selected': String(active) }
    })
    if (active) btn.addClass('kap-mode-btn-active')
    btn.addEventListener('click', onClick)
}

function addIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
): void {
    const btn = parent.createEl('button', {
        cls: 'kap-nav-btn',
        attr: { 'type': 'button', 'aria-label': label, 'title': label }
    })
    setIcon(btn, icon)
    btn.addEventListener('click', onClick)
}
