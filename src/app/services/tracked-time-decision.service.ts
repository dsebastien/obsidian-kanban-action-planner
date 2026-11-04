import { Notice } from 'obsidian'
import type { TFile } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../plugin'
import { lowerDecision } from '../domain/tracked-time-decision'
import { TrackedTimeDecisionModal } from '../ui/tracked-time-decision-modal'
import type { TrackedTimeDecisionRow } from '../ui/tracked-time-decision-session'
import { getFrontmatterValue } from './frontmatter.service'
import {
    computeTrackedTime,
    formatTrackedMinutes,
    linkedTimeConfigFor,
    recomputeTrackedTime,
    saveTotalTrackedTime,
    trackingPropertiesFor
} from './time-tracking.service'

/**
 * The user side of business rule 79: a recompute never lowers a stored
 * tracked duration on its own. Explicit recomputes ask (one modal, Keep /
 * Drop per note); background changes never write and only tell, once.
 */

/** Open the Keep / Drop modal for the rows (no-op without rows). */
function askAbout(plugin: KanbanActionPlannerPlugin, rows: TrackedTimeDecisionRow[]): void {
    if (rows.length === 0) return
    new TrackedTimeDecisionModal(plugin.app, {
        rows,
        format: (minutes) => formatTrackedMinutes(minutes, plugin.settings.minutesPerDay)
    }).open()
}

/** The notice after an explicit recompute that asked nothing. */
export function recomputeNoticeText(notes: readonly string[], changed: number): string {
    if (changed === 0) {
        return notes.length === 1
            ? `Tracked time of ${notes[0] ?? ''}: nothing to change`
            : `Tracked time of ${notes.length} notes: nothing to change`
    }
    return notes.length === 1
        ? `Tracked time recomputed: ${notes[0] ?? ''}`
        : `Tracked time recomputed: ${changed} of ${notes.length} notes changed`
}

/**
 * "Recompute tracked time" on `files` (the WBS row action, the palette
 * command): every value that does not lower a stored duration is written at
 * once; the notes whose stored duration is above their entries and
 * sessions are listed in one modal, where the user keeps or drops each
 * difference. Without anything to decide, one notice says what happened.
 */
export async function recomputeTrackedTimeWithDecisions(
    plugin: KanbanActionPlannerPlugin,
    files: readonly TFile[]
): Promise<void> {
    const unique = [...new Map(files.map((file) => [file.path, file])).values()]
    const rows: TrackedTimeDecisionRow[] = []
    let changed = 0
    for (const file of unique) {
        const outcome = await recomputeTrackedTime(plugin, file)
        if (outcome.changed) changed++
        const decision = outcome.decision
        if (!decision) {
            plugin.lowerTimeWatch.forget(file.path)
            continue
        }
        rows.push({
            title: file.basename,
            decision,
            apply: async (choice) => {
                const applied = await recomputeTrackedTime(plugin, file, choice)
                // Still open after a choice: the entry could not be stored.
                if (applied.decision) throw new Error('Manual adjustment not stored')
                plugin.lowerTimeWatch.forget(file.path)
                return { minutes: applied.minutes, adjusted: applied.adjusted }
            },
            refresh: async () => (await computeTrackedTime(plugin, file.path))?.decision ?? null
        })
    }
    if (rows.length > 0) {
        if (changed > 0)
            new Notice(
                recomputeNoticeText(
                    unique.map((f) => f.basename),
                    changed
                )
            )
        askAbout(plugin, rows)
        return
    }
    new Notice(
        recomputeNoticeText(
            unique.map((f) => f.basename),
            changed
        )
    )
}

/** The stored subtree total's decision against the total computed NOW (null = nothing to decide). */
async function totalDecision(
    plugin: KanbanActionPlannerPlugin,
    file: TFile,
    total: () => number | null
): Promise<ReturnType<typeof lowerDecision>> {
    const minutes = total()
    if (minutes === null) return null
    const properties = await trackingPropertiesFor(plugin, file)
    return lowerDecision(getFrontmatterValue(plugin.app, file, properties.totalDuration), minutes)
}

/**
 * "Save total tracked time" (WBS row menu): writes the subtree total, or,
 * when the stored total is above it, asks keep / drop for that one row.
 * `total` is evaluated again at click time, so the choice applies to the
 * subtree as it is then.
 */
export async function saveTotalTrackedTimeWithDecision(
    plugin: KanbanActionPlannerPlugin,
    file: TFile,
    total: () => number | null
): Promise<void> {
    const minutes = total()
    if (minutes === null) return
    const outcome = await saveTotalTrackedTime(plugin, file, minutes)
    const decision = outcome.decision
    if (!decision) return
    askAbout(plugin, [
        {
            title: `${file.basename} (total with children)`,
            decision,
            apply: async (choice) => {
                const now = total()
                if (now === null) return { minutes: null, adjusted: 0 }
                const applied = await saveTotalTrackedTime(plugin, file, now, choice)
                if (applied.decision) throw new Error('Manual adjustment not stored')
                return { minutes: applied.minutes, adjusted: applied.adjusted }
            },
            refresh: () => totalDecision(plugin, file, total)
        }
    ])
}

/** The background notice, by number of notes. */
export function lowerTimeNoticeText(count: number): string {
    return count === 1
        ? '1 note holds more time than its entries and sessions: run Recompute tracked time to decide'
        : `${count} notes hold more time than their entries and sessions: run Recompute tracked time to decide`
}

/** Quiet period after the last change before checking (typing is never interrupted). */
export const LOWER_CHECK_DELAY_MS = 4000

/** Timers and notice of the watch (injected by specs). */
export interface LowerTimeWatchDeps {
    setTimer: (run: () => void, ms: number) => number
    clearTimer: (id: number) => void
    notify: (text: string) => void
}

const defaultDeps: LowerTimeWatchDeps = {
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (id) => window.clearTimeout(id),
    notify: (text) => new Notice(text, 10000)
}

/**
 * Background side of rule 79. When a linked note changes (its targets,
 * minutes or date), or a flagged note itself changes, the notes are checked
 * after a quiet period: a note whose type takes linked time and whose stored
 * duration is now above its entries and sessions is NOT written; it is
 * flagged, and ONE notice tells how many notes are flagged, only when a note
 * newly became flagged. The flagged notes join the palette's "Recompute
 * tracked time". A rename moves the flag; nothing runs after unload.
 */
export class LowerTimeWatch {
    private readonly plugin: KanbanActionPlannerPlugin
    private readonly deps: LowerTimeWatchDeps
    private readonly pending = new Set<string>()
    private readonly flagged = new Set<string>()
    private timer: number | null = null
    private disposed = false
    /** The check running now, and whether notes arrived during it. */
    private running: Promise<void> | null = null
    private again = false

    constructor(plugin: KanbanActionPlannerPlugin, deps: LowerTimeWatchDeps = defaultDeps) {
        this.plugin = plugin
        this.deps = deps
    }

    /** These notes may have changed: check them once the vault is quiet. */
    note(paths: Iterable<string>): void {
        if (this.disposed) return
        for (const path of paths) this.pending.add(path)
        if (this.pending.size === 0) return
        if (this.timer !== null) this.deps.clearTimer(this.timer)
        this.timer = this.deps.setTimer(() => {
            this.timer = null
            void this.check()
        }, LOWER_CHECK_DELAY_MS)
    }

    /** A note changed: re-check it when it is flagged (a hand edit may settle it). */
    noteChanged(path: string): void {
        if (this.flagged.has(path)) this.note([path])
    }

    /** A note moved: its flag (and pending check) follows it. */
    rename(oldPath: string, newPath: string): void {
        if (this.flagged.delete(oldPath)) this.flagged.add(newPath)
        if (this.pending.delete(oldPath)) this.pending.add(newPath)
    }

    /** Whether the note is flagged. */
    isFlagged(path: string): boolean {
        return this.flagged.has(path)
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

    /** Stop for good (plugin unload): no pending check, no notice. */
    dispose(): void {
        this.disposed = true
        if (this.timer !== null) this.deps.clearTimer(this.timer)
        this.timer = null
        this.pending.clear()
    }

    /**
     * Check the pending notes; one notice when a note newly holds more time.
     * One run at a time: a call during a run returns that run, which goes
     * round once more for the notes that arrived meanwhile.
     */
    check(): Promise<void> {
        if (this.running) {
            this.again = true
            return this.running
        }
        const run = async (): Promise<void> => {
            try {
                do {
                    this.again = false
                    await this.checkOnce()
                } while (this.again && !this.disposed)
            } finally {
                this.running = null
            }
        }
        this.running = run()
        return this.running
    }

    private async checkOnce(): Promise<void> {
        const paths = [...this.pending]
        this.pending.clear()
        let added = 0
        for (const path of paths) {
            if (this.disposed) return
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
        if (added > 0 && !this.disposed) this.deps.notify(lowerTimeNoticeText(this.flagged.size))
    }
}
