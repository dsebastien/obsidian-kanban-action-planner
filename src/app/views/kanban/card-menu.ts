import { Menu } from 'obsidian'
import type { TFile } from 'obsidian'
import { UNMAPPED_COLUMN_ID } from '../../constants'
import type {
    CardPresentation,
    ColumnDef,
    NoteType,
    RelationshipRole
} from '../../domain/note-type'
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
    /** Read a card's scheduled/deadline date (null when unset). */
    cardDate(card: KanbanCard, dimension: DateDimension): Date | null
    /** Write (or clear, when `isoDate` is null) a card's scheduled date or deadline. */
    writeCardDate(card: KanbanCard, dimension: DateDimension, isoDate: string | null): Promise<void>
    /** Open the date picker for a card's scheduled date or deadline. */
    promptDate(card: KanbanCard, dimension: DateDimension, current: Date | null): void
    /** The note type whose card config drives a file's display (its type, else active). */
    cardDisplayNoteType(file: TFile): NoteType
    /** Candidate property names for the card's "Show fields" menu. */
    displayFieldCandidates(card: KanbanCard, presentation: CardPresentation): string[]
    /** Add or remove a property from a note type's displayed card fields. */
    toggleDisplayField(noteTypeId: string, property: string): Promise<void>
    openRelated(note: RelatedNote, newTab: boolean): void
    /** Quick "today"/"tomorrow" keys + the current new-tab modifier check. */
    todayKey(): string
    tomorrowKey(): string
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
    addDisplayFieldMenuItems(menu, card, host)
    addRelationshipMenuItems(menu, card, host)
    return menu
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

/**
 * "Show fields" submenu: a checkable list of candidate properties for the
 * card's note type. Toggling one adds/removes it from that note type's card
 * config; the change persists and every open board refreshes.
 */
function addDisplayFieldMenuItems(menu: Menu, card: KanbanCard, host: CardMenuHost): void {
    const noteType = host.cardDisplayNoteType(card.file)
    const candidates = host.displayFieldCandidates(card, noteType.card)
    if (candidates.length === 0) return

    menu.addSeparator()
    menu.addItem((item) => {
        item.setTitle('Show fields').setIcon('list')
        const submenu = item.setSubmenu()
        for (const property of candidates) {
            const shown = noteType.card.fields.some((f) => f.property === property)
            submenu.addItem((sub) =>
                sub
                    .setTitle(property)
                    .setChecked(shown)
                    .onClick(() => void host.toggleDisplayField(noteType.id, property))
            )
        }
    })
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
