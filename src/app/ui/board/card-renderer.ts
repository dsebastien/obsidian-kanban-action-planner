import type { RelationshipRole } from '../../domain/profile'
import type { CardRelationships } from '../../services/relationships.service'
import { hasAnyRelationship } from '../../services/relationships.service'
import type { KanbanCard } from './types'

export interface CardRenderCallbacks {
    /** Activate a relationship badge (navigate to / list related notes). */
    onRelationship?: (card: KanbanCard, role: RelationshipRole, event: MouseEvent) => void
}

/** Relationship roles shown as badges, in display order, with their glyph + label. */
const RELATIONSHIP_BADGES: Array<{ role: RelationshipRole; glyph: string; label: string }> = [
    { role: 'blocked_by', glyph: '⛔', label: 'Blocked by' },
    { role: 'parent', glyph: '▲', label: 'Parents' },
    { role: 'child', glyph: '▼', label: 'Children' },
    { role: 'sibling', glyph: '↔', label: 'Siblings' }
]

/**
 * Build a single card as a **detached** element (the caller appends/positions
 * it, so the incremental reconciler can reuse and move nodes).
 *
 * Driven by the card's resolved {@link KanbanCard.display}: optional cover image,
 * title (note name or a property), and configurable body fields (with the due
 * date in red). When the card has relationships it gets a badge row; a non-empty
 * `blocked_by` shows a distinct red blocked badge. `accentColor` is the resolved
 * status color for the left accent.
 */
export function renderCard(
    card: KanbanCard,
    accentColor: string,
    callbacks: CardRenderCallbacks = {}
): HTMLElement {
    const el = createDiv({ cls: 'kap-card' })
    el.dataset['cardKey'] = card.key
    el.setAttribute('role', 'listitem')
    el.setAttribute('tabindex', '0')
    el.style.setProperty('--kap-card-accent', accentColor)
    if (card.display.wrap) el.addClass('kap-card-wrap')
    if (card.relationships.blocked_by.length > 0) el.addClass('kap-card-blocked')

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

    renderRelationships(el, card, callbacks)

    return el
}

function renderRelationships(
    el: HTMLElement,
    card: KanbanCard,
    callbacks: CardRenderCallbacks
): void {
    const rels: CardRelationships = card.relationships
    if (!hasAnyRelationship(rels)) return

    const row = el.createDiv({ cls: 'kap-card-rels' })
    for (const { role, glyph, label } of RELATIONSHIP_BADGES) {
        const related = rels[role]
        if (related.length === 0) continue
        const badge = row.createEl('button', {
            cls: 'kap-card-rel',
            attr: {
                'aria-label': `${label}: ${String(related.length)}`,
                'title': `${label}: ${related.map((r) => r.label).join(', ')}`
            }
        })
        if (role === 'blocked_by') badge.addClass('kap-card-rel-blocked')
        badge.createSpan({ cls: 'kap-card-rel-glyph', text: glyph })
        badge.createSpan({ cls: 'kap-card-rel-count', text: String(related.length) })
        badge.addEventListener('click', (e) => {
            e.stopPropagation()
            callbacks.onRelationship?.(card, role, e)
        })
    }
}
