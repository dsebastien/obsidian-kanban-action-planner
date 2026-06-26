/**
 * Placeholder resolution for archive folder paths (and any other templated
 * path). Pure: every time-dependent value is supplied via {@link ExpressionContext}
 * so the resolver is deterministic and unit-testable.
 *
 * Supported tokens (case-insensitive, optional surrounding whitespace):
 *   {{year}}     → 4-digit year                  e.g. 2026
 *   {{month}}    → 2-digit month (01–12)         e.g. 06
 *   {{day}}      → 2-digit day of month (01–31)  e.g. 26
 *   {{week}}     → 2-digit ISO week (01–53)      e.g. 26
 *   {{quarter}}  → quarter (1–4)                 e.g. 2
 *   {{date}}     → YYYY-MM-DD                     e.g. 2026-06-26
 *   {{datetime}} → YYYY-MM-DD-HHmmss (FS-safe)    e.g. 2026-06-26-143015
 *   {{uuid}}     → a fresh unique id              (from the context)
 *
 * Unknown tokens are left untouched (so an accidental `{{foo}}` is visible
 * rather than silently dropped).
 */

export interface ExpressionContext {
    /** The reference instant for date/time tokens. */
    now: Date
    /** Fresh unique id generator for `{{uuid}}`. */
    uuid: () => string
}

const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g

/** Resolve all supported placeholders in `template` using `ctx`. */
export function resolvePlaceholders(template: string, ctx: ExpressionContext): string {
    return template.replace(TOKEN_RE, (match, rawName: string) => {
        const value = resolveToken(rawName.toLowerCase(), ctx)
        return value ?? match
    })
}

function resolveToken(name: string, ctx: ExpressionContext): string | null {
    const d = ctx.now
    switch (name) {
        case 'year':
            return String(d.getFullYear())
        case 'month':
            return pad2(d.getMonth() + 1)
        case 'day':
            return pad2(d.getDate())
        case 'week':
            return pad2(isoWeek(d))
        case 'quarter':
            return String(Math.floor(d.getMonth() / 3) + 1)
        case 'date':
            return `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        case 'datetime':
            return (
                `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
                `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
            )
        case 'uuid':
            return ctx.uuid()
        default:
            return null
    }
}

function pad2(n: number): string {
    return n < 10 ? `0${String(n)}` : String(n)
}

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
export function isoWeek(date: Date): number {
    // Work in UTC off the local Y/M/D to avoid DST edge cases in the arithmetic.
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dayNum = d.getUTCDay() || 7 // Sunday → 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum) // shift to the week's Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const diffDays = (d.getTime() - yearStart.getTime()) / 86_400_000
    return Math.floor(diffDays / 7) + 1
}
