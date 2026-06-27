import { setIcon } from 'obsidian'

/**
 * Render the floating "Configure board" gear button into the view root. It opens
 * the shared (note-type) settings; per-board options live in Bases "Configure
 * view". Returns the button so the caller can remove it on unload.
 */
export function renderGearButton(parentEl: HTMLElement, onClick: () => void): HTMLElement {
    const label = 'Configure board (shared settings)'
    const button = parentEl.createEl('button', {
        cls: 'kap-gear',
        attr: { 'aria-label': label, 'title': label, 'type': 'button' }
    })
    setIcon(button, 'settings')
    button.addEventListener('click', (e) => {
        e.preventDefault()
        onClick()
    })
    return button
}
