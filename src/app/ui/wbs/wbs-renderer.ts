/**
 * WBS view renderer (issue #76) — DOM only, intent reported via callbacks.
 *
 * Layout mirrors the calendar/timeline modes: a collapsible left
 * `kap-scheduling-panel` (cards missing a start date or an estimate, grouped
 * note type → status) beside the tree. Each visible node is one flat
 * `.kap-wbs-row` (the controller applies collapse before building the row
 * list), indented by depth, carrying `data-card-key` + `data-parent-key` for
 * the DnD hit-testing contract.
 *
 * **Incremental refresh:** the shell (panel chrome + tree bar + tree) is
 * built once and kept. Panel body groups and tree rows are both reconciled
 * with the board's pure `planReconcile` over keyed content signatures (rows
 * key per instance — `parentKey::path` — so duplicated multi-parent
 * instances stay distinct; the panel keys per type/status group, issue
 * #100) — unchanged nodes keep their exact DOM, so scroll, focus, and an
 * in-flight drag survive every refresh, and the echo rebuild after an
 * optimistic write no-ops.
 */

import { setIcon } from 'obsidian'
import { renderGroupHeader } from '../calendar/calendar-renderer'
import { planReconcile } from '../board/reconcile'
import { cssEscapeAttr } from '../../utils/css-escape'
import type { KanbanCard, CountdownTone } from '../board/types'
import { parseEstimateInput } from '../../domain/estimate'
import type { DurationParts, EstimateUnit } from '../../domain/estimate'

/** One visible tree row (collapse already applied by the controller). */
export interface WbsRowModel {
    /**
     * The card, or null for a CONTEXT row — an ancestor outside the view's
     * result set, shown so a filtered board keeps its hierarchy (approved
     * exception to business rule 36). Context rows open on click and accept
     * drops, but carry no editing chips, menu, or drag handle.
     */
    card: KanbanCard | null
    /** The row's display title (card title, or the file name for context rows). */
    title: string
    /** The note path (the DnD/card key). */
    key: string
    /** The context parent's path — '' for roots (dataset-friendly). */
    parentKey: string
    depth: number
    hasChildren: boolean
    collapsed: boolean
    /** Direct in-set children (shown on the collapsed badge). */
    childCount: number
    statusLabel: string | null
    /** Resolved CSS color for the status dot (null → neutral). */
    statusColor: string | null
    blocked: boolean
    /** An extra instance of a multi-parent note (rendered under each parent). */
    duplicate: boolean
    /**
     * The chip's primary estimate (the own value, else the derived rollup),
     * segmented per unit so days/hours/minutes render in fixed slots that
     * align vertically across rows. Null = unset (dash).
     */
    estimateParts: DurationParts | null
    /** The parts come from the children's rollup, not an own value. */
    estimateDerived: boolean
    /**
     * Full "Σ …" rollup text, only when an own value exists AND the rollup
     * meaningfully differs — the budget-vs-breakdown signal, rendered in the
     * chip's fixed leading slot.
     */
    rollupSuffix: string | null
    /** The card's estimate unit — the inline editor parses input against it. */
    estimateUnit: EstimateUnit
    /**
     * The inline editor's prefill in the card's unit (issue #106): the own
     * raw value, else the derived rollup — same as the estimate modal, so
     * persisting the bottom-up total stays a two-keystroke affair.
     */
    estimatePrefill: number | null
    /** Start date key (e.g. `2026-07-14`) when set (or derived). */
    startLabel: string | null
    /** End date key (start + estimate − 1, or the subtree's latest end). */
    endLabel: string | null
    /** Dates derived bottom-up from the children (no own start). */
    datesDerived: boolean
    /** Effective progress 0–100 (own, or derived from children), or null. */
    progress: number | null
    progressDerived: boolean
    /** Due countdown text (`in 3d`, `2d overdue`) + tone; null = no due date. */
    dueLabel: string | null
    dueTone: CountdownTone | null
    /** The due date key (tooltip / modal prefill), null when unset. */
    dueDateKey: string | null
}

export interface WbsPaneStatusGroupModel {
    key: string
    label: string
    collapsed: boolean
    cards: KanbanCard[]
    /** The owning note type id — pane-group drops are same-type only. */
    typeId: string
    /** The raw status value this group holds ('' = no status). */
    status: string
}

export interface WbsPaneTypeGroupModel {
    key: string
    label: string
    count: number
    collapsed: boolean
    groups: WbsPaneStatusGroupModel[]
}

export interface WbsViewModel {
    rows: WbsRowModel[]
    /** Number of root trees (0 → the empty hint shows). */
    rootCount: number
    paneGroups: WbsPaneTypeGroupModel[]
    /** Whether the pane nests status groups under type headers (multi-type). */
    paneGrouped: boolean
    panelCollapsed: boolean
    /** Minutes one work day represents — inline estimate parsing (issue #106). */
    minutesPerDay: number
}

export interface WbsCallbacks {
    onOpen: (card: KanbanCard, newTab: boolean) => void
    /** Open a context row's note (no card exists for it in the result set). */
    onOpenPath: (path: string, newTab: boolean) => void
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
    /** Status dot clicked (issue #98) — open the status quick menu. */
    onStatusDot: (card: KanbanCard, event: MouseEvent) => void
    onToggleNode: (key: string) => void
    onTogglePanel: () => void
    onTogglePaneGroup: (key: string) => void
    /** Inline estimate edit committed (issue #106): a value, or null = clear. */
    onCommitEstimate: (card: KanbanCard, value: number | null) => void
    onEditStart: (card: KanbanCard) => void
    onEditDue: (card: KanbanCard) => void
    onEditProgress: (card: KanbanCard) => void
    onExpandAll: () => void
    onCollapseAll: () => void
}

/** Render (or incrementally refresh) the WBS view inside the board host. */
export function renderWbs(root: HTMLElement, model: WbsViewModel, callbacks: WbsCallbacks): void {
    let shell = root.querySelector<HTMLElement>(':scope > .kap-wbs')
    if (!shell) {
        root.empty()
        shell = root.createDiv({ cls: 'kap-wbs' })
        buildShell(shell, callbacks)
    }
    reconcilePanel(shell, model, callbacks)
    reconcileTree(shell, model, callbacks)
}

/** The persistent skeleton: panel chrome + tree bar + scrolling tree. */
function buildShell(shell: HTMLElement, callbacks: WbsCallbacks): void {
    // Panel chrome is permanent; reconcilePanel updates its state in place
    // and reconciles the body groups (issue #100).
    const panel = shell.createDiv({ cls: 'kap-scheduling-panel kap-wbs-panel' })
    const header = panel.createDiv({ cls: 'kap-panel-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-panel-toggle',
        attr: { type: 'button' }
    })
    toggle.addEventListener('click', () => callbacks.onTogglePanel())
    // Cards missing a start date or an estimate — the WBS backlog to plan.
    header.createSpan({ cls: 'kap-panel-title' })
    // Revealed while a tree row drags (CSS on .kap-wbs-drop-ready); dropping
    // detaches the row from its parent. The collapsed rail has no room.
    panel.createDiv({ cls: 'kap-wbs-drop-hint', text: 'Drop here to detach from parent' })
    const wrap = shell.createDiv({ cls: 'kap-wbs-treewrap' })
    const bar = wrap.createDiv({ cls: 'kap-wbs-treebar' })
    const expand = bar.createEl('button', {
        cls: 'kap-wbs-treebar-btn',
        attr: { 'type': 'button', 'aria-label': 'Expand all', 'title': 'Expand all' }
    })
    setIcon(expand, 'chevrons-up-down')
    expand.addEventListener('click', () => callbacks.onExpandAll())
    const collapse = bar.createEl('button', {
        cls: 'kap-wbs-treebar-btn',
        attr: { 'type': 'button', 'aria-label': 'Collapse all', 'title': 'Collapse all' }
    })
    setIcon(collapse, 'chevrons-down-up')
    collapse.addEventListener('click', () => callbacks.onCollapseAll())
    wrap.createDiv({ cls: 'kap-wbs-tree', attr: { role: 'tree' } })
}

// ── Panel ─────────────────────────────────────────────────────

/** One reconcilable panel body block: a group section, or the empty hint. */
interface PanelSection {
    key: string
    signature: string
    build: () => HTMLElement
}

/** Everything one status subgroup renders (nested into type signatures too). */
function statusGroupSignature(sub: WbsPaneStatusGroupModel): unknown {
    return {
        k: sub.key,
        l: sub.label,
        c: sub.collapsed,
        i: sub.cards.map((card) => `${card.key}|${card.display.title}`)
    }
}

/**
 * The panel body as an ordered list of keyed sections (issue #100): one per
 * note-type group when the pane is grouped, one per status subgroup
 * otherwise, or the single empty hint. Keys are prefixed per shape so a
 * grouped↔flat flip never aliases a type key with a subgroup key.
 */
function panelSections(model: WbsViewModel, callbacks: WbsCallbacks): PanelSection[] {
    const total = model.paneGroups.reduce((sum, g) => sum + g.count, 0)
    if (total === 0) {
        return [
            {
                key: '__empty__',
                signature: 'empty',
                build: () =>
                    createDiv({
                        cls: 'kap-panel-empty',
                        text: 'Everything has a start date and estimate.'
                    })
            }
        ]
    }
    if (model.paneGrouped) {
        return model.paneGroups.map((group) => ({
            key: `t:${group.key}`,
            signature: JSON.stringify({
                l: group.label,
                n: group.count,
                c: group.collapsed,
                s: group.groups.map(statusGroupSignature)
            }),
            build: () => buildTypeSection(group, callbacks)
        }))
    }
    return model.paneGroups.flatMap((group) =>
        group.groups.map((sub) => ({
            key: `s:${sub.key}`,
            signature: JSON.stringify(statusGroupSignature(sub)),
            build: (): HTMLElement => {
                const section = createDiv({ cls: 'kap-wbs-pane-section' })
                buildStatusGroup(section, sub, callbacks)
                return section
            }
        }))
    )
}

/**
 * Update the persistent panel chrome in place (collapsed state, title count)
 * and reconcile the body's group sections — an unchanged group keeps its
 * exact DOM, so panel scroll and unrelated groups survive every refresh.
 */
function reconcilePanel(shell: HTMLElement, model: WbsViewModel, callbacks: WbsCallbacks): void {
    const panel = shell.querySelector<HTMLElement>(':scope > .kap-wbs-panel')
    if (!panel) return
    const total = model.paneGroups.reduce((sum, g) => sum + g.count, 0)
    panel.toggleClass('kap-scheduling-panel-collapsed', model.panelCollapsed)
    const toggle = panel.querySelector<HTMLElement>('.kap-panel-toggle')
    if (toggle) {
        toggle.setText(model.panelCollapsed ? '»' : '«')
        toggle.setAttribute('aria-label', model.panelCollapsed ? 'Expand panel' : 'Collapse panel')
    }
    panel
        .querySelector<HTMLElement>('.kap-panel-title')
        ?.setText(`Needs planning (${String(total)})`)

    let body = panel.querySelector<HTMLElement>(':scope > .kap-wbs-panel-body')
    if (model.panelCollapsed) {
        body?.remove()
        return
    }
    if (!body) body = panel.createDiv({ cls: 'kap-wbs-panel-body' })

    const sections = panelSections(model, callbacks)
    const existingEls = Array.from(
        body.querySelectorAll<HTMLElement>(':scope > [data-wbs-pane-key]')
    )
    const nodeByKey = new Map<string, HTMLElement>()
    const existing = existingEls.map((el) => {
        const key = el.dataset['wbsPaneKey'] ?? ''
        nodeByKey.set(key, el)
        return { key, signature: el.dataset['wbsPaneSig'] ?? '' }
    })
    const sectionByKey = new Map(sections.map((s) => [s.key, s]))
    const plan = planReconcile(
        existing,
        sections.map((s) => ({ key: s.key, signature: s.signature }))
    )
    for (const key of plan.remove) nodeByKey.get(key)?.remove()
    let cursor = body.firstElementChild
    for (const entry of plan.ordered) {
        let node: HTMLElement | undefined
        if (entry.create || entry.update) {
            const section = sectionByKey.get(entry.key)
            if (section) {
                node = section.build()
                node.dataset['wbsPaneKey'] = section.key
                node.dataset['wbsPaneSig'] = section.signature
            }
        } else {
            node = nodeByKey.get(entry.key)
        }
        if (!node) continue
        if (node === cursor) cursor = cursor.nextElementSibling
        else body.insertBefore(node, cursor)
    }
}

/** One note-type section: the type header plus its status subgroups. */
function buildTypeSection(group: WbsPaneTypeGroupModel, callbacks: WbsCallbacks): HTMLElement {
    const section = createDiv({ cls: 'kap-wbs-pane-section' })
    renderGroupHeader(section, 'kap-cal-ugroup', group.label, group.count, group.collapsed, () =>
        callbacks.onTogglePaneGroup(group.key)
    )
    if (group.collapsed) return section
    const host = section.createDiv({ cls: 'kap-cal-ugroup-body' })
    for (const sub of group.groups) buildStatusGroup(host, sub, callbacks)
    return section
}

/** One status subgroup: its header plus (when expanded) the card list. */
function buildStatusGroup(
    host: HTMLElement,
    sub: WbsPaneStatusGroupModel,
    callbacks: WbsCallbacks
): void {
    const subHeader = renderGroupHeader(
        host,
        'kap-cal-usubgroup',
        sub.label,
        sub.cards.length,
        sub.collapsed,
        () => callbacks.onTogglePaneGroup(sub.key)
    )
    // Pane-group DnD contract: a pane card dropped on another status
    // group (header or card list) of the SAME type sets that status.
    subHeader.dataset['paneDropType'] = sub.typeId
    subHeader.dataset['paneDropStatus'] = sub.status
    if (sub.collapsed) return
    const list = host.createDiv({ cls: 'kap-wbs-pane-cards' })
    list.dataset['paneDropType'] = sub.typeId
    list.dataset['paneDropStatus'] = sub.status
    for (const card of sub.cards) {
        const cardEl = list.createEl('button', {
            cls: 'kap-wbs-pane-card',
            attr: {
                type: 'button',
                title: 'Drag onto a tree node to set its parent'
            }
        })
        cardEl.dataset['cardKey'] = card.key
        cardEl.createSpan({ cls: 'kap-wbs-pane-cardtitle', text: card.display.title })
        cardEl.addEventListener('click', (e) => callbacks.onOpen(card, e.ctrlKey || e.metaKey))
        cardEl.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            callbacks.onContextMenu(card, e)
        })
    }
}

// ── Tree ──────────────────────────────────────────────────────

/** Per-instance reconcile key: multi-parent duplicates stay distinct. */
function rowKey(row: WbsRowModel): string {
    return `${row.parentKey}::${row.key}`
}

/** Everything a row renders — a changed signature rebuilds the node. */
function rowSignature(row: WbsRowModel): string {
    return JSON.stringify({
        t: row.title,
        x: row.card === null,
        d: row.depth,
        h: row.hasChildren,
        c: row.collapsed,
        n: row.childCount,
        sl: row.statusLabel,
        sc: row.statusColor,
        b: row.blocked,
        dup: row.duplicate,
        ep: row.estimateParts,
        ed: row.estimateDerived,
        rs: row.rollupSuffix,
        eu: row.estimateUnit,
        ef: row.estimatePrefill,
        s: row.startLabel,
        e: row.endLabel,
        dd: row.datesDerived,
        p: row.progress,
        pd: row.progressDerived,
        du: row.dueLabel,
        dt: row.dueTone
    })
}

function reconcileTree(shell: HTMLElement, model: WbsViewModel, callbacks: WbsCallbacks): void {
    const tree = shell.querySelector<HTMLElement>('.kap-wbs-tree')
    if (!tree) return

    if (model.rootCount === 0) {
        if (tree.dataset['wbsEmpty'] !== '1') {
            tree.empty()
            tree.dataset['wbsEmpty'] = '1'
            const empty = tree.createDiv({ cls: 'kap-wbs-empty' })
            empty.createDiv({
                cls: 'kap-wbs-empty-title',
                text: 'Nothing to break down.'
            })
            empty.createDiv({
                cls: 'kap-wbs-empty-hint',
                text: 'No notes match this view’s filters. Every matching note appears here — as a tree when notes link to parents or children, as single rows otherwise.'
            })
        }
        return
    }
    if (tree.dataset['wbsEmpty'] === '1') {
        tree.empty()
        delete tree.dataset['wbsEmpty']
    }

    // If the focused row gets rebuilt/removed, focus falls to body — restore
    // it onto the same instance (or the same note) after the pass.
    const activeEl = tree.ownerDocument.activeElement
    const focusedInstance =
        activeEl instanceof HTMLElement && tree.contains(activeEl)
            ? (activeEl.closest<HTMLElement>('.kap-wbs-row')?.dataset['wbsKey'] ?? null)
            : null

    const existingEls = Array.from(tree.querySelectorAll<HTMLElement>(':scope > .kap-wbs-row'))
    const nodeByKey = new Map<string, HTMLElement>()
    const existing = existingEls.map((el) => {
        const key = el.dataset['wbsKey'] ?? ''
        nodeByKey.set(key, el)
        return { key, signature: el.dataset['wbsSig'] ?? '' }
    })
    const rowByKey = new Map(model.rows.map((r) => [rowKey(r), r]))
    const desired = model.rows.map((r) => ({ key: rowKey(r), signature: rowSignature(r) }))

    const plan = planReconcile(existing, desired)
    for (const key of plan.remove) nodeByKey.get(key)?.remove()

    // Place desired nodes in order, reusing untouched nodes (React-style cursor).
    let cursor = tree.firstElementChild
    for (const entry of plan.ordered) {
        let node: HTMLElement | undefined
        if (entry.create || entry.update) {
            const row = rowByKey.get(entry.key)
            if (row) node = buildRowNode(row, callbacks, model.minutesPerDay)
        } else {
            node = nodeByKey.get(entry.key)
        }
        if (!node) continue
        if (node === cursor) cursor = cursor.nextElementSibling
        else tree.insertBefore(node, cursor)
    }

    if (focusedInstance && tree.ownerDocument.activeElement === tree.ownerDocument.body) {
        tree.querySelector<HTMLElement>(
            `.kap-wbs-row[data-wbs-key="${cssEscapeAttr(focusedInstance)}"]`
        )?.focus()
    }
}

/** Build one fully-wired, detached tree row and stamp its diff signature. */
function buildRowNode(
    row: WbsRowModel,
    callbacks: WbsCallbacks,
    minutesPerDay: number
): HTMLElement {
    const el = createDiv({
        cls: 'kap-wbs-row',
        attr: {
            'role': 'treeitem',
            'tabindex': '0',
            'aria-level': String(row.depth + 1)
        }
    })
    // ARIA tree pattern: aria-expanded marks a node as expandable — end
    // nodes must omit it entirely, or every leaf reads as a collapsed branch.
    if (row.hasChildren) el.setAttribute('aria-expanded', String(!row.collapsed))
    el.dataset['cardKey'] = row.key
    el.dataset['parentKey'] = row.parentKey
    el.dataset['wbsKey'] = rowKey(row)
    el.dataset['wbsSig'] = rowSignature(row)
    // Collapsed-branch marker: the DnD's hover-to-expand reads it.
    if (row.hasChildren && row.collapsed) el.dataset['wbsCollapsed'] = '1'
    if (row.blocked) el.addClass('kap-wbs-row-blocked')
    if (row.depth === 0) el.addClass('kap-wbs-row-root')
    // Context ancestor (outside the view's filters): display + drop target
    // only — the DnD skips it as a drag source via this marker.
    if (row.card === null) {
        el.addClass('kap-wbs-row-context')
        el.dataset['wbsContext'] = '1'
    }
    el.style.setProperty('--kap-wbs-depth', String(row.depth))

    // Expand/collapse chevron (fixed-width spacer keeps leaves aligned).
    if (row.hasChildren) {
        const toggle = el.createEl('button', {
            cls: 'kap-wbs-toggle',
            text: row.collapsed ? '▸' : '▾',
            attr: {
                'type': 'button',
                'aria-label': row.collapsed ? 'Expand' : 'Collapse'
            }
        })
        toggle.addEventListener('click', (e) => {
            e.stopPropagation()
            callbacks.onToggleNode(row.key)
        })
    } else {
        el.createSpan({ cls: 'kap-wbs-toggle kap-wbs-toggle-leaf' })
    }

    // Status dot — the row's single status affordance (issue #98): on card
    // rows it's a button opening the status quick menu; context rows keep a
    // plain slot-aligned placeholder (no card to write to).
    const statusCard = row.card
    if (statusCard) {
        const statusTitle = row.statusLabel
            ? `Status: ${row.statusLabel} — click to change`
            : 'Set status'
        const dotBtn = el.createEl('button', {
            cls: 'kap-wbs-status-btn',
            attr: {
                'type': 'button',
                'title': statusTitle,
                'aria-label': statusTitle,
                'aria-haspopup': 'menu'
            }
        })
        const dot = dotBtn.createSpan({ cls: 'kap-wbs-status-dot' })
        if (row.statusColor) dot.style.backgroundColor = row.statusColor
        dotBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            callbacks.onStatusDot(statusCard, e)
        })
    } else {
        el.createSpan({ cls: 'kap-wbs-status-btn' }).createSpan({ cls: 'kap-wbs-status-dot' })
    }

    el.createSpan({ cls: 'kap-wbs-title', text: row.title })
    if (row.card === null) {
        el.createSpan({
            cls: 'kap-wbs-context-badge',
            text: 'outside view',
            attr: { title: 'Not in this view’s results — shown so the hierarchy stays visible' }
        })
    }
    if (row.duplicate) {
        el.createSpan({
            cls: 'kap-wbs-dup',
            text: '⧉',
            attr: { title: 'Also shown under another parent' }
        })
    }
    if (row.hasChildren && row.collapsed) {
        el.createSpan({ cls: 'kap-wbs-childcount', text: String(row.childCount) })
    }

    const meta = el.createDiv({ cls: 'kap-wbs-meta' })
    renderProgress(meta, row, callbacks)
    renderDatesChip(meta, row, callbacks)
    renderDueChip(meta, row, callbacks)
    renderEstimateChip(meta, row, callbacks, minutesPerDay)

    const open = (newTab: boolean): void => {
        if (row.card) callbacks.onOpen(row.card, newTab)
        else callbacks.onOpenPath(row.key, newTab)
    }
    el.addEventListener('click', (e) => {
        if (
            (e.target as HTMLElement).closest(
                '.kap-wbs-chip-btn, .kap-wbs-toggle, .kap-wbs-status-btn'
            )
        )
            return
        open(e.ctrlKey || e.metaKey)
    })
    el.addEventListener('keydown', (e) => {
        // Keys pressed on a nested chip/toggle button belong to that button
        // (its native activation opens the modal / toggles) — the row must
        // not also open the note (same guard as the click handler).
        if (
            (e.target as HTMLElement).closest(
                '.kap-wbs-chip-btn, .kap-wbs-toggle, .kap-wbs-status-btn'
            )
        )
            return
        if (e.key === 'Enter') {
            e.preventDefault()
            open(e.ctrlKey || e.metaKey)
        }
        if (e.key === 'ArrowRight' && row.hasChildren && row.collapsed) {
            e.preventDefault()
            callbacks.onToggleNode(row.key)
        }
        if (e.key === 'ArrowLeft' && row.hasChildren && !row.collapsed) {
            e.preventDefault()
            callbacks.onToggleNode(row.key)
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            // ARIA tree pattern: vertical arrows move focus between rows.
            const sibling =
                e.key === 'ArrowDown' ? el.nextElementSibling : el.previousElementSibling
            if (sibling instanceof HTMLElement && sibling.hasClass('kap-wbs-row')) {
                e.preventDefault()
                sibling.focus()
            }
        }
    })
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        if (row.card) callbacks.onContextMenu(row.card, e)
    })
    return el
}

/** The per-node progress bar: own values solid, derived (rolled-up) hatched. */
function renderProgress(parent: HTMLElement, row: WbsRowModel, callbacks: WbsCallbacks): void {
    const value = row.progress
    const label =
        value === null
            ? 'No progress'
            : `${String(value)}%${row.progressDerived ? ' (from children)' : ''}`
    const card = row.card
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-progressbtn',
        attr: {
            'type': 'button',
            'title': card
                ? `${label} — click to set`
                : `${label} — read-only (note outside this view’s filters)`,
            'aria-label': `Progress: ${label}`
        }
    })
    const track = btn.createDiv({ cls: 'kap-wbs-progress' })
    if (row.progressDerived) track.addClass('kap-wbs-progress-derived')
    track.createDiv({ cls: 'kap-wbs-progress-fill' }).style.width = `${String(value ?? 0)}%`
    btn.createSpan({
        cls: 'kap-wbs-progress-caption',
        text: value === null ? '–' : `${String(value)}%`
    })
    if (card) btn.addEventListener('click', () => callbacks.onEditProgress(card))
    else btn.disabled = true
}

/**
 * Dates chip: the node's own span, or — bottom-up — the span its subtree
 * covers (derived styling) when the node has no start of its own.
 */
function renderDatesChip(parent: HTMLElement, row: WbsRowModel, callbacks: WbsCallbacks): void {
    const text =
        row.startLabel === null
            ? 'No start date'
            : row.endLabel === null
              ? row.startLabel
              : `${row.startLabel} → ${row.endLabel}`
    const card = row.card
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-dates',
        text,
        attr: {
            type: 'button',
            title: !card
                ? 'Span covered by children — read-only (note outside this view’s filters)'
                : row.datesDerived
                  ? 'Span covered by children — click to set a start date'
                  : 'Set start date'
        }
    })
    if (row.startLabel === null) btn.addClass('kap-wbs-chip-unset')
    if (row.datesDerived) btn.addClass('kap-wbs-chip-derived')
    if (card) btn.addEventListener('click', () => callbacks.onEditStart(card))
    else btn.disabled = true
}

/** Due chip: the countdown (`in 3d` / `2d overdue`), tone-colored (issue #62 scale). */
function renderDueChip(parent: HTMLElement, row: WbsRowModel, callbacks: WbsCallbacks): void {
    const card = row.card
    if (!card) {
        // Context rows track no due date, but the SLOT must stay: every row
        // renders the same four fixed-width chips or the columns drift.
        const placeholder = parent.createEl('button', {
            cls: 'kap-wbs-chip-btn kap-wbs-due kap-wbs-chip-unset',
            text: '–',
            attr: {
                type: 'button',
                title: 'Read-only (note outside this view’s filters)'
            }
        })
        placeholder.disabled = true
        return
    }
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-due',
        text: row.dueLabel ?? 'No due date',
        attr: {
            type: 'button',
            title: row.dueDateKey ? `Due ${row.dueDateKey} — click to change` : 'Set due date'
        }
    })
    if (row.dueTone) btn.addClass(`kap-wbs-due-${row.dueTone}`)
    else btn.addClass('kap-wbs-chip-unset')
    btn.addEventListener('click', () => callbacks.onEditDue(card))
}

/**
 * Estimate chip: the node's own days (plus the children's rollup as a
 * coverage signal when it differs); a node with no own estimate shows the
 * derived rollup (bottom-up), or an unset placeholder when the subtree has
 * nothing.
 */
function renderEstimateChip(
    parent: HTMLElement,
    row: WbsRowModel,
    callbacks: WbsCallbacks,
    minutesPerDay: number
): void {
    const card = row.card
    const title = !card
        ? 'Children rollup — read-only (note outside this view’s filters)'
        : row.rollupSuffix !== null
          ? `Set estimate — children rollup ${row.rollupSuffix.slice(2)} differs`
          : row.estimateDerived
            ? 'Derived from children — click to persist or adjust'
            : 'Set estimate'
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-estimate',
        attr: { type: 'button', title }
    })
    // Fixed slots — [Σ signal][days][hours][minutes] — so every unit sits at
    // the same x across rows (scannability): "2d 6h" and "1h 30m" align by
    // unit, not by string start. The grid lives on an inner div: Obsidian's
    // UNLAYERED `button { display: inline-flex }` would beat any layered
    // display on the button itself.
    const grid = btn.createDiv({ cls: 'kap-wbs-est-grid' })
    const lead = grid.createSpan({ cls: 'kap-wbs-est-lead' })
    if (row.rollupSuffix !== null) {
        lead.setText(row.rollupSuffix)
        lead.addClass('kap-wbs-estimate-total')
    } else if (row.estimateDerived) {
        lead.setText('Σ')
        lead.addClass('kap-wbs-estimate-total')
    }
    if (row.estimateParts) {
        if (row.estimateDerived) btn.addClass('kap-wbs-chip-derived')
        grid.createSpan({ cls: 'kap-wbs-est-seg', text: row.estimateParts.d ?? '' })
        grid.createSpan({ cls: 'kap-wbs-est-seg', text: row.estimateParts.h ?? '' })
        grid.createSpan({ cls: 'kap-wbs-est-seg', text: row.estimateParts.m ?? '' })
    } else {
        btn.addClass('kap-wbs-chip-unset')
        grid.createSpan({ cls: 'kap-wbs-est-empty', text: '–' })
    }
    if (card) {
        btn.addEventListener('click', () =>
            startEstimateEdit(btn, row, card, callbacks, minutesPerDay)
        )
    } else btn.disabled = true
}

/**
 * The one open inline editor's cancel hook — opening another editor closes
 * the previous one first (normally blur does this, but a failed focus — an
 * unfocused window, a modal stealing focus — must not leave two inputs).
 */
let cancelOpenEstimateEdit: (() => void) | null = null

/**
 * Inline estimate editing (issue #106): clicking the chip swaps it for a
 * slot-sized text input pre-filled with the chip's value (own, else the
 * derived rollup), accepting the same grammar as the estimate modal (a bare
 * number in the card's unit, or "2h" / "90m" / "0.5d"). Enter commits —
 * empty clears when an own value exists; Escape cancels; blur commits a
 * valid CHANGE and cancels anything else (never clears — a stray click
 * away must not delete an estimate). The chip button is kept aside and
 * restored on cancel; a commit's frontmatter echo rebuilds the row anyway.
 */
function startEstimateEdit(
    btn: HTMLElement,
    row: WbsRowModel,
    card: KanbanCard,
    callbacks: WbsCallbacks,
    minutesPerDay: number
): void {
    const hasOwn = row.estimateParts !== null && !row.estimateDerived
    const initial = row.estimatePrefill !== null ? String(row.estimatePrefill) : ''
    // A div carrying the chip classes: keeps the slot width AND the row's
    // click/keydown/drag guards (they match `.kap-wbs-chip-btn`) — an input
    // nested inside the <button> would be invalid HTML.
    const wrap = createDiv({ cls: 'kap-wbs-chip-btn kap-wbs-estimate kap-wbs-est-editwrap' })
    const unitLabel = row.estimateUnit === 'minutes' ? 'minutes' : 'days'
    const input = wrap.createEl('input', {
        type: 'text',
        cls: 'kap-wbs-est-input',
        value: initial,
        attr: {
            'aria-label': `Estimate (${unitLabel}, or a duration like 2h)`,
            'placeholder': `${unitLabel} — 2h, 0.5d`,
            'autocomplete': 'off',
            'inputmode': 'text',
            'title': 'Enter saves (empty clears), Esc cancels'
        }
    })
    cancelOpenEstimateEdit?.()
    btn.replaceWith(wrap)
    input.focus()
    input.select()
    let done = false
    const finish = (): void => {
        if (done) return
        done = true
        if (cancelOpenEstimateEdit === finish) cancelOpenEstimateEdit = null
        wrap.replaceWith(btn)
    }
    cancelOpenEstimateEdit = finish
    const parse = (): number | null =>
        parseEstimateInput(input.value, row.estimateUnit, minutesPerDay)
    input.addEventListener('input', () => {
        input.toggleClass(
            'kap-wbs-est-input-invalid',
            input.value.trim() !== '' && parse() === null
        )
    })
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            const raw = input.value.trim()
            if (raw === '') {
                finish()
                btn.focus()
                // Nothing to clear on a derived/unset chip — just cancel.
                if (hasOwn) callbacks.onCommitEstimate(card, null)
                return
            }
            const value = parse()
            if (value === null) {
                input.addClass('kap-wbs-est-input-invalid')
                return
            }
            finish()
            btn.focus()
            callbacks.onCommitEstimate(card, value)
        }
        if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            finish()
            btn.focus()
        }
    })
    input.addEventListener('blur', () => {
        if (done) return
        const raw = input.value.trim()
        if (raw !== '' && raw !== initial) {
            const value = parse()
            if (value !== null) {
                finish()
                callbacks.onCommitEstimate(card, value)
                return
            }
        }
        finish()
    })
}
