import type { TFile } from 'obsidian'
import type { BoardCardBase } from '../../domain/board-model'
import type { CardRelationships } from '../../services/relationships.service'

/** A single rendered field on a card. */
export interface CardFieldView {
    label: string | null
    text: string
    emphasis: 'normal' | 'due-red'
}

/** A card's due-date urgency, derived from the due property vs. today (issue #22). */
export type DueState = 'none' | 'today' | 'overdue'

/** Resolved presentation data for a card (title, fields, cover, wrapping). */
export interface CardDisplay {
    title: string
    fields: CardFieldView[]
    coverUrl: string | null
    wrap: boolean
    /** Due-date urgency for at-a-glance emphasis. */
    dueState: DueState
}

/** A card as rendered on the board: derived display data plus its note file. */
export interface KanbanCard extends BoardCardBase {
    file: TFile
    title: string
    display: CardDisplay
    /** Resolved related notes per role (blocked-by drives the blocked flag). */
    relationships: CardRelationships
}
