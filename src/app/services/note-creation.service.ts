import { Notice, TFile, normalizePath } from 'obsidian'
import type { App } from 'obsidian'
import { CORE_TEMPLATES_PLUGIN_ID } from '../constants'
import {
    applyCoreTemplatePlaceholders,
    buildNoteBasename,
    buildUniquePath,
    normalizeCreationFolder,
    type ResolvedCreationConfig
} from '../domain/note-creation'
import { resolvePlaceholders, type ExpressionContext } from '../utils/expressions'
import { liveExpressionContext } from './archive.service'
import {
    autoTemplatePathFor,
    claimTemplaterFile,
    isTemplaterAvailable,
    stripCursorMarkers,
    writeTemplateToFile
} from './templater.service'
import { findKeyCaseInsensitive } from './frontmatter.service'
import { formatDate } from '../utils/momentjs'
import { log } from '../../utils/log'

/**
 * Quick capture (issue #46): create a note that lands on the board as a card.
 *
 * Ordering is the whole game, and it is fixed:
 *
 *   ensure folder → `vault.create('')` → apply the template (awaited)
 *                 → write frontmatter ONCE
 *
 * The template runs **before** the frontmatter write because Templater merges a
 * template's frontmatter over the file's own (non-empty scalars win), so
 * properties written first would be silently overridden — the column's status
 * would be lost to a `tp.system.suggester` in the template. Templates also
 * rename and move their file, so only the `TFile` is held across the await and
 * `file.path` is re-read afterwards.
 *
 * Applying the template ourselves (rather than letting Templater's "trigger on
 * new file creation" do it in the background) is deliberate: `write_template_to_file`
 * claims the path in Templater's pending set synchronously, so the auto-trigger
 * stands down and there is exactly one, awaited, template application. See
 * `templater.service.ts`.
 */

/** Which engine rendered the note's template (for reporting only). */
export type TemplateEngine = 'templater' | 'core-templates' | 'copy' | 'none'

export interface CreateNoteRequest {
    /** Resolved (layered) creation config for the target note type. */
    config: ResolvedCreationConfig
    /** The title the user typed. */
    title: string
    /**
     * Frontmatter written after templating. Values are written verbatim; a key
     * already present on the note (in any casing) is reused, never duplicated.
     */
    properties: Record<string, unknown>
    /** Tags merged into the note's `tags` list (deduped, case-insensitively). */
    tags: string[]
    /** List properties whose values must be present (Base `contains` filters). */
    listProperties?: Record<string, string[]>
}

export type CreateNoteResult =
    | { ok: true; file: TFile; engine: TemplateEngine; templatePath: string | null }
    | { ok: false; reason: 'empty-title' | 'exists' | 'error'; message?: string }

/**
 * Create the note. Never throws: every failure is logged and returned so the
 * caller can report it without tearing the board down.
 */
export async function createNote(
    app: App,
    request: CreateNoteRequest,
    ctx: ExpressionContext = liveExpressionContext()
): Promise<CreateNoteResult> {
    const basename = buildNoteBasename(request.title, request.config, ctx)
    if (basename.length === 0) return { ok: false, reason: 'empty-title' }

    const folder = normalizeCreationFolder(resolvePlaceholders(request.config.folder, ctx))
    let file: TFile
    try {
        await ensureFolder(app, folder)
        file = await createEmptyNote(app, folder, basename)
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Quick capture: could not create the note. ${message}`, 'error', error)
        return { ok: false, reason: 'error', message }
    }

    // Claimed for the whole flow — opening the note (below) can easily outlast
    // the 300 ms after which Templater's create-trigger would template it itself.
    const claim = claimTemplaterFile(app, file.path)
    let engine: TemplateEngine = 'none'
    let templatePath: string | null = null
    try {
        // Open BEFORE templating (this is also what the Starter Kit's own
        // create-note command does): `tp.file.cursor()` is resolved by Templater's
        // `jump_to_next_cursor_location`, which only acts on the ACTIVE editor. A
        // new tab, not the current leaf — the current leaf is the board.
        if (request.config.openAfterCreate) {
            await app.workspace.getLeaf('tab').openFile(file)
        }
        const applied = await applyTemplate(app, file, request.config, basename, ctx)
        engine = applied.engine
        templatePath = applied.templatePath
        // Re-assert over the note's CURRENT path: the template may have moved it,
        // and `write_template_to_file` cleared its own marker on the way out while
        // Templater's 300 ms trigger check may still be pending.
        claim.reassert([file.path])
        // A note created without being opened keeps any literal cursor marker.
        if (engine === 'templater') await stripCursorMarkers(app, file)
    } catch (error: unknown) {
        // The note exists; a failure here (a rejected `openFile`, a template that
        // threw past its own guard) must not abort the property write — an
        // un-propertied note would never become a card.
        log('Quick capture: opening or templating the new note failed.', 'error', error)
        new Notice('The new note was created, but its template could not be applied.')
    }

    // The claim is held ACROSS the property write, not released before it: the
    // trigger Templater may still fire would otherwise re-apply a folder template
    // over the properties just written.
    try {
        await writeCreationFrontmatter(app, file, request)
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log(`Quick capture: could not write the new note's properties. ${message}`, 'error', error)
        // The note exists — surface it rather than pretending creation failed.
        new Notice(`Created "${file.basename}" but could not write its properties.`)
    } finally {
        claim.release([file.path])
    }

    return { ok: true, file, engine, templatePath }
}

/**
 * Create the empty note, re-resolving the name when the path was taken between
 * the availability check and the write (another plugin, a sync, a second capture).
 */
async function createEmptyNote(app: App, folder: string, basename: string): Promise<TFile> {
    const taken = new Set<string>()
    for (let attempt = 0; ; attempt++) {
        const path = buildUniquePath(
            folder,
            basename,
            (candidate) =>
                taken.has(candidate) || app.vault.getAbstractFileByPath(candidate) !== null
        )
        try {
            return await app.vault.create(path, '')
        } catch (error: unknown) {
            if (attempt >= 3) throw error
            taken.add(path)
        }
    }
}

/**
 * Apply the note's template, if any. The configured template wins; otherwise the
 * template Templater's auto-trigger would have applied is used, so the user's
 * folder/file templates keep working even for types with no explicit template.
 */
async function applyTemplate(
    app: App,
    file: TFile,
    config: ResolvedCreationConfig,
    basename: string,
    ctx: ExpressionContext
): Promise<{ engine: TemplateEngine; templatePath: string | null }> {
    const configured = config.templatePath.trim()
    const templatePath = configured.length > 0 ? configured : autoTemplatePathFor(app, file.path)
    if (!templatePath) return { engine: 'none', templatePath: null }

    const template = app.vault.getAbstractFileByPath(normalizePath(templatePath))
    if (!(template instanceof TFile)) {
        log(`Quick capture: template "${templatePath}" was not found.`, 'warn')
        new Notice(`Template not found: "${templatePath}". The note was created without it.`)
        return { engine: 'none', templatePath }
    }

    if (isTemplaterAvailable(app)) {
        const applied = await writeTemplateToFile(app, template, file)
        // A Templater failure (an aborted prompt, a template error) already showed
        // its own notice; the note stays, so the card still appears.
        return { engine: applied ? 'templater' : 'none', templatePath }
    }

    try {
        const raw = await app.vault.read(template)
        const core = isCoreTemplatesEnabled(app)
        const content = core ? substituteCorePlaceholders(app, raw, basename, ctx) : raw
        await app.vault.modify(file, content)
        if (!core) {
            new Notice('Templater is not enabled — the template was copied without evaluating it.')
        }
        return { engine: core ? 'core-templates' : 'copy', templatePath }
    } catch (error: unknown) {
        log(`Quick capture: could not copy template "${templatePath}".`, 'error', error)
        new Notice(`Could not apply the template "${templatePath}".`)
        return { engine: 'none', templatePath }
    }
}

/** Whether the core "Templates" plugin is enabled (its placeholder syntax applies). */
function isCoreTemplatesEnabled(app: App): boolean {
    const internal = (
        app as unknown as {
            internalPlugins?: { getEnabledPluginById?: (id: string) => unknown }
        }
    ).internalPlugins
    try {
        return Boolean(internal?.getEnabledPluginById?.(CORE_TEMPLATES_PLUGIN_ID))
    } catch {
        return false
    }
}

/** Core Templates' `{{title}}` / `{{date}}` / `{{time}}` (with `:format` variants). */
function substituteCorePlaceholders(
    app: App,
    content: string,
    basename: string,
    ctx: ExpressionContext
): string {
    const options = coreTemplateFormats(app)
    return applyCoreTemplatePlaceholders(content, {
        title: basename,
        date: formatDate(ctx.now, options.dateFormat),
        time: formatDate(ctx.now, options.timeFormat),
        format: (token) => formatDate(ctx.now, token)
    })
}

function coreTemplateFormats(app: App): { dateFormat: string; timeFormat: string } {
    const internal = (
        app as unknown as {
            internalPlugins?: {
                getEnabledPluginById?: (
                    id: string
                ) => { options?: { dateFormat?: string; timeFormat?: string } } | null
            }
        }
    ).internalPlugins
    let options: { dateFormat?: string; timeFormat?: string } | undefined
    try {
        options = internal?.getEnabledPluginById?.(CORE_TEMPLATES_PLUGIN_ID)?.options
    } catch {
        options = undefined
    }
    return {
        dateFormat: options?.dateFormat ?? 'YYYY-MM-DD',
        timeFormat: options?.timeFormat ?? 'HH:mm'
    }
}

/**
 * Write every creation-derived property in ONE transaction (status, swimlane
 * value, manual order, recognition + filter tags, filter equalities), so the
 * note goes from "templated" to "a card in the clicked column" in a single
 * metadata-cache update instead of a torn sequence of intermediate states.
 */
async function writeCreationFrontmatter(
    app: App,
    file: TFile,
    request: CreateNoteRequest
): Promise<void> {
    const hasProperties = Object.keys(request.properties).length > 0
    const hasLists = Object.keys(request.listProperties ?? {}).length > 0
    if (!hasProperties && !hasLists && request.tags.length === 0) return

    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const [name, value] of Object.entries(request.properties)) {
            const key = findKeyCaseInsensitive(fm, name) ?? name
            fm[key] = value
        }
        for (const [name, values] of Object.entries(request.listProperties ?? {})) {
            const key = findKeyCaseInsensitive(fm, name) ?? name
            fm[key] = mergeList(fm[key], values, false)
        }
        if (request.tags.length > 0) {
            const key = findKeyCaseInsensitive(fm, 'tags') ?? 'tags'
            fm[key] = mergeList(fm[key], request.tags, true)
        }
    })
}

/**
 * Merge `additions` into an existing frontmatter list value without disturbing
 * what is already there (a template's own tags stay, in their order). A scalar is
 * promoted to a list; `null`/absent starts a fresh one.
 */
function mergeList(raw: unknown, additions: string[], caseInsensitive: boolean): unknown[] {
    const existing = Array.isArray(raw) ? [...raw] : raw === null || raw === undefined ? [] : [raw]
    const seen = new Set(
        existing
            .filter((item): item is string => typeof item === 'string')
            .map((item) => (caseInsensitive ? item.toLowerCase() : item))
    )
    for (const addition of additions) {
        const key = caseInsensitive ? addition.toLowerCase() : addition
        if (seen.has(key)) continue
        seen.add(key)
        existing.push(addition)
    }
    return existing
}

/** Create every missing segment of `folder` (no-op for the vault root). */
async function ensureFolder(app: App, folder: string): Promise<void> {
    if (folder.length === 0) return
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
