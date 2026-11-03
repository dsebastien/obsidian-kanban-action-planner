import type { KanbanCard } from '../ui/board/types'
import type { BudgetRing } from '../domain/budget'
import { budgetRing, isoWeekRange } from '../domain/budget'
import { minutesInRange, parseTimeEntries } from '../domain/time-entries'
import type { TimeEntry } from '../domain/time-entries'
import type { LinkedNoteTime } from '../domain/linked-time'
import { linkedMinutesInRange } from '../domain/linked-time'
import { linkedEntryMatcher } from './linked-time.service'
import type { LinkedTimeApp } from './linked-time.service'
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
    /** The note's own minutes tracked this ISO week (entries; linked-session entries skipped). */
    ownTracked: number
    /** Minutes of the notes giving their time to it, dated this ISO week. */
    linkedNotesTracked: number
    /** Own + children's entries + linked notes, this ISO week (each note once). */
    tracked: number
    /** Paths of the child notes whose entries were counted. */
    linked: string[]
    ring: BudgetRing
}

/** What the budget computation needs from the view. */
export interface WeekBudgetContext {
    readonly app: LinkedTimeApp
    weekPropertiesFor(card: KanbanCard): WeekProperties
    trackingPropertiesFor(card: KanbanCard): TrackingProperties
    /** Any card of the board by key (filtered-out ones included). */
    cardForKey(key: string): KanbanCard | undefined
    /**
     * The notes giving their time to the card (time from linked notes);
     * empty / absent when its type does not take any.
     */
    linkedNotesFor?(card: KanbanCard): LinkedNoteTime[]
}

/** A positive-number frontmatter value, else null. */
function readMinutes(app: LinkedTimeApp, card: KanbanCard, property: string): number | null {
    const value = coerceOrder(getFrontmatterValue(app, card.file, property))
    return value !== null && value > 0 ? value : null
}

/**
 * A note's own minutes tracked inside `[from, to)`. Entries `skip` matches
 * (a linked note's session, counted with that note) are left out.
 */
export function trackedInRange(
    ctx: WeekBudgetContext,
    card: KanbanCard,
    from: Date,
    to: Date,
    skip?: (entry: TimeEntry) => boolean
): number {
    const entries = parseTimeEntries(
        getFrontmatterValue(ctx.app, card.file, ctx.trackingPropertiesFor(card).entries)
    )
    return minutesInRange(skip ? entries.filter((e) => !skip(e)) : entries, from, to)
}

/**
 * The budget of `card` for the ISO week holding `now`, or null when the note
 * carries neither a target nor planned minutes (it has no weekly budget: a
 * task, a goal, a plan). Tracked this week = the note's own entries plus the
 * entries of the notes linked to it as children (its tasks, on this board),
 * each counted once, all clipped to the week, plus the minutes of the notes
 * giving it their time (time from linked notes) dated this week. A linked
 * note that is also a child counts once, as a linked note; an own entry
 * whose description links to a linked note is skipped (counted with it).
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
    const linkedNotes = ctx.linkedNotesFor?.(card) ?? []
    const linkedPaths = new Set(linkedNotes.map((note) => note.path))
    const ownTracked = trackedInRange(
        ctx,
        card,
        start,
        end,
        linkedEntryMatcher(ctx.app, card.file, linkedPaths)
    )
    const linkedNotesTracked = linkedMinutesInRange(linkedNotes, start, end)
    let tracked = ownTracked + linkedNotesTracked
    const linked: string[] = []
    // Linked notes are already counted: a child that is one counts once.
    const seen = new Set<string>([card.key, ...linkedPaths])
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
        linkedNotesTracked,
        tracked,
        linked,
        ring: budgetRing({ target, planned, tracked, alarm })
    }
}
