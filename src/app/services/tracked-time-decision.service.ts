import { Notice } from 'obsidian'
import type { TFile } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../plugin'
import { TrackedTimeDecisionModal } from '../ui/tracked-time-decision-modal'
import type { TrackedTimeDecisionRow } from '../ui/tracked-time-decision-modal'
import {
    computeTrackedTime,
    formatTrackedMinutes,
    linkedTimeConfigFor,
    recomputeTrackedTime,
    saveTotalTrackedTime
} from './time-tracking.service'

/**
 * The user side of business rule 79: a recompute never lowers a stored
 * tracked time on its own. Explicit recomputes ask (one modal, Keep / Drop
 * per note); background changes never write and only tell, once.
 */

/** Open the Keep / Drop modal for the rows (no-op without rows). */
function askAbout(plugin: KanbanActionPlannerPlugin, rows: TrackedTimeDecisionRow[]): void {
    if (rows.length === 0) return
    new TrackedTimeDecisionModal(plugin.app, {
        rows,
        format: (minutes) => formatTrackedMinutes(minutes, plugin.settings.minutesPerDay)
    }).open()
}

/**
 * "Recompute tracked time" on `files` (the WBS row action, the palette
 * command): every value that does not lower a stored time is written at
 * once; the notes whose stored time is above their entries and sessions
 * are listed in one modal, where the user keeps or drops each difference.
 */
export async function recomputeTrackedTimeWithDecisions(
    plugin: KanbanActionPlannerPlugin,
    files: readonly TFile[]
): Promise<void> {
    const unique = [...new Map(files.map((file) => [file.path, file])).values()]
    const rows: TrackedTimeDecisionRow[] = []
    for (const file of unique) {
        const outcome = await recomputeTrackedTime(plugin, file)
        const decision = outcome.decision
        if (!decision) {
            plugin.lowerTimeWatch.forget(file.path)
            continue
        }
        rows.push({
            title: file.basename,
            decision,
            apply: async (choice) => {
                await recomputeTrackedTime(plugin, file, choice)
                plugin.lowerTimeWatch.forget(file.path)
            }
        })
    }
    if (rows.length > 0) {
        askAbout(plugin, rows)
        return
    }
    const first = unique[0]
    new Notice(
        unique.length === 1 && first
            ? `Tracked time recomputed: ${first.basename}`
            : `Tracked time recomputed: ${unique.length} notes`
    )
}

/**
 * "Save total tracked time" (WBS row menu): writes the subtree total, or,
 * when the stored total is above it, asks keep / drop for that one row.
 */
export async function saveTotalTrackedTimeWithDecision(
    plugin: KanbanActionPlannerPlugin,
    file: TFile,
    totalMinutes: number
): Promise<void> {
    const decision = await saveTotalTrackedTime(plugin, file, totalMinutes)
    if (!decision) return
    askAbout(plugin, [
        {
            title: `${file.basename} (total with children)`,
            decision,
            apply: async (choice) => {
                await saveTotalTrackedTime(plugin, file, totalMinutes, choice)
            }
        }
    ])
}

/** The background notice, by number of notes. */
export function lowerTimeNoticeText(count: number): string {
    return count === 1
        ? '1 note holds more time than its entries and sessions: run Recompute tracked time to decide'
        : `${count} notes hold more time than their entries and sessions: run Recompute tracked time to decide`
}

/** Quiet period after the last linked-note change before checking (typing is never interrupted). */
const CHECK_DELAY_MS = 4000

/**
 * Background side of rule 79. When a linked note changes (its targets,
 * minutes or date), the targets whose type takes linked time are checked
 * after a quiet period: a target whose stored time is now above its entries
 * and sessions is NOT written; it is flagged, and ONE notice tells how many
 * notes are flagged, only when a note newly became flagged. The flagged
 * notes join the palette's "Recompute tracked time".
 */
export class LowerTimeWatch {
    private readonly plugin: KanbanActionPlannerPlugin
    private readonly pending = new Set<string>()
    private readonly flagged = new Set<string>()
    private timer: number | null = null

    constructor(plugin: KanbanActionPlannerPlugin) {
        this.plugin = plugin
    }

    /** Linked notes of these targets changed: check them once the vault is quiet. */
    note(targets: ReadonlySet<string>): void {
        for (const path of targets) this.pending.add(path)
        if (this.timer !== null) window.clearTimeout(this.timer)
        this.timer = window.setTimeout(() => {
            this.timer = null
            void this.check()
        }, CHECK_DELAY_MS)
    }

    /** The flagged notes that still exist. */
    flaggedFiles(): TFile[] {
        const files: TFile[] = []
        for (const path of this.flagged) {
            const file = this.plugin.app.vault.getFileByPath(path)
            if (file) files.push(file)
            else this.flagged.delete(path)
        }
        return files
    }

    /** The user decided (or the note no longer needs it). */
    forget(path: string): void {
        this.flagged.delete(path)
    }

    /** Stop the pending check (plugin unload). */
    dispose(): void {
        if (this.timer !== null) window.clearTimeout(this.timer)
        this.timer = null
        this.pending.clear()
    }

    /** Check the pending targets; one notice when a note newly holds more time. */
    async check(): Promise<void> {
        const paths = [...this.pending]
        this.pending.clear()
        let added = 0
        for (const path of paths) {
            const file = this.plugin.app.vault.getFileByPath(path)
            const config = file ? await linkedTimeConfigFor(this.plugin, file) : null
            const report = config ? await computeTrackedTime(this.plugin, path) : null
            if (report?.decision) {
                if (!this.flagged.has(path)) added++
                this.flagged.add(path)
            } else {
                this.flagged.delete(path)
            }
        }
        if (added > 0) new Notice(lowerTimeNoticeText(this.flagged.size), 10000)
    }
}
