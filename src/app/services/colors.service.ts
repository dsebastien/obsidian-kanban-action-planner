import type { ColorSpec } from '../domain/profile'

/**
 * Color resolution for cards and columns.
 *
 * A curated palette maps stable tokens to concrete colors that read well in
 * both light and dark themes. A status may use a palette token or a custom hex.
 * Column backgrounds are derived as a translucent blend of the card color over
 * the theme background (via `color-mix`), so they adapt to the active theme.
 */

/** Curated palette: token -> CSS color. Order doubles as the auto-assign cycle. */
export const PALETTE: Record<string, string> = {
    blue: '#4c78dd',
    green: '#3aa675',
    amber: '#d9920b',
    red: '#d9534f',
    purple: '#8b5cf6',
    teal: '#21a1a1',
    pink: '#d6608f',
    slate: '#6b7280'
}

const PALETTE_CYCLE = Object.keys(PALETTE)

/** Neutral color used for the default/placeholder and Unmapped tokens. */
const NEUTRAL_COLOR = 'var(--text-muted)'

/** Tokens that are valid palette choices in the UI. */
export function paletteTokens(): string[] {
    return [...PALETTE_CYCLE]
}

/** Resolve a {@link ColorSpec} to a concrete CSS color string. */
export function resolveColor(spec: ColorSpec): string {
    if (spec.kind === 'hex') return spec.value
    return PALETTE[spec.token] ?? NEUTRAL_COLOR
}

/**
 * Deterministically assign a palette color to a status value. Stable for a
 * given value (hash-based) so colors don't shuffle as columns change.
 */
export function autoAssignColor(statusValue: string): ColorSpec {
    let hash = 0
    for (let i = 0; i < statusValue.length; i++) {
        hash = (hash * 31 + statusValue.charCodeAt(i)) & 0x7fffffff
    }
    const token = PALETTE_CYCLE[hash % PALETTE_CYCLE.length] ?? 'slate'
    return { kind: 'palette', token }
}

/** A translucent shade of `cardColor` over the theme background, for columns. */
export function columnShade(cardColor: string): string {
    return `color-mix(in srgb, ${cardColor} 14%, var(--background-primary))`
}

/** A slightly stronger blend for column headers. */
export function columnHeaderShade(cardColor: string): string {
    return `color-mix(in srgb, ${cardColor} 22%, var(--background-secondary))`
}

/** Validate a 3/6-digit hex color string. */
export function isValidHex(value: string): boolean {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}
