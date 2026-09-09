import { isoWeekNumber } from './week-planner'

/**
 * Weekly time budget of an activity or project (issue #172, phase C).
 *
 * Three numbers per note, all minutes per week: the TARGET the user set
 * (`minutes_per_week`), the PLANNED minutes the ideal week reserves
 * (`minutes_planned_per_week`, written by the ideal week), and the minutes
 * TRACKED this ISO week (the note's own entries plus its linked tasks'
 * entries, clipped to the week). An optional ALARM (`minutes_alarm_per_week`)
 * flags a week that ran over. The ring shows tracked against target; the
 * WBS rolls target and planned up like estimates (own value wins, else the
 * children's) and adds tracked like durations.
 *
 * Pure: no Obsidian imports.
 */

export type BudgetTone = 'none' | 'under' | 'on' | 'over' | 'alarm'

export interface BudgetInput {
    target: number | null
    planned: number | null
    tracked: number
    alarm: number | null
}

export interface BudgetRing {
    /** Tracked / target, clamped to 0..1 for the arc (null without a target). */
    ratio: number | null
    tone: BudgetTone
    /** Short chip label: `2h / 4h`, `2h` without a target, `–` with nothing at all. */
    label: string
    /** Full sentence for the tooltip. */
    detail: string
}

/** "2h" / "1h 30m" / "45m" / "0m". */
export function formatBudgetMinutes(minutes: number): string {
    const rounded = Math.max(0, Math.round(minutes))
    const h = Math.floor(rounded / 60)
    const m = rounded % 60
    if (h === 0) return `${m}m`
    return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * The ring for one note this week. Tones: `alarm` when tracked exceeds the
 * alarm; `over` when tracked exceeds the target; `on` at 90% of the target
 * or more; `under` below; `none` without a target (the ring is then a
 * plain count of the tracked minutes).
 */
export function budgetRing(input: BudgetInput): BudgetRing {
    const { target, planned, tracked, alarm } = input
    const hasTarget = target !== null && target > 0
    let tone: BudgetTone = 'none'
    if (alarm !== null && alarm > 0 && tracked > alarm) tone = 'alarm'
    else if (hasTarget) {
        if (tracked > target) tone = 'over'
        else if (tracked >= target * 0.9) tone = 'on'
        else tone = 'under'
    }
    const ratio = hasTarget ? Math.min(1, tracked / target) : null
    const label = hasTarget
        ? `${formatBudgetMinutes(tracked)} / ${formatBudgetMinutes(target)}`
        : tracked > 0 || (planned ?? 0) > 0
          ? formatBudgetMinutes(tracked)
          : '–'
    const parts = [`Tracked this week: ${formatBudgetMinutes(tracked)}`]
    parts.push(hasTarget ? `Target: ${formatBudgetMinutes(target)}` : 'No weekly target')
    if (planned !== null) parts.push(`Planned: ${formatBudgetMinutes(planned)}`)
    if (alarm !== null && alarm > 0) parts.push(`Alarm above: ${formatBudgetMinutes(alarm)}`)
    if (tone === 'alarm') parts.push('Over the alarm')
    return { ratio, tone, label, detail: parts.join(' · ') }
}

/** Monday 00:00 local of the ISO week holding `date`. */
export function isoWeekStart(date: Date): Date {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const offset = (day.getDay() + 6) % 7 // Monday = 0
    day.setDate(day.getDate() - offset)
    return day
}

/** The `[start, end)` bounds of the ISO week holding `date` (local midnights). */
export function isoWeekRange(date: Date): { start: Date; end: Date } {
    const start = isoWeekStart(date)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
    return { start, end }
}

/** `2026-W37`: the ISO week key, using the ISO week-based year. */
export function isoWeekKey(date: Date): string {
    const week = isoWeekNumber(date)
    // The ISO year is the year of that week's Thursday.
    const thursday = isoWeekStart(date)
    thursday.setDate(thursday.getDate() + 3)
    return `${thursday.getFullYear()}-W${week < 10 ? `0${week}` : week}`
}

/**
 * Whether the alarm notice for `path` should fire now, and the memo to
 * store afterwards: one notice per note per ISO week. Entries of past weeks
 * are pruned from the memo so it never grows.
 */
export function alarmNoticeDue(
    memo: Readonly<Record<string, string>>,
    path: string,
    weekKey: string
): { due: boolean; memo: Record<string, string> } {
    const next: Record<string, string> = {}
    for (const [p, key] of Object.entries(memo)) if (key === weekKey) next[p] = key
    const due = next[path] !== weekKey
    next[path] = weekKey
    return { due, memo: next }
}
