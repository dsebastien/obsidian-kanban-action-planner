import type { TFile } from 'obsidian'
import type { BoardCardBase } from '../../domain/board-model'

/** A card as rendered on the board: derived display data plus its note file. */
export interface KanbanCard extends BoardCardBase {
    file: TFile
    title: string
}
