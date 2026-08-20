/**
 * Column aggregates (issue #23): a per-column roll-up of one numeric property,
 * shown in the column header next to the card count — a quick capacity/load
 * read ("Σ 13" of estimate or points).
 *
 * Pure math only: the view reads the property per card (frontmatter or a
 * `formula.*`/`file.*` column) and injects the values; the renderer only draws
 * the label this module produces.
 */

/** The roll-up function. `none` disables the aggregate entirely. */
export type AggregateKind = 'none' | 'sum' | 'avg' | 'min' | 'max'

const KINDS = new Set<string>(['none', 'sum', 'avg', 'min', 'max'])

/** Read a stored (untyped Bases config) value as an {@link AggregateKind}. */
export function readAggregateKind(value: unknown): AggregateKind {
    return typeof value === 'string' && KINDS.has(value) ? (value as AggregateKind) : 'none'
}

/**
 * Coerce a raw property value to a finite number, or `null` when it is not
 * numeric. Non-numeric values are **ignored** by the aggregate rather than
 * counted as zero — a column of untagged cards must not drag an average down.
 * Booleans are not numbers here (`true` is not 1); an empty/whitespace string
 * is nothing, not 0.
 */
export function toAggregateNumber(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed === '') return null
        const parsed = Number(trimmed)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

/**
 * Apply `kind` over the numeric values (nulls already dropped by the caller or
 * skipped here). Returns `null` when the kind is `none` or nothing numeric
 * remains — the header then shows the plain card count, with no empty badge.
 */
export function computeAggregate(
    values: ReadonlyArray<number | null>,
    kind: AggregateKind
): number | null {
    if (kind === 'none') return null
    const numbers = values.filter((v): v is number => v !== null)
    if (numbers.length === 0) return null
    switch (kind) {
        case 'sum':
            return numbers.reduce((a, b) => a + b, 0)
        case 'avg':
            return numbers.reduce((a, b) => a + b, 0) / numbers.length
        case 'min':
            return Math.min(...numbers)
        case 'max':
            return Math.max(...numbers)
    }
}

/**
 * The glyph/word introducing the value in the header. `Σ` is the universal
 * sum sign; the others spell out because no symbol reads as clearly at badge
 * size.
 */
export function aggregatePrefix(kind: AggregateKind): string {
    switch (kind) {
        case 'sum':
            return 'Σ'
        case 'avg':
            return 'avg'
        case 'min':
            return 'min'
        case 'max':
            return 'max'
        case 'none':
            return ''
    }
}

/**
 * Default numeric formatting: integers stay bare, fractions (only `avg` can
 * produce them from integer inputs) round to at most 2 decimals with trailing
 * zeros stripped, so "13", "4.5", "3.33".
 */
export function formatAggregateNumber(value: number): string {
    if (Number.isInteger(value)) return String(value)
    return String(Math.round(value * 100) / 100)
}

/**
 * The full header label, e.g. `Σ 13` / `avg 4.5`. `formatValue` is injected so
 * an estimate aggregate can render through the shared duration grammar
 * (`formatDuration`, "1d 2h") instead of decimal days. Returns `null` when
 * there is nothing to show.
 */
export function formatAggregateLabel(
    kind: AggregateKind,
    value: number | null,
    formatValue: (value: number) => string = formatAggregateNumber
): string | null {
    if (kind === 'none' || value === null) return null
    return `${aggregatePrefix(kind)} ${formatValue(value)}`
}
