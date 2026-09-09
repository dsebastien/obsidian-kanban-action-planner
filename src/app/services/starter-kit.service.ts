import type { App, TFile } from 'obsidian'
import { STARTER_KIT_PLUGIN_ID } from '../constants'
import type { InheritedCreationDefaults } from '../domain/note-creation'

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
    /** Where notes of this type live (may contain `{{year}}`-style expressions). */
    associatedFolder?: string | null
    /** The type's template file (vault-relative). */
    templatePath?: string | null
    /** Name decoration; the suffix often doubles as a regex recognition mapping. */
    noteNamePrefix?: string | null
    noteNameSuffix?: string | null
    /** Tags the Starter Kit associates with this type. */
    tags?: string[]
}

interface SkApiLike {
    listNoteTypes?: () => unknown
    getNoteType?: (id: string) => unknown
    getNoteTypeByName?: (name: string) => unknown
    recognizeNoteType?: (file: unknown) => Promise<unknown>
    /** Starter Kit ≥ 1.13: the type's status property + done states. */
    getNoteTypeStatus?: (ref: string) => unknown
    /** Starter Kit: the plugin settings (`globalSettings.enableAutomations` ≥ 1.15). */
    getSettings?: () => unknown
}

/** One status value of a Starter Kit note type, as its `getNoteTypeStatus` resolves it. */
export type SkStatusRole = 'backlog' | 'scheduled' | 'active' | 'waiting'

export interface SkStatusValue {
    value: string
    done: boolean
    outcome: 'success' | 'failure' | null
    /**
     * Planning meaning of an OPEN status (Starter Kit ≥ 1.14): backlog /
     * scheduled / active / waiting; null on done states or when unset.
     */
    role: SkStatusRole | null
    /** Date property stamped when a note enters this status (null = none). */
    stampsDate: string | null
    stampOnlyIfEmpty: boolean
}

/** A Starter Kit note type's resolved status (property + every value's meaning). */
export interface SkResolvedStatus {
    property: string
    /** True when configured on the type; false = the Starter Kit's own heuristic. */
    explicit: boolean
    values: SkStatusValue[]
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
function getStarterKitApi(app: App): SkApiLike | null {
    const pm = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins
    const plugin = pm?.plugins?.[STARTER_KIT_PLUGIN_ID] as { api?: unknown } | undefined
    const api = plugin?.api
    if (api && typeof (api as SkApiLike).listNoteTypes === 'function') {
        return api
    }
    return null
}

/** True when the Starter Kit is installed, enabled, and exposes its API. */
export function isStarterKitAvailable(app: App): boolean {
    return getStarterKitApi(app) !== null
}

/**
 * True when the Starter Kit (≥ 1.15) runs its own automation rules — its
 * "Run automation rules" setting is on. It then stamps dates itself, from any
 * edit source, so this plugin must not mirror the stamping rules (exactly one
 * executor per rule; see `status-mirror.ts`). False when the setting is off,
 * absent (older Starter Kit) or the API is unavailable.
 */
export function starterKitRunsAutomations(app: App): boolean {
    const api = getStarterKitApi(app)
    if (!api?.getSettings) return false
    try {
        const settings = unwrap<{ globalSettings?: { enableAutomations?: unknown } }>(
            api.getSettings()
        )
        return settings?.globalSettings?.enableAutomations === true
    } catch {
        return false
    }
}

/** List the Starter Kit note types (empty when unavailable). */
export function listNoteTypes(app: App): SkNoteType[] {
    const api = getStarterKitApi(app)
    if (!api?.listNoteTypes) return []
    const types = unwrap<SkNoteType[]>(api.listNoteTypes())
    return Array.isArray(types) ? types : []
}

/** Look up one Starter Kit note type by id (null when unavailable/unknown). */
export function getNoteTypeById(app: App, id: string): SkNoteType | null {
    const api = getStarterKitApi(app)
    if (api?.getNoteType) {
        const type = unwrap<SkNoteType>(api.getNoteType(id))
        if (type) return type
    }
    return listNoteTypes(app).find((type) => type.id === id) ?? null
}

/**
 * The Starter Kit's status resolution for a note type (its status property,
 * done states, outcomes and stamped dates), or `null` when the installed
 * Starter Kit predates the API, the type is unknown, or it has no status
 * property. Shapes are normalized defensively like every other SK result.
 */
export function getNoteTypeStatus(app: App, id: string): SkResolvedStatus | null {
    const api = getStarterKitApi(app)
    if (!api?.getNoteTypeStatus) return null
    try {
        const raw = unwrap<Partial<SkResolvedStatus>>(api.getNoteTypeStatus(id))
        if (!raw || typeof raw.property !== 'string' || !Array.isArray(raw.values)) return null
        return {
            property: raw.property,
            explicit: raw.explicit === true,
            values: raw.values
                .filter((v): v is SkStatusValue => typeof v?.value === 'string')
                .map((v) => ({
                    value: v.value,
                    done: v.done === true,
                    outcome: v.outcome === 'success' || v.outcome === 'failure' ? v.outcome : null,
                    role:
                        v.role === 'backlog' ||
                        v.role === 'scheduled' ||
                        v.role === 'active' ||
                        v.role === 'waiting'
                            ? v.role
                            : null,
                    stampsDate:
                        typeof v.stampsDate === 'string' && v.stampsDate ? v.stampsDate : null,
                    stampOnlyIfEmpty: v.stampOnlyIfEmpty !== false
                }))
        }
    } catch {
        return null
    }
}

/**
 * The creation-relevant configuration a Starter Kit note type already carries
 * (issue #46), so a mirrored type needs no extra setup in this plugin. Values are
 * passed through verbatim — placeholder expansion happens at creation time.
 */
export function creationDefaults(noteType: SkNoteType): InheritedCreationDefaults {
    return {
        folder: noteType.associatedFolder ?? '',
        templatePath: noteType.templatePath ?? '',
        namePrefix: noteType.noteNamePrefix ?? '',
        nameSuffix: noteType.noteNameSuffix ?? ''
    }
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

/**
 * Find a note type's property by name (case-insensitive) and return its allowed
 * values (issue #52). Unlike {@link findStatusProperty} this matches an exact
 * property name, so any enum (priority/urgency/effort/…) can be resolved.
 * Returns `[]` when the property is unknown or has no constrained values.
 */
export function findProperty(noteType: SkNoteType, name: string): string[] {
    const lower = name.toLowerCase()
    const prop = (noteType.properties ?? []).find((p) => p.name.toLowerCase() === lower)
    return prop ? toStringValues(prop.allowedValues) : []
}

/** Every Starter Kit property that has constrained (enum) values (issue #52). */
export function enumPropertyDefs(
    noteType: SkNoteType
): Array<{ name: string; displayName: string; values: string[] }> {
    const out: Array<{ name: string; displayName: string; values: string[] }> = []
    for (const p of noteType.properties ?? []) {
        const values = toStringValues(p.allowedValues)
        if (values.length > 0)
            out.push({ name: p.name, displayName: p.displayName ?? p.name, values })
    }
    return out
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
