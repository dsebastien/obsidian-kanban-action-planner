/**
 * Daily-note path resolution (issue #172, phase A): where a pomodoro record
 * goes. The daily note's folder and date format are read, in order, from the
 * Periodic Notes community plugin (its `daily` settings), the core Daily
 * Notes plugin's options, and finally the plugin's own fallback settings —
 * the same precedence TaskNotes applies. The format may carry folders
 * (`YYYY/MM/YYYY-MM-DD`), which is why the path is `<folder>/<formatted>.md`
 * and never `<folder>/<basename>`.
 *
 * Pure: the momentjs formatter is injected so the domain stays Obsidian-free.
 */

export interface DailyNoteSource {
    folder: string
    format: string
}

export interface DailyNoteSources {
    /** Periodic Notes plugin `daily` settings, when the plugin is enabled. */
    periodic: DailyNoteSource | null
    /** Core Daily Notes plugin options, when enabled. */
    core: DailyNoteSource | null
    /** The plugin's own settings (used when neither plugin answers). */
    fallback: DailyNoteSource
}

/** Default date format when a source leaves it blank (Obsidian's own default). */
export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD'

/** Trim slashes and collapse `//` so folder + format compose cleanly. */
function normalizeSegment(value: string): string {
    return value
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+|\/+$/g, '')
}

/** The first source with a non-blank folder or format; the fallback otherwise. */
export function pickDailyNoteSource(sources: DailyNoteSources): DailyNoteSource {
    for (const source of [sources.periodic, sources.core]) {
        if (source && (source.folder.trim() !== '' || source.format.trim() !== '')) return source
    }
    return sources.fallback
}

/**
 * The vault path of the daily note for `date` (`Folder/2026-09-09.md`; a
 * blank folder resolves to the vault root).
 */
export function dailyNotePath(
    source: DailyNoteSource,
    date: Date,
    format: (date: Date, momentFormat: string) => string
): string {
    const folder = normalizeSegment(source.folder)
    const momentFormat = source.format.trim() || DEFAULT_DAILY_NOTE_FORMAT
    const name = normalizeSegment(format(date, momentFormat))
    return `${folder ? `${folder}/` : ''}${name}.md`
}
