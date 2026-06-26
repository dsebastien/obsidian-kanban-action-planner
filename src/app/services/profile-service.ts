import type { App, TFile } from 'obsidian'
import { produce } from 'immer'
import type { ColorSpec, ColumnDef, LaneGrouping, Profile } from '../domain/profile'
import { compareStatusValues, splitStatusValue } from '../domain/status'
import { autoAssignColor } from './colors.service'
import {
    findStatusProperty,
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
 * Resolves and persists note-type profiles.
 *
 * A profile is keyed by an id: the Starter Kit note-type id when recognized,
 * else the shared `__default__` profile. Profiles carry the kanban-owned config
 * (colors today; presentation/relationships/etc. as those features land). When
 * the Starter Kit is present, the status property + allowed column values are
 * mirrored from it; local color overrides are preserved across re-mirroring.
 */

export const DEFAULT_PROFILE_ID = '__default__'

export interface ProfileDefaults {
    statusProperty: string
    orderProperty: string
    scheduledDateProperty: string
    dueDateProperty: string
    dateFormat: string
}

export function defaultsFromPlugin(plugin: KanbanActionPlannerPlugin): ProfileDefaults {
    const s = plugin.settings
    return {
        statusProperty: s.defaultStatusProperty,
        orderProperty: s.defaultOrderProperty,
        scheduledDateProperty: s.defaultScheduledDateProperty,
        dueDateProperty: s.defaultDueDateProperty,
        dateFormat: s.defaultDateFormat
    }
}

/** A complete default profile — every field populated, valid against the schema. */
export function createDefaultProfile(
    id: string,
    name: string,
    source: Profile['source'],
    defaults: ProfileDefaults = {
        statusProperty: DEFAULT_STATUS_PROPERTY,
        orderProperty: DEFAULT_ORDER_PROPERTY,
        scheduledDateProperty: DEFAULT_SCHEDULED_DATE_PROPERTY,
        dueDateProperty: DEFAULT_DUE_DATE_PROPERTY,
        dateFormat: DEFAULT_DATE_FORMAT
    }
): Profile {
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
        card: {
            titleSource: { kind: 'note-name' },
            fields: [],
            coverImageProperty: null,
            wrapPropertyValues: false
        },
        archive: { archiveFolder: '', triggerStatus: null },
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

/** Find a stored profile by id. */
export function findProfile(plugin: KanbanActionPlannerPlugin, id: string): Profile | undefined {
    return plugin.settings.profiles.find((p) => p.id === id)
}

/** Insert or replace a profile, persisting settings. */
export async function upsertProfile(
    plugin: KanbanActionPlannerPlugin,
    profile: Profile
): Promise<void> {
    plugin.settings = produce(plugin.settings, (draft) => {
        const idx = draft.profiles.findIndex((p) => p.id === profile.id)
        if (idx >= 0) draft.profiles[idx] = profile
        else draft.profiles.push(profile)
    })
    await plugin.saveSettings()
}

/** Get an existing profile or create, persist, and return a default one. */
export async function getOrCreateProfile(
    plugin: KanbanActionPlannerPlugin,
    id: string,
    name: string,
    source: Profile['source']
): Promise<Profile> {
    const existing = findProfile(plugin, id)
    if (existing) return existing
    const created = createDefaultProfile(id, name, source, defaultsFromPlugin(plugin))
    await upsertProfile(plugin, created)
    return created
}

/** Set a per-status color override on a profile. */
export async function setColorOverride(
    plugin: KanbanActionPlannerPlugin,
    profileId: string,
    statusValue: string,
    spec: ColorSpec
): Promise<void> {
    const profile = findProfile(plugin, profileId)
    if (!profile) return
    await upsertProfile(
        plugin,
        produce(profile, (draft) => {
            draft.colors.overrides[statusValue] = spec
        })
    )
}

/** Remove a per-status color override (revert to auto). */
export async function clearColorOverride(
    plugin: KanbanActionPlannerPlugin,
    profileId: string,
    statusValue: string
): Promise<void> {
    const profile = findProfile(plugin, profileId)
    if (!profile) return
    await upsertProfile(
        plugin,
        produce(profile, (draft) => {
            delete draft.colors.overrides[statusValue]
        })
    )
}

/** Toggle whether un-overridden columns get palette colors. */
export async function setAutoAssign(
    plugin: KanbanActionPlannerPlugin,
    profileId: string,
    autoAssign: boolean
): Promise<void> {
    const profile = findProfile(plugin, profileId)
    if (!profile) return
    await upsertProfile(
        plugin,
        produce(profile, (draft) => {
            draft.colors.autoAssign = autoAssign
        })
    )
}

/** Replace a profile's relationship rules. */
export async function setRelationships(
    plugin: KanbanActionPlannerPlugin,
    profileId: string,
    relationships: Profile['relationships']
): Promise<void> {
    const profile = findProfile(plugin, profileId)
    if (!profile) return
    await upsertProfile(
        plugin,
        produce(profile, (draft) => {
            draft.relationships = relationships
        })
    )
}

/** Replace a profile's swimlane grouping config. */
export async function setLaneGrouping(
    plugin: KanbanActionPlannerPlugin,
    profileId: string,
    laneGrouping: LaneGrouping
): Promise<void> {
    const profile = findProfile(plugin, profileId)
    if (!profile) return
    await upsertProfile(
        plugin,
        produce(profile, (draft) => {
            draft.laneGrouping = laneGrouping
        })
    )
}

/** Replace a profile's card-presentation config. */
export async function setCardPresentation(
    plugin: KanbanActionPlannerPlugin,
    profileId: string,
    card: Profile['card']
): Promise<void> {
    const profile = findProfile(plugin, profileId)
    if (!profile) return
    await upsertProfile(
        plugin,
        produce(profile, (draft) => {
            draft.card = card
        })
    )
}

const NEUTRAL_SPEC: ColorSpec = { kind: 'palette', token: 'slate' }

/** Resolve the color for a status value from a profile's overrides / auto rule. */
export function colorForStatus(profile: Profile, statusValue: string): ColorSpec {
    const override = profile.colors.overrides[statusValue]
    if (override) return override
    return profile.colors.autoAssign ? autoAssignColor(statusValue) : NEUTRAL_SPEC
}

/**
 * Build columns for a set of status values using a profile's colors.
 * `preserveOrder` keeps the given order (e.g. Starter Kit allowed values);
 * otherwise values are ordered by numeric/lexical prefix.
 */
export function columnsFromValues(
    values: ReadonlyArray<string>,
    profile: Profile,
    preserveOrder: boolean
): ColumnDef[] {
    const unique = Array.from(new Set(values))
    const ordered = preserveOrder ? unique : unique.sort(compareStatusValues)
    return ordered.map((statusValue) => {
        const { sortKey, label } = splitStatusValue(statusValue)
        return {
            id: statusValue,
            statusValue,
            label,
            sortKey,
            color: colorForStatus(profile, statusValue)
        }
    })
}

export interface ResolvedProfile {
    profile: Profile
    /** Explicit status values from the source of truth, or null to use observed. */
    statusValues: string[] | null
    preserveOrder: boolean
}

/**
 * Resolve the active profile for the given files: when the Starter Kit
 * recognizes them as a note type, mirror its status property + allowed values
 * (preserving local color overrides); otherwise use the shared default profile
 * and observed status values.
 */
export async function resolveActiveProfile(
    app: App,
    plugin: KanbanActionPlannerPlugin,
    files: TFile[]
): Promise<ResolvedProfile> {
    const noteType = await recognizeDominantNoteType(app, files)

    if (noteType) {
        const defaults = defaultsFromPlugin(plugin)
        const status = findStatusProperty(noteType, defaults.statusProperty)
        const base =
            (await getOrCreateProfile(plugin, noteType.id, noteType.name, 'starter-kit')) ?? null
        const merged = mirrorNoteType(base, noteType, status, defaults)
        if (!profilesEqual(base, merged)) await upsertProfile(plugin, merged)
        return {
            profile: merged,
            statusValues: status?.allowedValues ?? null,
            preserveOrder: true
        }
    }

    const profile = await getOrCreateProfile(plugin, DEFAULT_PROFILE_ID, 'Default', 'local')
    return { profile, statusValues: null, preserveOrder: false }
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

/** Merge Starter Kit facts onto a profile, keeping local color overrides. */
function mirrorNoteType(
    base: Profile,
    noteType: SkNoteType,
    status: { name: string; allowedValues: string[] } | null,
    defaults: ProfileDefaults
): Profile {
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

function profilesEqual(a: Profile, b: Profile): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}
