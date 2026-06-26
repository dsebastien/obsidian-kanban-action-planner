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

/** Delete a frontmatter property (case-insensitive); used to clear a value. */
export async function deleteProperty(app: App, file: TFile, propertyName: string): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const key = findKeyCaseInsensitive(fm, propertyName)
        if (key !== null) delete fm[key]
    })
}
