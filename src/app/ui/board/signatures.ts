import type { Board, BoardCardBase } from '../../domain/board-model'
import type { RelationshipRole } from '../../domain/note-type'
import type { CardRelationships } from '../../services/relationships.service'
import type { CardDisplay } from './types'

/**
 * Pure render signatures that drive the incremental board patch (M6). The
 * renderer compares these strings to decide what to reuse vs. rebuild:
 *
 * - {@link structureSignature} captures the board's lane/column **shape**; when
 *   it is unchanged the renderer patches in place, otherwise it full-renders.
 * - {@link cardSignature} captures everything that affects a card's rendered
 *   **content + accent**; an unchanged signature lets a card keep its exact DOM
 *   node (so scroll/focus/in-flight drag survive).
 *
 * Kept pure (no DOM, no Obsidian) so the reconcile decisions are unit-testable.
 */

/** A stable signature of the board's lane/column shape (not card contents). */
export function structureSignature<T extends BoardCardBase>(board: Board<T>): string {
    const lanes = board.lanes
        .map((l) => `${l.lane.id}:${l.columns.map((c) => c.column.id).join(',')}`)
        .join(';')
    return `${board.isMultiLane ? 'M' : 'S'}|${lanes}`
}

/** A signature of everything that affects a card's rendered content + accent. */
export function cardSignature(
    card: { display: CardDisplay; relationships: CardRelationships },
    accent: string
): string {
    const d = card.display
    const fields = d.fields
        .map((f) => `${f.label ?? ''}|${f.text}|${f.emphasis ?? ''}|${f.tone}|${String(f.heat)}`)
        .join('~')
    const roles: RelationshipRole[] = ['blocked_by', 'parent', 'child', 'sibling']
    const rels = roles
        .map((r) => `${r}:${card.relationships[r].map((x) => x.key).join(',')}`)
        .join(';')
    const cd = d.countdown ? `${d.countdown.text}|${d.countdown.tone}|${d.countdown.placement}` : ''
    return [
        d.title,
        d.wrap ? 'w' : '',
        d.coverUrl ?? '',
        d.dueState,
        cd,
        fields,
        rels,
        accent
    ].join('§')
}
