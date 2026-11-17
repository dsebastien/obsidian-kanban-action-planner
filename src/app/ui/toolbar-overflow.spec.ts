import { describe, expect, test } from 'bun:test'
import type { CollapsibleAction } from './toolbar-overflow'
import { modeEntries, overflowEntries } from './toolbar-overflow'

const anchor = {} as HTMLElement

function action(label: string, hidden: boolean, checked: boolean | null = null): CollapsibleAction {
    return { icon: 'x', label, checked, hidden, run: () => undefined }
}

describe('overflowEntries', () => {
    test('lists only the hidden actions, in toolbar order', () => {
        const entries = overflowEntries(
            null,
            [action('Select', true), action('Compact', false), action('Gear', true)],
            () => undefined
        )
        expect(entries.map((e) => e.title)).toEqual(['Select', 'Gear'])
        expect(entries.every((e) => e.section === 'action')).toBe(true)
    })

    test('puts the hidden date-window chips first, the active one checked', () => {
        const entries = overflowEntries(
            {
                chips: [
                    { value: 'today', label: 'Today' },
                    { value: 'next7d', label: 'Next 7 days' }
                ],
                active: 'next7d'
            },
            [action('Gear', true)],
            () => undefined
        )
        expect(entries.map((e) => [e.section, e.title, e.checked])).toEqual([
            ['window', 'Today', false],
            ['window', 'Next 7 days', true],
            ['action', 'Gear', null]
        ])
    })

    test('a chip entry toggles its window', () => {
        const toggled: string[] = []
        const [entry] = overflowEntries(
            { chips: [{ value: 'today', label: 'Today' }], active: null },
            [],
            (value) => toggled.push(value)
        )
        entry?.run(anchor)
        expect(toggled).toEqual(['today'])
    })

    test('an action entry runs with the anchor it is given', () => {
        const anchors: HTMLElement[] = []
        const [entry] = overflowEntries(
            null,
            [{ ...action('Contexts', true), run: (a) => anchors.push(a) }],
            () => undefined
        )
        entry?.run(anchor)
        expect(anchors).toEqual([anchor])
    })

    test('keeps the on/off state of a toggle', () => {
        const entries = overflowEntries(null, [action('Compact', true, true)], () => undefined)
        expect(entries[0]?.checked).toBe(true)
    })

    test('nothing hidden and no chips: no entries', () => {
        expect(overflowEntries(null, [action('Gear', false)], () => undefined)).toEqual([])
    })
})

describe('modeEntries', () => {
    const modes = ['board', 'calendar', 'week'] as const
    const labels = { board: 'Board', calendar: 'Calendar', week: 'Ideal week' }

    test('lists the enabled modes in order, the active one checked', () => {
        expect(modeEntries(modes, labels, 'calendar', (m) => m !== 'week')).toEqual([
            { mode: 'board', title: 'Board', checked: false },
            { mode: 'calendar', title: 'Calendar', checked: true }
        ])
    })
})
