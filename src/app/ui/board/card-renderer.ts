import type { KanbanCard } from './types'

/**
 * Render a single card into a column's list element.
 *
 * `accentColor` is a resolved CSS color used for the card's status accent
 * (left border). Milestone 1 shows the note name; configurable title, fields,
 * cover image, and wrapping are added in a later milestone.
 */
export function renderCard(
    listEl: HTMLElement,
    card: KanbanCard,
    accentColor: string
): HTMLElement {
    const el = listEl.createDiv({ cls: 'kap-card' })
    el.dataset['cardKey'] = card.key
    el.setAttribute('role', 'listitem')
    el.setAttribute('tabindex', '0')
    el.style.setProperty('--kap-card-accent', accentColor)
    el.createDiv({ cls: 'kap-card-title', text: card.title })
    return el
}
