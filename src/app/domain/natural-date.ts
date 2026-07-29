import { addDays, startOfDay, startOfWeek, toDateKey } from './calendar'

/**
 * Natural-language date entry (issue #116): a small, dependency-free parser
 * behind the date-prompt modal — the Todoist-style typed-date affordance.
 *
 * Grammar (case-insensitive, whitespace-tolerant):
 * - `today` / `tod`, `tomorrow` / `tom` / `tmr`, `yesterday`
 * - a bare weekday (`fri`, `friday`, …) → the NEXT occurrence strictly after
 *   today (1–7 days out; "today" already covers day 0)
 * - `next <weekday>` → that weekday within the week AFTER the current week,
 *   where weeks start on the configured first day (global setting)
 * - `next week` → the first day of next week (same setting)
 * - `in N d|w|mo` (also `day(s)`, `week(s)`, `month(s)`, or unitless = days),
 *   `+N [unit]`, or `N <unit>` — a bare number without `in`/`+`/unit is
 *   rejected as ambiguous (could mean a day of month)
 * - an explicit ISO date `YYYY-MM-DD`
 *
 * Returns local midnight, or null when the input is not recognized. The
 * caller formats the write via the configured date format downstream — this
 * module only resolves WHICH day is meant.
 */

const KEYWORDS: Record<string, number> = {
    today: 0,
    tod: 0,
    tomorrow: 1,
    tom: 1,
    tmr: 1,
    yesterday: -1
}

/** Accepted weekday spellings → JS weekday index (0 = Sunday … 6 = Saturday). */
const WEEKDAYS: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    weds: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6
}

/** `in 3`, `+2w`, `3d`, `in 2 weeks` — prefix (`in`/`+`) makes the unit optional. */
const PREFIXED_RELATIVE = /^(?:in\s+|\+\s*)(\d{1,3})\s*(d|days?|w|wks?|weeks?|mo|months?)?$/
const UNIT_RELATIVE = /^(\d{1,3})\s*(d|days?|w|wks?|weeks?|mo|months?)$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `date` plus `n` calendar months, clamping the day (Jan 31 + 1mo → Feb 28). */
function addMonthsClamped(date: Date, n: number): Date {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + n + 1, 0).getDate()
    return new Date(date.getFullYear(), date.getMonth() + n, Math.min(date.getDate(), lastDay))
}

function resolveRelative(amount: number, unit: string | undefined, today: Date): Date {
    if (unit === undefined || unit.startsWith('d')) return addDays(today, amount)
    if (unit.startsWith('w')) return addDays(today, amount * 7)
    return addMonthsClamped(startOfDay(today), amount)
}

/**
 * Parse a natural-language date phrase relative to `today`. Returns local
 * midnight of the resolved day, or null when unrecognized. `firstDayOfWeek`
 * (0 = Sunday … 6 = Saturday) anchors `next week` / `next <weekday>`.
 */
export function parseNaturalDate(
    raw: string,
    today: Date,
    firstDayOfWeek: number = 1
): Date | null {
    const input = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (input === '') return null

    const keywordOffset = KEYWORDS[input]
    if (keywordOffset !== undefined) return addDays(today, keywordOffset)

    const iso = ISO_DATE.exec(input)
    if (iso) {
        const [, y, m, d] = iso
        const date = new Date(Number(y), Number(m) - 1, Number(d))
        // Reject rollovers like 2026-02-31 (Date silently wraps to March).
        return toDateKey(date) === input ? date : null
    }

    const weekday = WEEKDAYS[input]
    if (weekday !== undefined) {
        const delta = (weekday - today.getDay() + 7) % 7
        return addDays(today, delta === 0 ? 7 : delta)
    }

    if (input === 'next week') return addDays(startOfWeek(today, firstDayOfWeek), 7)

    if (input.startsWith('next ')) {
        const target = WEEKDAYS[input.slice(5)]
        if (target === undefined) return null
        const nextWeekStart = addDays(startOfWeek(today, firstDayOfWeek), 7)
        return addDays(nextWeekStart, (target - firstDayOfWeek + 7) % 7)
    }

    const relative = PREFIXED_RELATIVE.exec(input) ?? UNIT_RELATIVE.exec(input)
    if (relative?.[1] !== undefined) return resolveRelative(Number(relative[1]), relative[2], today)

    return null
}

/**
 * Human preview of a resolved date for the modal's live hint:
 * `Fri 2026-08-07 · in 9 days` (or `today` / `tomorrow` / `N days ago`).
 */
export function formatNaturalDatePreview(date: Date, today: Date): string {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const delta = Math.round(
        (startOfDay(date).getTime() - startOfDay(today).getTime()) / 86_400_000
    )
    const relative =
        delta === 0
            ? 'today'
            : delta === 1
              ? 'tomorrow'
              : delta === -1
                ? 'yesterday'
                : delta > 1
                  ? `in ${String(delta)} days`
                  : `${String(-delta)} days ago`
    return `${dayNames[date.getDay()] ?? ''} ${toDateKey(date)} · ${relative}`
}
