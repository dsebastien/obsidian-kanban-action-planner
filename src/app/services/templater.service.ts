import { TFile, TFolder, normalizePath } from 'obsidian'
import type { App } from 'obsidian'
import { TEMPLATER_PLUGIN_ID } from '../constants'
import { log } from '../../utils/log'

/**
 * Adapter for the optional **Templater** plugin (issue #46).
 *
 * Templater has no published API, so every member is feature-detected and every
 * call is guarded — an absent or reshaped Templater degrades to "no templating"
 * instead of breaking note creation.
 *
 * Two Templater behaviours drive this module:
 *
 * 1. `write_template_to_file(template, file)` renders a template into an existing
 *    file, merging the template's frontmatter OVER the file's own (non-empty
 *    scalars win, arrays are concatenated). Callers must therefore write their own
 *    properties AFTER awaiting it.
 * 2. With "Trigger Templater on new file creation" enabled, Templater listens for
 *    `vault.on('create')`, waits 300 ms, and applies the matching folder/file
 *    template — UNLESS the path sits in its `files_with_pending_templates` set.
 *    `write_template_to_file` adds the path to that set synchronously, so calling
 *    it right after `vault.create` deterministically claims the file (exactly one
 *    template application, and it is awaited). {@link claimTemplaterFile} keeps the
 *    marker in place around that call, because Templater clears it when its own
 *    write finishes — before its 300 ms trigger check has run.
 */

/** The Templater members this plugin touches; all optional by design. */
interface TemplaterApiLike {
    write_template_to_file?: (template: TFile, file: TFile) => Promise<void>
    get_new_file_template_for_folder?: (folder: TFolder) => string | undefined
    files_with_pending_templates?: Set<string>
    start_templater_task?: (path: string) => void
    end_templater_task?: (path: string) => Promise<void>
}

interface TemplaterSettingsLike {
    trigger_on_file_creation?: boolean
    templates_folder?: string
    enable_folder_templates?: boolean
    enable_file_templates?: boolean
    /** Matched against the file PATH, exactly like Templater does. */
    file_templates?: Array<{ regex?: string; template?: string }>
    ignore_folders_on_creation?: Array<{ folder?: string }>
}

interface TemplaterPluginLike {
    templater?: TemplaterApiLike
    settings?: TemplaterSettingsLike
}

function getTemplaterPlugin(app: App): TemplaterPluginLike | null {
    const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins
    const plugin = plugins?.plugins?.[TEMPLATER_PLUGIN_ID] as TemplaterPluginLike | undefined
    return plugin ?? null
}

/** True when Templater is installed, enabled, and can render into a file. */
export function isTemplaterAvailable(app: App): boolean {
    return typeof getTemplaterPlugin(app)?.templater?.write_template_to_file === 'function'
}

/**
 * Render `template` into `file` through Templater and wait for it to finish
 * (including the template's own `tp.file.rename()` / `tp.file.move()`, which is
 * why callers must keep the `TFile` and re-read `file.path` afterwards).
 *
 * Returns `false` when Templater is unavailable or the render failed (Templater
 * reports its own error notice; an aborted `tp.system.suggester` lands here too).
 */
export async function writeTemplateToFile(
    app: App,
    template: TFile,
    file: TFile
): Promise<boolean> {
    const api = getTemplaterPlugin(app)?.templater
    if (typeof api?.write_template_to_file !== 'function') return false
    try {
        await api.write_template_to_file(template, file)
        return true
    } catch (error: unknown) {
        log(`Templater failed to apply "${template.path}" to "${file.path}".`, 'error', error)
        return false
    }
}

/** Templater's configured templates folder, or `null` when unset/unavailable. */
export function templaterTemplatesFolder(app: App): string | null {
    const folder = getTemplaterPlugin(app)?.settings?.templates_folder
    if (typeof folder !== 'string') return null
    const trimmed = folder.trim()
    return trimmed.length > 0 ? normalizePath(trimmed) : null
}

/**
 * The template Templater's "trigger on new file creation" would apply to a file
 * at `path`, or `null` when it would not act. Mirrors Templater's own guards
 * (its templates folder, the ignore list, folder-templates before file-templates)
 * so the plugin applies exactly the template the user would otherwise get —
 * just synchronously and awaited.
 */
export function autoTemplatePathFor(app: App, path: string): string | null {
    const plugin = getTemplaterPlugin(app)
    const settings = plugin?.settings
    const api = plugin?.templater
    if (!settings?.trigger_on_file_creation || !api) return null

    // NOTE: the two guards below intentionally reproduce Templater's own checks
    // verbatim — including its loose `includes` test for the templates folder,
    // which also excludes e.g. `ProjectTemplates/`. Tightening them here would
    // apply a template where Templater itself applies none.
    const normalized = normalizePath(path)
    const templatesFolder = normalizePath(settings.templates_folder ?? '')
    if (
        templatesFolder !== '/' &&
        templatesFolder.length > 0 &&
        normalized.includes(templatesFolder)
    )
        return null
    for (const entry of settings.ignore_folders_on_creation ?? []) {
        const folder = normalizePath(entry.folder ?? '')
        if (folder.length > 0 && folder !== '/' && normalized.startsWith(folder)) return null
    }

    try {
        if (settings.enable_folder_templates && api.get_new_file_template_for_folder) {
            const parentPath = normalized.slice(0, normalized.lastIndexOf('/'))
            const parent = parentPath.length > 0 ? app.vault.getFolderByPath(parentPath) : null
            const folder = parent ?? app.vault.getRoot()
            if (folder instanceof TFolder) {
                const template = api.get_new_file_template_for_folder(folder)
                if (template) return template
            }
        }
        if (settings.enable_file_templates) {
            // Templater's own rule: the FIRST file-template whose regex matches the
            // path wins. Evaluated here rather than through
            // `get_new_file_template_for_file`, which needs a real `TFile` that does
            // not exist yet when this runs for the modal's preview.
            for (const entry of settings.file_templates ?? []) {
                if (!entry.regex || !entry.template) continue
                if (new RegExp(entry.regex).test(normalized)) return entry.template
            }
        }
    } catch (error: unknown) {
        log('Could not resolve the Templater auto-template; ignoring it.', 'warn', error)
    }
    return null
}

/** A held "Templater is handling this file" marker; always release it. */
export interface TemplaterClaim {
    /**
     * Re-assert the claim over `paths` — call this right after templating with
     * the note's (possibly changed) current path, since `write_template_to_file`
     * clears its own marker before Templater's 300 ms trigger check runs.
     */
    reassert: (paths: string[]) => void
    /**
     * Release the claim `delayMs` after the note is fully written. Any
     * `extraPaths` are re-asserted first, so the window never reopens between
     * the last re-assert and the release.
     */
    release: (extraPaths?: string[], delayMs?: number) => void
}

/** Safety net: a claim never explicitly released is dropped after this long. */
const CLAIM_SAFETY_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Claim a path so Templater's "trigger on new file creation" leaves it alone.
 *
 * Two windows need covering, and neither is handled by `write_template_to_file`
 * on its own:
 *
 * - **Before** it runs — the note is opened first (so `tp.file.cursor()` works),
 *   and Templater's trigger fires 300 ms after the file appeared.
 * - **After** it runs — it clears the marker itself, but if the rendered note has
 *   an empty BODY the trigger would then apply the folder template a second time.
 *
 * No-op (with a release that does nothing) when Templater is absent.
 */
export function claimTemplaterFile(app: App, path: string): TemplaterClaim {
    const api = getTemplaterPlugin(app)?.templater
    if (typeof api?.start_templater_task !== 'function' || path.length === 0) {
        return { reassert: () => undefined, release: () => undefined }
    }

    const held = new Set<string>()
    /**
     * Always re-issues `start_templater_task`, even for a path already marked
     * here: `write_template_to_file` DELETES its own entry when it finishes, so a
     * path this claim believes it holds may no longer be in Templater's set.
     * Skipping the re-issue would reopen the very window this claim exists to close.
     */
    const mark = (value: string): void => {
        if (value.length === 0) return
        try {
            api.start_templater_task?.(value)
            held.add(value)
        } catch (error: unknown) {
            log('Could not hold the Templater task marker.', 'warn', error)
        }
    }
    const endAll = (): void => {
        for (const value of held) {
            try {
                void api.end_templater_task?.(value)
            } catch (error: unknown) {
                log('Could not release the Templater task marker.', 'warn', error)
            }
        }
        held.clear()
    }

    mark(path)
    let released = false
    const safety = window.setTimeout(() => {
        released = true
        endAll()
    }, CLAIM_SAFETY_TIMEOUT_MS)

    return {
        reassert: (paths: string[]) => {
            if (released) return
            for (const value of paths) mark(value)
        },
        release: (extraPaths = [], delayMs = 500) => {
            if (released) return
            released = true
            window.clearTimeout(safety)
            for (const extra of extraPaths) mark(extra)
            window.setTimeout(endAll, delayMs)
        }
    }
}

/** Templater's own cursor placeholder — see `get_cursor_matches_and_positions`. */
const CURSOR_MARKER = /<%\s*tp\.file\.cursor\([0-9]*\)\s*%>/g

/**
 * Remove `<% tp.file.cursor() %>` markers a template left behind.
 *
 * Templater strips them in `jump_to_next_cursor_location`, which only acts on the
 * **active editor** — so a note created without being opened keeps the raw marker
 * as literal text. Skipped when the note IS the active editor (Templater already
 * handled it, and rewriting under an open editor would fight the user's typing).
 */
export async function stripCursorMarkers(app: App, file: TFile): Promise<void> {
    if (app.workspace.activeEditor?.file === file) return
    try {
        const content = await app.vault.read(file)
        if (!new RegExp(CURSOR_MARKER.source).test(content)) return
        await app.vault.process(file, (data) => data.replace(CURSOR_MARKER, ''))
    } catch (error: unknown) {
        log(`Could not clean the template cursor markers in "${file.path}".`, 'warn', error)
    }
}
