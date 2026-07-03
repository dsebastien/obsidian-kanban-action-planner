import { Menu } from 'obsidian'
import { UNMAPPED_COLUMN_ID } from '../../constants'
import type { ColumnDef, RelationshipRole } from '../../domain/note-type'
import type { DateDimension } from '../../domain/calendar'
import type { RelatedNote } from '../../services/relationships.service'
import type { KanbanCard } from '../../ui/board/types'

/**
 * What {@link buildCardMenu} needs from the host view: the card actions it
 * triggers, passed as closures so the menu builder never reaches into view
 * privates. Construction is otherwise stateless — the menu only reads the card.
 */
export interface CardMenuHost {
    openCard(card: KanbanCard, newTab: boolean): void
    columns(): ReadonlyArray<ColumnDef>
    setCardStatus(card: KanbanCard, statusValue: string | null, columnId: string): Promise<void>
    archivingConfigured(card: KanbanCard): boolean
    archiveCard(card: KanbanCard): Promise<void>
    /**
     * Enum properties (issue #52) the "Set <property>" submenu offers for this
     * card — each with its allowed values and the card's current value. Empty
     * when the card's note type has no known enum properties.
     */
    enumPropertiesFor(card: KanbanCard): Array<{
        name: string
        displayName: string
        values: string[]
        current: string | null
    }>
    /** Write (or clear, when `value` is null) an enum property on the card's note. */
    setCardProperty(card: KanbanCard, propertyName: string, value: string | null): Promise<void>
    /** Read a card's scheduled/deadline date (null when unset). */
    cardDate(card: KanbanCard, dimension: DateDimension): Date | null
    /** Write (or clear, when `isoDate` is null) a card's scheduled date or deadline. */
    writeCardDate(card: KanbanCard, dimension: DateDimension, isoDate: string | null): Promise<void>
    /** Open the date picker for a card's scheduled date or deadline. */
    promptDate(card: KanbanCard, dimension: DateDimension, current: Date | null): void
    openRelated(note: RelatedNote, newTab: boolean): void
    /** Zoom (issue #74): re-filter the board to the card's children. */
    focusOnChildren(card: KanbanCard): void
    /** Zoom (issue #74): re-filter the board to the card's whole subtree. */
    focusOnDescendants(card: KanbanCard): void
    /** Quick "today"/"tomorrow" keys + the current new-tab modifier check. */
    todayKey(): string
    tomorrowKey(): string
    // Relationship editing (issue #14).
    /** Roles whose link-property is non-empty, so a target can be added. */
    addableRelationshipRoles(): ReadonlySet<RelationshipRole>
    /** Removable direct links currently on the card (per role + target). */
    directRelationships(card: KanbanCard): Array<{
        role: RelationshipRole
        target: { path: string; label: string }
    }>
    /** Open a note picker and link the chosen note in `role`'s property. */
    addRelationship(card: KanbanCard, role: RelationshipRole): void
    /** Remove the link to `targetPath` from `role`'s property. */
    removeRelationship(card: KanbanCard, role: RelationshipRole, targetPath: string): Promise<void>
}

/** Build the card right-click / keyboard context menu (issue #3, #7, #20, #27). */
export function buildCardMenu(card: KanbanCard, host: CardMenuHost): Menu {
    const menu = new Menu()
    menu.addItem((item) =>
        item
            .setTitle('Open note')
            .setIcon('file')
            .onClick(() => host.openCard(card, false))
    )
    menu.addItem((item) =>
        item
            .setTitle('Open in new tab')
            .setIcon('lucide-external-link')
            .onClick(() => host.openCard(card, true))
    )
    if (card.relationships.child.length > 0) {
        menu.addItem((item) =>
            item
                .setTitle('Focus on children')
                .setIcon('zoom-in')
                .onClick(() => host.focusOnChildren(card))
        )
        menu.addItem((item) =>
            item
                .setTitle('Focus on all descendants')
                .setIcon('zoom-in')
                .onClick(() => host.focusOnDescendants(card))
        )
    }
    menu.addSeparator()
    for (const col of host.columns()) {
        menu.addItem((item) =>
            item
                .setTitle(`Set status: ${col.label}`)
                .setChecked(card.statusValue === col.statusValue)
                .onClick(() => void host.setCardStatus(card, col.statusValue, col.id))
        )
    }
    if (card.statusValue !== null) {
        menu.addItem((item) =>
            item
                .setTitle('Clear status')
                .setIcon('x')
                .onClick(() => void host.setCardStatus(card, null, UNMAPPED_COLUMN_ID))
        )
    }
    addEnumSetMenuItems(menu, card, host)
    addSchedulingMenuItems(menu, card, host)
    if (host.archivingConfigured(card)) {
        menu.addSeparator()
        menu.addItem((item) =>
            item
                .setTitle('Archive')
                .setIcon('archive')
                .onClick(() => void host.archiveCard(card))
        )
    }
    addRelationshipMenuItems(menu, card, host)
    addRelationshipEditItems(menu, card, host)
    return menu
}

/** "Relationships" submenu to add/remove direct relationships (issue #14). */
function addRelationshipEditItems(menu: Menu, card: KanbanCard, host: CardMenuHost): void {
    const addable = host.addableRelationshipRoles()
    const direct = host.directRelationships(card)
    if (addable.size === 0 && direct.length === 0) return

    menu.addSeparator()
    menu.addItem((item) => {
        item.setTitle('Relationships').setIcon('link')
        const submenu = item.setSubmenu()
        for (const { role, label, icon } of RELATIONSHIP_MENU) {
            if (!addable.has(role)) continue
            submenu.addItem((sub) =>
                sub
                    .setTitle(`Add ${label.toLowerCase()}…`)
                    .setIcon(icon)
                    .onClick(() => host.addRelationship(card, role))
            )
        }
        if (direct.length > 0) submenu.addSeparator()
        for (const { role, target } of direct) {
            const meta = RELATIONSHIP_MENU.find((m) => m.role === role)
            submenu.addItem((sub) =>
                sub
                    .setTitle(`Remove ${(meta?.label ?? role).toLowerCase()}: ${target.label}`)
                    .setIcon('x')
                    .onClick(() => void host.removeRelationship(card, role, target.path))
            )
        }
    })
}

/**
 * "Set <property>" submenus for each configured enum property (issue #52),
 * generalizing the "Set status" pattern: a submenu of allowed values with the
 * current one checked, plus a Clear item. Nothing is added when the card's note
 * type has no known enum properties.
 */
function addEnumSetMenuItems(menu: Menu, card: KanbanCard, host: CardMenuHost): void {
    const props = host.enumPropertiesFor(card)
    if (props.length === 0) return
    menu.addSeparator()
    for (const { name, displayName, values, current } of props) {
        menu.addItem((item) => {
            item.setTitle(`Set ${displayName.toLowerCase()}`).setIcon('list')
            const submenu = item.setSubmenu()
            for (const value of values) {
                submenu.addItem((sub) =>
                    sub
                        .setTitle(value)
                        .setChecked(current === value)
                        .onClick(() => void host.setCardProperty(card, name, value))
                )
            }
            if (current !== null) {
                submenu.addSeparator()
                submenu.addItem((sub) =>
                    sub
                        .setTitle('Clear')
                        .setIcon('x')
                        .onClick(() => void host.setCardProperty(card, name, null))
                )
            }
        })
    }
}

/** "Schedule" / "Set deadline" quick dates + precise picker + clear. */
function addSchedulingMenuItems(menu: Menu, card: KanbanCard, host: CardMenuHost): void {
    const todayKey = host.todayKey()
    const tomorrowKey = host.tomorrowKey()
    const scheduled = host.cardDate(card, 'scheduled')
    const deadline = host.cardDate(card, 'deadline')

    menu.addItem((i) =>
        i
            .setTitle('Schedule for today')
            .setIcon('calendar-clock')
            .setSection('kap-schedule')
            .onClick(() => void host.writeCardDate(card, 'scheduled', todayKey))
    )
    menu.addItem((i) =>
        i
            .setTitle('Schedule for tomorrow')
            .setIcon('calendar-clock')
            .setSection('kap-schedule')
            .onClick(() => void host.writeCardDate(card, 'scheduled', tomorrowKey))
    )
    menu.addItem((i) =>
        i
            .setTitle('Schedule on a date…')
            .setIcon('calendar')
            .setSection('kap-schedule')
            .onClick(() => host.promptDate(card, 'scheduled', scheduled))
    )
    if (scheduled) {
        menu.addItem((i) =>
            i
                .setTitle('Clear scheduled date')
                .setIcon('x')
                .setSection('kap-schedule')
                .onClick(() => void host.writeCardDate(card, 'scheduled', null))
        )
    }

    menu.addItem((i) =>
        i
            .setTitle('Set deadline today')
            .setIcon('alarm-clock')
            .setSection('kap-deadline')
            .onClick(() => void host.writeCardDate(card, 'deadline', todayKey))
    )
    menu.addItem((i) =>
        i
            .setTitle('Set deadline on a date…')
            .setIcon('alarm-clock')
            .setSection('kap-deadline')
            .onClick(() => host.promptDate(card, 'deadline', deadline))
    )
    if (deadline) {
        menu.addItem((i) =>
            i
                .setTitle('Clear deadline')
                .setIcon('x')
                .setSection('kap-deadline')
                .onClick(() => void host.writeCardDate(card, 'deadline', null))
        )
    }
}

/** Add "open related note" items (blockers first) when the card has any. */
function addRelationshipMenuItems(menu: Menu, card: KanbanCard, host: CardMenuHost): void {
    let separated = false
    for (const { role, label, icon } of RELATIONSHIP_MENU) {
        const related = card.relationships[role]
        if (related.length === 0) continue
        if (!separated) {
            menu.addSeparator()
            separated = true
        }
        for (const note of related) {
            menu.addItem((item) =>
                item
                    .setTitle(`${label}: ${note.label}`)
                    .setIcon(icon)
                    .onClick((evt) => host.openRelated(note, isNewTabEvent(evt)))
            )
        }
    }
}

/** Relationship roles shown in the card context menu (blockers first). */
const RELATIONSHIP_MENU: Array<{ role: RelationshipRole; label: string; icon: string }> = [
    { role: 'blocked_by', label: 'Blocked by', icon: 'ban' },
    { role: 'parent', label: 'Parent', icon: 'corner-left-up' },
    { role: 'child', label: 'Child', icon: 'corner-right-down' },
    { role: 'sibling', label: 'Sibling', icon: 'arrow-left-right' }
]

/** Whether an event asks to open in a new tab (Ctrl/Cmd held). */
export function isNewTabEvent(evt: MouseEvent | KeyboardEvent): boolean {
    return evt.ctrlKey || evt.metaKey
}
