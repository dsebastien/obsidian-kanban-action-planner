import { describe, expect, test } from 'bun:test'
import { compareTabCards, matchesQuery, type TabSortKey } from './calendar-tabs'

function key(p: Partial<TabSortKey> & { title: string }): TabSortKey {
    return { order: null, sortValue: null, searchText: p.title.toLowerCase(), ...p }
}

describe('matchesQuery', () => {
    test('empty query matches everything', () => {
        expect(matchesQuery('anything', '')).toBe(true)
        expect(matchesQuery('anything', '   ')).toBe(true)
    })
    test('case-insensitive substring', () => {
        expect(matchesQuery('task a #urgent', 'URGENT')).toBe(true)
        expect(matchesQuery('task a #urgent', 'task')).toBe(true)
        expect(matchesQuery('task a #urgent', 'done')).toBe(false)
    })
})

describe('compareTabCards', () => {
    test('name mode: alphabetical by title', () => {
        const sorted = [key({ title: 'Beta' }), key({ title: 'Alpha' })].sort((a, b) =>
            compareTabCards(a, b, 'name')
        )
        expect(sorted.map((k) => k.title)).toEqual(['Alpha', 'Beta'])
    })

    test('order mode: numeric ascending, nulls last, ties by title', () => {
        const cards = [
            key({ title: 'C', order: null }),
            key({ title: 'A', order: 2 }),
            key({ title: 'B', order: 1 }),
            key({ title: 'D', order: null })
        ]
        const sorted = cards.sort((a, b) => compareTabCards(a, b, 'order'))
        expect(sorted.map((k) => k.title)).toEqual(['B', 'A', 'C', 'D'])
    })

    test('property mode: numbers numeric, then ties by title, nulls last', () => {
        const cards = [
            key({ title: 'High', sortValue: 1 }),
            key({ title: 'Low', sortValue: 10 }),
            key({ title: 'None', sortValue: null }),
            key({ title: 'Med', sortValue: 2 })
        ]
        const sorted = cards.sort((a, b) => compareTabCards(a, b, 'property'))
        expect(sorted.map((k) => k.title)).toEqual(['High', 'Med', 'Low', 'None'])
    })

    test('property mode: string values compare lexically', () => {
        const cards = [key({ title: 'X', sortValue: 'b' }), key({ title: 'Y', sortValue: 'a' })]
        const sorted = cards.sort((a, b) => compareTabCards(a, b, 'property'))
        expect(sorted.map((k) => k.title)).toEqual(['Y', 'X'])
    })
})
