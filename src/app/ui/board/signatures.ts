import type { Board, BoardCardBase } from '../../domain/board-model'
import type { ColorSpec, RelationshipRole } from '../../domain/note-type'
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
    card: { display: CardDisplay; relationships: CardRelationships; deferred?: boolean },
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
        card.deferred ? 'D' : '',
        cd,
        fields,
        rels,
        accent
    ].join('§')
}

/** A deterministic content key for a {@link ColorSpec} (accent proxy). */
function colorKey(color: ColorSpec): string {
    return color.kind === 'hex' ? `h:${color.value}` : `p:${color.token}`
}

/**
 * A signature of EVERYTHING a board-mode render pass draws (issue #105 render
 * gate): the lane/column structure, lane labels + card counts, column labels /
 * status values / colors / WIP limits, the collapse state of every lane and
 * column, and each card's rendered content signature in its exact position.
 * Two boards with equal signatures produce pixel-identical board DOM, so the
 * view can skip the whole render pass (and its side effects) when the
 * signature matches the previous completed pass.
 */
export function boardRenderSignature<
    T extends BoardCardBase & { display: CardDisplay; relationships: CardRelationships }
>(
    board: Board<T>,
    collapsedLanes: ReadonlySet<string>,
    collapsedColumns: ReadonlySet<string>
): string {
    const lanes = board.lanes
        .map((lane) => {
            const cols = lane.columns
                .map(({ column, cards }) => {
                    const accent = colorKey(column.color)
                    const cardsSig = cards
                        .map((c) => `${c.key}#${cardSignature(c, accent)}`)
                        .join('¦')
                    return [
                        column.id,
                        column.label,
                        column.statusValue,
                        accent,
                        column.wipLimit === undefined ? '' : String(column.wipLimit),
                        collapsedColumns.has(column.id) ? 'c' : '',
                        cardsSig
                    ].join('^')
                })
                .join('|')
            return [
                lane.lane.id,
                lane.lane.label,
                String(lane.cardCount),
                collapsedLanes.has(lane.lane.id) ? 'c' : '',
                cols
            ].join('^')
        })
        .join('\n')
    return `${structureSignature(board)}\n${lanes}`
}

/**
 * Compose an ordered list of render inputs into one deterministic signature
 * string (issue #105 render gate). Callers must pass JSON-serializable values
 * only — convert `Map`/`Set` to sorted arrays first (JSON.stringify silently
 * turns them into `{}`, which would blind the gate to their changes).
 */
export function renderPassSignature(parts: readonly unknown[]): string {
    return JSON.stringify(parts)
}

/** Section separator for {@link composeCardsSignature}. */
const SIGNATURE_SECTION_SEP = String.fromCharCode(0x00)
/** Per-card record separator for {@link composeCardsSignature}. */
const SIGNATURE_RECORD_SEP = String.fromCharCode(0x1e)

/**
 * Compose a render-pass signature from a small header plus one already-
 * `JSON.stringify`'d entry per card, WITHOUT re-stringifying the entries
 * (issue #110, item 2). The old nested form `JSON.stringify([...header,
 * cards])` escaped each card's frontmatter JSON a SECOND time — linear in
 * total frontmatter bytes on every gated calendar/timeline pass. Here each
 * card is stringified once and the parts are joined with control-char
 * separators; `JSON.stringify` always escapes those control chars inside the
 * entries, so the join can never be forged by card content (collision-safe).
 */
export function composeCardsSignature(
    header: readonly unknown[],
    perCard: readonly string[]
): string {
    return JSON.stringify(header) + SIGNATURE_SECTION_SEP + perCard.join(SIGNATURE_RECORD_SEP)
}
