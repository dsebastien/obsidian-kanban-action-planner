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
    estimate: estimateConfigSchema.optional()
})
export type NoteType = z.infer<typeof noteTypeSchema>
