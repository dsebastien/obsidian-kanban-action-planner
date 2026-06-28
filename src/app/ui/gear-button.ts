import { setIcon } from 'obsidian'

/**
 * Render the "Configure note types" gear into the view toolbar. It opens the
 * plugin settings, where each note type's shared config (statuses, colors,
 * cards, relationships, archiving) lives; per-board options stay in Bases
 * "Configure view". Returns the button so the caller can remove it on unload.
 */
export function renderGearButton(parentEl: HTMLElement, onClick: () => void): HTMLElement {
    const label = 'Configure note types'
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
