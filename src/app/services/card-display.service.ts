import type { App, BasesEntry, BasesPropertyId, TFile } from 'obsidian'
import { getFrontmatterValue } from './frontmatter.service'
import { parseFrontmatterDate, startOfDay } from '../domain/calendar'
import type { CardDisplay, CardFieldView, DueState } from '../ui/board/types'

/**
 * Classify a due date against `today` (issue #22): `overdue` when strictly
 * before today, `today` on the day itself, else `none`. Pure + unit-tested.
 */
export function computeDueState(due: Date | null, today: Date): DueState {
    if (!due) return 'none'
    const d = startOfDay(due).getTime()
    const t = startOfDay(today).getTime()
    if (d < t) return 'overdue'
    if (d === t) return 'today'
    return 'none'
}

/** The subset of `BasesViewConfig` the card display reads (issue #50). */
interface CardFieldConfig {
    getOrder(): BasesPropertyId[]
    getDisplayName(propertyId: BasesPropertyId): string
}

/** The file/title property id — shown as the card's heading, never as a field. */
const TITLE_PROPERTY_ID = 'file.name'

/**
 * Build a card's presentation from the **Bases view's configured properties**
 * (issue #50): the title (note name) plus one field per property in the view's
 * `getOrder()` (the standard Bases "Properties" toolbar), read per card via
 * `BasesEntry.getValue` and labelled by `getDisplayName`. Works uniformly for
 * `note.*` / `formula.*` / `file.*` columns — so a base formula (e.g. a
 * `priority_score`) shows on the card with no special handling. Relationships
 * are rendered separately from `KanbanCard.relationships`, not here.
 */
export function buildCardDisplay(
    app: App,
    file: TFile,
    entry: BasesEntry | undefined,
    config: CardFieldConfig,
    dueDateProperty: string | null,
    today: Date
): CardDisplay {
    const fields: CardFieldView[] = []
    for (const id of config.getOrder()) {
        if (id === TITLE_PROPERTY_ID) continue // shown as the title
        const value = entry?.getValue(id)
        const text = value == null ? '' : value.toString().trim()
        // `NullValue.toString()` is "null"; skip empty/unset so cards don't show "Field: null".
        if (!text || text === 'null') continue
        fields.push({ label: config.getDisplayName(id), text, emphasis: 'normal' })
    }

    const dueRaw = dueDateProperty ? getFrontmatterValue(app, file, dueDateProperty) : null
    return {
        title: file.basename,
        fields,
        coverUrl: null,
        wrap: true,
        dueState: computeDueState(parseFrontmatterDate(dueRaw), today)
    }
}
