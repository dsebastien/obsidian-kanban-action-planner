import type { TFile } from 'obsidian'
import type { BoardCardBase } from '../../domain/board-model'
import type { CardRelationships } from '../../services/relationships.service'

/** A single rendered field on a card. */
export interface CardFieldView {
    label: string | null
    text: string
    emphasis: 'normal' | 'due-red'
}

/** Resolved presentation data for a card (title, fields, cover, wrapping). */
export interface CardDisplay {
    title: string
    fields: CardFieldView[]
    coverUrl: string | null
    wrap: boolean
}

/** A card as rendered on the board: derived display data plus its note file. */
export interface KanbanCard extends BoardCardBase {
    file: TFile
    title: string
    display: CardDisplay
    /** Resolved related notes per role (blocked-by drives the blocked flag). */
    relationships: CardRelationships
}
