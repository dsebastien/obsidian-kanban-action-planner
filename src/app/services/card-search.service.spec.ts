import { describe, expect, it } from 'bun:test'
import type { App, CachedMetadata, TFile } from 'obsidian'
import { buildCardSearchRecord, stringifyForSearch } from './card-search.service'
import type { RelatedNote } from './relationships.service'
import type { KanbanCard } from '../ui/board/types'

/** A minimal metadata cache backing one file's frontmatter + tags. */
function fakeApp(cache: CachedMetadata | null): App {
    return {
        metadataCache: {
            getFileCache: (): CachedMetadata | null => cache
        }
    } as unknown as App
}

function related(label: string, key: string): RelatedNote {
    return { label, key }
}

function card(overrides: Partial<KanbanCard> = {}): KanbanCard {
    return {
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fake: only .path is read
        file: { path: 'Notes/Card.md' } as unknown as TFile,
        key: 'Notes/Card.md',
        title: 'Card',
        statusValue: '20 Doing',
        order: 1,
        display: {
            title: 'My Card',
            fields: [],
            coverUrl: null,
            wrap: false,
            dueState: 'none'
        },
        relationships: { parent: [], sibling: [], child: [], blocked_by: [] },
        ...overrides
    }
}

describe('buildCardSearchRecord', () => {
    it('lowercases the title and indexes frontmatter values into props + haystack', () => {
        const cache = {
            frontmatter: { priority: 'High', count: 3 }
        } as unknown as CachedMetadata
        const rec = buildCardSearchRecord(fakeApp(cache), card(), 'date_due')
        expect(rec.title).toBe('my card')
        expect(rec.props.get('priority')).toEqual(['high'])
        expect(rec.props.get('count')).toEqual(['3'])
        expect(rec.haystack).toContain('high')
        expect(rec.haystack).toContain('3')
    })

    it('derives statusText from the status value and its column label', () => {
        const rec = buildCardSearchRecord(
            fakeApp(null),
            card({ statusValue: '20 Doing' }),
            'date_due'
        )
        expect(rec.statusText).toContain('20 doing')
        expect(rec.statusText).toContain('doing')
    })

    it('lowercases related-note labels per role', () => {
        const rec = buildCardSearchRecord(
            fakeApp(null),
            card({
                relationships: {
                    parent: [related('Epic A', 'Notes/Epic A.md')],
                    sibling: [],
                    child: [],
                    blocked_by: [related('Blocker', 'Notes/Blocker.md')]
                }
            }),
            'date_due'
        )
        expect(rec.rels.parent).toEqual(['epic a'])
        expect(rec.rels.blocked_by).toEqual(['blocker'])
        expect(rec.haystack).toContain('epic a')
    })

    it('parses the due date from the configured property', () => {
        const cache = {
            frontmatter: { date_due: '2026-06-30' }
        } as unknown as CachedMetadata
        const rec = buildCardSearchRecord(fakeApp(cache), card(), 'date_due')
        expect(rec.due).toBeInstanceOf(Date)
        expect(rec.due?.getFullYear()).toBe(2026)
    })

    it('has a null due date when the property is absent', () => {
        const rec = buildCardSearchRecord(fakeApp(null), card(), 'date_due')
        expect(rec.due).toBeNull()
    })
})

describe('stringifyForSearch', () => {
    it('keeps non-empty strings and stringifies numbers/booleans', () => {
        expect(stringifyForSearch('hi')).toEqual(['hi'])
        expect(stringifyForSearch('  ')).toEqual([])
        expect(stringifyForSearch(42)).toEqual(['42'])
        expect(stringifyForSearch(true)).toEqual(['true'])
    })

    it('flattens arrays and skips null/undefined/objects', () => {
        expect(stringifyForSearch(['a', 2, null])).toEqual(['a', '2'])
        expect(stringifyForSearch(null)).toEqual([])
        expect(stringifyForSearch({ a: 1 })).toEqual([])
    })
})
