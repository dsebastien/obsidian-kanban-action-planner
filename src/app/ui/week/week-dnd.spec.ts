import { describe, expect, test } from 'bun:test'
import { SIDE_EDGE_PX, sideEdgeOf } from './week-dnd'

/**
 * A press near a block's left / right edge stretches its run of days instead
 * of moving it (issue #172, phase B). The zone is measured against the
 * block's rect, not only the thin handle strips, so a real mouse landing a
 * little inside the edge still stretches.
 */
describe('sideEdgeOf', () => {
    const left = 100
    const right = 298

    test('the left zone, inclusive of its inner border', () => {
        expect(sideEdgeOf(left, right, left)).toBe('left')
        expect(sideEdgeOf(left, right, left + SIDE_EDGE_PX)).toBe('left')
    })

    test('the right zone, inclusive of its inner border', () => {
        expect(sideEdgeOf(left, right, right)).toBe('right')
        expect(sideEdgeOf(left, right, right - SIDE_EDGE_PX)).toBe('right')
    })

    test('the body between the zones is a move', () => {
        expect(sideEdgeOf(left, right, left + SIDE_EDGE_PX + 1)).toBeNull()
        expect(sideEdgeOf(left, right, right - SIDE_EDGE_PX - 1)).toBeNull()
        expect(sideEdgeOf(left, right, 200)).toBeNull()
    })

    test('a narrow piece keeps a body: it is all move', () => {
        expect(sideEdgeOf(0, SIDE_EDGE_PX * 3 - 1, 1)).toBeNull()
        expect(sideEdgeOf(0, SIDE_EDGE_PX * 3, 1)).toBe('left')
    })

    test('a custom zone width', () => {
        expect(sideEdgeOf(0, 100, 15, 20)).toBe('left')
        expect(sideEdgeOf(0, 100, 15, 10)).toBeNull()
    })
})
