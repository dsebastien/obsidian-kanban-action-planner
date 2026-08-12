import { describe, expect, it } from 'bun:test'
import { buildAgenda } from './agenda'
import type { AgendaCardInput } from './agenda'

const TODAY = new Date(2026, 5, 28) // 2026-06-28

function card(over: Partial<AgendaCardInput> & { key: string }): AgendaCardInput {
    return {
        title: over.key,
        due: null,
        scheduled: null,
        order: null,
        available: true,
        ...over
    }
}

function groupIds(model: ReturnType<typeof buildAgenda>): string[] {
    return model.groups.map((g) => g.id)
}

function keysOf(model: ReturnType<typeof buildAgenda>, id: string): string[] {
    return model.groups.find((g) => g.id === id)?.entries.map((e) => e.card.key) ?? []
}

describe('buildAgenda', () => {
    it('groups overdue / today / upcoming, most urgent first', () => {
        const model = buildAgenda(
            [
                card({ key: 'late', due: new Date(2026, 5, 20) }),
                card({ key: 'now', due: new Date(2026, 5, 28) }),
                card({ key: 'soon', due: new Date(2026, 6, 2) })
            ],
            TODAY,
            'week',
            false
        )
        expect(groupIds(model)).toEqual(['overdue', 'today', 'upcoming'])
        expect(model.count).toBe(3)
    })

    it('lists a card exactly once, in its most urgent group', () => {
        // Overdue AND scheduled today → overdue only.
        const model = buildAgenda(
            [card({ key: 'a', due: new Date(2026, 5, 20), scheduled: new Date(2026, 5, 28) })],
            TODAY,
            'week',
            false
        )
        expect(keysOf(model, 'overdue')).toEqual(['a'])
        expect(keysOf(model, 'today')).toEqual([])
    })

    it('scheduled today lists under Today; a past schedule alone does not list', () => {
        const model = buildAgenda(
            [
                card({ key: 'sched-today', scheduled: new Date(2026, 5, 28) }),
                card({ key: 'slipped', scheduled: new Date(2026, 5, 20) })
            ],
            TODAY,
            'week',
            false
        )
        expect(keysOf(model, 'today')).toEqual(['sched-today'])
        expect(model.count).toBe(1)
    })

    it('the today window drops Upcoming', () => {
        const cards = [card({ key: 'soon', due: new Date(2026, 6, 2) })]
        expect(buildAgenda(cards, TODAY, 'week', false).count).toBe(1)
        expect(buildAgenda(cards, TODAY, 'today', false).count).toBe(0)
    })

    it('upcoming looks 7 days ahead only', () => {
        const model = buildAgenda(
            [
                card({ key: 'in7', due: new Date(2026, 6, 5) }),
                card({ key: 'in8', due: new Date(2026, 6, 6) })
            ],
            TODAY,
            'week',
            false
        )
        expect(keysOf(model, 'upcoming')).toEqual(['in7'])
    })

    it('sorts by date, then manual order, then title', () => {
        const model = buildAgenda(
            [
                card({ key: 'b', title: 'b', due: new Date(2026, 5, 20) }),
                card({ key: 'a', title: 'a', due: new Date(2026, 5, 20) }),
                card({ key: 'c', title: 'c', due: new Date(2026, 5, 20), order: 1 }),
                card({ key: 'earlier', due: new Date(2026, 5, 15) })
            ],
            TODAY,
            'week',
            false
        )
        expect(keysOf(model, 'overdue')).toEqual(['earlier', 'c', 'a', 'b'])
    })

    it('availableOnly hides unavailable cards and counts them', () => {
        const model = buildAgenda(
            [
                card({ key: 'ok', due: new Date(2026, 5, 28) }),
                card({ key: 'blocked', due: new Date(2026, 5, 20), available: false })
            ],
            TODAY,
            'week',
            true
        )
        expect(model.count).toBe(1)
        expect(model.hiddenUnavailable).toBe(1)
        expect(keysOf(model, 'overdue')).toEqual([])
    })

    it('upcoming uses the earlier of due/scheduled as its date', () => {
        const model = buildAgenda(
            [
                card({
                    key: 'both',
                    due: new Date(2026, 6, 4),
                    scheduled: new Date(2026, 6, 1)
                }),
                card({ key: 'mid', due: new Date(2026, 6, 2) })
            ],
            TODAY,
            'week',
            false
        )
        expect(keysOf(model, 'upcoming')).toEqual(['both', 'mid'])
    })

    it('dateless cards never list', () => {
        expect(buildAgenda([card({ key: 'x' })], TODAY, 'week', false).count).toBe(0)
    })
})
