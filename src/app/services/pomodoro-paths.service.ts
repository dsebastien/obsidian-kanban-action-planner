import type { KanbanActionPlannerPlugin } from '../plugin'
import { renamePomodoroTaskPaths, type PathRename } from '../domain/pomodoro'
import {
    findKeyCaseInsensitive,
    readFrontmatterKey,
    updateFrontmatter
} from './frontmatter.service'
import { log } from '../../utils/log'

/**
 * Pomodoro records follow renames (issue #231). A record names its note by a
 * plain vault path (`taskPath`, TaskNotes' shape), which Obsidian does not
 * update on a rename or move. So renames are collected for a short while (a
 * folder move or a bulk rename fires one event per note) and then every note
 * whose pomodoro list names an old path gets those paths rewritten, in one
 * frontmatter write per note, read from disk inside the write. Records
 * written by TaskNotes are the same ledger and follow too.
 */

/** How long renames are collected before the notes are rewritten (ms). */
export const POMODORO_RENAME_DEBOUNCE_MS = 1000

export function registerPomodoroPathFollow(plugin: KanbanActionPlannerPlugin): void {
    let pending: PathRename[] = []
    let timer: number | null = null
    const flush = (): void => {
        timer = null
        const batch = pending
        pending = []
        void rewritePomodoroPaths(plugin, batch)
    }
    plugin.registerEvent(
        plugin.app.vault.on('rename', (file, oldPath) => {
            if (oldPath === file.path) return
            pending.push({ from: oldPath, to: file.path })
            if (timer !== null) window.clearTimeout(timer)
            timer = window.setTimeout(flush, POMODORO_RENAME_DEBOUNCE_MS)
        })
    )
    plugin.register(() => {
        if (timer !== null) window.clearTimeout(timer)
    })
}

/** Rewrite the pomodoro records of every note that names a renamed path. */
export async function rewritePomodoroPaths(
    plugin: KanbanActionPlannerPlugin,
    renames: ReadonlyArray<PathRename>
): Promise<number> {
    if (renames.length === 0) return 0
    const property = plugin.settings.pomodorosProperty
    const { app } = plugin
    let rewritten = 0
    for (const file of app.vault.getMarkdownFiles()) {
        const cached = app.metadataCache.getFileCache(file)?.frontmatter
        if (renamePomodoroTaskPaths(readFrontmatterKey(cached, property), renames) === null) {
            continue
        }
        // The file may itself have moved since the cache was read.
        if (app.vault.getFileByPath(file.path) === null) continue
        try {
            await updateFrontmatter(app, file, (fm) => {
                const key = findKeyCaseInsensitive(fm, property)
                if (key === null) return
                const next = renamePomodoroTaskPaths(fm[key], renames)
                if (next) fm[key] = next
            })
            rewritten++
        } catch (error: unknown) {
            log(`Pomodoro paths not updated in "${file.path}".`, 'error', error)
        }
    }
    if (rewritten > 0)
        log(`Pomodoro records updated after a rename in ${String(rewritten)} note(s).`, 'info')
    return rewritten
}
