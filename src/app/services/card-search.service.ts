import { getAllTags } from 'obsidian'
import type { App } from 'obsidian'
import { parseFrontmatterDate } from '../domain/calendar'
import type { CardSearchRecord } from '../domain/filter-query'
import type { RelationshipRole } from '../domain/note-type'
import { splitStatusValue } from '../domain/status'
import { coerceOrder, getFrontmatterValue } from './frontmatter.service'
import type { KanbanCard } from '../ui/board/types'

/**
 * Configured-property values resolved by the view for the #169 filter aliases
 * (`scheduled:`, `estimate:`, `progress:`, `order:`). Estimate arrives already
 * resolved into DAYS because its property AND unit are per note type
 * (`estimateConfigFor`), which only the view can resolve.
 */
export interface CardSearchExtras {
    /** The resolved scheduled-date property, backing `scheduled:`. */
    scheduledDateProperty?: string | null
    /** The card's resolved estimate in days (unit-converted), backing `estimate:`. */
    estimateDays?: number | null
    /** The resolved progress property, backing `progress:`. */
    progressProperty?: string | null
    /** The resolved manual-order property, backing `order:`. */
    orderProperty?: string | null
}

/**
 * Build a card's lowercased search index from the metadata cache, so keystroke
 * filtering (issue #34) does no file reads. The pure matcher in
 * `domain/filter-query.ts` runs against the {@link CardSearchRecord} this returns.
 */
export function buildCardSearchRecord(
    app: App,
    card: KanbanCard,
    dueDateProperty: string,
    ancestorLabels: ReadonlyArray<string> = [],
    /** Defer ("can't start until") property, backing `defer:`/`is:` (issue #113). */
    deferDateProperty: string | null = null,
    /** Whether the note counts as done per its type's done definition (issue #113). */
    done = false,
    /** Configured-property values for the #169 aliases. */
    extras: CardSearchExtras = {}
): CardSearchRecord {
    const file = card.file
    const cache = app.metadataCache.getFileCache(file)
    const frontmatter = cache?.frontmatter ?? {}
    const props = new Map<string, string[]>()
    const haystack: string[] = [card.display.title]

    for (const [key, raw] of Object.entries(frontmatter)) {
        const values = stringifyForSearch(raw)
        if (values.length === 0) continue
        const lowered = values.map((v) => v.toLowerCase())
        props.set(key.toLowerCase(), lowered)
        haystack.push(...lowered)
    }

    const tags = (cache ? (getAllTags(cache) ?? []) : []).map((t) =>
        t.replace(/^#/, '').toLowerCase()
    )
    haystack.push(...tags)

    const rels: Record<RelationshipRole, string[]> = {
        parent: card.relationships.parent.map((r) => r.label.toLowerCase()),
        sibling: card.relationships.sibling.map((r) => r.label.toLowerCase()),
        child: card.relationships.child.map((r) => r.label.toLowerCase()),
        blocked_by: card.relationships.blocked_by.map((r) => r.label.toLowerCase())
    }
    for (const list of Object.values(rels)) haystack.push(...list)

    const statusText: string[] = []
    if (card.statusValue) {
        statusText.push(card.statusValue.toLowerCase())
        statusText.push(splitStatusValue(card.statusValue).label.toLowerCase())
    }

    const due = parseFrontmatterDate(getFrontmatterValue(app, file, dueDateProperty))
    const defer = deferDateProperty
        ? parseFrontmatterDate(getFrontmatterValue(app, file, deferDateProperty))
        : null
    // Configured-property aliases (issue #169): resolved here so the pure
    // matcher never needs to know the properties' real names.
    const scheduled = extras.scheduledDateProperty
        ? parseFrontmatterDate(getFrontmatterValue(app, file, extras.scheduledDateProperty))
        : null
    const progress = extras.progressProperty
        ? coerceOrder(getFrontmatterValue(app, file, extras.progressProperty))
        : null
    const order = extras.orderProperty
        ? coerceOrder(getFrontmatterValue(app, file, extras.orderProperty))
        : null

    return {
        title: card.display.title.toLowerCase(),
        haystack: haystack.join('  ').toLowerCase(),
        statusText,
        rels,
        // Transitive parents for `ancestor:` (issue #74 descendants zoom);
        // deliberately NOT added to the haystack — a bare word shouldn't match
        // a card through its grandparent's name.
        ancestors: ancestorLabels.map((l) => l.toLowerCase()),
        tags,
        due,
        defer,
        scheduled,
        estimate: extras.estimateDays ?? null,
        progress,
        order,
        done,
        props
    }
}

/** Flatten a frontmatter value into searchable strings (scalars only; objects skipped). */
export function stringifyForSearch(raw: unknown): string[] {
    if (raw === null || raw === undefined) return []
    if (typeof raw === 'string') return raw.trim() ? [raw] : []
    if (typeof raw === 'number' || typeof raw === 'boolean') return [String(raw)]
    if (Array.isArray(raw)) return raw.flatMap((v) => stringifyForSearch(v))
    return []
}
