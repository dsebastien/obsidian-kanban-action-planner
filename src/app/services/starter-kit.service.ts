import type { App, TFile } from 'obsidian'
import { STARTER_KIT_PLUGIN_ID } from '../constants'

/**
 * Adapter for the optional Obsidian Starter Kit plugin.
 *
 * The Starter Kit is the read-only source of truth for note-type config when
 * installed. Its API has no version guarantee, so every method is feature
 * detected and every result shape is normalized defensively; when the plugin is
 * absent or its shape differs, callers simply get `null`/`[]` and degrade.
 */

export interface SkPropertyDefinition {
    name: string
    displayName?: string
    type?: string
    allowedValues?: unknown
}

export interface SkMapping {
    type: 'tag' | 'folder' | 'regex' | 'formula'
    value: string
    enabled: boolean
}

export interface SkNoteType {
    id: string
    name: string
    properties?: SkPropertyDefinition[]
    mappings?: SkMapping[]
}

interface SkApiLike {
    listNoteTypes?: () => unknown
    getNoteTypeByName?: (name: string) => unknown
    recognizeNoteType?: (file: unknown) => Promise<unknown>
}

/** Normalize either a raw value or an `ApiResult<T>` wrapper into `T | null`. */
function unwrap<T>(res: unknown): T | null {
    if (res === null || res === undefined) return null
    if (typeof res === 'object' && 'success' in res) {
        const r = res as { success: boolean; data?: T }
        return r.success ? (r.data ?? null) : null
    }
    return res as T
}

/** Feature-detect the Starter Kit API, or `null` when unavailable. */
export function getStarterKitApi(app: App): SkApiLike | null {
    const pm = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins
    const plugin = pm?.plugins?.[STARTER_KIT_PLUGIN_ID] as { api?: unknown } | undefined
    const api = plugin?.api
    if (api && typeof (api as SkApiLike).listNoteTypes === 'function') {
        return api as SkApiLike
    }
    return null
}

/** True when the Starter Kit is installed, enabled, and exposes its API. */
export function isStarterKitAvailable(app: App): boolean {
    return getStarterKitApi(app) !== null
}

/** List the Starter Kit note types (empty when unavailable). */
export function listNoteTypes(app: App): SkNoteType[] {
    const api = getStarterKitApi(app)
    if (!api?.listNoteTypes) return []
    const types = unwrap<SkNoteType[]>(api.listNoteTypes())
    return Array.isArray(types) ? types : []
}

/** Recognize the note type of a file via the Starter Kit (null when none). */
export async function recognizeNoteType(app: App, file: TFile): Promise<SkNoteType | null> {
    const api = getStarterKitApi(app)
    if (!api?.recognizeNoteType) return null
    try {
        return unwrap<SkNoteType>(await api.recognizeNoteType(file))
    } catch {
        return null
    }
}

/**
 * Pick the status property of a note type, preferring a configured name, then
 * one named `status`, then one whose name contains `status`, then the first
 * `select`-typed / constrained property. Returns its name + allowed values.
 */
export function findStatusProperty(
    noteType: SkNoteType,
    configuredName?: string | null
): { name: string; allowedValues: string[] } | null {
    const props = noteType.properties ?? []
    const byName = (pred: (n: string) => boolean): SkPropertyDefinition | undefined =>
        props.find((p) => pred(p.name.toLowerCase()))

    const candidate =
        (configuredName ? byName((n) => n === configuredName.toLowerCase()) : undefined) ??
        byName((n) => n === 'status') ??
        byName((n) => n.includes('status')) ??
        props.find((p) => p.type === 'select') ??
        props.find((p) => Array.isArray(p.allowedValues) && p.allowedValues.length > 0)

    if (!candidate) return null
    return { name: candidate.name, allowedValues: toStringValues(candidate.allowedValues) }
}

function toStringValues(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    return raw
        .map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null))
        .filter((v): v is string => v !== null && v.length > 0)
}

/** The note type's recognition mappings, restricted to ones we support. */
export function recognitionMappings(
    noteType: SkNoteType
): Array<{ type: 'tag' | 'folder' | 'regex'; value: string; enabled: boolean }> {
    return (noteType.mappings ?? [])
        .filter((m) => m.type === 'tag' || m.type === 'folder' || m.type === 'regex')
        .map((m) => ({
            type: m.type as 'tag' | 'folder' | 'regex',
            value: m.value,
            enabled: m.enabled
        }))
}
