import { describe, expect, it } from 'bun:test'
import { inclusiveKeyRange } from './selection-range'

const order = ['a', 'b', 'c', 'd', 'e']

describe('inclusiveKeyRange', () => {
    it('returns the inclusive forward range', () => {
        expect(inclusiveKeyRange(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    })

    it('works backwards (toKey before fromKey)', () => {
        expect(inclusiveKeyRange(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    })

    it('returns a single key when both endpoints are the same', () => {
        expect(inclusiveKeyRange(order, 'c', 'c')).toEqual(['c'])
    })

    it('falls back to just toKey when there is no anchor', () => {
        expect(inclusiveKeyRange(order, null, 'c')).toEqual(['c'])
    })

    it('falls back to just toKey when an endpoint is unknown', () => {
        expect(inclusiveKeyRange(order, 'gone', 'c')).toEqual(['c'])
        expect(inclusiveKeyRange(order, 'b', 'gone')).toEqual(['gone'])
    })

    it('spans the whole list', () => {
        expect(inclusiveKeyRange(order, 'a', 'e')).toEqual(['a', 'b', 'c', 'd', 'e'])
    })
})
