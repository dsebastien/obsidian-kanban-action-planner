import type { ResolvedDoneConfig } from './done'
import { isDoneValue } from './done'
import { doneIsStatusBased } from './automation'

/**
 * Whether a column offers the header **Archive** button: its status value is
 * one of the note type's done values (a STATUS-BASED done definition — the
 * done property is the status property, so the column itself means "done"),
 * and the type has an archive folder configured. The synthetic Unmapped
 * column (`statusValue` null) never qualifies.
 */
export function columnArchivable(
    statusValue: string | null,
    done: ResolvedDoneConfig | null,
    statusProperty: string,
    archiveFolder: string
): boolean {
    if (statusValue === null || statusValue.trim().length === 0) return false
    if (archiveFolder.trim().length === 0) return false
    if (!done || done.values.length === 0) return false
    if (!doneIsStatusBased(done, statusProperty)) return false
    return isDoneValue(statusValue, done.values)
}
