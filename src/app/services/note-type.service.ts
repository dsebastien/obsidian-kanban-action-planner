import { getAllTags } from 'obsidian'
import type { App, TFile } from 'obsidian'
import { produce } from 'immer'
import type { ColorSpec, ColumnDef, LaneGrouping, NoteType } from '../domain/note-type'
import { compareStatusValues, splitStatusValue } from '../domain/status'
import { matchesAnyMapping } from '../domain/note-type-recognition'
import type { RecognitionFile } from '../domain/note-type-recognition'
import { autoAssignColor } from './colors.service'
import { log } from '../../utils/log'
import {
    findStatusProperty,
    isStarterKitAvailable,
    recognitionMappings,
    recognizeNoteType,
    type SkNoteType
} from './starter-kit.service'
import {
    DEFAULT_BLOCKED_BY_PROPERTY,
    DEFAULT_CHILD_PROPERTY,
    DEFAULT_DATE_FORMAT,
    DEFAULT_DUE_DATE_PROPERTY,
    DEFAULT_ORDER_PROPERTY,
    DEFAULT_PARENT_PROPERTY,
    DEFAULT_SCHEDULED_DATE_PROPERTY,
    DEFAULT_SIBLING_PROPERTY,
    DEFAULT_STATUS_PROPERTY
} from '../constants'
import type { KanbanActionPlannerPlugin } from '../plugin'

/**
 * Resolves and persists note types.
 *
 * A note type is keyed by an id: the Starter Kit note-type id when recognized,
 * else the shared `__default__` noteType. Note types carry the kanban-owned config
 * (colors today; presentation/relationships/etc. as those features land). When
 * the Starter Kit is present, the status property + allowed column values are
 * mirrored from it; local color overrides are preserved across re-mirroring.
 */

export const DEFAULT_NOTE_TYPE_ID = '__default__'

export interface NoteTypeDefaults {
    statusProperty: string
    orderProperty: string
    scheduledDateProperty: string
    dueDateProperty: string
    dateFormat: string
}

function defaultsFromPlugin(plugin: KanbanActionPlannerPlugin): NoteTypeDefaults {
    const s = plugin.settings
    return {
        statusProperty: s.defaultStatusProperty,
        orderProperty: s.defaultOrderProperty,
        scheduledDateProperty: s.defaultScheduledDateProperty,
        dueDateProperty: s.defaultDueDateProperty,
        dateFormat: s.defaultDateFormat
    }
}

/** A complete default note type — every field populated, valid against the schema. */
export function createDefaultNoteType(
    id: string,
    name: string,
    source: NoteType['source'],
    defaults: NoteTypeDefaults = {
        statusProperty: DEFAULT_STATUS_PROPERTY,
        orderProperty: DEFAULT_ORDER_PROPERTY,
        scheduledDateProperty: DEFAULT_SCHEDULED_DATE_PROPERTY,
        dueDateProperty: DEFAULT_DUE_DATE_PROPERTY,
        dateFormat: DEFAULT_DATE_FORMAT
    }
): NoteType {
    return {
        id,
        name,
        source,
        typeRecognition: { mappings: [] },
        statusProperty: defaults.statusProperty,
        orderProperty: defaults.orderProperty,
        columns: [],
        laneGrouping: { kind: 'none' },
        colors: { autoAssign: true, overrides: {} },
        archive: { archiveFolder: '', triggerStatuses: [] },
        wipLimits: {},
        relationships: [
            { role: 'parent', linkProperty: DEFAULT_PARENT_PROPERTY },
            { role: 'sibling', linkProperty: DEFAULT_SIBLING_PROPERTY },
            { role: 'child', linkProperty: DEFAULT_CHILD_PROPERTY },
            { role: 'blocked_by', linkProperty: DEFAULT_BLOCKED_BY_PROPERTY }
        ],
        calendar: {
            enabled: false,
            scheduledDateProperty: defaults.scheduledDateProperty,
            dueDateProperty: defaults.dueDateProperty,
            dateFormat: defaults.dateFormat,
            defaultRange: 'month',
            tabSort: defaults.orderProperty
        }
    }
}

/** Find a stored note type by id. */
export function findNoteType(plugin: KanbanActionPlannerPlugin, id: string): NoteType | undefined {
    return plugin.settings.noteTypes.find((p) => p.id === id)
}

/**
 * Resolve a note type for a **write**, logging when it's missing so the write is
 * never silently dropped (e.g. the type was deleted between UI render and save).
 * Callers still early-return on `undefined`; the log makes the lost write visible.
 */
function requireNoteType(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string
): NoteType | undefined {
    const noteType = findNoteType(plugin, noteTypeId)
    if (!noteType) {
        log(`Cannot update note type "${noteTypeId}": not found (write skipped).`, 'warn')
    }
    return noteType
}

/** Insert or replace a note type, persisting settings. */
export async function upsertNoteType(
    plugin: KanbanActionPlannerPlugin,
    noteType: NoteType
): Promise<void> {
    plugin.settings = produce(plugin.settings, (draft) => {
        const idx = draft.noteTypes.findIndex((p) => p.id === noteType.id)
        if (idx >= 0) draft.noteTypes[idx] = noteType
        else draft.noteTypes.push(noteType)
    })
    await plugin.saveSettings()
}

/** Get an existing noteType or create, persist, and return a default one. */
export async function getOrCreateNoteType(
    plugin: KanbanActionPlannerPlugin,
    id: string,
    name: string,
    source: NoteType['source']
): Promise<NoteType> {
    const existing = findNoteType(plugin, id)
    if (existing) return existing
    const created = createDefaultNoteType(id, name, source, defaultsFromPlugin(plugin))
    await upsertNoteType(plugin, created)
    return created
}

/** Set a per-status color override on a note type. */
export async function setColorOverride(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    statusValue: string,
    spec: ColorSpec
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            draft.colors.overrides[statusValue] = spec
        })
    )
}

/** Remove a per-status color override (revert to auto). */
export async function clearColorOverride(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    statusValue: string
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            delete draft.colors.overrides[statusValue]
        })
    )
}

/** Toggle whether un-overridden columns get palette colors. */
export async function setAutoAssign(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    autoAssign: boolean
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            draft.colors.autoAssign = autoAssign
        })
    )
}

/** Replace a note type's relationship rules. */
export async function setRelationships(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    relationships: NoteType['relationships']
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            draft.relationships = relationships
        })
    )
}

/** Replace a note type's swimlane grouping config. */
export async function setLaneGrouping(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    laneGrouping: LaneGrouping
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            draft.laneGrouping = laneGrouping
        })
    )
}

/** Replace a note type's archiving config. */
export async function setArchiveConfig(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    archive: NoteType['archive']
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            draft.archive = archive
        })
    )
}

/** Create a new local note type (issue #31) with a unique id; persists it. */
export async function createLocalNoteType(
    plugin: KanbanActionPlannerPlugin,
    name: string
): Promise<NoteType> {
    const id = `local-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
    const noteType = createDefaultNoteType(
        id,
        name.trim() || 'New type',
        'local',
        defaultsFromPlugin(plugin)
    )
    await upsertNoteType(plugin, noteType)
    return noteType
}

/** Rename a note type (issue #31). */
export async function setNoteTypeName(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    name: string
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            draft.name = name.trim() || draft.name
        })
    )
}

/** Replace a local note type's recognition mappings (issue #31). */
export async function setRecognitionMappings(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    mappings: NoteType['typeRecognition']['mappings']
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            draft.typeRecognition.mappings = mappings
        })
    )
}

/** Delete a stored note type (issue #31). The Default note type cannot be deleted. */
export async function deleteNoteType(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string
): Promise<void> {
    if (noteTypeId === DEFAULT_NOTE_TYPE_ID) return
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.noteTypes = draft.noteTypes.filter((p) => p.id !== noteTypeId)
    })
    await plugin.saveSettings()
}

/** Set or clear a status's soft WIP limit (issue #16); `null`/≤0 removes it. */
export async function setWipLimit(
    plugin: KanbanActionPlannerPlugin,
    noteTypeId: string,
    statusValue: string,
    limit: number | null
): Promise<void> {
    const noteType = requireNoteType(plugin, noteTypeId)
    if (!noteType) return
    await upsertNoteType(
        plugin,
        produce(noteType, (draft) => {
            if (limit && limit > 0) draft.wipLimits[statusValue] = Math.floor(limit)
            else delete draft.wipLimits[statusValue]
        })
    )
}

const NEUTRAL_SPEC: ColorSpec = { kind: 'palette', token: 'slate' }

/** Resolve the color for a status value from a note type's overrides / auto rule. */
export function colorForStatus(noteType: NoteType, statusValue: string): ColorSpec {
    const override = noteType.colors.overrides[statusValue]
    if (override) return override
    return noteType.colors.autoAssign ? autoAssignColor(statusValue) : NEUTRAL_SPEC
}

/**
 * Build columns for a set of status values using a note type's colors.
 * `preserveOrder` keeps the given order (e.g. Starter Kit allowed values);
 * otherwise values are ordered by numeric/lexical prefix.
 */
export function columnsFromValues(
    values: ReadonlyArray<string>,
    noteType: NoteType,
    preserveOrder: boolean
): ColumnDef[] {
    const unique = Array.from(new Set(values))
    const ordered = preserveOrder ? unique : unique.sort(compareStatusValues)
    return ordered.map((statusValue) => {
        const { sortKey, label } = splitStatusValue(statusValue)
        const wipLimit = noteType.wipLimits[statusValue]
        return {
            id: statusValue,
            statusValue,
            label,
            sortKey,
            color: colorForStatus(noteType, statusValue),
            ...(wipLimit && wipLimit > 0 ? { wipLimit } : {})
        }
    })
}

export interface ResolvedNoteType {
    noteType: NoteType
    /** Explicit status values from the source of truth, or null to use observed. */
    statusValues: string[] | null
    preserveOrder: boolean
}

/**
 * Resolve the active note type for the given files: when the Starter Kit
 * recognizes them as a note type, mirror its status property + allowed values
 * (preserving local color overrides); otherwise use the shared default note type
 * and observed status values.
 */
export async function resolveActiveNoteType(
    app: App,
    plugin: KanbanActionPlannerPlugin,
    files: TFile[]
): Promise<ResolvedNoteType> {
    const skType = await recognizeDominantNoteType(app, files)

    if (skType) {
        const defaults = defaultsFromPlugin(plugin)
        const status = findStatusProperty(skType, defaults.statusProperty)
        const base =
            (await getOrCreateNoteType(plugin, skType.id, skType.name, 'starter-kit')) ?? null
        const merged = mirrorNoteType(base, skType, status, defaults)
        if (!noteTypesEqual(base, merged)) await upsertNoteType(plugin, merged)
        return {
            noteType: merged,
            statusValues: status?.allowedValues ?? null,
            preserveOrder: true
        }
    }

    // Local fallback (issue #31): recognize via stored note types' mapping rules,
    // so note types work without the Starter Kit (and survive it being removed).
    const localId = recognizeDominantLocalType(app, plugin, files)
    if (localId) {
        const local = findNoteType(plugin, localId)
        if (local) return { noteType: local, statusValues: null, preserveOrder: true }
    }

    const noteType = await getOrCreateNoteType(plugin, DEFAULT_NOTE_TYPE_ID, 'Default', 'local')
    return { noteType, statusValues: null, preserveOrder: false }
}

/** Build the pure recognition view of a file (path + normalized tags). */
function toRecognitionFile(app: App, file: TFile): RecognitionFile {
    const cache = app.metadataCache.getFileCache(file)
    const tags = (cache ? (getAllTags(cache) ?? []) : []).map((t) =>
        t.toLowerCase().replace(/^#+/, '')
    )
    return { path: file.path, tags }
}

/** Note types eligible for local recognition: non-Default with at least one mapping. */
function recognitionNoteTypes(plugin: KanbanActionPlannerPlugin): NoteType[] {
    return plugin.settings.noteTypes.filter(
        (p) => p.id !== DEFAULT_NOTE_TYPE_ID && p.typeRecognition.mappings.length > 0
    )
}

/** Recognize a file's note type from stored mapping rules; null if none match. */
export function recognizeLocalNoteType(
    app: App,
    plugin: KanbanActionPlannerPlugin,
    file: TFile
): { id: string; name: string } | null {
    const record = toRecognitionFile(app, file)
    for (const noteType of recognitionNoteTypes(plugin)) {
        if (matchesAnyMapping(record, noteType.typeRecognition.mappings)) {
            return { id: noteType.id, name: noteType.name }
        }
    }
    return null
}

/**
 * Recognize a file's note type, preferring the Starter Kit (when present) and
 * falling back to local mapping rules (issue #31). Used for per-card swimlane /
 * archive / display resolution.
 */
export async function recognizeNoteTypeFor(
    app: App,
    plugin: KanbanActionPlannerPlugin,
    file: TFile
): Promise<{ id: string; name: string } | null> {
    if (isStarterKitAvailable(app)) {
        const sk = await recognizeNoteType(app, file)
        if (sk) return { id: sk.id, name: sk.name }
    }
    return recognizeLocalNoteType(app, plugin, file)
}

/** The most common locally-recognized note type id across a sample of files. */
function recognizeDominantLocalType(
    app: App,
    plugin: KanbanActionPlannerPlugin,
    files: TFile[]
): string | null {
    const candidates = recognitionNoteTypes(plugin)
    if (candidates.length === 0) return null
    const counts = new Map<string, number>()
    for (const file of files.slice(0, 20)) {
        const record = toRecognitionFile(app, file)
        const hit = candidates.find((p) => matchesAnyMapping(record, p.typeRecognition.mappings))
        if (hit) counts.set(hit.id, (counts.get(hit.id) ?? 0) + 1)
    }
    let best: { id: string; count: number } | null = null
    for (const [id, count] of counts) {
        if (!best || count > best.count) best = { id, count }
    }
    return best?.id ?? null
}

/** Recognize the most common Starter Kit note type across a sample of files. */
async function recognizeDominantNoteType(app: App, files: TFile[]): Promise<SkNoteType | null> {
    const sample = files.slice(0, 20)
    const counts = new Map<string, { type: SkNoteType; count: number }>()
    for (const file of sample) {
        const type = await recognizeNoteType(app, file)
        if (!type) continue
        const entry = counts.get(type.id)
        if (entry) entry.count += 1
        else counts.set(type.id, { type, count: 1 })
    }
    let best: { type: SkNoteType; count: number } | null = null
    for (const entry of counts.values()) {
        if (!best || entry.count > best.count) best = entry
    }
    return best?.type ?? null
}

/** Merge Starter Kit facts onto a note type, keeping local color overrides. */
function mirrorNoteType(
    base: NoteType,
    noteType: SkNoteType,
    status: { name: string; allowedValues: string[] } | null,
    defaults: NoteTypeDefaults
): NoteType {
    return produce(base, (draft) => {
        draft.name = noteType.name
        draft.source = 'starter-kit'
        draft.typeRecognition.mappings = recognitionMappings(noteType)
        if (status) {
            draft.statusProperty = status.name
            draft.columns = columnsFromValues(status.allowedValues, base, true)
        }
        if (!draft.orderProperty) draft.orderProperty = defaults.orderProperty
    })
}

function noteTypesEqual(a: NoteType, b: NoteType): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}
