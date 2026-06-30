import { describe, expect, it } from 'bun:test'
import { cardSignature, structureSignature } from './signatures'
import type { Board, BoardCardBase } from '../../domain/board-model'
import type { ColumnDef } from '../../domain/note-type'
import type { CardDisplay } from './types'
import type { CardRelationships } from '../../services/relationships.service'

function column(id: string): ColumnDef {
    return {
        id,
        statusValue: id,
        label: id,
        sortKey: id,
        color: { kind: 'palette', token: 'slate' }
    }
}

function board(
    isMultiLane: boolean,
    lanes: Array<{ id: string; columns: string[] }>
): Board<BoardCardBase> {
    return {
        isMultiLane,
        lanes: lanes.map((l) => ({
            lane: { id: l.id, label: l.id, isUngrouped: false },
            columns: l.columns.map((c) => ({ column: column(c), cards: [] })),
            cardCount: 0
        }))
    }
}

const emptyRels: CardRelationships = { parent: [], sibling: [], child: [], blocked_by: [] }

function display(over: Partial<CardDisplay> = {}): CardDisplay {
    return {
        title: 'Card',
        fields: [],
        coverUrl: null,
        wrap: false,
        dueState: 'none',
        countdown: null,
        ...over
    }
}

describe('structureSignature', () => {
    it('encodes single/multi flag + lane/column ids', () => {
        expect(structureSignature(board(false, [{ id: '', columns: ['a', 'b'] }]))).toBe('S|:a,b')
        expect(structureSignature(board(true, [{ id: 'L1', columns: ['a'] }]))).toBe('M|L1:a')
    })

    it('changes when the shape changes, is stable otherwise', () => {
        const a = structureSignature(board(false, [{ id: '', columns: ['a', 'b'] }]))
        const same = structureSignature(board(false, [{ id: '', columns: ['a', 'b'] }]))
        const reordered = structureSignature(board(false, [{ id: '', columns: ['b', 'a'] }]))
        const added = structureSignature(board(false, [{ id: '', columns: ['a', 'b', 'c'] }]))
        expect(a).toBe(same)
        expect(a).not.toBe(reordered)
        expect(a).not.toBe(added)
    })
})

describe('cardSignature', () => {
    it('is stable for identical content + accent', () => {
        const card = { display: display(), relationships: emptyRels }
        expect(cardSignature(card, '#abc')).toBe(cardSignature({ ...card }, '#abc'))
    })

    it('changes when title, dueState, accent, fields, or relationships change', () => {
        const base = { display: display(), relationships: emptyRels }
        const sig = cardSignature(base, '#abc')
        expect(cardSignature({ ...base, display: display({ title: 'Other' }) }, '#abc')).not.toBe(
            sig
        )
        expect(
            cardSignature({ ...base, display: display({ dueState: 'overdue' }) }, '#abc')
        ).not.toBe(sig)
        expect(cardSignature(base, '#def')).not.toBe(sig)
        expect(
            cardSignature(
                {
                    ...base,
                    display: display({
                        fields: [
                            {
                                label: null,
                                text: 'x',
                                emphasis: 'normal',
                                progress: null,
                                tone: 'neutral',
                                heat: null
                            }
                        ]
                    })
                },
                '#abc'
            )
        ).not.toBe(sig)
        expect(
            cardSignature(
                {
                    ...base,
                    relationships: { ...emptyRels, blocked_by: [{ key: 'b.md', label: 'B' }] }
                },
                '#abc'
            )
        ).not.toBe(sig)
    })

    it('changes when the due countdown changes (issue #62)', () => {
        const base = { display: display(), relationships: emptyRels }
        const sig = cardSignature(base, '#abc')
        const withCountdown = cardSignature(
            {
                ...base,
                display: display({
                    countdown: { text: 'in 3d', tone: 'soon', placement: 'title' }
                })
            },
            '#abc'
        )
        expect(withCountdown).not.toBe(sig)
        // Tone/text/placement are all part of the signature.
        expect(
            cardSignature(
                {
                    ...base,
                    display: display({
                        countdown: { text: 'in 3d', tone: 'future', placement: 'title' }
                    })
                },
                '#abc'
            )
        ).not.toBe(withCountdown)
    })
})
