import { setIcon } from 'obsidian'
import { renderGearButton } from './gear-button'

/** The three mutually-exclusive view modes (Board / Calendar / Triage). */
export type ViewMode = 'board' | 'calendar' | 'triage'

export interface ViewToolbarState {
    /** The active view mode. */
    mode: ViewMode
    /** Whether to show the up/down swimlane navigation (board mode, >1 lane). */
    showLaneNav: boolean
    /** Whether multi-select mode is active (board mode only). */
    selectionMode: boolean
    /** Whether compact cards (title only) are active (board mode only). */
    compactMode: boolean
}

export interface ViewToolbarCallbacks {
    /** Switch the view mode (persists to the view config). */
    onSetMode: (mode: ViewMode) => void
    /** Open the shared (note-type) settings modal. */
    onConfigure: () => void
    /** Scroll to the previous swimlane. */
    onLanePrev: () => void
    /** Scroll to the next swimlane. */
    onLaneNext: () => void
    /** Toggle multi-select mode. */
    onToggleSelectionMode: () => void
    /** Toggle compact cards (persists to the view config). */
    onToggleCompactMode: () => void
}

/**
 * Render the view's toolbar controls into two stable slots: the Board / Calendar
 * mode switch into `leftEl`, and the swimlane navigation (only with multiple
 * lanes) plus the "Configure board" gear into `rightEl`. Each slot is emptied
 * and refilled so the controls stay in sync on mode/lane changes. The filter
 * input lives in a separate, persistent slot between them (owned by the view) so
 * it is never re-rendered and never loses focus mid-typing.
 */
export function renderViewToolbar(
    leftEl: HTMLElement,
    rightEl: HTMLElement,
    state: ViewToolbarState,
    callbacks: ViewToolbarCallbacks
): void {
    leftEl.empty()
    const modeSwitch = leftEl.createDiv({
        cls: 'kap-mode-switch',
        attr: { 'role': 'tablist', 'aria-label': 'View mode' }
    })
    addModeButton(modeSwitch, 'Board', state.mode === 'board', () => callbacks.onSetMode('board'))
    addModeButton(modeSwitch, 'Calendar', state.mode === 'calendar', () =>
        callbacks.onSetMode('calendar')
    )
    addModeButton(modeSwitch, 'Triage', state.mode === 'triage', () =>
        callbacks.onSetMode('triage')
    )

    rightEl.empty()
    if (state.showLaneNav) {
        addIconButton(rightEl, 'chevron-up', 'Previous swimlane', callbacks.onLanePrev)
        addIconButton(rightEl, 'chevron-down', 'Next swimlane', callbacks.onLaneNext)
    }
    if (state.mode === 'board') {
        const selectBtn = addIconButton(
            rightEl,
            'list-checks',
            state.selectionMode ? 'Exit select mode' : 'Select multiple cards',
            callbacks.onToggleSelectionMode
        )
        if (state.selectionMode) selectBtn.addClass('kap-nav-btn-active')
        const compactBtn = addIconButton(
            rightEl,
            'rows-2',
            state.compactMode ? 'Show card details' : 'Show titles only',
            callbacks.onToggleCompactMode
        )
        if (state.compactMode) compactBtn.addClass('kap-nav-btn-active')
    }
    renderGearButton(rightEl, callbacks.onConfigure)
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
): HTMLElement {
    const btn = parent.createEl('button', {
        cls: 'kap-nav-btn',
        attr: { 'type': 'button', 'aria-label': label, 'title': label }
    })
    setIcon(btn, icon)
    btn.addEventListener('click', onClick)
    return btn
}
