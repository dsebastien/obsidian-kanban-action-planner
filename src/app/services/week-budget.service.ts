import type { App } from 'obsidian'
import type { KanbanCard } from '../ui/board/types'
import type { BudgetRing } from '../domain/budget'
import { budgetRing, isoWeekRange } from '../domain/budget'
import { minutesInRange, parseTimeEntries } from '../domain/time-entries'
import { coerceOrder, getFrontmatterValue } from './frontmatter.service'
import type { TrackingProperties } from './time-tracking.service'
import type { WeekProperties } from './week-properties.service'

/**
 * The weekly budget of one note (issue #172, phase C): the three numbers the
 * ring shows and how they were obtained. Null values are absent properties.
 */
export interface WeekBudget {
    target: number | null
    planned: number | null
    alarm: number | null
    /** The note's own minutes tracked this ISO week. */
    ownTracked: number
    /** Own + the linked notes' minutes this ISO week (distinct notes). */
    tracked: number
    /** Paths of the linked notes whose entries were counted. */
    linked: string[]
    ring: BudgetRing
}

/** What the budget computation needs from the view. */
export interface WeekBudgetContext {
    readonly app: App
    weekPropertiesFor(card: KanbanCard): WeekProperties
    trackingPropertiesFor(card: KanbanCard): TrackingProperties
    /** Any card of the board by key (filtered-out ones included). */
    cardForKey(key: string): KanbanCard | undefined
}

/** A positive-number frontmatter value, else null. */
function readMinutes(app: App, card: KanbanCard, property: string): number | null {
    const value = coerceOrder(getFrontmatterValue(app, card.file, property))
    return value !== null && value > 0 ? value : null
}

/** A note's own minutes tracked inside `[from, to)`. */
export function trackedInRange(
    ctx: WeekBudgetContext,
    card: KanbanCard,
    from: Date,
    to: Date
): number {
    const entries = parseTimeEntries(
        getFrontmatterValue(ctx.app, card.file, ctx.trackingPropertiesFor(card).entries)
    )
    return minutesInRange(entries, from, to)
}

/**
 * The budget of `card` for the ISO week holding `now`, or null when the note
 * carries neither a target nor planned minutes (it has no weekly budget: a
 * task, a goal, a plan). Tracked this week = the note's own entries plus the
 * entries of the notes linked to it as children (its tasks, on this board),
 * each counted once, all clipped to the week.
 */
export function weekBudgetOf(
    ctx: WeekBudgetContext,
    card: KanbanCard,
    now: Date = new Date()
): WeekBudget | null {
    const props = ctx.weekPropertiesFor(card)
    const target = readMinutes(ctx.app, card, props.targetMinutes)
    const planned = readMinutes(ctx.app, card, props.plannedMinutes)
    if (target === null && planned === null) return null
    const alarm = readMinutes(ctx.app, card, props.alarmMinutes)
    const { start, end } = isoWeekRange(now)
    const ownTracked = trackedInRange(ctx, card, start, end)
    let tracked = ownTracked
    const linked: string[] = []
    const seen = new Set<string>([card.key])
    for (const related of card.relationships.child) {
        if (seen.has(related.key)) continue
        seen.add(related.key)
        const child = ctx.cardForKey(related.key)
        if (!child) continue
        linked.push(related.key)
        tracked += trackedInRange(ctx, child, start, end)
    }
    return {
        target,
        planned,
        alarm,
        ownTracked,
        tracked,
        linked,
        ring: budgetRing({ target, planned, tracked, alarm })
    }
}
