import type { App, TFile } from 'obsidian'

/**
 * Frontmatter read/write.
 *
 * Reads come from the metadata cache (raw, lossless JS values); writes go
 * through `app.fileManager.processFrontMatter`. Property lookups are
 * case-insensitive, and writes reuse an existing differently-cased key so we
 * never create duplicate properties.
 */

/** Find the actual key in `obj` matching `name` case-insensitively, or null. */
export function findKeyCaseInsensitive(
    obj: Record<string, unknown> | null | undefined,
    name: string
): string | null {
    if (!obj) return null
    if (name in obj) return name
    const lower = name.toLowerCase()
    for (const key of Object.keys(obj)) {
        if (key.toLowerCase() === lower) return key
    }
    return null
}

/** Coerce a raw frontmatter value to a finite number, or null. */
export function coerceOrder(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    if (typeof raw === 'string' && raw.trim() !== '') {
        const n = Number(raw)
        return Number.isFinite(n) ? n : null
    }
    return null
}

/** Read a frontmatter value by property name (case-insensitive). */
export function getFrontmatterValue(app: App, file: TFile, propertyName: string): unknown {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter
    if (!fm) return undefined
    const key = findKeyCaseInsensitive(fm, propertyName)
    return key === null ? undefined : fm[key]
}

/**
 * In-flight frontmatter writes by file path. Two `processFrontMatter` calls
 * that overlap on the SAME file lose the earlier one: each reads the note,
 * edits, and writes back, so the later read predates the earlier write
 * (observed live — a concurrent property write reverted a card move). Every
 * write here is chained behind the previous one on its path, so the plugin's
 * own writes never overlap, whatever paths they come from (a drop while an
 * automation or a triage write on the same note is still in flight).
 */
const writeQueues = new Map<string, Promise<void>>()

/** Run `write` after every earlier queued write to `file` has finished. */
export function queueFrontmatterWrite(file: TFile, write: () => Promise<void>): Promise<void> {
    const path = file.path
    const previous = writeQueues.get(path)
    // An idle file starts writing at once (as a bare `processFrontMatter`
    // would). A failed predecessor must not poison the chain: it is
    // swallowed here (the caller that queued it still sees its own rejection).
    const next = previous ? previous.then(write, write) : write()
    writeQueues.set(path, next)
    const forget = (): void => {
        if (writeQueues.get(path) === next) writeQueues.delete(path)
    }
    next.then(forget, forget)
    return next
}

/** `processFrontMatter` serialized per file (see {@link queueFrontmatterWrite}). */
function processFrontMatter(
    app: App,
    file: TFile,
    fn: (fm: Record<string, unknown>) => void
): Promise<void> {
    return queueFrontmatterWrite(file, () => app.fileManager.processFrontMatter(file, fn))
}

/** Set a frontmatter property, reusing an existing differently-cased key. */
export async function setProperty(
    app: App,
    file: TFile,
    propertyName: string,
    value: unknown
): Promise<void> {
    await processFrontMatter(app, file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName) ?? propertyName
        fm[key] = value
    })
}

/**
 * Set several frontmatter properties in ONE `processFrontMatter` transaction
 * (each reusing an existing differently-cased key). Used where two sequential
 * {@link setProperty} calls would double-rebuild the board and leave a torn
 * intermediate state on disk (the timeline's left-handle resize writes the
 * start date and the estimate together).
 */
export async function setProperties(
    app: App,
    file: TFile,
    properties: Record<string, unknown>
): Promise<void> {
    await processFrontMatter(app, file, (fm: Record<string, unknown>) => {
        for (const [name, value] of Object.entries(properties)) {
            const key = findKeyCaseInsensitive(fm, name) ?? name
            fm[key] = value
        }
    })
}

/** Delete a frontmatter property (case-insensitive); used to clear a value. */
export async function deleteProperty(app: App, file: TFile, propertyName: string): Promise<void> {
    await processFrontMatter(app, file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName)
        if (key !== null) delete fm[key]
    })
}

/**
 * Append one entry to a list property (scalar values are promoted to a list;
 * the entry is deduped). Used by the timeline's milestone creation (issue #77).
 * `matches` overrides the dedupe equality (default: exact) — tags dedupe
 * case-insensitively via it.
 */
export async function appendToListProperty(
    app: App,
    file: TFile,
    propertyName: string,
    entry: string,
    matches: (item: unknown) => boolean = (item) => item === entry
): Promise<void> {
    await processFrontMatter(app, file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName) ?? propertyName
        const raw = fm[key]
        const list = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]
        if (!list.some(matches)) list.push(entry)
        fm[key] = list
    })
}

/**
 * Replace one entry (exact match) of a list property IN PLACE — the entry
 * keeps its position, unlike a remove + append round-trip. Scalars equal to
 * `entry` are replaced the same way. A miss is a no-op (the entry may have
 * been edited externally mid-gesture). Used by milestone drags.
 */
export async function replaceInListProperty(
    app: App,
    file: TFile,
    propertyName: string,
    entry: string,
    replacement: string
): Promise<void> {
    await processFrontMatter(app, file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName)
        if (key === null) return
        const raw = fm[key]
        if (Array.isArray(raw)) {
            const index = raw.indexOf(entry)
            if (index >= 0) raw[index] = replacement
            return
        }
        if (raw === entry) fm[key] = replacement
    })
}

/**
 * Remove one entry (exact match by default; override via `matches`) from a
 * list property; the property is deleted when the list empties. Scalars equal
 * to `entry` are removed the same way. A missing/empty (`null`) property is a
 * no-op — promoting it to `[null]` would corrupt it.
 */
export async function removeFromListProperty(
    app: App,
    file: TFile,
    propertyName: string,
    entry: string,
    matches: (item: unknown) => boolean = (item) => item === entry
): Promise<void> {
    await processFrontMatter(app, file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName)
        if (key === null) return
        const raw = fm[key]
        if (raw === null || raw === undefined) return
        const list = Array.isArray(raw) ? raw : [raw]
        const kept = list.filter((item) => !matches(item))
        if (kept.length === 0) delete fm[key]
        else fm[key] = kept
    })
}
