import type { App, BasesEntry, BasesPropertyId, TFile } from 'obsidian'
import { getFrontmatterValue } from './frontmatter.service'
import { parseFrontmatterDate, startOfDay } from '../domain/calendar'
import type { CardDisplay, CardFieldView, DueState } from '../ui/board/types'

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

/** The subset of `BasesViewConfig` the card display reads (issue #50). */
interface CardFieldConfig {
    getOrder(): BasesPropertyId[]
    getDisplayName(propertyId: BasesPropertyId): string
}

/** The file/title property id — shown as the card's heading, never as a field. */
const TITLE_PROPERTY_ID = 'file.name'

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
 * (issue #50): the title (note name) plus one field per property in the view's
 * `getOrder()` (the standard Bases "Properties" toolbar), read per card via
 * `BasesEntry.getValue` and labelled by `getDisplayName`. Enum values are
 * prefix-stripped + heat-colored, numeric formulas become accent badges (card
 * scannability). Relationships are rendered separately, not here.
 */
export function buildCardDisplay(
    app: App,
    file: TFile,
    entry: BasesEntry | undefined,
    config: CardFieldConfig,
    dueDateProperty: string | null,
    today: Date,
    /** Allowed values for a property id (for heat ranking); defaults to none. */
    allowedValuesFor: (id: BasesPropertyId) => ReadonlyArray<string> = () => []
): CardDisplay {
    const fields: CardFieldView[] = []
    for (const id of config.getOrder()) {
        if (id === TITLE_PROPERTY_ID) continue // shown as the title
        const value = entry?.getValue(id)
        const text = value == null ? '' : value.toString().trim()
        // `NullValue.toString()` is "null"; skip empty/unset so cards don't show "Field: null".
        if (!text || text === 'null') continue
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

    const dueRaw = dueDateProperty ? getFrontmatterValue(app, file, dueDateProperty) : null
    return {
        title: file.basename,
        fields,
        coverUrl: null,
        wrap: true,
        dueState: computeDueState(parseFrontmatterDate(dueRaw), today)
    }
}
