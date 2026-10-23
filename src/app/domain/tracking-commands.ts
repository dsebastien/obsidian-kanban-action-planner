/**
 * Time-tracking shortcuts (issue #228): per-note "Start time tracking: <note>"
 * commands a hotkey can be bound to, and the order of the "Switch time
 * tracking to…" picker. Pure: paths in, paths out.
 *
 * A command's id is generated once and never derived from the path, because
 * Obsidian keys hotkeys by command id: the note can be renamed or archived and
 * its hotkey keeps working, only the stored path (and the command's name)
 * follow it.
 */

/** A per-note tracking command: its stable id and the note it starts. */
export interface TrackingCommand {
    id: string
    path: string
}

/** How many recently tracked notes the picker remembers. */
export const MAX_RECENT_TRACKED = 20

/** The command palette name of a note's tracking command. */
export function trackingCommandName(path: string): string {
    return `Start time tracking: ${noteBasename(path)}`
}

/** A command id not used by any existing tracking command. */
export function newTrackingCommandId(
    existing: readonly TrackingCommand[],
    random: () => number = Math.random
): string {
    const taken = new Set(existing.map((c) => c.id))
    for (;;) {
        const id = `track-${Math.floor(random() * 36 ** 8)
            .toString(36)
            .padStart(8, '0')}`
        if (!taken.has(id)) return id
    }
}

/**
 * `path` after `oldPath` was renamed to `newPath`: the note itself, or a note
 * inside a renamed folder. Null when the rename does not concern it.
 */
export function renamedPath(path: string, oldPath: string, newPath: string): string | null {
    if (path === oldPath) return newPath
    if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length)
    return null
}

/** Whether `path` is `deletedPath` or lies inside that deleted folder. */
export function isDeletedPath(path: string, deletedPath: string): boolean {
    return path === deletedPath || path.startsWith(`${deletedPath}/`)
}

/** The tracking commands after a rename, or null when none moved. */
export function renameTrackingCommands(
    commands: readonly TrackingCommand[],
    oldPath: string,
    newPath: string
): TrackingCommand[] | null {
    let changed = false
    const next = commands.map((c) => {
        const path = renamedPath(c.path, oldPath, newPath)
        if (path === null) return c
        changed = true
        return { ...c, path }
    })
    return changed ? next : null
}

/** The recent list after a rename, or null when no entry moved. */
export function renameRecentPaths(
    recent: readonly string[],
    oldPath: string,
    newPath: string
): string[] | null {
    let changed = false
    const next = recent.map((p) => {
        const path = renamedPath(p, oldPath, newPath)
        if (path === null) return p
        changed = true
        return path
    })
    return changed ? next : null
}

/** `path` moved to the front of the recent list, deduplicated and capped. */
export function pushRecentPath(
    recent: readonly string[],
    path: string,
    max: number = MAX_RECENT_TRACKED
): string[] {
    return [path, ...recent.filter((p) => p !== path)].slice(0, max)
}

/**
 * The picker's order: recently tracked notes first, then recently opened
 * ones, then every other note. Paths missing from `all` (deleted notes) are
 * dropped, and each note appears once.
 */
export function orderPickerPaths(
    recentTracked: readonly string[],
    recentOpened: readonly string[],
    all: readonly string[]
): string[] {
    const known = new Set(all)
    const seen = new Set<string>()
    const out: string[] = []
    for (const path of [...recentTracked, ...recentOpened, ...all]) {
        if (!known.has(path) || seen.has(path)) continue
        seen.add(path)
        out.push(path)
    }
    return out
}

function noteBasename(path: string): string {
    return path.replace(/^.*\//, '').replace(/\.md$/, '')
}
