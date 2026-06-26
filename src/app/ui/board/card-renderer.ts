import type { KanbanCard } from './types'

/**
 * Render a single card into a column's list element.
 *
 * Milestone 1 shows the minimal card: the note name. Configurable title,
 * fields, cover image, and wrapping arrive in Milestone 2b (issues #3–#6).
 */
export function renderCard(listEl: HTMLElement, card: KanbanCard): HTMLElement {
    const el = listEl.createDiv({ cls: 'kap-card' })
    el.dataset['cardKey'] = card.key
    el.setAttribute('role', 'listitem')
    el.setAttribute('tabindex', '0')
    el.createDiv({ cls: 'kap-card-title', text: card.title })
    return el
}
