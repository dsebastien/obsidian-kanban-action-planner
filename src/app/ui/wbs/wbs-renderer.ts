/**
 * WBS view renderer (issue #76) — DOM only, intent reported via callbacks.
 *
 * Layout mirrors the calendar/timeline modes: a collapsible left
 * `kap-scheduling-panel` (cards missing a start date or an estimate, grouped
 * note type → status) beside the tree. Each visible node is one flat
 * `.kap-wbs-row` (the controller applies collapse before building the row
 * list), indented by depth, carrying `data-card-key` + `data-parent-key` for
 * the DnD hit-testing contract.
 */

import { renderGroupHeader } from '../calendar/calendar-renderer'
import { cssEscapeAttr } from '../../utils/css-escape'
import type { KanbanCard } from '../board/types'

/** One visible tree row (collapse already applied by the controller). */
export interface WbsRowModel {
    card: KanbanCard
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
    onContextMenu: (card: KanbanCard, event: MouseEvent) => void
    onToggleNode: (key: string) => void
    onTogglePanel: () => void
    onTogglePaneGroup: (key: string) => void
    onEditEstimate: (card: KanbanCard) => void
    onEditStart: (card: KanbanCard) => void
    onEditProgress: (card: KanbanCard) => void
}

/**
 * Render the WBS view into the board host (replaces its content). The tree
 * is torn down and rebuilt, so its scroll position and the focused row are
 * captured first and restored after — a collapse deep in a long tree (or the
 * optimistic post-drop refresh) must not jump the viewport or drop keyboard
 * focus (visual-stability priority; the board's refocusCardKey analogue).
 */
export function renderWbs(root: HTMLElement, model: WbsViewModel, callbacks: WbsCallbacks): void {
    const prevTree = root.querySelector<HTMLElement>('.kap-wbs-tree')
    const prevScroll = prevTree?.scrollTop ?? 0
    const active = root.ownerDocument.activeElement
    const focusedKey =
        active instanceof HTMLElement
            ? (active.closest<HTMLElement>('.kap-wbs-row')?.dataset['cardKey'] ?? null)
            : null

    root.empty()
    const wbs = root.createDiv({ cls: 'kap-wbs' })
    renderPanel(wbs, model, callbacks)
    const tree = renderTree(wbs, model, callbacks)

    tree.scrollTop = prevScroll
    if (focusedKey) {
        wbs.querySelector<HTMLElement>(
            `.kap-wbs-row[data-card-key="${cssEscapeAttr(focusedKey)}"]`
        )?.focus()
    }
}

function renderPanel(parent: HTMLElement, model: WbsViewModel, callbacks: WbsCallbacks): void {
    const total = model.paneGroups.reduce((sum, g) => sum + g.count, 0)
    const panel = parent.createDiv({ cls: 'kap-scheduling-panel kap-wbs-panel' })
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
    if (model.panelCollapsed) return

    const body = panel.createDiv({ cls: 'kap-wbs-panel-body' })
    if (total === 0) {
        body.createDiv({
            cls: 'kap-panel-empty',
            text: 'Everything has a start date and estimate.'
        })
        return
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
}

function renderTree(
    parent: HTMLElement,
    model: WbsViewModel,
    callbacks: WbsCallbacks
): HTMLElement {
    const tree = parent.createDiv({ cls: 'kap-wbs-tree', attr: { role: 'tree' } })
    if (model.rootCount === 0) {
        const empty = tree.createDiv({ cls: 'kap-wbs-empty' })
        empty.createDiv({
            cls: 'kap-wbs-empty-title',
            text: 'No hierarchy to break down.'
        })
        empty.createDiv({
            cls: 'kap-wbs-empty-hint',
            text: 'Link notes with parent/child relationships (or drag a card from the panel onto a node once one exists). Notes excluded by this view’s own Base filters stay hidden.'
        })
        return tree
    }
    for (const row of model.rows) renderRow(tree, row, callbacks)
    return tree
}

function renderRow(tree: HTMLElement, row: WbsRowModel, callbacks: WbsCallbacks): void {
    const el = tree.createDiv({
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
    if (row.blocked) el.addClass('kap-wbs-row-blocked')
    if (row.depth === 0) el.addClass('kap-wbs-row-root')
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

    el.createSpan({ cls: 'kap-wbs-title', text: row.card.display.title })
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
    renderEstimateChip(meta, row, callbacks)

    el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.kap-wbs-chip-btn, .kap-wbs-toggle')) return
        callbacks.onOpen(row.card, e.ctrlKey || e.metaKey)
    })
    el.addEventListener('keydown', (e) => {
        // Keys pressed on a nested chip/toggle button belong to that button
        // (its native activation opens the modal / toggles) — the row must
        // not also open the note (same guard as the click handler).
        if ((e.target as HTMLElement).closest('.kap-wbs-chip-btn, .kap-wbs-toggle')) return
        if (e.key === 'Enter') {
            e.preventDefault()
            callbacks.onOpen(row.card, e.ctrlKey || e.metaKey)
        }
        if (e.key === 'ArrowRight' && row.hasChildren && row.collapsed) {
            e.preventDefault()
            callbacks.onToggleNode(row.key)
        }
        if (e.key === 'ArrowLeft' && row.hasChildren && !row.collapsed) {
            e.preventDefault()
            callbacks.onToggleNode(row.key)
        }
    })
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onContextMenu(row.card, e)
    })
}

/** The per-node progress bar: own values solid, derived (rolled-up) hatched. */
function renderProgress(parent: HTMLElement, row: WbsRowModel, callbacks: WbsCallbacks): void {
    const value = row.progress
    const label =
        value === null
            ? 'No progress'
            : `${String(value)}%${row.progressDerived ? ' (from children)' : ''}`
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-progressbtn',
        attr: {
            'type': 'button',
            'title': `${label} — click to set`,
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
    btn.addEventListener('click', () => callbacks.onEditProgress(row.card))
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
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-dates',
        text,
        attr: {
            type: 'button',
            title: row.datesDerived
                ? 'Span covered by children — click to set a start date'
                : 'Set start date'
        }
    })
    if (row.startLabel === null) btn.addClass('kap-wbs-chip-unset')
    if (row.datesDerived) btn.addClass('kap-wbs-chip-derived')
    btn.addEventListener('click', () => callbacks.onEditStart(row.card))
}

/**
 * Estimate chip: the node's own days (plus the children's rollup as a
 * coverage signal when it differs); a node with no own estimate shows the
 * derived rollup (bottom-up), or an unset placeholder when the subtree has
 * nothing.
 */
function renderEstimateChip(parent: HTMLElement, row: WbsRowModel, callbacks: WbsCallbacks): void {
    const btn = parent.createEl('button', {
        cls: 'kap-wbs-chip-btn kap-wbs-estimate',
        attr: { type: 'button', title: 'Set estimate (days)' }
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
    btn.addEventListener('click', () => callbacks.onEditEstimate(row.card))
}
