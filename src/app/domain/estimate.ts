/**
 * Unit-aware estimate resolution — pure, unit-tested.
 *
 * Estimates live in frontmatter in one of two units: **days** (the default;
 * the global `defaultEstimateProperty`) or **minutes** (per-note-type
 * override — e.g. tasknotes-compatible `time_estimate`). All rollup /
 * timeline / span math runs in DAYS; minute values convert through the
 * global "minutes per day" setting (default 480 = an 8-hour workday). Date
 * geometry (timeline bars, derived spans) uses the whole-day `spanDays`
 * (≥ 1); writes always happen in the note's own unit.
 */

export type EstimateUnit = 'days' | 'minutes'

/** A note type's estimate override; absent = global property, days. */
export interface EstimateConfig {
    /** Frontmatter property name ('' = the global default property). */
    property: string
    unit: EstimateUnit
}

/** One parsed estimate, resolved into every representation the views need. */
export interface ResolvedEstimate {
    /** Effort in days (float for minute-based values) — the math unit. */
    days: number
    /** Whole-day span for date geometry (≥ 1). */
    spanDays: number
    /** The stored value, unit-native (what edits/prefills operate on). */
    raw: number
    /** Unit-aware display label ("3d", "45m", "1h 30m"). */
    label: string
}

function toNumber(raw: unknown): number | null {
    let value: number
    if (typeof raw === 'number') value = raw
    else if (typeof raw === 'string' && raw.trim() !== '') value = Number(raw)
    else return null
    return Number.isFinite(value) ? value : null
}

/**
 * Parse a raw frontmatter value in `unit`. Days keep the historical
 * semantics (rounded UP to whole days, minimum 1); minutes keep their exact
 * value (minimum 1 minute) and convert to fractional days for the math.
 */
export function readEstimate(
    raw: unknown,
    unit: EstimateUnit,
    minutesPerDay: number
): ResolvedEstimate | null {
    const value = toNumber(raw)
    if (value === null) return null
    if (unit === 'days') {
        const days = Math.ceil(value)
        if (days < 1) return null
        return { days, spanDays: days, raw: days, label: formatUnitValue(days, 'days') }
    }
    const minutes = Math.round(value)
    if (minutes < 1) return null
    const perDay = minutesPerDay > 0 ? minutesPerDay : 1
    const days = minutes / perDay
    return {
        days,
        spanDays: Math.max(1, Math.ceil(days)),
        raw: minutes,
        label: formatUnitValue(minutes, 'minutes')
    }
}

/** Label for a days quantity ("3d"; fractional rollups get one decimal). */
export function formatDaysLabel(days: number): string {
    const rounded = Math.round(days * 10) / 10
    return Number.isInteger(rounded) ? `${String(rounded)}d` : `${rounded.toFixed(1)}d`
}

/** Label for a unit-native value ("3d", "45m", "1h", "1h 30m"). */
export function formatUnitValue(value: number, unit: EstimateUnit): string {
    if (unit === 'days') return formatDaysLabel(value)
    const minutes = Math.round(value)
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    if (hours === 0) return `${String(rest)}m`
    return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`
}

/** Convert a days quantity into a writable unit-native value (≥ 1). */
export function daysToUnit(days: number, unit: EstimateUnit, minutesPerDay: number): number {
    if (unit === 'days') return Math.max(1, Math.round(days))
    const perDay = minutesPerDay > 0 ? minutesPerDay : 1
    return Math.max(1, Math.round(days * perDay))
}

/**
 * Parse a human duration input into the TARGET unit's writable value.
 *
 * A bare number is already in the target unit (the historical behavior:
 * days round UP to whole days, minutes round to the minute — both ≥ 1).
 * `d` / `h` / `m` suffixes convert regardless of the target unit — days via
 * `minutesPerDay` (so "0.5d" → 240 minutes at the 480 default, and "4h" on a
 * day-based note → 1 day). Tokens combine ("1d 4h", "1h30m"); decimals with
 * `.` or `,` both parse. Returns null for anything unrecognized.
 */
export function parseEstimateInput(
    raw: string,
    targetUnit: EstimateUnit,
    minutesPerDay: number
): number | null {
    const text = raw.trim().toLowerCase().replace(/,/g, '.')
    if (text === '') return null
    const perDay = minutesPerDay > 0 ? minutesPerDay : 1
    if (/^\d+(?:\.\d+)?$/.test(text)) {
        const value = Number(text)
        if (!Number.isFinite(value) || value <= 0) return null
        return targetUnit === 'days' ? Math.ceil(value) : Math.max(1, Math.round(value))
    }
    if (!/^(?:\d+(?:\.\d+)?\s*[dhm]\s*)+$/.test(text)) return null
    let minutes = 0
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhm])/g)) {
        const value = Number(match[1])
        if (!Number.isFinite(value)) return null
        const unit = match[2]
        minutes += unit === 'd' ? value * perDay : unit === 'h' ? value * 60 : value
    }
    if (minutes <= 0) return null
    return targetUnit === 'days'
        ? Math.max(1, Math.ceil(minutes / perDay))
        : Math.max(1, Math.round(minutes))
}
