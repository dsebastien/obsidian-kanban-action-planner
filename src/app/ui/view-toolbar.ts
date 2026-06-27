import { renderGearButton } from './gear-button'

export interface ViewToolbarCallbacks {
    /** Switch between board and calendar mode (persists to the view config). */
    onSetCalendarMode: (calendar: boolean) => void
    /** Open the shared (note-type) settings modal. */
    onConfigure: () => void
}

/**
 * Render the view's top toolbar: a Board / Calendar mode switch on the left and
 * the "Configure board" gear on the right. Re-render (the caller empties the
 * host) whenever the mode changes so the active segment stays in sync. Giving
 * the gear a fixed home here also keeps it from overlapping the calendar's own
 * toolbar.
 */
export function renderViewToolbar(
    parentEl: HTMLElement,
    calendarMode: boolean,
    callbacks: ViewToolbarCallbacks
): void {
    parentEl.empty()
    const modeSwitch = parentEl.createDiv({
        cls: 'kap-mode-switch',
        attr: { 'role': 'tablist', 'aria-label': 'View mode' }
    })
    addModeButton(modeSwitch, 'Board', !calendarMode, () => callbacks.onSetCalendarMode(false))
    addModeButton(modeSwitch, 'Calendar', calendarMode, () => callbacks.onSetCalendarMode(true))
    renderGearButton(parentEl, callbacks.onConfigure)
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
