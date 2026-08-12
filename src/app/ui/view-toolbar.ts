import { setIcon } from 'obsidian'
import { renderGearButton } from './gear-button'
import type { ViewMode } from '../domain/embed-params'

// ViewMode lives in the domain layer (embed-params, issue #103) so pure
// domain code never imports from ui/; re-exported here for existing users.
export type { ViewMode } from '../domain/embed-params'

export interface ViewToolbarState {
    /** The active view mode. */
    mode: ViewMode
    /** Whether to show the up/down swimlane navigation (board mode, >1 lane). */
    showLaneNav: boolean
    /** Whether multi-select mode is active (board mode only). */
    selectionMode: boolean
    /** Whether compact cards (title only) are active (board mode only). */
    compactMode: boolean
    /** Whether any card on the board carries the contexts property (else the switcher is hidden). */
    contextsAvailable: boolean
    /** Number of GTD contexts currently selected (0 = inactive/no count badge). */
    contextCount: number
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
    /** Open the GTD context switcher menu, anchored to the toolbar button. */
    onOpenContextMenu: (anchorEl: HTMLElement) => void
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
    addModeButton(modeSwitch, 'Timeline', state.mode === 'timeline', () =>
        callbacks.onSetMode('timeline')
    )
    addModeButton(modeSwitch, 'WBS', state.mode === 'wbs', () => callbacks.onSetMode('wbs'))
    addModeButton(modeSwitch, 'Triage', state.mode === 'triage', () =>
        callbacks.onSetMode('triage')
    )
    addModeButton(modeSwitch, 'Agenda', state.mode === 'agenda', () =>
        callbacks.onSetMode('agenda')
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
    // GTD context switcher: contexts filter every mode, so it is shown in all
    // modes — but only when at least one card on the board carries the property
    // (mirrors how lane nav only appears with >1 lane).
    if (state.contextsAvailable) {
        const contextBtn = addIconButton(
            rightEl,
            'at-sign',
            state.contextCount > 0
                ? `Contexts (${String(state.contextCount)} selected)`
                : 'Filter by context',
            () => callbacks.onOpenContextMenu(contextBtn)
        )
        if (state.contextCount > 0) contextBtn.addClass('kap-nav-btn-active')
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
