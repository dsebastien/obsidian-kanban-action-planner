/**
 * Ideal-week time blocks (issue #172, phase B).
 *
 * A note's `time_blocks` list holds strings of the form `<days> <start>-<end>`:
 * day tokens `mon`..`sun` as a single day, a list (`tue,thu`), a range
 * (`mon-fri`), or a mix (`mon-wed,fri`); times `HH:MM` on a 15-minute grid;
 * an end earlier than (or equal to) the start crosses midnight. One entry
 * with several days is a REPEAT: it expands to one {@link Slot} per day.
 *
 * Days are Monday-first (0 = Monday … 6 = Sunday), like the week-planner app.
 * Slot times are minutes from the day's 00:00; a slot crossing midnight has
 * `end > 1440`. Every function here is pure and Obsidian-free.
 */

/** Minutes in a day / a week, and the grid step. */
export const MINUTES_PER_DAY = 1440
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY
export const GRID_MINUTES = 15

/** Day tokens, Monday-first. */
export const DAY_TOKENS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** A parsed entry: the repeat days (sorted, unique) and the time range. */
export interface TimeBlock {
    /** Monday-first day indexes, sorted, unique. */
    days: number[]
    /** Minutes from 00:00, on the grid, 0..1425. */
    start: number
    /** Minutes from 00:00; `end > start` within the day, or `end > 1440` when crossing midnight. */
    end: number
}

/** One concrete occurrence of a block on one day. */
export interface Slot {
    day: number
    start: number
    end: number
}

export type ParseResult = { ok: true; block: TimeBlock } | { ok: false; error: string }

/** Parse one day token list (`mon`, `tue,thu`, `mon-fri`, `mon-wed,fri`) into day indexes. */
function parseDays(text: string): number[] | string {
    const days = new Set<number>()
    for (const part of text.split(',')) {
        const token = part.trim().toLowerCase()
        if (token === '') return `empty day in "${text}"`
        const range = token.split('-')
        if (range.length > 2) return `bad day range "${token}"`
        const from = DAY_TOKENS.indexOf(range[0]?.trim() as (typeof DAY_TOKENS)[number])
        const to =
            range.length === 2
                ? DAY_TOKENS.indexOf(range[1]?.trim() as (typeof DAY_TOKENS)[number])
                : from
        if (from < 0 || to < 0) return `unknown day "${token}"`
        // A range wraps past Sunday (`sat-mon` = sat, sun, mon).
        for (let d = from; ; d = (d + 1) % 7) {
            days.add(d)
            if (d === to) break
        }
    }
    return [...days].sort((a, b) => a - b)
}

/** Parse `HH:MM` into minutes, on the 15-minute grid; a string names the error. */
function parseTime(text: string): number | string {
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
    if (!m) return `bad time "${text}" (expected HH:MM)`
    const hours = Number(m[1])
    const minutes = Number(m[2])
    if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) {
        return `time out of range "${text}"`
    }
    const total = hours * 60 + minutes
    if (total % GRID_MINUTES !== 0) return `"${text}" is not on the 15-minute grid`
    return total
}

/** Parse one `time_blocks` entry. */
export function parseTimeBlock(text: string): ParseResult {
    const trimmed = text.trim()
    const m = /^(\S+)\s+(\S+)\s*-\s*(\S+)$/.exec(trimmed)
    if (!m) {
        return { ok: false, error: `"${trimmed}" is not "<days> HH:MM-HH:MM"` }
    }
    const days = parseDays(m[1] ?? '')
    if (typeof days === 'string') return { ok: false, error: `${days} in "${trimmed}"` }
    const start = parseTime(m[2] ?? '')
    if (typeof start === 'string') return { ok: false, error: `${start} in "${trimmed}"` }
    let end = parseTime(m[3] ?? '')
    if (typeof end === 'string') return { ok: false, error: `${end} in "${trimmed}"` }
    if (start >= MINUTES_PER_DAY) {
        return { ok: false, error: `start must be before 24:00 in "${trimmed}"` }
    }
    // `end <= start` crosses midnight (an `end` of 24:00 or 00:00 ends the day).
    if (end <= start) end += MINUTES_PER_DAY
    if (end - start > MINUTES_PER_DAY) {
        return { ok: false, error: `block longer than a day in "${trimmed}"` }
    }
    return { ok: true, block: { days, start, end } }
}

/** Every well-formed entry of a raw list, plus the errors naming the bad ones. */
export function parseTimeBlocks(raw: unknown): {
    blocks: TimeBlock[]
    errors: { entry: string; error: string }[]
} {
    const blocks: TimeBlock[] = []
    const errors: { entry: string; error: string }[] = []
    const list = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]
    for (const item of list) {
        if (item === null || item === undefined) continue
        if (typeof item !== 'string') {
            errors.push({ entry: String(item), error: 'not a string' })
            continue
        }
        if (item.trim() === '') continue
        const result = parseTimeBlock(item)
        if (result.ok) blocks.push(result.block)
        else errors.push({ entry: item, error: result.error })
    }
    return { blocks, errors }
}

/** `HH:MM` for minutes from 00:00 (1440 renders as `24:00`; beyond wraps). */
export function formatMinutes(minutes: number): string {
    const m =
        minutes === MINUTES_PER_DAY
            ? minutes
            : ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
    const h = Math.floor(m / 60)
    const rest = m % 60
    return `${h < 10 ? '0' : ''}${h}:${rest < 10 ? '0' : ''}${rest}`
}

/** Compact day tokens: consecutive runs of 3+ become ranges (`mon-wed,fri`). */
export function formatDays(days: readonly number[]): string {
    const sorted = [...new Set(days)].sort((a, b) => a - b)
    const parts: string[] = []
    let i = 0
    while (i < sorted.length) {
        let j = i
        while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] ?? -1) + 1) j++
        const from = sorted[i] ?? 0
        const to = sorted[j] ?? 0
        if (j - i >= 2) parts.push(`${DAY_TOKENS[from]}-${DAY_TOKENS[to]}`)
        else for (let k = i; k <= j; k++) parts.push(DAY_TOKENS[sorted[k] ?? 0] ?? '')
        i = j + 1
    }
    return parts.join(',')
}

/** The canonical string of a block (`mon-fri 09:00-12:00`; a crosser ends past midnight as `23:00-01:00`). */
export function formatTimeBlock(block: TimeBlock): string {
    const end = block.end > MINUTES_PER_DAY ? block.end - MINUTES_PER_DAY : block.end
    return `${formatDays(block.days)} ${formatMinutes(block.start)}-${formatMinutes(end)}`
}

/** One slot per repeat day. */
export function expandSlots(block: TimeBlock): Slot[] {
    return block.days.map((day) => ({ day, start: block.start, end: block.end }))
}

/** Every slot of a list of blocks. */
export function slotsOf(blocks: readonly TimeBlock[]): Slot[] {
    return blocks.flatMap(expandSlots)
}

/** Minutes one slot reserves. */
export function slotMinutes(slot: Slot): number {
    return Math.max(0, slot.end - slot.start)
}

/** Minutes per week reserved by a list of blocks (the `minutes_planned_per_week` cache). */
export function plannedMinutesPerWeek(blocks: readonly TimeBlock[]): number {
    let total = 0
    for (const slot of slotsOf(blocks)) total += slotMinutes(slot)
    return total
}

/**
 * A slot as half-open intervals of absolute week minutes (Monday 00:00 = 0).
 * A Sunday slot crossing midnight wraps into Monday, hence up to two pieces.
 */
export function slotIntervals(slot: Slot): [number, number][] {
    const start = slot.day * MINUTES_PER_DAY + slot.start
    const end = slot.day * MINUTES_PER_DAY + slot.end
    if (end <= MINUTES_PER_WEEK) return [[start, end]]
    return [
        [start, MINUTES_PER_WEEK],
        [0, end - MINUTES_PER_WEEK]
    ]
}

/** Whether two slots share any minute (midnight and week wrap included). */
export function slotsOverlap(a: Slot, b: Slot): boolean {
    for (const [as, ae] of slotIntervals(a)) {
        for (const [bs, be] of slotIntervals(b)) {
            if (as < be && bs < ae) return true
        }
    }
    return false
}

/** A slot attributed to a note (for cross-note overlap detection). */
export interface OwnedSlot extends Slot {
    path: string
}

/**
 * The first slot among `others` overlapping `candidate`, ignoring slots of
 * `candidate`'s own path when `ignoreOwn` names it (a block being moved must
 * not collide with its old position or its own repeats on other days —
 * those are on other days by construction, but the moved slot's origin is
 * passed as `except`). Null when free.
 */
export function findOverlap(
    candidate: Slot,
    others: readonly OwnedSlot[],
    except?: Slot | null
): OwnedSlot | null {
    for (const other of others) {
        if (
            except &&
            other.day === except.day &&
            other.start === except.start &&
            other.end === except.end
        ) {
            continue
        }
        if (slotsOverlap(candidate, other)) return other
    }
    return null
}

/** Snap minutes to the grid (nearest step). */
export function snapToGrid(minutes: number, step = GRID_MINUTES): number {
    return Math.round(minutes / step) * step
}

/** Clamp a slot into a legal shape: on the grid, at least one step long, within a day span. */
export function normalizeSlot(slot: Slot): Slot {
    const day = ((Math.round(slot.day) % 7) + 7) % 7
    let start = Math.min(MINUTES_PER_DAY - GRID_MINUTES, Math.max(0, snapToGrid(slot.start)))
    let end = snapToGrid(slot.end)
    if (end <= start) end = start + GRID_MINUTES
    if (end - start > MINUTES_PER_DAY) end = start + MINUTES_PER_DAY
    return { day, start, end }
}

// ── Editing the list ────────────────────────────────────────────────────

/** Whether two slots are the same occurrence. */
function sameSlot(a: Slot, b: Slot): boolean {
    return a.day === b.day && a.start === b.start && a.end === b.end
}

/**
 * Remove one occurrence: the day leaves its entry (an entry with no day left
 * is dropped). Other days of a repeat are untouched.
 */
export function removeSlot(blocks: readonly TimeBlock[], slot: Slot): TimeBlock[] {
    const out: TimeBlock[] = []
    for (const block of blocks) {
        if (block.start === slot.start && block.end === slot.end && block.days.includes(slot.day)) {
            const days = block.days.filter((d) => d !== slot.day)
            if (days.length > 0) out.push({ ...block, days })
        } else {
            out.push(block)
        }
    }
    return out
}

/**
 * Add one occurrence: joins an entry with the same time range (a repeat
 * grows), else appends a new entry. The list order is preserved.
 */
export function addSlot(blocks: readonly TimeBlock[], slot: Slot): TimeBlock[] {
    const normalized = normalizeSlot(slot)
    const out = blocks.map((b) => ({ ...b, days: [...b.days] }))
    const target = out.find((b) => b.start === normalized.start && b.end === normalized.end)
    if (target) {
        if (!target.days.includes(normalized.day)) {
            target.days = [...target.days, normalized.day].sort((a, b) => a - b)
        }
        return out
    }
    out.push({ days: [normalized.day], start: normalized.start, end: normalized.end })
    return out
}

/** Move / resize one occurrence: remove `from`, add `to`. */
export function replaceSlot(blocks: readonly TimeBlock[], from: Slot, to: Slot): TimeBlock[] {
    if (sameSlot(from, normalizeSlot(to))) return blocks.map((b) => ({ ...b, days: [...b.days] }))
    return addSlot(removeSlot(blocks, from), to)
}

/** The list as strings, ready to write back. */
export function formatTimeBlocks(blocks: readonly TimeBlock[]): string[] {
    return blocks.map(formatTimeBlock)
}

/** The contiguous run of days (in `days`) containing `day`: `[first, last]`. */
export function dayRunOf(days: readonly number[], day: number): [number, number] {
    const set = new Set(days)
    if (!set.has(day)) return [day, day]
    let first = day
    let last = day
    while (first > 0 && set.has(first - 1)) first--
    while (last < 6 && set.has(last + 1)) last++
    return [first, last]
}

/**
 * Stretch (or shrink) the run of days an occurrence belongs to, by dragging
 * one of its horizontal edges to `toDay`: the run containing `slot.day`
 * inside the entry with the same time range becomes `[run start, toDay]`
 * (right edge) or `[toDay, run end]` (left edge), never crossing the
 * opposite bound. Returns the new list and the days the run GAINED (the
 * overlap check runs on those only).
 */
export function spanRun(
    blocks: readonly TimeBlock[],
    slot: Slot,
    edge: 'left' | 'right',
    toDay: number
): { blocks: TimeBlock[]; addedDays: number[] } {
    const out = blocks.map((b) => ({ ...b, days: [...b.days] }))
    const target = out.find(
        (b) => b.start === slot.start && b.end === slot.end && b.days.includes(slot.day)
    )
    if (!target) return { blocks: out, addedDays: [] }
    const [first, last] = dayRunOf(target.days, slot.day)
    const day = Math.max(0, Math.min(6, Math.round(toDay)))
    const range: [number, number] =
        edge === 'right' ? [first, Math.max(first, day)] : [Math.min(last, day), last]
    const run = new Set<number>()
    for (let d = first; d <= last; d++) run.add(d)
    const kept = target.days.filter((d) => !run.has(d))
    const next = new Set(kept)
    const addedDays: number[] = []
    for (let d = range[0]; d <= range[1]; d++) {
        if (!target.days.includes(d)) addedDays.push(d)
        next.add(d)
    }
    target.days = [...next].sort((a, b) => a - b)
    return { blocks: out, addedDays }
}
