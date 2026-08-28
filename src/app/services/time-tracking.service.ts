import { Notice } from 'obsidian'
import { produce } from 'immer'
import { formatDuration } from '../domain/estimate'
import { coerceOrder, getFrontmatterValue, setProperty } from './frontmatter.service'
import type { KanbanActionPlannerPlugin } from '../plugin'

/**
 * Time tracking (issue #119): a single start/stop session accumulating tracked
 * minutes into the configured duration property. Only ONE session runs at a
 * time (starting a card while another is tracked stops that one first, writing
 * its elapsed minutes). The active session persists in the plugin settings so
 * a restart mid-session loses nothing — elapsed time is derived from the
 * stored epoch start, never from a timer.
 */

/** Elapsed whole minutes of a session, at least 1 (a tracked tap still counts). */
export function elapsedSessionMinutes(startedAt: number, now: number): number {
    return Math.max(1, Math.round((now - startedAt) / 60000))
}

/** Tracked minutes formatted with the estimate display grammar ("1h 30m"). */
export function formatTrackedMinutes(minutes: number, minutesPerDay: number): string {
    const perDay = minutesPerDay > 0 ? minutesPerDay : 1
    return formatDuration(minutes / perDay, perDay)
}

/** A note's own tracked minutes (the duration property), or null when unset. */
export function readDurationMinutes(raw: unknown): number | null {
    const value = coerceOrder(raw)
    return value !== null && value > 0 ? value : null
}

/** Whether the active session (if any) tracks this path. */
export function isTrackingPath(plugin: KanbanActionPlannerPlugin, path: string): boolean {
    return plugin.settings.activeTimeSession?.path === path
}

/**
 * Start tracking `path`. An active session on another note is stopped first
 * (its elapsed minutes are written); starting the already-tracked path is a
 * no-op.
 */
export async function startTimeSession(
    plugin: KanbanActionPlannerPlugin,
    path: string
): Promise<void> {
    if (isTrackingPath(plugin, path)) return
    await stopTimeSession(plugin)
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activeTimeSession = { path, startedAt: Date.now() }
    })
    await plugin.saveSettings('cards')
    new Notice(`Time tracking started: ${basename(path)}`)
}

/**
 * Stop the active session (if any), adding its elapsed minutes to the tracked
 * note's duration property. A session whose note no longer exists is
 * discarded with a notice instead of throwing.
 */
export async function stopTimeSession(plugin: KanbanActionPlannerPlugin): Promise<void> {
    const session = plugin.settings.activeTimeSession
    if (!session) return
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.activeTimeSession = null
    })
    const file = plugin.app.vault.getFileByPath(session.path)
    if (!file) {
        await plugin.saveSettings('cards')
        new Notice(`Time tracking stopped — note not found: ${session.path}`)
        return
    }
    const property = plugin.settings.defaultDurationProperty
    const elapsed = elapsedSessionMinutes(session.startedAt, Date.now())
    const current = readDurationMinutes(getFrontmatterValue(plugin.app, file, property)) ?? 0
    const total = current + elapsed
    await setProperty(plugin.app, file, property, total)
    await plugin.saveSettings('cards')
    const perDay = plugin.settings.minutesPerDay
    new Notice(
        `Time tracking stopped: ${basename(session.path)} — ` +
            `${formatTrackedMinutes(elapsed, perDay)} (total ${formatTrackedMinutes(total, perDay)})`
    )
}

/** The note's display basename (path without folders and extension). */
function basename(path: string): string {
    const name = path.split('/').pop() ?? path
    return name.replace(/\.md$/, '')
}
