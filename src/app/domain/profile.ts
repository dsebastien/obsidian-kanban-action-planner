import { z } from 'zod'

/**
 * Profile configuration model + Zod schemas.
 *
 * Profiles are the reusable note-type configuration unit. When the Starter Kit
 * plugin is present its note-type config is mirrored in (read-only source of
 * truth); the kanban-owned parts (colors, card presentation, swimlane grouping,
 * relationships, archiving, calendar) always live here. All stored config is
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
    color: colorSpecSchema
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

/** A single configurable field shown on a card (issue #3). */
export const cardFieldDisplaySchema = z.object({
    property: z.string(),
    showLabel: z.boolean(),
    dateFormat: z.string().optional(),
    emphasis: z.enum(['normal', 'due-red']).optional()
})
export type CardFieldDisplay = z.infer<typeof cardFieldDisplaySchema>

/** Configurable card presentation (issues #3–#6). */
export const cardPresentationSchema = z.object({
    titleSource: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('note-name') }),
        z.object({ kind: z.literal('property'), property: z.string() })
    ]),
    fields: z.array(cardFieldDisplaySchema),
    coverImageProperty: z.string().nullable(),
    wrapPropertyValues: z.boolean()
})
export type CardPresentation = z.infer<typeof cardPresentationSchema>

/** Archiving config (issue #7). `archiveFolder` supports `{{year}}` etc. */
export const archiveConfigSchema = z.object({
    archiveFolder: z.string(),
    triggerStatus: z.string().nullable()
})
export type ArchiveConfig = z.infer<typeof archiveConfigSchema>

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

/** The set of profile fields a local override may replace. */
export const profileOverridableSchema = z.object({
    statusProperty: z.string(),
    orderProperty: z.string(),
    columns: z.array(columnDefSchema),
    laneGrouping: laneGroupingSchema,
    colors: z.object({
        autoAssign: z.boolean(),
        overrides: z.record(z.string(), colorSpecSchema)
    }),
    card: cardPresentationSchema,
    archive: archiveConfigSchema,
    relationships: z.array(relationshipRuleSchema),
    calendar: calendarConfigSchema
})

/** A reusable note-type profile. */
export const profileSchema = profileOverridableSchema.extend({
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
    overrides: profileOverridableSchema.partial().optional()
})
export type Profile = z.infer<typeof profileSchema>
