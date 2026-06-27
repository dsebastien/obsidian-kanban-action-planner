/**
 * Pure calendar math for the scheduling view (Milestone 5).
 *
 * No Obsidian or DOM dependencies so it is fully unit-testable. The view layer
 * supplies `today`/`anchor` dates and a `dateOf` accessor; this module produces
 * the grid blocks and buckets cards onto day keys. Date *formatting* for writes
 * lives in `utils/momentjs.ts`; this module only reads/derives.
 */

/** Calendar zoom level. */
export type CalendarRange = 'week' | 'month' | 'quarter' | 'year'

/**
 * Which date dimension the scheduling view is operating on. `scheduled` uses the
 * scheduled-date property (default `date_scheduled`); `deadline` uses the
 * due-date property (default `date_due`). The active tab selects the dimension.
 */
export type DateDimension = 'scheduled' | 'deadline'

/** A single day cell in a calendar grid. */
export interface CalendarDay {
    date: Date
    /** `YYYY-MM-DD` local key — the bucketing key and `data-day` attribute. */
    key: string
    /** False for leading/trailing days that spill from an adjacent month. */
    inCurrentMonth: boolean
    isToday: boolean
}

/** A labelled block of weeks (a month grid, or a single week for week range). */
export interface CalendarBlock {
    label: string
    weeks: CalendarDay[][]
}

const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
]

/** Short weekday names indexed by `Date.getDay()` (0 = Sunday). */
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Default first day of the week (Monday) when none is supplied. */
const DEFAULT_FIRST_DAY = 1

/** Weekday header labels starting at `firstDay` (0 = Sunday … 6 = Saturday). */
export function weekdayLabels(firstDay: number = DEFAULT_FIRST_DAY): string[] {
    return Array.from({ length: 7 }, (_, i) => WEEKDAY_NAMES[(firstDay + i) % 7] ?? '')
}

/** Local `YYYY-MM-DD` key for a date (timezone-stable, no UTC shift). */
export function toDateKey(date: Date): string {
    const y = String(date.getFullYear()).padStart(4, '0')
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

/** Strip the time component, returning local midnight of the same day. */
export function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * The start of the week containing `date`, for a configurable `firstDay`
 * (0 = Sunday … 6 = Saturday; default Monday). Returns local midnight.
 */
export function startOfWeek(date: Date, firstDay: number = DEFAULT_FIRST_DAY): Date {
    const d = startOfDay(date)
    const delta = (d.getDay() - firstDay + 7) % 7
    d.setDate(d.getDate() - delta)
    return d
}

/**
 * Parse a frontmatter date value into a local-midnight `Date`, or `null`.
 * Accepts a `Date`, a `YYYY-MM-DD[...]` string (date part used, parsed as local
 * to avoid the UTC off-by-one), or any other `Date`-parseable string.
 */
export function parseFrontmatterDate(raw: unknown): Date | null {
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : startOfDay(raw)
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed.length === 0) return null
        const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (iso) {
            const [, y, m, d] = iso
            return new Date(Number(y), Number(m) - 1, Number(d))
        }
        const parsed = new Date(trimmed)
        return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed)
    }
    return null
}

/** Build a 6×7 month grid (starting on `firstDay`), marking spill days and today. */
export function monthBlock(
    year: number,
    month0: number,
    today: Date,
    firstDay: number = DEFAULT_FIRST_DAY
): CalendarBlock {
    const first = new Date(year, month0, 1)
    const gridStart = startOfWeek(first, firstDay)
    const todayKey = toDateKey(today)
    const weeks: CalendarDay[][] = []
    const cursor = new Date(gridStart)
    for (let w = 0; w < 6; w++) {
        const week: CalendarDay[] = []
        for (let i = 0; i < 7; i++) {
            const date = new Date(cursor)
            week.push({
                date,
                key: toDateKey(date),
                inCurrentMonth: date.getMonth() === month0,
                isToday: toDateKey(date) === todayKey
            })
            cursor.setDate(cursor.getDate() + 1)
        }
        weeks.push(week)
    }
    return { label: `${MONTH_NAMES[month0] ?? ''} ${String(year)}`, weeks }
}

/** Build a single 7-day week block around `anchor`, starting on `firstDay`. */
export function weekBlock(
    anchor: Date,
    today: Date,
    firstDay: number = DEFAULT_FIRST_DAY
): CalendarBlock {
    const start = startOfWeek(anchor, firstDay)
    const todayKey = toDateKey(today)
    const week: CalendarDay[] = []
    const cursor = new Date(start)
    for (let i = 0; i < 7; i++) {
        const date = new Date(cursor)
        week.push({
            date,
            key: toDateKey(date),
            inCurrentMonth: true,
            isToday: toDateKey(date) === todayKey
        })
        cursor.setDate(cursor.getDate() + 1)
    }
    const end = week[6]?.date ?? start
    return {
        label: `${MONTH_NAMES[start.getMonth()] ?? ''} ${String(start.getDate())} – ${MONTH_NAMES[end.getMonth()] ?? ''} ${String(end.getDate())}, ${String(end.getFullYear())}`,
        weeks: [week]
    }
}

/**
 * Build the calendar blocks for `anchor` at the given `range`:
 * - `week` → one week block
 * - `month` → the anchor's month grid
 * - `quarter` → the three month grids of the anchor's quarter
 * - `year` → all twelve month grids of the anchor's year
 */
export function buildCalendar(
    anchor: Date,
    range: CalendarRange,
    today: Date,
    firstDay: number = DEFAULT_FIRST_DAY
): CalendarBlock[] {
    const year = anchor.getFullYear()
    const month0 = anchor.getMonth()
    switch (range) {
        case 'week':
            return [weekBlock(anchor, today, firstDay)]
        case 'month':
            return [monthBlock(year, month0, today, firstDay)]
        case 'quarter': {
            const qStart = Math.floor(month0 / 3) * 3
            return [0, 1, 2].map((i) => monthBlock(year, qStart + i, today, firstDay))
        }
        case 'year':
            return Array.from({ length: 12 }, (_, m) => monthBlock(year, m, today, firstDay))
    }
}

/** Step the anchor by one unit of `range` in `direction` (−1 prev, +1 next). */
export function shiftAnchor(anchor: Date, range: CalendarRange, direction: number): Date {
    const d = startOfDay(anchor)
    switch (range) {
        case 'week':
            d.setDate(d.getDate() + 7 * direction)
            return d
        case 'month':
            d.setMonth(d.getMonth() + direction)
            return d
        case 'quarter':
            d.setMonth(d.getMonth() + 3 * direction)
            return d
        case 'year':
            d.setFullYear(d.getFullYear() + direction)
            return d
    }
}

/** Bucket items onto local day keys via `dateOf`; items with no date are skipped. */
export function bucketByDay<T>(
    items: ReadonlyArray<T>,
    dateOf: (item: T) => Date | null
): Map<string, T[]> {
    const map = new Map<string, T[]>()
    for (const item of items) {
        const date = dateOf(item)
        if (!date) continue
        const key = toDateKey(date)
        const bucket = map.get(key)
        if (bucket) bucket.push(item)
        else map.set(key, [item])
    }
    return map
}
