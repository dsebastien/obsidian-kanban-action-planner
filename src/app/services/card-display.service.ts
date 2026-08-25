import type { App, BasesEntry, BasesPropertyId, TFile } from 'obsidian'
import { getFrontmatterValue } from './frontmatter.service'
import { parseFrontmatterDate, startOfDay } from '../domain/calendar'
import type {
    CardCountdown,
    CardDisplay,
    CardFieldView,
    CountdownPlacement,
    DueState
} from '../ui/board/types'

/**
 * Classify a due date against `today` (issue #22): `overdue` when strictly
 * before today, `today` on the day itself, else `none`. Pure + unit-tested.
 */
export function computeDueState(due: Date | null, today: Date): DueState {
    if (!due) return 'none'
    const d = startOfDay(due).getTime()
    const t = startOfDay(today).getTime()
    if (d < t) return 'overdue'
    if (d === t) return 'today'
    return 'none'
}

const DAY_MS = 86_400_000

/**
 * Format a span of `n` whole days (n > 0) at auto granularity: days under ~2
 * weeks, then weeks (under ~2 months), then months. E.g. `3` → `3d`, `14` →
 * `2w`, `90` → `3mo`.
 */
function formatDaySpan(n: number): string {
    if (n < 14) return `${String(n)}d`
    if (n < 60) return `${String(Math.round(n / 7))}w`
    return `${String(Math.round(n / 30))}mo`
}

/**
 * Build a human-readable due countdown (issue #62) from a due date vs `today`:
 * `today`, `in 3d` / `in 2w` / `in 3mo` (future), or `2d overdue` (past). The
 * `tone` extends the {@link computeDueState} scale — `overdue` / `today` / `soon`
 * (within `soonDays`) / `future` — and drives **color, not visibility**. Returns
 * null when there's no due date. Pure + unit-tested.
 */
export function formatCountdown(
    due: Date | null,
    today: Date,
    soonDays: number,
    placement: CountdownPlacement
): CardCountdown | null {
    if (!due) return null
    const days = Math.round((startOfDay(due).getTime() - startOfDay(today).getTime()) / DAY_MS)
    if (days === 0) return { text: 'Today', tone: 'today', placement }
    if (days < 0) return { text: `${formatDaySpan(-days)} overdue`, tone: 'overdue', placement }
    return {
        text: `In ${formatDaySpan(days)}`,
        tone: days <= soonDays ? 'soon' : 'future',
        placement
    }
}

/** The subset of `BasesViewConfig` the card display reads (issue #50). */
interface CardFieldConfig {
    getOrder(): BasesPropertyId[]
    getDisplayName(propertyId: BasesPropertyId): string
}

/** The file/title property id — shown as the card's heading, never as a field. */
const TITLE_PROPERTY_ID = 'file.name'

/** Read a Bases entry value as trimmed display text ('' when unset/NullValue). */
function entryText(entry: BasesEntry | undefined, id: BasesPropertyId): string {
    const value = entry?.getValue(id)
    const text = value == null ? '' : value.toString().trim()
    // `NullValue.toString()` is "null" — treat it as unset.
    return text === 'null' ? '' : text
}

/**
 * Resolve the card's heading (issue #4): the configured title property's value
 * when set and non-empty, else the note name — so date/ID-based filenames can
 * show a readable `title`/`name` property instead, and cards never go blank.
 */
export function resolveCardTitle(
    entry: BasesEntry | undefined,
    titleProperty: BasesPropertyId | null,
    basename: string
): string {
    if (!titleProperty || titleProperty === TITLE_PROPERTY_ID) return basename
    return entryText(entry, titleProperty) || basename
}

/**
 * Detect a percentage field so it can render as a progress bar: the label must
 * read like a percentage/progress (`%` or "progress", case-insensitive) and the
 * value must be a finite number, clamped to 0–100. Returns `null` otherwise.
 * Pure + unit-tested.
 */
export function parseProgressField(label: string | null, text: string): number | null {
    if (!label || !/%|progress/i.test(label)) return null
    const raw = text.replace('%', '').trim()
    if (raw === '') return null // `Number('')` is 0 — guard so a blank value isn't a 0% bar
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return Math.max(0, Math.min(100, n))
}

/**
 * Strip a leading `NN - ` sort-order prefix from an enum value ("30 - High" →
 * "High"). Requires whitespace **before** the dash so an ISO date
 * (`2026-01-15`) is never mistaken for a prefixed enum.
 */
export function stripEnumPrefix(text: string): string {
    return text.replace(/^\d+\s+-\s*/, '')
}

/** Parse the leading integer of an `NN - Label` enum value (space-dashed), or null. */
export function parseEnumPrefix(text: string): number | null {
    const m = /^(\d+)\s+-/.exec(text)
    return m && m[1] !== undefined ? Number.parseInt(m[1], 10) : null
}

/**
 * Heat bucket (0 = warmest … 4 = coolest) for an enum `value` ranked within its
 * property's `allowedValues` — by the numeric `NN -` prefix, so it's robust to
 * the order the allowed list is returned in. Returns null when the value has no
 * prefix or the scale can't be established (→ neutral). The highest prefix (e.g.
 * a `99 - TBD` sentinel) naturally lands coolest. Pure + unit-tested.
 */
export function heatLevel(value: string, allowedValues: ReadonlyArray<string>): number | null {
    const p = parseEnumPrefix(value)
    if (p === null) return null
    const nums = Array.from(
        new Set(allowedValues.map(parseEnumPrefix).filter((n): n is number => n !== null))
    ).sort((a, b) => a - b)
    if (nums.length < 2) return null
    const rank = nums.indexOf(p)
    if (rank < 0) return null
    const frac = rank / (nums.length - 1) // 0 = lowest prefix (warmest)
    return Math.min(4, Math.round(frac * 4))
}

/** A pure number (integer or decimal), used to flag a numeric formula "score". */
function isNumeric(text: string): boolean {
    return text !== '' && Number.isFinite(Number(text))
}

/**
 * Build a card's presentation from the **Bases view's configured properties**
 * (issue #50): the title (note name, or the per-view title property — issue #4)
 * plus one field per property in the view's `getOrder()` (the standard Bases
 * "Properties" toolbar), read per card via `BasesEntry.getValue` and labelled by
 * `getDisplayName`. Enum values are prefix-stripped + heat-colored, numeric
 * formulas become accent badges (card scannability). Relationships are rendered
 * separately, not here.
 */
export function buildCardDisplay(
    app: App,
    file: TFile,
    entry: BasesEntry | undefined,
    config: CardFieldConfig,
    /** Card-title source (issue #4): a Bases property id, or null → note name. */
    titleProperty: BasesPropertyId | null,
    dueDateProperty: string | null,
    today: Date,
    /**
     * Countdown config (issue #62): show flag, soon-threshold, placement, plus
     * the date it counts down to (issue #68) — the deadline by default, or the
     * scheduled date when the view counts down to when work is planned to start.
     * `property` never affects `dueState`, which always follows the deadline.
     */
    countdown: {
        show: boolean
        soonDays: number
        placement: CountdownPlacement
        property?: string | null
    },
    /** Allowed values for a property id (for heat ranking); defaults to none. */
    allowedValuesFor: (id: BasesPropertyId) => ReadonlyArray<string> = () => [],
    /**
     * Just-written note-property values (issue #105, finding 4.3), keyed by
     * LOWERCASE property name (`null` = cleared). The Bases entry and the
     * metadata cache are both stale right after a frontmatter write, so an
     * optimistic display recompute substitutes these for the matching reads —
     * card fields AND the due-date state/countdown.
     */
    overrides?: ReadonlyMap<string, string | null>
): CardDisplay {
    /** The override for a `note.*` property id, or undefined when none applies. */
    const noteOverride = (id: BasesPropertyId): string | null | undefined => {
        if (!overrides || overrides.size === 0 || !id.startsWith('note.')) return undefined
        const key = id.slice('note.'.length).toLowerCase()
        return overrides.has(key) ? (overrides.get(key) ?? null) : undefined
    }

    const fields: CardFieldView[] = []
    for (const id of config.getOrder()) {
        if (id === TITLE_PROPERTY_ID || id === titleProperty) continue // shown as the title
        // Skip empty/unset so cards don't show "Field: null".
        const override = noteOverride(id)
        const text = override === undefined ? entryText(entry, id) : (override ?? '').trim()
        if (!text) continue
        const label = config.getDisplayName(id)
        const progress = parseProgressField(label, text)
        if (progress !== null) {
            fields.push({
                label,
                text: `${progress}%`,
                emphasis: 'normal',
                progress,
                tone: 'neutral',
                heat: null
            })
            continue
        }
        // A numeric formula (e.g. a priority_score) → a filled accent badge.
        if (id.startsWith('formula.') && isNumeric(text)) {
            fields.push({
                label,
                text,
                emphasis: 'normal',
                progress: null,
                tone: 'badge',
                heat: null
            })
            continue
        }
        // Enum value → strip the `NN -` sort prefix and color by its rank.
        const heat = heatLevel(text, allowedValuesFor(id))
        fields.push({
            label,
            text: stripEnumPrefix(text),
            emphasis: 'normal',
            progress: null,
            tone: heat === null ? 'neutral' : 'heat',
            heat
        })
    }

    /** Read a date property, honoring the just-written overrides. */
    const readDate = (property: string | null): Date | null => {
        if (!property) return null
        const key = property.toLowerCase()
        const raw = overrides?.has(key)
            ? (overrides.get(key) ?? null)
            : getFrontmatterValue(app, file, property)
        return parseFrontmatterDate(raw)
    }

    const due = readDate(dueDateProperty)
    // The countdown may follow a different date than the deadline (issue #68);
    // when it is the same property, reuse the value rather than re-reading.
    const countdownProperty = countdown.property ?? dueDateProperty
    const countdownDate = countdownProperty === dueDateProperty ? due : readDate(countdownProperty)
    return {
        title: resolveCardTitle(entry, titleProperty, file.basename),
        fields,
        coverUrl: null,
        wrap: true,
        // Always the deadline: overdue/due-today emphasis is about what is owed,
        // not about when you planned to start.
        dueState: computeDueState(due, today),
        countdown: countdown.show
            ? formatCountdown(countdownDate, today, countdown.soonDays, countdown.placement)
            : null
    }
}
