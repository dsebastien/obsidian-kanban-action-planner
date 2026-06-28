/**
 * Escape a value for safe use inside a CSS attribute selector
 * (e.g. `[data-card-key="…"]`). Uses the native `CSS.escape` when available and
 * falls back to escaping the two characters that break a double-quoted selector.
 */
export function cssEscapeAttr(value: string): string {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/["\\]/g, '\\$&')
}
