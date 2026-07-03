import { describe, expect, it, mock } from 'bun:test'
import type { TFile } from 'obsidian'
import type { KanbanCard } from '../../ui/board/types'
import { buildCardMenu, type CardMenuHost } from './card-menu'

/** Shape of the recording Menu/MenuItem mocks from `src/test-setup.ts`. */
interface MenuItemRecord {
    title: string
    icon: string
    checked: boolean | null
    clickHandler: ((evt: MouseEvent | KeyboardEvent) => unknown) | null
    separator?: boolean
}

function menuItems(card: KanbanCard, host: CardMenuHost): MenuItemRecord[] {
    return (buildCardMenu(card, host) as unknown as { items: MenuItemRecord[] }).items
}

function makeCard(): KanbanCard {
    return {
        key: 'Tasks/task.md',
        statusValue: 'todo',
        order: 1000,
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fake: only .path is read
        file: { path: 'Tasks/task.md' } as unknown as TFile,
        title: 'Task',
        display: {
            title: 'Task',
            fields: [],
            coverUrl: null,
            wrap: false,
            dueState: 'none',
            countdown: null
        },
        relationships: { blocked_by: [], parent: [], child: [], sibling: [] }
    }
}

function makeHost(overrides: Partial<CardMenuHost> = {}): CardMenuHost {
    return {
        openCard: () => {},
        columns: () => [],
        setCardStatus: () => Promise.resolve(),
        archivingConfigured: () => false,
        archiveCard: () => Promise.resolve(),
        enumPropertiesFor: () => [],
        setCardProperty: () => Promise.resolve(),
        cardDate: () => null,
        writeCardDate: () => Promise.resolve(),
        promptDate: () => {},
        openRelated: () => {},
        focusOnChildren: () => {},
        focusOnDescendants: () => {},
        canReorderCards: () => true,
        sendCardToEdge: () => {},
        todayKey: () => '2026-01-01',
        tomorrowKey: () => '2026-01-02',
        addableRelationshipRoles: () => new Set(),
        directRelationships: () => [],
        addRelationship: () => {},
        removeRelationship: () => Promise.resolve(),
        ...overrides
    }
}

describe('buildCardMenu — send to top/bottom (issue #78)', () => {
    it('offers Send to top and Send to bottom under manual order', () => {
        const items = menuItems(makeCard(), makeHost())
        const titles = items.map((i) => i.title)
        expect(titles).toContain('Send to top')
        expect(titles).toContain('Send to bottom')
    })

    it('routes clicks to sendCardToEdge with the matching edge', () => {
        const sendCardToEdge = mock((_card: KanbanCard, _edge: 'top' | 'bottom') => {})
        const card = makeCard()
        const items = menuItems(card, makeHost({ sendCardToEdge }))
        const top = items.find((i) => i.title === 'Send to top')
        const bottom = items.find((i) => i.title === 'Send to bottom')
        const click = {} as MouseEvent // no DOM in bun test; the handler ignores the event
        top?.clickHandler?.(click)
        bottom?.clickHandler?.(click)
        expect(sendCardToEdge.mock.calls).toEqual([
            [card, 'top'],
            [card, 'bottom']
        ])
    })

    it('hides both items while a non-manual sort owns the order (#17)', () => {
        const items = menuItems(makeCard(), makeHost({ canReorderCards: () => false }))
        const titles = items.map((i) => i.title)
        expect(titles).not.toContain('Send to top')
        expect(titles).not.toContain('Send to bottom')
    })
})
