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
 *
 * The ideal week's rail (issue #185) groups by status ONLY, with no note-type
 * level, so a status group can hold notes of several types. It therefore
 * resolves against the DRAGGED note's own columns — see
 * {@link resolveRailStatusDrop}.
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

/**
 * Ideal-week rail drop (issue #185): dragging a rail entry onto another status
 * group's header sets that status, exactly like moving a card between columns.
 *
 * The rail has no note-type level, so the target group's raw status value may
 * belong to a DIFFERENT type than the dragged note. Resolution therefore runs
 * against the dragged note's own columns: the group's raw value when that type
 * has it, else the column whose LABEL matches the group's (statuses are
 * displayed without their `NN - ` sort prefix, so "In Progress" means the same
 * thing across types that spell the prefix differently). Nothing matches = no
 * drop, rather than writing a status the note's type does not define.
 */
export function resolveRailStatusDrop(
    source: { statusValue: string | null },
    target: { statusValue: string; label: string },
    columns: ReadonlyArray<ColumnDef>
): PaneGroupDropResolution | null {
    // The "No status" group clears the status (Unmapped semantics), like the
    // pane groups' empty target.
    if (target.statusValue === '') {
        return source.statusValue === null
            ? null
            : { statusValue: null, columnId: UNMAPPED_COLUMN_ID }
    }
    const column =
        columns.find((c) => c.statusValue === target.statusValue) ??
        columns.find((c) => c.label === target.label)
    if (!column) return null
    if (column.statusValue === source.statusValue) return null
    return { statusValue: column.statusValue, columnId: column.id }
}
