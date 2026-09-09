import type { App, TFile } from 'obsidian'
import type { ArchiveConfig } from '../domain/note-type'
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
 *
 * **Namesake folders move whole.** A note that is its folder's namesake
 * (`Foo/Foo.md`, the folder-note convention — projects with their own files;
 * a parenthesised type suffix is allowed: `Foo/Foo (Project).md`) takes the
 * folder with it: the folder is renamed into the destination, so every
 * sibling file stays with the note and links keep resolving. The folder gets
 * the collision suffix in that case, not the note.
 */

export type ArchiveResult =
    | { ok: true; destPath: string }
    | { ok: false; reason: 'no-folder' | 'collision' | 'error'; message?: string }

/** Build the current expression context (real clock + UUID generator). */
export function liveExpressionContext(): ExpressionContext {
    return {
        now: new Date(),
        uuid: () => window.crypto.randomUUID()
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
    ctx: ExpressionContext = liveExpressionContext()
): Promise<ArchiveResult> {
    return moveNoteToFolder(app, file, archive.archiveFolder, ctx)
}

/**
 * Move `file` into a placeholder-templated folder (the archive machinery,
 * reused by automation `move-to-folder` actions): resolves the template,
 * creates intermediate folders, suffixes on name collision, and moves via
 * `fileManager.renameFile` so links update. Never thrown; failures logged.
 */
export async function moveNoteToFolder(
    app: App,
    file: TFile,
    folderTemplate: string,
    ctx: ExpressionContext = liveExpressionContext()
): Promise<ArchiveResult> {
    const folder = resolveArchiveFolder(folderTemplate, ctx)
    if (folder === null) {
        log('Move: no destination folder configured; ignoring.', 'warn')
        return { ok: false, reason: 'no-folder' }
    }

    const parent = file.parent
    const plan = planMove(
        {
            path: file.path,
            name: file.name,
            basename: file.basename,
            parent:
                parent && !parent.isRoot()
                    ? {
                          path: parent.path,
                          name: parent.name,
                          parentPath: parent.parent?.path ?? ''
                      }
                    : null
        },
        folder,
        (path) => app.vault.getAbstractFileByPath(path) !== null
    )
    if (plan.kind === 'noop') return { ok: true, destPath: file.path }

    try {
        await ensureFolder(app, folder)
        if (plan.kind === 'folder' && parent) {
            await app.fileManager.renameFile(parent, plan.folderDest)
            log(`Moved folder "${plan.folderFrom}" → "${plan.folderDest}"`, 'info')
        } else {
            const from = file.path
            await app.fileManager.renameFile(file, plan.destPath)
            log(`Moved "${from}" → "${plan.destPath}"`, 'info')
        }
        return { ok: true, destPath: plan.destPath }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Move failed for "${file.path}": ${message}`, 'error', error)
        return { ok: false, reason: 'error', message }
    }
}

/** The file-system facts {@link planMove} needs (pure, no Obsidian types). */
export interface MoveSubject {
    path: string
    /** File name with extension. */
    name: string
    /** File name without extension. */
    basename: string
    /** The containing folder, or `null` at the vault root. */
    parent: { path: string; name: string; parentPath: string } | null
}

export type MovePlan =
    /** Already where it should be. */
    | { kind: 'noop' }
    /** Move the note file alone. */
    | { kind: 'file'; destPath: string }
    /** Move the note's namesake folder whole; `destPath` is the note's path after. */
    | { kind: 'folder'; folderFrom: string; folderDest: string; destPath: string }

/**
 * Plan a move into `folder` (already resolved + normalized). A note that is
 * its folder's namesake moves as that folder (siblings included); otherwise
 * the file moves alone. Name collisions get a numeric suffix (` 1`, ` 2`, …)
 * on whatever moves, so nothing is overwritten. `exists` answers whether a
 * vault path is taken.
 */
export function planMove(
    subject: MoveSubject,
    folder: string,
    exists: (path: string) => boolean
): MovePlan {
    const parent = subject.parent
    if (parent && isNamesake(subject.basename, parent.name)) {
        // Namesake folder: a self-move would suffix the folder onto itself.
        if (parent.parentPath === folder) return { kind: 'noop' }
        const folderDest = uniquePath(`${folder}/${parent.name}`, '', exists)
        return {
            kind: 'folder',
            folderFrom: parent.path,
            folderDest,
            destPath: `${folderDest}/${subject.name}`
        }
    }
    // Already in the destination folder — a self-collision would otherwise
    // rename the note onto a " 1" suffix of itself.
    if (`${folder}/${subject.name}` === subject.path) return { kind: 'noop' }
    const ext = subject.name.slice(subject.basename.length)
    const destPath = uniquePath(`${folder}/${subject.basename}`, ext, exists)
    return { kind: 'file', destPath }
}

/**
 * Whether a note named `basename` is the folder note of a folder named
 * `folderName`: the same name, or the same name plus one parenthesised suffix
 * (`Foo (Project)` in `Foo/` — the type-suffix naming convention).
 */
export function isNamesake(basename: string, folderName: string): boolean {
    if (basename === folderName) return true
    return basename.startsWith(`${folderName} (`) && basename.endsWith(')')
}

/**
 * `<base><ext>`, suffixing the base (`base 1`, `base 2`, …) while the path is
 * taken, so a move never overwrites.
 */
function uniquePath(base: string, ext: string, exists: (path: string) => boolean): string {
    let candidate = `${base}${ext}`
    let n = 1
    while (exists(candidate)) {
        candidate = `${base} ${String(n)}${ext}`
        n += 1
    }
    return candidate
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
