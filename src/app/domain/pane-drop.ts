/**
 * Pane-group drop resolution — pure, unit-tested.
 *
 * The scheduling panels (calendar / timeline / WBS) group their cards by note
 * type → status. Dragging a pane card onto ANOTHER status group of the same
 * type sets that status — the same effect as the card menu's "Set status"
 * items. This resolves whether such a drop commits, and to what:
 *
 * - Cross-type drops never commit (each type has its own status vocabulary).
 * - Dropping on the card's current group is a no-op.
 * - The "No status" group ('' status) clears the status (Unmapped semantics).
 * - Any other target must resolve to one of the card's own columns — a raw
 *   unmapped status value is not a valid destination.
 */

import { UNMAPPED_COLUMN_ID } from '../constants'
import type { ColumnDef } from './note-type'

export interface PaneGroupDropResolution {
    statusValue: string | null
    columnId: string
}

export function resolvePaneGroupDrop(
    source: { typeId: string; statusValue: string | null },
    target: { typeId: string; status: string },
    columns: ReadonlyArray<ColumnDef>
): PaneGroupDropResolution | null {
    if (source.typeId !== target.typeId) return null
    if ((source.statusValue ?? '') === target.status) return null
    if (target.status === '') return { statusValue: null, columnId: UNMAPPED_COLUMN_ID }
    const column = columns.find((c) => c.statusValue === target.status)
    return column ? { statusValue: column.statusValue, columnId: column.id } : null
}
