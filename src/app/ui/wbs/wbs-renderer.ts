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
 * **Incremental refresh:** the shell (panel + tree bar + tree) is built once
 * and kept. The panel re-renders only when its content signature changes;
 * tree rows are reconciled with the board's pure `planReconcile` over a
 * per-instance key (`parentKey::path` — duplicated multi-parent instances
 * stay distinct) plus a content signature — unchanged rows keep their exact
 * DOM node, so scroll, focus, and an in-flight drag survive every refresh,
 * and the echo rebuild after an optimistic write no-ops.
 */

import { setIcon } from 'obsidian'
import { renderGroupHeader } from '../calendar/calendar-renderer'
import { planReconcile } from '../board/reconcile'
import { cssEscapeAttr } from '../../utils/css-escape'
import type { KanbanCard, CountdownTone } from '../board/types'

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
    ownEstimate: number | null
    /**
     * The children's rollup (Σ of direct children's effective estimates);
     * the node's displayed value when it has no own estimate, the coverage
     * signal next to it when it does. Null when the subtree has nothing.
     */
    rollupEstimate: number | null
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
}

export interface WbsCallbacks {
    onOpen: (card: KanbanCard, newTab: boolean) => void
    /** Open a context row's note (no card exists for it in the result set). */
    onOpenPath: (path: string, newTab: boolean) => void
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
    onToggleNode: (key: string) => void
    onTogglePanel: () => void
    onTogglePaneGroup: (key: string) => void
    onEditEstimate: (card: KanbanCard) => void
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

/** The persistent skeleton: panel placeholder + tree bar + scrolling tree. */
function buildShell(shell: HTMLElement, callbacks: WbsCallbacks): void {
    // The panel is (re)built by reconcilePanel; reserve its slot first.
    shell.createDiv({ cls: 'kap-scheduling-panel kap-wbs-panel' })
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

/** Everything the panel renders, for the skip-unchanged signature. */
function panelSignature(model: WbsViewModel): string {
    return JSON.stringify({
        collapsed: model.panelCollapsed,
        grouped: model.paneGrouped,
        groups: model.paneGroups.map((g) => ({
            k: g.key,
            l: g.label,
            n: g.count,
            c: g.collapsed,
            s: g.groups.map((s) => ({
                k: s.key,
                l: s.label,
                c: s.collapsed,
                i: s.cards.map((card) => `${card.key}|${card.display.title}`)
            }))
        }))
    })
}

/** Rebuild the panel only when its signature changed (in-place replace). */
function reconcilePanel(shell: HTMLElement, model: WbsViewModel, callbacks: WbsCallbacks): void {
    const existing = shell.querySelector<HTMLElement>(':scope > .kap-wbs-panel')
    const signature = panelSignature(model)
    if (existing && existing.dataset['wbsPanelSig'] === signature) return
    const panel = buildPanel(model, callbacks)
    panel.dataset['wbsPanelSig'] = signature
    if (existing) existing.replaceWith(panel)
    else shell.insertBefore(panel, shell.firstChild)
}

function buildPanel(model: WbsViewModel, callbacks: WbsCallbacks): HTMLElement {
    const total = model.paneGroups.reduce((sum, g) => sum + g.count, 0)
    const panel = createDiv({ cls: 'kap-scheduling-panel kap-wbs-panel' })
    if (model.panelCollapsed) panel.addClass('kap-scheduling-panel-collapsed')

    const header = panel.createDiv({ cls: 'kap-panel-header' })
    const toggle = header.createEl('button', {
        cls: 'kap-panel-toggle',
        text: model.panelCollapsed ? '»' : '«',
        attr: { 'aria-label': model.panelCollapsed ? 'Expand panel' : 'Collapse panel' }
    })
    toggle.addEventListener('click', () => callbacks.onTogglePanel())
    // Cards missing a start date or an estimate — the WBS backlog to plan.
    header.createSpan({ cls: 'kap-panel-title', text: `Needs planning (${String(total)})` })
    // Revealed while a tree row drags (CSS on .kap-wbs-drop-ready); dropping
    // detaches the row from its parent. The collapsed rail has no room.
    panel.createDiv({ cls: 'kap-wbs-drop-hint', text: 'Drop here to detach from parent' })
    if (model.panelCollapsed) return panel

    const body = panel.createDiv({ cls: 'kap-wbs-panel-body' })
    if (total === 0) {
        body.createDiv({
            cls: 'kap-panel-empty',
            text: 'Everything has a start date and estimate.'
        })
        return panel
    }
    for (const group of model.paneGroups) {
        let host = body
        if (model.paneGrouped) {
            renderGroupHeader(
                body,
                'kap-cal-ugroup',
                group.label,
                group.count,
                group.collapsed,
                () => callbacks.onTogglePaneGroup(group.key)
            )
            if (group.collapsed) continue
            host = body.createDiv({ cls: 'kap-cal-ugroup-body' })
        }
        for (const sub of group.groups) {
            renderGroupHeader(
                host,
                'kap-cal-usubgroup',
                sub.label,
                sub.cards.length,
                sub.collapsed,
                () => callbacks.onTogglePaneGroup(sub.key)
            )
            if (sub.collapsed) continue
            const list = host.createDiv({ cls: 'kap-wbs-pane-cards' })
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
                cardEl.addEventListener('click', (e) =>
                    callbacks.onOpen(card, e.ctrlKey || e.metaKey)
                )
                cardEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault()
                    callbacks.onContextMenu(card, e)
                })
            }
        }
    }
    return panel
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
        oe: row.ownEstimate,
        re: row.rollupEstimate,
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
            if (row) node = buildRowNode(row, callbacks)
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
function buildRowNode(row: WbsRowModel, callbacks: WbsCallbacks): HTMLElement {
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

    const dot = el.createSpan({ cls: 'kap-wbs-status-dot' })
    if (row.statusColor) dot.style.backgroundColor = row.statusColor
    if (row.statusLabel) dot.setAttribute('title', row.statusLabel)

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
    renderEstimateChip(meta, row, callbacks)

    const open = (newTab: boolean): void => {
        if (row.card) callbacks.onOpen(row.card, newTab)
        else callbacks.onOpenPath(row.key, newTab)
    }
    el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.kap-wbs-chip-btn, .kap-wbs-toggle')) return
        open(e.ctrlKey || e.metaKey)
    })
    el.addEventListener('keydown', (e) => {
        // Keys pressed on a nested chip/toggle button belong to that button
        // (its native activation opens the modal / toggles) — the row must
        // not also open the note (same guard as the click handler).
        if ((e.target as HTMLElement).closest('.kap-wbs-chip-btn, .kap-wbs-toggle')) return
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
            'title': card ? `${label} — click to set` : label,
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
            ? 'no start'
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
                ? 'Span covered by children'
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
    if (!card) return // context rows carry no due date
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-due',
        text: row.dueLabel ?? 'no due',
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
function renderEstimateChip(parent: HTMLElement, row: WbsRowModel, callbacks: WbsCallbacks): void {
    const card = row.card
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-estimate',
        attr: { type: 'button', title: card ? 'Set estimate (days)' : 'Children rollup (days)' }
    })
    if (row.ownEstimate !== null) {
        btn.createSpan({ text: `${String(row.ownEstimate)}d` })
        if (row.rollupEstimate !== null && row.rollupEstimate !== row.ownEstimate) {
            btn.createSpan({
                cls: 'kap-wbs-estimate-total',
                text: `Σ ${String(row.rollupEstimate)}d`,
                attr: { title: 'Children rollup — differs from the own estimate' }
            })
        }
    } else if (row.rollupEstimate !== null) {
        btn.addClass('kap-wbs-chip-derived')
        btn.createSpan({
            cls: 'kap-wbs-estimate-total',
            text: `Σ ${String(row.rollupEstimate)}d`,
            attr: { title: 'Derived from children — click to persist or adjust' }
        })
    } else {
        btn.addClass('kap-wbs-chip-unset')
        btn.createSpan({ text: '–d' })
    }
    if (card) btn.addEventListener('click', () => callbacks.onEditEstimate(card))
    else btn.disabled = true
}
