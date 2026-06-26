import { moment } from 'obsidian'

/**
 * Date formatting for frontmatter writes, via Obsidian's bundled moment.
 *
 * Reading/bucketing dates is pure (`domain/calendar.ts`); only *writing* a date
 * back to a note needs the user's configured momentjs format (default
 * `YYYY-MM-DD`), which this thin wrapper provides. Kept separate from the pure
 * domain so the domain stays Obsidian-free and unit-testable.
 */

/** Minimal callable view of Obsidian's `moment` (its namespace type isn't callable). */
type MomentFn = (input?: Date) => { format: (fmt: string) => string }

export function formatDate(date: Date, format: string): string {
    return (moment as unknown as MomentFn)(date).format(format)
}
