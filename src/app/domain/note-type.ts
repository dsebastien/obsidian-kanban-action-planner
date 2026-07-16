import { z } from 'zod'

/**
 * NoteType configuration model + Zod schemas.
 *
 * Note types are the reusable configuration unit. When the Starter Kit
 * plugin is present its note-type config is mirrored in (read-only source of
 * truth); the kanban-owned parts (colors, swimlane grouping, relationships,
 * archiving, calendar) always live here. All stored config is
 * validated with these schemas on load, so types are inferred from the schemas
 * to keep them in lockstep.
 *
 * Milestone 0: schemas + types only. Derived runtime models (CardModel, Lane,
 * BoardModel) that reference `BasesEntry`/`TFile` live in `board-model.ts`
 * (Milestone 1).
 */

/** Card/column color: a curated palette token or an explicit hex override. */
export const colorSpecSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('palette'), token: z.string() }),
    z.object({ kind: z.literal('hex'), value: z.string() })
])
export type ColorSpec = z.infer<typeof colorSpecSchema>

/** A board column derived from a status value. */
export const columnDefSchema = z.object({
    id: z.string(),
    statusValue: z.string(),
    label: z.string(),
    sortKey: z.string(),
    color: colorSpecSchema,
    /** Soft WIP limit for this column (issue #16); absent = no limit. */
    wipLimit: z.number().int().positive().optional()
})
export type ColumnDef = z.infer<typeof columnDefSchema>

/** Relationship roles between notes. */
export const relationshipRoleSchema = z.enum(['parent', 'sibling', 'child', 'blocked_by'])
export type RelationshipRole = z.infer<typeof relationshipRoleSchema>

/**
 * A relationship rule: primary detection via an explicit link-property, with an
 * optional secondary tag+link heuristic.
 */
export const relationshipRuleSchema = z.object({
    role: relationshipRoleSchema,
    linkProperty: z.string(),
    heuristic: z
        .object({
            allowedTypeTags: z.array(z.string()),
            requiresLinkToSource: z.boolean()
        })
        .optional()
})
export type RelationshipRule = z.infer<typeof relationshipRuleSchema>

/** Swimlane grouping dimension (issue #2). */
export const laneGroupingSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('note-type') }),
    z.object({ kind: z.literal('property'), property: z.string() })
])
export type LaneGrouping = z.infer<typeof laneGroupingSchema>

/**
 * Archiving config (issue #7). `archiveFolder` supports `{{year}}` etc.
 * `triggerStatuses` lists the statuses that auto-archive a card on entry (issue
 * #32) — empty means off. The legacy single `triggerStatus` field is migrated
 * into the list on load and dropped on the next save.
 */
export const archiveConfigSchema = z
    .object({
        archiveFolder: z.string(),
        triggerStatuses: z.array(z.string()).optional(),
        triggerStatus: z.string().nullable().optional()
    })
    .transform(({ archiveFolder, triggerStatuses, triggerStatus }) => {
        const list =
            triggerStatuses && triggerStatuses.length > 0
                ? triggerStatuses
                : triggerStatus
                  ? [triggerStatus]
                  : []
        return { archiveFolder, triggerStatuses: [...new Set(list)] }
    })
export type ArchiveConfig = z.infer<typeof archiveConfigSchema>

/**
 * Per-type estimate override: which frontmatter property holds the time
 * estimate and in which unit. Absent = the global `defaultEstimateProperty`
 * in days. Plugin-owned (like colors/relationships) — editable for Starter
 * Kit–mirrored types too, and untouched by the SK mirror.
 */
export const estimateConfigSchema = z.object({
    /** Property name; '' falls back to the global default property. */
    property: z.string(),
    unit: z.enum(['days', 'minutes'])
})
export type NoteTypeEstimateConfig = z.infer<typeof estimateConfigSchema>

/**
 * Per-type done-state definition (issue #56): which frontmatter property and
 * value(s) mark a note of this type as done. `property` '' falls back to the
 * type's status property; an empty `values` list treats a boolean `true` as
 * done (checkbox properties). Absent (older stored types, no backfill) =
 * disabled. Plugin-owned — editable for Starter Kit–mirrored types too.
 */
export const doneConfigSchema = z.object({
    enabled: z.boolean(),
    /** Property name; '' falls back to the type's status property. */
    property: z.string(),
    /** Values meaning done (case-insensitive); empty = boolean `true`. */
    values: z.array(z.string())
})
export type DoneConfig = z.infer<typeof doneConfigSchema>

/**
 * Automation rules (per note type): "when a note transitions into status X
 * (or into a done state, or is archived, or a property condition becomes
 * true), do Y". Status/done/archived triggers fire from the plugin's write
 * paths, exactly once per transition; property-condition triggers are
 * edge-triggered off metadata-change diffs (any edit source, while a board
 * shows the note). Actions never re-trigger rules (no cascades).
 * Plugin-owned — editable for Starter Kit–mirrored types too, untouched by
 * the SK mirror.
 */
export const propertyOperatorSchema = z.enum([
    'equals',
    'not-equals',
    'gt',
    'gte',
    'lt',
    'lte',
    'set',
    'unset'
])
export type PropertyOperator = z.infer<typeof propertyOperatorSchema>

export const automationTriggerSchema = z.discriminatedUnion('kind', [
    /** The note enters any of the listed status values. */
    z.object({ kind: z.literal('status-entered'), statuses: z.array(z.string()) }),
    /** The note leaves any of the listed status values. */
    z.object({ kind: z.literal('status-left'), statuses: z.array(z.string()) }),
    /**
     * The note enters a done state (any of the type's done values, rule 39)
     * from a non-done one. Requires a status-based done definition.
     */
    z.object({ kind: z.literal('done-entered') }),
    /** The note is archived (manual, bulk, or status-triggered). */
    z.object({ kind: z.literal('archived') }),
    /**
     * A frontmatter property starts satisfying a comparison ('value' is
     * unused for `set`/`unset`). Numbers compare numerically, everything
     * else as case-insensitive strings (ISO dates order correctly).
     */
    z.object({
        kind: z.literal('property-condition'),
        property: z.string(),
        operator: propertyOperatorSchema,
        value: z.string()
    })
])
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>

/**
 * One automation action. `set-property` values and `move-to-folder` paths
 * support the `{{year}}`/`{{month}}`/`{{date}}`/… placeholders
 * (`resolvePlaceholders`); numeric/boolean-looking values are written as
 * numbers/booleans. Tags target the frontmatter `tags` list.
 */
export const automationActionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('set-property'), property: z.string(), value: z.string() }),
    z.object({ kind: z.literal('remove-property'), property: z.string() }),
    z.object({ kind: z.literal('add-tag'), tag: z.string() }),
    z.object({ kind: z.literal('remove-tag'), tag: z.string() }),
    z.object({ kind: z.literal('move-to-folder'), folder: z.string() })
])
export type AutomationAction = z.infer<typeof automationActionSchema>

export const automationRuleSchema = z.object({
    id: z.string(),
    /** Optional display label ('' = unnamed). */
    name: z.string(),
    enabled: z.boolean(),
    trigger: automationTriggerSchema,
    actions: z.array(automationActionSchema)
})
export type AutomationRule = z.infer<typeof automationRuleSchema>

/** Calendar / scheduling config. */
export const calendarConfigSchema = z.object({
    enabled: z.boolean(),
    scheduledDateProperty: z.string(),
    dueDateProperty: z.string(),
    dateFormat: z.string(),
    defaultRange: z.enum(['week', 'month', 'quarter', 'year']),
    tabSort: z.string()
})
export type CalendarConfig = z.infer<typeof calendarConfigSchema>

/**
 * A note type: the reusable config the plugin applies to every board showing
 * notes of that type (recognized via the Starter Kit or local rules). The
 * `__default__` note type is the fallback for notes that match no type.
 */
export const noteTypeSchema = z.object({
    id: z.string(),
    name: z.string(),
    source: z.enum(['starter-kit', 'local']),
    typeRecognition: z.object({
        mappings: z.array(
            z.object({
                type: z.enum(['tag', 'folder', 'regex']),
                value: z.string(),
                enabled: z.boolean()
            })
        )
    }),
    statusProperty: z.string(),
    orderProperty: z.string(),
    columns: z.array(columnDefSchema),
    laneGrouping: laneGroupingSchema,
    colors: z.object({
        autoAssign: z.boolean(),
        overrides: z.record(z.string(), colorSpecSchema)
    }),
    archive: archiveConfigSchema,
    relationships: z.array(relationshipRuleSchema),
    calendar: calendarConfigSchema,
    /** Soft per-status WIP limits (issue #16): status value → positive limit. */
    wipLimits: z.record(z.string(), z.number().int().positive()).default({}),
    /**
     * Manual enum allowed-values (issue #52): property name → ordered allowed
     * values. The fallback/override for the Starter Kit's `allowedValues`; lets
     * local note types (and props SK doesn't define) drive the card "Set
     * <property>" quick-set menu. Defaults to `{}` so older stored note types
     * degrade gracefully (no backfill).
     */
    enumProperties: z.record(z.string(), z.array(z.string())).default({}),
    /**
     * Estimate property + unit override; absent (older stored types, no
     * backfill) = the global default property in days.
     */
    estimate: estimateConfigSchema.optional(),
    /**
     * Done-state definition (issue #56); absent (older stored types, no
     * backfill) = no done state configured.
     */
    done: doneConfigSchema.optional(),
    /**
     * Automation rules. Defaults to `[]` so older stored note types degrade
     * gracefully (no backfill). Items are parsed individually and invalid
     * ones dropped — a rule written by a NEWER plugin version (unknown
     * trigger/action kind) must never fail the whole settings parse (which
     * would reset every note type to defaults).
     */
    automations: z
        .array(z.unknown())
        .default([])
        .transform((items) =>
            items.flatMap((item) => {
                const parsed = automationRuleSchema.safeParse(item)
                return parsed.success ? [parsed.data] : []
            })
        )
})
export type NoteType = z.infer<typeof noteTypeSchema>
