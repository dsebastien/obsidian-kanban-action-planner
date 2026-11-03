import type { KanbanCard } from '../ui/board/types'
import type { BudgetRing } from '../domain/budget'
import { budgetRing, isoWeekRange } from '../domain/budget'
import { minutesInRange, parseTimeEntries } from '../domain/time-entries'
import type { TimeEntry } from '../domain/time-entries'
import type { LinkedNoteTime } from '../domain/linked-time'
import { linkedMinutesInRange, skippedEntryPaths } from '../domain/linked-time'
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
    /** Minutes of the notes giving their time to it or to a counted child, dated this ISO week (each once). */
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
 * giving their time (time from linked notes) to the card or to one of those
 * children (when its type takes them), dated this week, each linked note
 * counted once. A linked note with minutes > 0 dated this week that is also
 * a child counts once, as a linked note (its entries are not added); any
 * other child (0 minutes, dated another week) adds its entries. An entry
 * (own or a child's) whose description links to a counted linked note is
 * skipped (counted with that note); otherwise it counts.
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
    const week = { from: start, to: end }
    // The distinct children on the board (the card itself never counts as one).
    const children: KanbanCard[] = []
    const childKeys = new Set<string>([card.key])
    for (const related of card.relationships.child) {
        if (childKeys.has(related.key)) continue
        childKeys.add(related.key)
        const child = ctx.cardForKey(related.key)
        if (child) children.push(child)
    }
    // The linked notes counted this week: the card's and its children's,
    // each note once (by path), the card itself never.
    const counted = new Map<string, LinkedNoteTime>()
    for (const owner of [card, ...children]) {
        for (const note of ctx.linkedNotesFor?.(owner) ?? []) {
            if (note.path !== card.key && !counted.has(note.path)) counted.set(note.path, note)
        }
    }
    const countedNotes = [...counted.values()]
    const linkedNotesTracked = linkedMinutesInRange(countedNotes, start, end)
    // The notes whose minutes count this week: their entries are skipped, and
    // a child that is one counts once, as a linked note.
    const skipped = skippedEntryPaths(countedNotes, week)
    const ownTracked = trackedInRange(
        ctx,
        card,
        start,
        end,
        linkedEntryMatcher(ctx.app, card.file, skipped)
    )
    let tracked = ownTracked + linkedNotesTracked
    const linked: string[] = []
    for (const child of children) {
        if (skipped.has(child.key)) continue
        linked.push(child.key)
        // The child's links resolve from its own path.
        tracked += trackedInRange(
            ctx,
            child,
            start,
            end,
            linkedEntryMatcher(ctx.app, child.file, skipped)
        )
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
