import { describe, expect, test } from 'bun:test'
import {
    wbsRenderSignature,
    type WbsSignatureCard,
    type WbsSignatureConfig,
    type WbsSignatureContext,
    type WbsSignatureView
} from './wbs-signature'

function card(overrides: Partial<WbsSignatureCard> = {}): WbsSignatureCard {
    return {
        key: 'a.md',
        order: 1,
        statusValue: '10 Todo',
        typeId: 'nt-1',
        typeName: 'Tasks',
        statusLabel: 'Todo',
        statusColor: 'teal',
        blocked: false,
        done: false,
        estimateProperty: 'estimate',
        estimateUnit: 'days',
        frontmatter: JSON.stringify({ status: '10 Todo', estimate: 3 }),
        tags: 'a,b',
        parent: [],
        child: [],
        sibling: [],
        ...overrides
    }
}

const emptyContext: WbsSignatureContext = {
    paths: [],
    titles: [],
    childEdges: [],
    parentEdges: []
}

const baseView: WbsSignatureView = {
    collapsedNodes: [],
    panelCollapsed: false,
    paneCollapsed: []
}

const baseConfig: WbsSignatureConfig = {
    minutesPerDay: 480,
    startProperty: 'date_scheduled',
    deadlineProperty: 'date_due',
    progressProperty: 'progress',
    durationProperty: 'duration',
    dueSoonDays: 7,
    todayKey: '2026-07-17',
    comparator: 'order'
}

function sig(
    cards: WbsSignatureCard[],
    context = emptyContext,
    view = baseView,
    config = baseConfig
): string {
    return wbsRenderSignature(cards, context, view, config)
}

describe('wbsRenderSignature', () => {
    test('identical inputs produce an identical signature', () => {
        expect(sig([card(), card({ key: 'b.md' })])).toBe(sig([card(), card({ key: 'b.md' })]))
    })

    test('card order within the list matters (sibling order)', () => {
        const a = card({ key: 'a.md' })
        const b = card({ key: 'b.md' })
        expect(sig([a, b])).not.toBe(sig([b, a]))
    })

    test.each([
        ['order', { order: 2 }],
        ['status value', { statusValue: '20 Doing' }],
        ['type id', { typeId: 'nt-2' }],
        ['type name', { typeName: 'Renamed' }],
        ['status label', { statusLabel: 'Doing' }],
        ['status color', { statusColor: 'red' }],
        ['blocked flag', { blocked: true }],
        ['done flag', { done: true }],
        ['estimate property', { estimateProperty: 'time_estimate' }],
        ['estimate unit', { estimateUnit: 'minutes' }],
        ['frontmatter', { frontmatter: JSON.stringify({ estimate: 5 }) }],
        ['tags', { tags: 'a,c' }],
        ['resolved parent', { parent: ['p.md'] }],
        ['resolved child', { child: ['c.md'] }],
        ['resolved sibling', { sibling: ['s.md'] }]
    ] as const)('a change to a card %s changes the signature', (_label, override) => {
        expect(sig([card()])).not.toBe(sig([card(override)]))
    })

    test('an unset order is distinct from an explicit zero', () => {
        expect(sig([card({ order: null })])).not.toBe(sig([card({ order: 0 })]))
    })

    test('context ancestor paths change the signature', () => {
        expect(sig([card()], emptyContext)).not.toBe(
            sig([card()], { ...emptyContext, paths: ['goal.md'] })
        )
    })

    test('a context-row rename (title) changes the signature', () => {
        const before: WbsSignatureContext = {
            ...emptyContext,
            paths: ['g.md'],
            titles: [['g.md', 'Goal']]
        }
        const after: WbsSignatureContext = {
            ...emptyContext,
            paths: ['g.md'],
            titles: [['g.md', 'Renamed']]
        }
        expect(sig([card()], before)).not.toBe(sig([card()], after))
    })

    test('grafted context edges change the signature', () => {
        expect(sig([card()], { ...emptyContext, childEdges: [['g.md', ['a.md']]] })).not.toBe(
            sig([card()], { ...emptyContext, childEdges: [['g.md', ['b.md']]] })
        )
        expect(sig([card()], { ...emptyContext, parentEdges: [['a.md', ['g.md']]] })).not.toBe(
            sig([card()], emptyContext)
        )
    })

    test.each([
        ['collapsed nodes', { collapsedNodes: ['a.md'] }],
        ['panel collapse', { panelCollapsed: true }],
        ['pane-group collapse', { paneCollapsed: [['nt-1', false] as const] }]
    ] as const)('a change to view %s changes the signature', (_label, override) => {
        expect(sig([card()], emptyContext, baseView)).not.toBe(
            sig([card()], emptyContext, { ...baseView, ...override })
        )
    })

    test.each([
        ['minutesPerDay', { minutesPerDay: 240 }],
        ['start property', { startProperty: 'start' }],
        ['deadline property', { deadlineProperty: 'due' }],
        ['progress property', { progressProperty: 'pct' }],
        ['due-soon days', { dueSoonDays: 3 }],
        ['today', { todayKey: '2026-07-18' }],
        ['comparator', { comparator: 'property:desc:priority' }]
    ] as const)('a change to config %s changes the signature', (_label, override) => {
        expect(sig([card()], emptyContext, baseView, baseConfig)).not.toBe(
            sig([card()], emptyContext, baseView, { ...baseConfig, ...override })
        )
    })

    test('separators do not let adjacent fields alias each other', () => {
        // Moving a boundary between two fields must change the signature.
        expect(sig([card({ key: 'a', statusValue: 'b' })])).not.toBe(
            sig([card({ key: 'ab', statusValue: '' })])
        )
    })
})
