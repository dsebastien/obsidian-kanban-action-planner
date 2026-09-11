import { plannedMinutesPerWeek } from './time-blocks'
import type { WeekEntry } from './week-planner'

/**
 * Targets sub-mode of the Ideal week (issue #172, phase G). Pure.
 *
 * The ideal week has two faces: the grid (WHEN the blocks fall) and the
 * targets table (HOW MUCH each note gets per week). The table lists every
 * note of the rail with its weekly target editable in place, its planned
 * minutes, and the share of the AVAILABLE time the target represents;
 * groups (by area or context, first value wins) carry subtotals and a
 * repartition bar, and a totals row closes the table. "Available" is one
 * number per vault: the setting, else the visible grid hours times seven
 * days. Sleep is an activity like any other, so the default covers the
 * whole week (168h) and the remaining time is the free time.
 */

/** What the table can group by; `status` is the rail's default. */
export type WeekGroupBy = 'status' | 'area' | 'context'
export type TargetsGroupBy = 'none' | 'area' | 'context'

/** Minutes available per week: the setting (hours) wins, else the grid's hours × 7. */
export function availableMinutesPerWeek(input: {
    availableHours: number | null
    gridStartHour: number
    gridEndHour: number
}): number {
    if (input.availableHours !== null && input.availableHours > 0) {
        return Math.round(input.availableHours * 60)
    }
    const hours = Math.max(1, input.gridEndHour - input.gridStartHour)
    return hours * 60 * 7
}

/**
 * The "Available hours per week" setting text: `''` clears it (null), a
 * positive decimal (`10`, `37.5`, `10,5`, `40h`) is hours; anything else is
 * `undefined` (ignored, the field keeps its value).
 */
export function parseAvailableHours(raw: string): number | null | undefined {
    const text = raw
        .trim()
        .toLowerCase()
        .replace(/,/g, '.')
        .replace(/\s*h(?:ours?)?$/, '')
    if (text === '') return null
    if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined
    const value = Number(text)
    if (!Number.isFinite(value) || value <= 0 || value > 168) return undefined
    return value
}

/** `12%` (rounded), `–` without a base. */
export function formatShare(minutes: number, available: number): string {
    if (available <= 0) return '–'
    return `${Math.round((minutes / available) * 100)}%`
}

/**
 * The target a note should carry after planning `planned` minutes when the
 * target follows the plan: the planned minutes when they exceed the current
 * target, else null (nothing to raise). A missing target is not a raise —
 * see {@link seededTarget}. A target is NEVER lowered.
 */
export function raisedTarget(target: number | null, planned: number): number | null {
    if (target === null || target <= 0) return null
    return planned > target ? planned : null
}

/**
 * The target a note WITHOUT one should be seeded with when the target
 * follows the plan: what is now planned on the grid (the whole note, not
 * just the block that triggered the edit), or null when the note already
 * has a target or nothing is planned. The first block on a target-less note
 * thus sets the target instead of asking for it.
 */
export function seededTarget(target: number | null, planned: number): number | null {
    if (target !== null && target > 0) return null
    return planned > 0 ? planned : null
}

/** One grouped run of the rail or the table. */
export interface WeekGroup {
    /** `area:Health`, `context:@work`, `status:Active`, or `none`. */
    key: string
    label: string
    /** Sort rank (statuses keep their column order; values sort by label; the empty group last). */
    rank: number
    entries: WeekEntry[]
}

const NO_AREA = 'No area'
const NO_CONTEXT = 'No context'

/** The first area / context of an entry, or null. */
export function groupValueOf(entry: WeekEntry, by: 'area' | 'context'): string | null {
    const list = by === 'area' ? entry.areas : entry.contexts
    const first = list.find((v) => v.trim() !== '')
    return first ? first.trim() : null
}

/**
 * Group entries by their FIRST area or context (the value that colours a
 * block is the value that files it, so no note is counted twice), the
 * empty group last; titles sorted inside each group.
 */
export function groupByValue(entries: readonly WeekEntry[], by: 'area' | 'context'): WeekGroup[] {
    const groups = new Map<string, WeekGroup>()
    const emptyLabel = by === 'area' ? NO_AREA : NO_CONTEXT
    for (const entry of entries) {
        const value = groupValueOf(entry, by)
        const label = value ?? emptyLabel
        const key = `${by}:${value ?? ''}`
        const group = groups.get(key) ?? {
            key,
            label,
            rank: value === null ? Number.MAX_SAFE_INTEGER : 0,
            entries: []
        }
        group.entries.push(entry)
        groups.set(key, group)
    }
    return [...groups.values()]
        .map((g) => ({
            ...g,
            entries: [...g.entries].sort((a, b) => a.title.localeCompare(b.title))
        }))
        .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
}

/** Target and planned minutes of a set of entries (active ones only count). */
export interface WeekSubtotal {
    target: number
    planned: number
    /** Entries that counted (active). */
    counted: number
}

export function subtotalOf(entries: readonly WeekEntry[]): WeekSubtotal {
    let target = 0
    let planned = 0
    let counted = 0
    for (const entry of entries) {
        if (!entry.active) continue
        counted++
        target += entry.targetMinutes ?? 0
        planned += plannedMinutesPerWeek(entry.blocks)
    }
    return { target, planned, counted }
}

/** The totals row: everything against the available minutes. */
export interface WeekTotals extends WeekSubtotal {
    available: number
    /** Available minus the targets (negative when over-committed). */
    remaining: number
    /** Available minus the planned minutes. */
    unplanned: number
}

export function totalsOf(entries: readonly WeekEntry[], available: number): WeekTotals {
    const sub = subtotalOf(entries)
    return {
        ...sub,
        available,
        remaining: available - sub.target,
        unplanned: available - sub.planned
    }
}

/** The table's groups for a grouping choice: one anonymous group for `none`. */
export function targetsGroups(entries: readonly WeekEntry[], by: TargetsGroupBy): WeekGroup[] {
    if (by === 'none') {
        return [
            {
                key: 'none',
                label: '',
                rank: 0,
                entries: [...entries].sort((a, b) => a.title.localeCompare(b.title))
            }
        ]
    }
    return groupByValue(entries, by)
}

/**
 * Bar widths (0..1 of the available time) for a target / planned pair; the
 * larger of the two is clamped to the bar so an over-committed group still
 * draws, with `over` set.
 */
export function repartitionBar(
    target: number,
    planned: number,
    available: number
): { target: number; planned: number; over: boolean } {
    if (available <= 0) return { target: 0, planned: 0, over: target > 0 || planned > 0 }
    return {
        target: Math.min(1, target / available),
        planned: Math.min(1, planned / available),
        over: target > available || planned > available
    }
}
