import { test, expect, describe } from 'bun:test'
import { activeColumnIndex, sameItems } from './column-switcher'

describe('activeColumnIndex', () => {
    const offsets = [0, 300, 600, 900]

    test('no column, no index', () => {
        expect(activeColumnIndex(0, [], 300)).toBe(-1)
    })

    test('at rest on a column, that column is active', () => {
        expect(activeColumnIndex(0, offsets, 300)).toBe(0)
        expect(activeColumnIndex(600, offsets, 300)).toBe(2)
    })

    test('a column more than half revealed wins', () => {
        expect(activeColumnIndex(140, offsets, 300)).toBe(0)
        expect(activeColumnIndex(160, offsets, 300)).toBe(1)
    })

    test('scrolled past the last column start, the last column stays active', () => {
        expect(activeColumnIndex(1200, offsets, 300)).toBe(3)
    })
})

describe('sameItems', () => {
    const a = [
        { columnId: 'todo', label: 'To do', count: 3 },
        { columnId: 'done', label: 'Done', count: 1 }
    ]

    test('equal lists match', () => {
        expect(
            sameItems(
                a,
                a.map((item) => ({ ...item }))
            )
        ).toBe(true)
    })

    test('a count change is a different strip', () => {
        expect(sameItems(a, [a[0]!, { columnId: 'done', label: 'Done', count: 2 }])).toBe(false)
    })

    test('a reorder is a different strip', () => {
        expect(sameItems(a, [a[1]!, a[0]!])).toBe(false)
    })

    test('a length change is a different strip', () => {
        expect(sameItems(a, [a[0]!])).toBe(false)
    })
})
