import { startOfDay } from './calendar'

/**
 * Pure Agenda model (issue #39): a flat, prioritized "what's on my plate"
 * list built from the cards' due and scheduled dates. No Obsidian/DOM deps
 * so it is fully unit-testable; the view maps its cards into
 * {@link AgendaCardInput} and renders the returned groups.
 */

/** How far the agenda looks ahead: just today, or the next 7 days too. */
export type AgendaWindow = 'today' | 'week'

/** Days the `week` window looks ahead (after today). */
export const AGENDA_LOOKAHEAD_DAYS = 7

/** What the agenda needs to know about a card (the view's card flows through). */
export interface AgendaCardInput {
    key: string
    title: string
    due: Date | null
    scheduled: Date | null
    order: number | null
    /** GTD availability (issue #113): not deferred, not blocked, not done. */
    available: boolean
}

export type AgendaGroupId = 'overdue' | 'today' | 'upcoming'

/** One agenda row: the card plus why it is listed. */
export interface AgendaEntry<T extends AgendaCardInput> {
    card: T
    /** The date that placed the card in its group (the more urgent of the two). */
    date: Date
    /** Whether the due / scheduled dimension contributed. */
    isDue: boolean
    isScheduled: boolean
}

export interface AgendaGroup<T extends AgendaCardInput> {
    id: AgendaGroupId
    entries: AgendaEntry<T>[]
}

export interface AgendaModel<T extends AgendaCardInput> {
    /** Non-empty groups, most urgent first (overdue → today → upcoming). */
    groups: AgendaGroup<T>[]
    /** Cards excluded by the available-only toggle (visible feedback). */
    hiddenUnavailable: number
    /** Total rows shown. */
    count: number
}

function sameDay(a: Date, b: Date): boolean {
    return startOfDay(a).getTime() === startOfDay(b).getTime()
}

/** Sort within a group: date asc, then manual order (unset last), then title. */
function compareEntries<T extends AgendaCardInput>(a: AgendaEntry<T>, b: AgendaEntry<T>): number {
    const at = a.date.getTime()
    const bt = b.date.getTime()
    if (at !== bt) return at - bt
    const ao = a.card.order
    const bo = b.card.order
    if (ao !== null || bo !== null) {
        if (ao === null) return 1
        if (bo === null) return -1
        if (ao !== bo) return ao - bo
    }
    return a.card.title.localeCompare(b.card.title)
}

/**
 * Build the agenda. A card lands in exactly ONE group — its most urgent:
 *
 * - `overdue` — the due date is before today.
 * - `today` — due today or scheduled today (an overdue card scheduled today
 *   stays in overdue).
 * - `upcoming` — due or scheduled within the next {@link AGENDA_LOOKAHEAD_DAYS}
 *   days; only with the `week` window.
 *
 * A past scheduled date alone never lists a card (a slipped schedule is not
 * an overdue deadline). With `availableOnly`, unavailable cards (deferred /
 * blocked / done, issue #113) are dropped and counted instead of shown.
 */
export function buildAgenda<T extends AgendaCardInput>(
    cards: ReadonlyArray<T>,
    today: Date,
    window: AgendaWindow,
    availableOnly: boolean
): AgendaModel<T> {
    const day0 = startOfDay(today)
    const horizon = new Date(day0)
    horizon.setDate(horizon.getDate() + AGENDA_LOOKAHEAD_DAYS)

    const groups: Record<AgendaGroupId, AgendaEntry<T>[]> = {
        overdue: [],
        today: [],
        upcoming: []
    }
    let hiddenUnavailable = 0

    for (const card of cards) {
        const entry = classify(card, day0, horizon, window)
        if (!entry) continue
        if (availableOnly && !card.available) {
            hiddenUnavailable++
            continue
        }
        groups[entry.group].push(entry.entry)
    }

    const ordered: AgendaGroup<T>[] = (['overdue', 'today', 'upcoming'] as const)
        .filter((id) => groups[id].length > 0)
        .map((id) => ({ id, entries: groups[id].sort(compareEntries) }))
    return {
        groups: ordered,
        hiddenUnavailable,
        count: ordered.reduce((n, g) => n + g.entries.length, 0)
    }
}

function classify<T extends AgendaCardInput>(
    card: T,
    day0: Date,
    horizon: Date,
    window: AgendaWindow
): { group: AgendaGroupId; entry: AgendaEntry<T> } | null {
    const due = card.due ? startOfDay(card.due) : null
    const scheduled = card.scheduled ? startOfDay(card.scheduled) : null

    if (due && due.getTime() < day0.getTime()) {
        return {
            group: 'overdue',
            entry: { card, date: due, isDue: true, isScheduled: scheduled !== null }
        }
    }
    const dueToday = due !== null && sameDay(due, day0)
    const scheduledToday = scheduled !== null && sameDay(scheduled, day0)
    if (dueToday || scheduledToday) {
        return {
            group: 'today',
            entry: {
                card,
                date: day0,
                isDue: dueToday,
                isScheduled: scheduledToday
            }
        }
    }
    if (window !== 'week') return null
    const inWindow = (d: Date | null): boolean =>
        d !== null && d.getTime() > day0.getTime() && d.getTime() <= horizon.getTime()
    const dueSoon = inWindow(due)
    const scheduledSoon = inWindow(scheduled)
    if (!dueSoon && !scheduledSoon) return null
    const date =
        dueSoon && scheduledSoon
            ? new Date(Math.min((due as Date).getTime(), (scheduled as Date).getTime()))
            : ((dueSoon ? due : scheduled) as Date)
    return {
        group: 'upcoming',
        entry: { card, date, isDue: dueSoon, isScheduled: scheduledSoon }
    }
}
