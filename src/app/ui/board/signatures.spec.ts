import { describe, expect, it } from 'bun:test'
import {
    boardRenderSignature,
    cardSignature,
    composeCardsSignature,
    renderPassSignature,
    structureSignature
} from './signatures'
import type { Board, BoardCardBase } from '../../domain/board-model'
import type { ColorSpec, ColumnDef } from '../../domain/note-type'
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

// ── boardRenderSignature (issue #105 render gate) ─────────────────────────

type SigCard = BoardCardBase & { display: CardDisplay; relationships: CardRelationships }

function sigCard(key: string, over: Partial<SigCard> = {}): SigCard {
    return {
        key,
        statusValue: 'todo',
        order: null,
        display: display({ title: key }),
        relationships: emptyRels,
        ...over
    }
}

interface SigColumnSpec {
    id: string
    cards?: SigCard[]
    label?: string
    color?: ColorSpec
    wipLimit?: number
}

function sigBoard(
    lanes: Array<{ id: string; columns: SigColumnSpec[]; label?: string }>,
    isMultiLane = false
): Board<SigCard> {
    return {
        isMultiLane,
        lanes: lanes.map((l) => ({
            lane: { id: l.id, label: l.label ?? l.id, isUngrouped: false },
            columns: l.columns.map((c) => ({
                column: {
                    ...column(c.id),
                    label: c.label ?? c.id,
                    ...(c.color ? { color: c.color } : {}),
                    ...(c.wipLimit === undefined ? {} : { wipLimit: c.wipLimit })
                },
                cards: c.cards ?? []
            })),
            cardCount: l.columns.reduce((sum, c) => sum + (c.cards?.length ?? 0), 0)
        }))
    }
}

const none = new Set<string>()

describe('boardRenderSignature', () => {
    const base = (): Board<SigCard> =>
        sigBoard([{ id: '', columns: [{ id: 'a', cards: [sigCard('x.md')] }, { id: 'b' }] }])

    it('is stable for identical board + collapse state', () => {
        expect(boardRenderSignature(base(), none, none)).toBe(
            boardRenderSignature(base(), none, none)
        )
    })

    it('changes when a card is added, removed, or edited', () => {
        const sig = boardRenderSignature(base(), none, none)
        const added = sigBoard([
            {
                id: '',
                columns: [{ id: 'a', cards: [sigCard('x.md'), sigCard('y.md')] }, { id: 'b' }]
            }
        ])
        const removed = sigBoard([{ id: '', columns: [{ id: 'a' }, { id: 'b' }] }])
        const edited = sigBoard([
            {
                id: '',
                columns: [
                    { id: 'a', cards: [sigCard('x.md', { display: display({ title: 'New' }) })] },
                    { id: 'b' }
                ]
            }
        ])
        expect(boardRenderSignature(added, none, none)).not.toBe(sig)
        expect(boardRenderSignature(removed, none, none)).not.toBe(sig)
        expect(boardRenderSignature(edited, none, none)).not.toBe(sig)
    })

    it('changes when a card moves column or order flips within a column', () => {
        const two = (cards: [SigCard[], SigCard[]]): Board<SigCard> =>
            sigBoard([
                {
                    id: '',
                    columns: [
                        { id: 'a', cards: cards[0] },
                        { id: 'b', cards: cards[1] }
                    ]
                }
            ])
        const x = sigCard('x.md')
        const y = sigCard('y.md')
        const sig = boardRenderSignature(two([[x, y], []]), none, none)
        expect(boardRenderSignature(two([[y, x], []]), none, none)).not.toBe(sig)
        expect(boardRenderSignature(two([[x], [y]]), none, none)).not.toBe(sig)
    })

    it('changes when column label, color, or WIP limit change', () => {
        const sig = boardRenderSignature(base(), none, none)
        const relabeled = sigBoard([
            {
                id: '',
                columns: [{ id: 'a', cards: [sigCard('x.md')], label: 'Renamed' }, { id: 'b' }]
            }
        ])
        const recolored = sigBoard([
            {
                id: '',
                columns: [
                    { id: 'a', cards: [sigCard('x.md')], color: { kind: 'hex', value: '#123456' } },
                    { id: 'b' }
                ]
            }
        ])
        const limited = sigBoard([
            { id: '', columns: [{ id: 'a', cards: [sigCard('x.md')], wipLimit: 3 }, { id: 'b' }] }
        ])
        expect(boardRenderSignature(relabeled, none, none)).not.toBe(sig)
        expect(boardRenderSignature(recolored, none, none)).not.toBe(sig)
        expect(boardRenderSignature(limited, none, none)).not.toBe(sig)
    })

    it('changes when lane/column collapse state changes', () => {
        const multi = (): Board<SigCard> =>
            sigBoard([{ id: 'L1', columns: [{ id: 'a', cards: [sigCard('x.md')] }] }], true)
        const sig = boardRenderSignature(multi(), none, none)
        expect(boardRenderSignature(multi(), new Set(['L1']), none)).not.toBe(sig)
        expect(boardRenderSignature(multi(), none, new Set(['a']))).not.toBe(sig)
    })

    it('changes when a lane appears or its label changes', () => {
        const one = sigBoard([{ id: 'L1', columns: [{ id: 'a' }] }], true)
        const two = sigBoard(
            [
                { id: 'L1', columns: [{ id: 'a' }] },
                { id: 'L2', columns: [{ id: 'a' }] }
            ],
            true
        )
        const renamed = sigBoard([{ id: 'L1', columns: [{ id: 'a' }], label: 'Lane one' }], true)
        const sig = boardRenderSignature(one, none, none)
        expect(boardRenderSignature(two, none, none)).not.toBe(sig)
        expect(boardRenderSignature(renamed, none, none)).not.toBe(sig)
    })
})

describe('renderPassSignature', () => {
    it('is stable for equal parts and changes when any part changes', () => {
        const sig = renderPassSignature(['board', 'query', false, 'content'])
        expect(renderPassSignature(['board', 'query', false, 'content'])).toBe(sig)
        expect(renderPassSignature(['calendar', 'query', false, 'content'])).not.toBe(sig)
        expect(renderPassSignature(['board', 'other', false, 'content'])).not.toBe(sig)
        expect(renderPassSignature(['board', 'query', true, 'content'])).not.toBe(sig)
        expect(renderPassSignature(['board', 'query', false, 'CONTENT'])).not.toBe(sig)
    })

    it('distinguishes nested per-card tuples', () => {
        const cards = [
            ['x.md', 'todo', null, 'type', 'sig', '{"a":1}', '', 'estimate', 'days', null]
        ]
        const sig = renderPassSignature(['calendar', '', false, 'state', cards])
        const changedFm = [
            ['x.md', 'todo', null, 'type', 'sig', '{"a":2}', '', 'estimate', 'days', null]
        ]
        expect(renderPassSignature(['calendar', '', false, 'state', changedFm])).not.toBe(sig)
    })
})

describe('composeCardsSignature', () => {
    it('is stable for equal inputs and changes with the header or any card', () => {
        const header = ['calendar', 'query', false, 'state']
        const perCard = [JSON.stringify(['a.md', { s: 1 }]), JSON.stringify(['b.md', { s: 2 }])]
        const sig = composeCardsSignature(header, perCard)
        expect(composeCardsSignature([...header], [...perCard])).toBe(sig)
        expect(composeCardsSignature(['timeline', 'query', false, 'state'], perCard)).not.toBe(sig)
        expect(
            composeCardsSignature(header, [JSON.stringify(['a.md', { s: 9 }]), perCard[1]!])
        ).not.toBe(sig)
    })

    it('a card added or removed changes the signature', () => {
        const header = ['calendar']
        const one = [JSON.stringify(['a.md'])]
        const two = [JSON.stringify(['a.md']), JSON.stringify(['b.md'])]
        expect(composeCardsSignature(header, one)).not.toBe(composeCardsSignature(header, two))
    })

    it('does not double-escape frontmatter (single JSON.stringify per card)', () => {
        // The per-card entry is already stringified; the composer must NOT
        // wrap it in a second stringify (no escaped-quote doubling).
        const entry = JSON.stringify(['a.md', { title: 'x"y' }])
        const out = composeCardsSignature(['calendar'], [entry])
        expect(out).toContain(entry)
        expect(out).not.toContain('\\\\"')
    })

    it('card content cannot forge the record/section separators', () => {
        // A card title containing the raw separator bytes still stringifies to
        // an escaped form, so two distinct card sets never collide.
        const withCtrl = JSON.stringify(['a.md', { t: ' ' }])
        const plain = JSON.stringify(['a.md', { t: 'x' }])
        expect(composeCardsSignature(['c'], [withCtrl])).not.toBe(
            composeCardsSignature(['c'], [plain])
        )
    })
})
