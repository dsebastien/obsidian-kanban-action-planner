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

/** Set a frontmatter property, reusing an existing differently-cased key. */
export async function setProperty(
    app: App,
    file: TFile,
    propertyName: string,
    value: unknown
): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
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
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const [name, value] of Object.entries(properties)) {
            const key = findKeyCaseInsensitive(fm, name) ?? name
            fm[key] = value
        }
    })
}

/** Delete a frontmatter property (case-insensitive); used to clear a value. */
export async function deleteProperty(app: App, file: TFile, propertyName: string): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName)
        if (key !== null) delete fm[key]
    })
}

/**
 * Append one entry to a list property (scalar values are promoted to a list;
 * the entry is deduped). Used by the timeline's milestone creation (issue #77).
 */
export async function appendToListProperty(
    app: App,
    file: TFile,
    propertyName: string,
    entry: string
): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName) ?? propertyName
        const raw = fm[key]
        const list = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]
        if (!list.includes(entry)) list.push(entry)
        fm[key] = list
    })
}

/**
 * Remove one entry (exact match) from a list property; the property is deleted
 * when the list empties. Scalars equal to `entry` are removed the same way.
 */
export async function removeFromListProperty(
    app: App,
    file: TFile,
    propertyName: string,
    entry: string
): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName)
        if (key === null) return
        const raw = fm[key]
        const list = Array.isArray(raw) ? raw : [raw]
        const kept = list.filter((item) => item !== entry)
        if (kept.length === 0) delete fm[key]
        else fm[key] = kept
    })
}
