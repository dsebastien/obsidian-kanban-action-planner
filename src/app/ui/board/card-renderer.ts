import type { KanbanCard } from './types'

/**
 * Render a single card into a column's list element.
 *
 * Driven by the card's resolved {@link KanbanCard.display}: optional cover image,
 * title (note name or a property), and configurable body fields (with the due
 * date in red). `accentColor` is the resolved status color for the left accent.
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
    if (card.display.wrap) el.addClass('kap-card-wrap')

    if (card.display.coverUrl) {
        const cover = el.createDiv({ cls: 'kap-card-cover' })
        cover.createEl('img', {
            attr: { src: card.display.coverUrl, alt: card.display.title, loading: 'lazy' }
        })
    }

    el.createDiv({ cls: 'kap-card-title', text: card.display.title })

    if (card.display.fields.length > 0) {
        const fieldsEl = el.createDiv({ cls: 'kap-card-fields' })
        for (const field of card.display.fields) {
            const chip = fieldsEl.createDiv({ cls: 'kap-card-field' })
            if (field.emphasis === 'due-red') chip.addClass('kap-card-field-due')
            if (field.label) {
                chip.createSpan({ cls: 'kap-card-field-label', text: `${field.label}: ` })
            }
            chip.createSpan({ cls: 'kap-card-field-value', text: field.text })
        }
    }

    return el
}
