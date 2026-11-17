import { Menu, setIcon } from 'obsidian'
import { renderGearButton } from './gear-button'
import type { ViewMode } from '../domain/embed-params'
import { VIEW_MODES, VIEW_MODE_LABELS, modeEnabled } from '../domain/embed-params'
import type { CollapsibleAction, DateWindowState } from './toolbar-overflow'
import { modeEntries, overflowEntries } from './toolbar-overflow'

// ViewMode lives in the domain layer (embed-params, issue #103) so pure
// domain code never imports from ui/; re-exported here for existing users.
export type { ViewMode } from '../domain/embed-params'

export interface ViewToolbarState {
    /** The active view mode. */
    mode: ViewMode
    /** Whether to show the up/down swimlane navigation (board mode, >1 lane). */
    showLaneNav: boolean
    /** Whether multi-select mode is active (board mode only). */
    selectionMode: boolean
    /** Whether compact cards (title only) are active (board mode only). */
    compactMode: boolean
    /** Whether any card on the board carries the contexts property (else the switcher is hidden). */
    contextsAvailable: boolean
    /** Number of GTD contexts currently selected (0 = inactive/no count badge). */
    contextCount: number
    /** Whether the board's note types define enum properties (else the property picker is hidden). */
    propertiesAvailable: boolean
    /** Number of properties the picker currently filters on. */
    propertyFilterCount: number
    /** Modes switched off in the plugin settings (their buttons are not rendered). */
    disabledModes: readonly string[]
}

export interface ViewToolbarCallbacks {
    /** Switch the view mode (persists to the view config). */
    onSetMode: (mode: ViewMode) => void
    /** Open the shared (note-type) settings modal. */
    onConfigure: () => void
    /** Scroll to the previous swimlane. */
    onLanePrev: () => void
    /** Scroll to the next swimlane. */
    onLaneNext: () => void
    /** Toggle multi-select mode. */
    onToggleSelectionMode: () => void
    /** Toggle compact cards (persists to the view config). */
    onToggleCompactMode: () => void
    /** Open the GTD context switcher menu, anchored to the toolbar button. */
    onOpenContextMenu: (anchorEl: HTMLElement) => void
    /** Open the property picker (filter by a note-type property's values). */
    onOpenPropertyMenu: (anchorEl: HTMLElement) => void
    /**
     * The date-window chips when the narrow toolbar hid them (they then go to
     * the overflow menu); null when they are visible or there are none.
     */
    collapsedWindows: () => DateWindowState | null
    /** Toggle a date window from the overflow menu (same as a chip click). */
    onWindowToggle: (value: string) => void
}

/**
 * Render the view's toolbar controls into two stable slots: the mode switch
 * into `leftEl`, and the secondary actions (swimlane navigation, select,
 * compact, context and property pickers, "Configure note types" gear) plus the
 * overflow "More" button into `rightEl`. Each slot is emptied and refilled so the
 * controls stay in sync on mode/lane changes. The filter input lives in a
 * separate, persistent slot between them (owned by the view) so it is never
 * re-rendered and never loses focus mid-typing.
 *
 * Narrow toolbar (issue #236): a container query on `.kap-toolbar` hides the
 * inactive modes (the active one gets a chevron and opens a mode menu) and the
 * secondary actions (the "More" button lists them). The CSS decides what is
 * hidden; the menus read it back from the DOM when they open.
 */
export function renderViewToolbar(
    leftEl: HTMLElement,
    rightEl: HTMLElement,
    state: ViewToolbarState,
    callbacks: ViewToolbarCallbacks
): void {
    leftEl.empty()
    const modeSwitch = leftEl.createDiv({
        cls: 'kap-mode-switch',
        attr: { 'role': 'tablist', 'aria-label': 'View mode' }
    })
    const enabled = (mode: ViewMode): boolean => modeEnabled(mode, state.disabledModes)
    const enabledCount = VIEW_MODES.filter(enabled).length
    for (const mode of VIEW_MODES) {
        if (!enabled(mode)) continue
        const active = state.mode === mode
        const btn = addModeButton(modeSwitch, VIEW_MODE_LABELS[mode], active)
        if (active && enabledCount > 1) {
            const chevron = btn.createSpan({ cls: 'kap-mode-btn-chevron' })
            setIcon(chevron, 'chevron-down')
        }
        btn.addEventListener('click', () => {
            // Narrow toolbar: the other modes are hidden, so the active mode
            // button opens the mode menu instead of re-selecting itself.
            if (active && modesCollapsed(modeSwitch)) {
                openModeMenu(btn, state, callbacks)
                return
            }
            callbacks.onSetMode(mode)
        })
    }

    rightEl.empty()
    const actions: Array<{ el: HTMLElement; action: Omit<CollapsibleAction, 'hidden'> }> = []
    const addAction = (action: Omit<CollapsibleAction, 'hidden'>): HTMLElement => {
        const btn = addIconButton(rightEl, action.icon, action.label, () => action.run(btn))
        btn.addClass('kap-toolbar-collapsible')
        if (action.checked) btn.addClass('kap-nav-btn-active')
        actions.push({ el: btn, action })
        return btn
    }
    if (state.showLaneNav) {
        addAction({
            icon: 'chevron-up',
            label: 'Previous swimlane',
            checked: null,
            run: callbacks.onLanePrev
        })
        addAction({
            icon: 'chevron-down',
            label: 'Next swimlane',
            checked: null,
            run: callbacks.onLaneNext
        })
    }
    if (state.mode === 'board') {
        addAction({
            icon: 'list-checks',
            label: state.selectionMode ? 'Exit select mode' : 'Select multiple cards',
            checked: state.selectionMode,
            run: callbacks.onToggleSelectionMode
        })
        addAction({
            icon: 'rows-2',
            label: state.compactMode ? 'Show card details' : 'Show titles only',
            checked: state.compactMode,
            run: callbacks.onToggleCompactMode
        })
    }
    // GTD context switcher: contexts filter every mode, so it is shown in all
    // modes — but only when at least one card on the board carries the property
    // (mirrors how lane nav only appears with >1 lane).
    if (state.contextsAvailable) {
        const contextBtn = addAction({
            icon: 'at-sign',
            label:
                state.contextCount > 0
                    ? `Contexts (${String(state.contextCount)} selected)`
                    : 'Filter by context',
            checked: null,
            run: (anchor) => callbacks.onOpenContextMenu(anchor)
        })
        if (state.contextCount > 0) contextBtn.addClass('kap-nav-btn-active')
    }
    // Property picker: filter by the allowed values of any enum property the
    // board's note types define, shown when there is at least one.
    if (state.propertiesAvailable) {
        const propertyBtn = addAction({
            icon: 'list-filter',
            label:
                state.propertyFilterCount > 0
                    ? `Properties (${String(state.propertyFilterCount)} filtered)`
                    : 'Filter by property',
            checked: null,
            run: (anchor) => callbacks.onOpenPropertyMenu(anchor)
        })
        if (state.propertyFilterCount > 0) propertyBtn.addClass('kap-nav-btn-active')
    }
    const gear = renderGearButton(rightEl, callbacks.onConfigure)
    gear.addClass('kap-toolbar-collapsible')
    actions.push({
        el: gear,
        action: {
            icon: 'settings',
            label: gear.getAttribute('aria-label') ?? 'Configure note types',
            checked: null,
            run: callbacks.onConfigure
        }
    })

    const more = addIconButton(rightEl, 'more-horizontal', 'More actions', () => {
        const entries = overflowEntries(
            callbacks.collapsedWindows(),
            actions.map(({ el, action }) => ({ ...action, hidden: !el.isShown() })),
            callbacks.onWindowToggle
        )
        const menu = new Menu()
        let section: string | null = null
        for (const entry of entries) {
            if (section !== null && entry.section !== section) menu.addSeparator()
            section = entry.section
            menu.addItem((item) => {
                item.setTitle(entry.title)
                if (entry.icon) item.setIcon(entry.icon)
                if (entry.checked !== null) item.setChecked(entry.checked)
                item.onClick(() => entry.run(more))
            })
        }
        showBelow(menu, more)
    })
    more.addClass('kap-toolbar-overflow')
}

/** Whether the narrow-toolbar container query hid the inactive mode buttons. */
function modesCollapsed(modeSwitch: HTMLElement): boolean {
    return Array.from(modeSwitch.children).some((el) => el.instanceOf(HTMLElement) && !el.isShown())
}

/** The narrow toolbar's mode menu: every enabled mode, the active one checked. */
function openModeMenu(
    anchor: HTMLElement,
    state: ViewToolbarState,
    callbacks: ViewToolbarCallbacks
): void {
    const menu = new Menu()
    for (const entry of modeEntries(VIEW_MODES, VIEW_MODE_LABELS, state.mode, (mode) =>
        modeEnabled(mode, state.disabledModes)
    )) {
        menu.addItem((item) => {
            item.setTitle(entry.title)
                .setChecked(entry.checked)
                .onClick(() => {
                    if (!entry.checked) callbacks.onSetMode(entry.mode)
                })
        })
    }
    showBelow(menu, anchor)
}

/** Open a menu under its anchor, aligned to the anchor's left edge. */
function showBelow(menu: Menu, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect()
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument)
}

function addModeButton(parent: HTMLElement, label: string, active: boolean): HTMLElement {
    const btn = parent.createEl('button', {
        cls: 'kap-mode-btn',
        text: label,
        attr: { 'type': 'button', 'role': 'tab', 'aria-selected': String(active) }
    })
    if (active) btn.addClass('kap-mode-btn-active')
    return btn
}

function addIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
): HTMLElement {
    const btn = parent.createEl('button', {
        cls: 'kap-nav-btn',
        attr: { 'type': 'button', 'aria-label': label, 'title': label }
    })
    setIcon(btn, icon)
    btn.addEventListener('click', onClick)
    return btn
}
