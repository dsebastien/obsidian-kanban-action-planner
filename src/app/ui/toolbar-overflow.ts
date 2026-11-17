/**
 * The toolbar's overflow menu (issue #236). When the view is narrow, a
 * container query hides the secondary toolbar controls (date-window chips,
 * icon buttons) and shows a "More" button instead; its menu lists exactly the
 * controls the CSS hid, read from the DOM at click time. The CSS decides what
 * collapses, so the menu never disagrees with what is on screen.
 *
 * Pure: no DOM, no Obsidian API. `view-toolbar.ts` turns the entries into an
 * Obsidian `Menu`.
 */

/** One date-window chip (issue #145): the `when:` keyword and its label. */
export interface DateWindowChip {
    value: string
    label: string
}

/** The date-window chips and the active one, as the filter bar shows them. */
export interface DateWindowState {
    chips: ReadonlyArray<DateWindowChip>
    active: string | null
}

/** One secondary toolbar control that can collapse into the overflow menu. */
export interface CollapsibleAction {
    icon: string
    label: string
    /** On/off state of a toggle (select mode, compact cards); null for plain actions. */
    checked: boolean | null
    /** Whether the control is hidden right now (collapsed by the container query). */
    hidden: boolean
    /** Run the action; `anchor` positions any menu the action opens. */
    run: (anchor: HTMLElement) => void
}

/** One overflow-menu item. `section` groups items between separators. */
export interface OverflowEntry {
    section: 'window' | 'action'
    title: string
    icon: string | null
    checked: boolean | null
    run: (anchor: HTMLElement) => void
}

/**
 * The overflow-menu items: the hidden date-window chips first (checked when
 * active; a click toggles that window), then each hidden action in toolbar
 * order. `windows` is null when the chips are visible or there are none.
 */
export function overflowEntries(
    windows: DateWindowState | null,
    actions: ReadonlyArray<CollapsibleAction>,
    onWindowToggle: (value: string) => void
): OverflowEntry[] {
    const entries: OverflowEntry[] = []
    for (const chip of windows?.chips ?? []) {
        entries.push({
            section: 'window',
            title: chip.label,
            icon: null,
            checked: chip.value === windows?.active,
            run: () => onWindowToggle(chip.value)
        })
    }
    for (const action of actions) {
        if (!action.hidden) continue
        entries.push({
            section: 'action',
            title: action.label,
            icon: action.icon,
            checked: action.checked,
            run: action.run
        })
    }
    return entries
}

/** A mode-menu item: every enabled mode, the active one checked. */
export interface ModeEntry<M extends string> {
    mode: M
    title: string
    checked: boolean
}

/** The mode menu (narrow toolbar): every enabled mode in order, the active one checked. */
export function modeEntries<M extends string>(
    modes: ReadonlyArray<M>,
    labels: Readonly<Record<M, string>>,
    active: M,
    enabled: (mode: M) => boolean
): Array<ModeEntry<M>> {
    return modes
        .filter((mode) => enabled(mode))
        .map((mode) => ({ mode, title: labels[mode], checked: mode === active }))
}
