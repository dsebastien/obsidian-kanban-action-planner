import type { App, TFile } from 'obsidian'
import type { ArchiveConfig } from '../domain/profile'
import { resolvePlaceholders, type ExpressionContext } from '../utils/expressions'
import { log } from '../../utils/log'

/**
 * Archiving: move a card's note into a configurable, placeholder-driven folder.
 *
 * The folder template may contain `{{year}}`, `{{month}}`, `{{week}}`,
 * `{{quarter}}`, `{{day}}`, `{{date}}`, `{{datetime}}`, `{{uuid}}` (see
 * {@link resolvePlaceholders}). Intermediate folders are created on demand and
 * the move goes through `fileManager.renameFile` so links update. The note then
 * leaves the board (it no longer matches the Base filter once moved).
 */

export type ArchiveResult =
    | { ok: true; destPath: string }
    | { ok: false; reason: 'no-folder' | 'collision' | 'error'; message?: string }

/** Build the current expression context (real clock + UUID generator). */
export function archiveContext(): ExpressionContext {
    return {
        now: new Date(),
        uuid: () => globalThis.crypto.randomUUID()
    }
}

/**
 * Resolve a folder template to a normalized, vault-relative folder path, or
 * `null` when the template is blank (archiving disabled).
 */
export function resolveArchiveFolder(template: string, ctx: ExpressionContext): string | null {
    const resolved = normalizeFolderPath(resolvePlaceholders(template, ctx))
    return resolved.length > 0 ? resolved : null
}

/** Collapse separators, trim slashes/whitespace; `''` for an empty folder. */
export function normalizeFolderPath(path: string): string {
    return path
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .join('/')
}

/**
 * Move `file` into the resolved archive folder. Creates intermediate folders,
 * resolves name collisions with a numeric suffix, and updates links. Guarded:
 * every failure is logged and reported, never thrown.
 */
export async function archiveNote(
    app: App,
    file: TFile,
    archive: ArchiveConfig,
    ctx: ExpressionContext = archiveContext()
): Promise<ArchiveResult> {
    const folder = resolveArchiveFolder(archive.archiveFolder, ctx)
    if (folder === null) {
        log('Archive: no archive folder configured; ignoring.', 'warn')
        return { ok: false, reason: 'no-folder' }
    }

    try {
        await ensureFolder(app, folder)
        const destPath = uniqueDestPath(app, folder, file)
        await app.fileManager.renameFile(file, destPath)
        log(`Archived "${file.path}" → "${destPath}"`, 'info')
        return { ok: true, destPath }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Archive failed for "${file.path}": ${message}`, 'error', error)
        return { ok: false, reason: 'error', message }
    }
}

/** Create every segment of `folder` that doesn't already exist. */
async function ensureFolder(app: App, folder: string): Promise<void> {
    const segments = folder.split('/')
    let current = ''
    for (const segment of segments) {
        current = current.length > 0 ? `${current}/${segment}` : segment
        if (app.vault.getFolderByPath(current)) continue
        try {
            await app.vault.createFolder(current)
        } catch {
            // Created concurrently or already exists — ignore and continue.
        }
    }
}

/**
 * `<folder>/<name>`, suffixing the basename (`note 1.md`, `note 2.md`, …) when
 * a file already lives at the target path so an archive never overwrites.
 */
function uniqueDestPath(app: App, folder: string, file: TFile): string {
    const ext = file.extension ? `.${file.extension}` : ''
    const base = file.basename
    let candidate = `${folder}/${base}${ext}`
    let n = 1
    while (app.vault.getAbstractFileByPath(candidate)) {
        candidate = `${folder}/${base} ${String(n)}${ext}`
        n += 1
    }
    return candidate
}
