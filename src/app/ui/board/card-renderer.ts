import type { RelationshipRole } from '../../domain/note-type'
import type { CardRelationships } from '../../services/relationships.service'
import { hasAnyRelationship } from '../../services/relationships.service'
import type { CardCountdown, KanbanCard } from './types'

/** Append the due-countdown badge to `parent`, tagged by placement + tone (issue #62). */
function renderCountdown(parent: HTMLElement, cd: CardCountdown): void {
    parent.createSpan({
        cls: `kap-card-countdown kap-card-countdown-${cd.placement} kap-card-countdown-${cd.tone}`,
        text: cd.text
    })
}

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
    if (card.display.dueState === 'overdue') el.addClass('kap-card-overdue')
    else if (card.display.dueState === 'today') el.addClass('kap-card-due-today')
    if (card.relationships.blocked_by.length > 0) el.addClass('kap-card-blocked')

    const cd = card.display.countdown

    // Corner badge is absolutely positioned, so it renders first (anchored to the card).
    if (cd && cd.placement === 'corner') renderCountdown(el, cd)

    if (card.display.coverUrl) {
        const cover = el.createDiv({ cls: 'kap-card-cover' })
        cover.createEl('img', {
            attr: { src: card.display.coverUrl, alt: card.display.title, loading: 'lazy' }
        })
    }

    // Title row is a flex line: the title takes the slack (ellipsis), the badge
    // (placement `title`) sits right-aligned and keeps its natural width.
    const titleEl = el.createDiv({ cls: 'kap-card-title' })
    titleEl.createSpan({ cls: 'kap-card-title-text', text: card.display.title })
    if (cd && cd.placement === 'title') renderCountdown(titleEl, cd)

    const countdownAsChip = cd !== null && cd.placement === 'chip'
    if (card.display.fields.length > 0 || countdownAsChip) {
        const fieldsEl = el.createDiv({ cls: 'kap-card-fields' })
        if (cd && countdownAsChip) renderCountdown(fieldsEl, cd)
        for (const field of card.display.fields) {
            const chip = fieldsEl.createDiv({ cls: 'kap-card-field' })
            if (field.emphasis === 'due-red') chip.addClass('kap-card-field-due')
            if (field.progress !== null) chip.addClass('kap-card-field-progress')
            else if (field.tone === 'badge') chip.addClass('kap-card-field-badge')
            else if (field.tone === 'heat' && field.heat !== null) {
                chip.addClass(`kap-card-field-heat-${String(field.heat)}`)
            }
            if (field.label) {
                chip.createSpan({ cls: 'kap-card-field-label', text: `${field.label}: ` })
            }
            if (field.progress !== null) {
                const bar = chip.createDiv({ cls: 'kap-card-progress' })
                bar.createDiv({ cls: 'kap-card-progress-fill' }).style.width = `${field.progress}%`
            }
            chip.createSpan({ cls: 'kap-card-field-value', text: field.text })
        }
    }

    renderRelationships(el, card, callbacks)

    // Footer badge: a thin full-width row at the very bottom of the card.
    if (cd && cd.placement === 'footer') {
        const footer = el.createDiv({ cls: 'kap-card-footer' })
        renderCountdown(footer, cd)
    }

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
