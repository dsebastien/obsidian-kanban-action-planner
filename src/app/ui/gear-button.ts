import { setIcon } from 'obsidian'

/**
 * Render the floating "Configure board" gear button into the view root.
 * Returns the button so the caller can remove it on unload.
 */
export function renderGearButton(parentEl: HTMLElement, onClick: () => void): HTMLElement {
    const button = parentEl.createEl('button', {
        cls: 'kap-gear',
        attr: { 'aria-label': 'Configure board', 'type': 'button' }
    })
    setIcon(button, 'settings')
    button.addEventListener('click', (e) => {
        e.preventDefault()
        onClick()
    })
    return button
}
