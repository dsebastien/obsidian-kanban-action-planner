import { describe, expect, test } from 'bun:test'
import { coerceSortValue, compareTabCards, matchesQuery, type TabSortKey } from './calendar-tabs'

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

    test('descending flips the value order but keeps nulls last (issue #17)', () => {
        const cards = [
            key({ title: 'High', sortValue: 1 }),
            key({ title: 'Low', sortValue: 10 }),
            key({ title: 'None', sortValue: null }),
            key({ title: 'Med', sortValue: 2 })
        ]
        const sorted = cards.sort((a, b) => compareTabCards(a, b, 'property', 'desc'))
        expect(sorted.map((k) => k.title)).toEqual(['Low', 'Med', 'High', 'None'])
    })

    test('descending order mode reverses numbers, nulls still last', () => {
        const cards = [
            key({ title: 'C', order: null }),
            key({ title: 'A', order: 2 }),
            key({ title: 'B', order: 1 })
        ]
        const sorted = cards.sort((a, b) => compareTabCards(a, b, 'order', 'desc'))
        expect(sorted.map((k) => k.title)).toEqual(['A', 'B', 'C'])
    })

    test('descending name mode is Z–A', () => {
        const sorted = [key({ title: 'Alpha' }), key({ title: 'Beta' })].sort((a, b) =>
            compareTabCards(a, b, 'name', 'desc')
        )
        expect(sorted.map((k) => k.title)).toEqual(['Beta', 'Alpha'])
    })
})

describe('coerceSortValue', () => {
    test('keeps finite numbers, rejects non-finite', () => {
        expect(coerceSortValue(3)).toBe(3)
        expect(coerceSortValue(0)).toBe(0)
        expect(coerceSortValue(Infinity)).toBeNull()
        expect(coerceSortValue(NaN)).toBeNull()
    })

    test('parses numeric strings to numbers, keeps other strings', () => {
        expect(coerceSortValue('42')).toBe(42)
        expect(coerceSortValue(' 7 ')).toBe(7)
        expect(coerceSortValue('high')).toBe('high')
    })

    test('blank/non-scalar → null', () => {
        expect(coerceSortValue('')).toBeNull()
        expect(coerceSortValue('   ')).toBeNull()
        expect(coerceSortValue(null)).toBeNull()
        expect(coerceSortValue(true)).toBeNull()
        expect(coerceSortValue({})).toBeNull()
    })
})
