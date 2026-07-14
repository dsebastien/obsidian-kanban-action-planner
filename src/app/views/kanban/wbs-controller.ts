import { Notice } from 'obsidian'
import type { App, Menu } from 'obsidian'
import { parseFrontmatterDate, toDateKey } from '../../domain/calendar'
import { derivedEnd, groupByTypeAndStatus, parseEstimate } from '../../domain/timeline'
import {
    buildWbsForest,
    buildWbsNode,
    childrenEstimate,
    distributeEstimate,
    effectiveEstimate,
    effectiveProgress,
    parseProgress,
    subtreeSpan
} from '../../domain/wbs'
import type { WbsNode } from '../../domain/wbs'
import type { RelationshipSet } from '../../domain/relationships'
import {
    deleteProperty,
    getFrontmatterValue,
    setProperty
} from '../../services/frontmatter.service'
import {
    addRelationshipLink,
    directLinkTargets,
    removeRelationshipLink
} from '../../services/relationships.service'
import { renderWbs } from '../../ui/wbs/wbs-renderer'
import type { WbsPaneTypeGroupModel, WbsRowModel, WbsViewModel } from '../../ui/wbs/wbs-renderer'
import { EstimatePromptModal } from '../../ui/timeline/estimate-modal'
import { ProgressPromptModal } from '../../ui/wbs/progress-modal'
import { DatePromptModal } from '../../ui/date-prompt-modal'
import { formatDate } from '../../utils/momentjs'
import type { KanbanCard } from '../../ui/board/types'

/** Durable WBS UI state persisted per-view (node collapse has its own key). */
export interface WbsViewState {
    /** Whether the left "Needs planning" panel is collapsed to its slim rail. */
    panelCollapsed: boolean
}

/**
 * What {@link WbsController} needs from the host view — closures only, so the
 * controller never reaches into view privates (same shape as
 * `TimelineController` / `CalendarController`).
 */
export interface WbsHost {
    readonly app: App
    boardEl(): HTMLElement | null
    /** Full re-derivation + re-render (config/persisted-state changes). */
    rebuild(): void
    /**
     * Re-render from the CURRENT in-memory state (optimistic updates, issue
     * #64): a re-parent mutates the resolved relationship sets in place and
     * must re-render from them — a full rebuild would re-derive from the
     * not-yet-written frontmatter and snap the node back.
     */
    refresh(): void
    /** Whether the view is currently in WBS mode (guards auto-collapse). */
    isWbsMode(): boolean
    openCard(card: KanbanCard, newTab: boolean): void
    showCardMenu(card: KanbanCard, event: MouseEvent, extend?: (menu: Menu) => void): void
    cardForKey(key: string): KanbanCard | undefined
    /**
     * Lookup over the UNFILTERED result set. Write paths (distribute,
     * save-rollup, modal prefills) must compute over the whole Base result
     * set — a transient toolbar filter must never skew a persisted number.
     */
    allCardForKey(key: string): KanbanCard | undefined
    /**
     * The view's LIVE resolved relationship map (path → sets). Read to build
     * the tree; mutated in place for the optimistic re-parent.
     */
    relationshipSets(): Map<string, RelationshipSet>
    /** Resolved property names (start = the scheduled date; the rest global). */
    startProperty(): string
    estimateProperty(): string
    progressProperty(): string
    scheduledProperty(): string
    /** Role link-properties for the active note type ('' = role disabled). */
    parentProperty(): string
    childProperty(): string
    dateFormat(): string
    noteTypeFor(card: KanbanCard): { id: string; name: string } | null
    /** Resolved status column color/label for the row's dot (null = neutral). */
    statusColorFor(card: KanbanCard): string | null
    statusLabelFor(card: KanbanCard): string | null
    /** Sibling/root order: the view's card sort comparator (title fallback). */
    comparator(): (a: KanbanCard, b: KanbanCard) => number
    restoreState(): WbsViewState
    persistState(state: WbsViewState): void
    /**
     * Collapsed node paths, persisted under their own config key
     * (`wbsCollapsedNodes`) so `persistState` call sites can never clobber
     * the list (the `timelineHiddenTypes` pattern).
     */
    restoreCollapsedNodes(): string[]
    persistCollapsedNodes(paths: string[]): void
    /** The #14 "add parent" picker — the non-drag re-parenting fallback. */
    addParentRelationship(card: KanbanCard): void
}

/**
 * WBS mode (issue #76): owns the in-memory WBS state (node collapse, pane
 * group collapse, panel collapse), builds the tree + rollup view model from
 * the resolved relationships, and commits estimate/start/progress edits and
 * drag re-parenting back to frontmatter. Rendering is delegated to
 * `ui/wbs/wbs-renderer.ts`; tree/rollup math is pure in `domain/wbs.ts`.
 */
export class WbsController {
    private panelCollapsed = false
    private panelAutoCollapsed = false
    private panelLastNarrow: boolean | null = null
    /** Collapsed node paths (persisted; a path collapses every instance). */
    private collapsedNodes = new Set<string>()
    /**
     * Pane group collapse, keyed `typeId` / `typeId::status` — default
     * collapsed (drag-backlog convention). Lives on the controller instance
     * so it survives the rebuild every frontmatter write triggers.
     */
    private readonly paneCollapsed = new Map<string, boolean>()
    // Durable state loads lazily: config is unavailable at construction.
    private loaded = false

    constructor(private readonly host: WbsHost) {}

    private ensureLoaded(): void {
        if (this.loaded) return
        this.loaded = true
        this.panelCollapsed = this.host.restoreState().panelCollapsed
        this.collapsedNodes = new Set(this.host.restoreCollapsedNodes())
    }

    /** Persist the durable bits — always the full state from instance fields. */
    private persist(): void {
        this.host.persistState({ panelCollapsed: this.panelCollapsed })
    }

    /** Reset the narrow-width memo so the next evaluation re-decides from scratch. */
    resetNarrow(): void {
        this.panelLastNarrow = null
    }

    /**
     * Collapse the panel automatically on narrow containers, restore it when
     * there's room — only on a width-category change, so a manual toggle is
     * never fought (mirrors the calendar/timeline panels).
     */
    evaluatePanelAutoCollapse(): void {
        const boardEl = this.host.boardEl()
        if (!boardEl || !this.host.isWbsMode()) {
            this.panelLastNarrow = null
            return
        }
        this.ensureLoaded()
        const width = boardEl.clientWidth
        if (width === 0) return
        const root = boardEl.ownerDocument.documentElement
        const remPx = parseFloat(getComputedStyle(root).fontSize) || 16
        const narrow = width < 36 * remPx
        if (narrow === this.panelLastNarrow) return
        this.panelLastNarrow = narrow
        if (narrow && !this.panelCollapsed) {
            this.panelCollapsed = true
            this.panelAutoCollapsed = true
            this.persist()
            this.host.refresh()
        } else if (!narrow && this.panelAutoCollapsed) {
            this.panelCollapsed = false
            this.panelAutoCollapsed = false
            this.persist()
            this.host.refresh()
        }
    }

    /** Build the view model from the (already filtered) cards and render it. */
    render(cards: KanbanCard[]): void {
        const boardEl = this.host.boardEl()
        if (!boardEl) return
        this.ensureLoaded()

        const byKey = new Map(cards.map((c) => [c.key, c]))
        const rels = this.host.relationshipSets()
        const childrenOf = (path: string): ReadonlyArray<string> => rels.get(path)?.child ?? []
        const parentsOf = (path: string): ReadonlyArray<string> => rels.get(path)?.parent ?? []
        const compareCards = this.host.comparator()
        const compare = (a: string, b: string): number => {
            const cardA = byKey.get(a)
            const cardB = byKey.get(b)
            if (!cardA || !cardB) return a.localeCompare(b)
            return compareCards(cardA, cardB)
        }
        const forest = buildWbsForest([...byKey.keys()], childrenOf, parentsOf, compare)

        // Per-render frontmatter caches: one read per path, not per instance.
        const estimateCache = new Map<string, number | null>()
        const estimateOf = (path: string): number | null => {
            let value = estimateCache.get(path)
            if (value === undefined) {
                const card = byKey.get(path)
                value = card
                    ? parseEstimate(
                          getFrontmatterValue(
                              this.host.app,
                              card.file,
                              this.host.estimateProperty()
                          )
                      )
                    : null
                estimateCache.set(path, value)
            }
            return value
        }
        const progressCache = new Map<string, number | null>()
        const progressOf = (path: string): number | null => {
            let value = progressCache.get(path)
            if (value === undefined) {
                const card = byKey.get(path)
                value = card
                    ? parseProgress(
                          getFrontmatterValue(
                              this.host.app,
                              card.file,
                              this.host.progressProperty()
                          )
                      )
                    : null
                progressCache.set(path, value)
            }
            return value
        }
        const weightOf = (node: WbsNode): number | null => effectiveEstimate(node, estimateOf).value
        const startCache = new Map<string, Date | null>()
        const startOf = (path: string): Date | null => {
            let value = startCache.get(path)
            if (value === undefined) {
                const card = byKey.get(path)
                value = card ? this.readDate(card, this.host.startProperty()) : null
                startCache.set(path, value)
            }
            return value
        }
        // A path's OWN end: start + own estimate − 1 (the timeline convention).
        const endOf = (path: string): Date | null => {
            const start = startOf(path)
            const estimate = estimateOf(path)
            return start && estimate !== null ? derivedEnd(start, estimate) : null
        }

        const rows: WbsRowModel[] = []
        const seenPaths = new Set<string>()
        const pushRows = (node: WbsNode): void => {
            const card = byKey.get(node.path)
            if (!card) return
            const own = estimateOf(node.path)
            const rollup = childrenEstimate(node, estimateOf)
            const progress = effectiveProgress(node, progressOf, weightOf)
            const start = startOf(node.path)
            // Bottom-up date derivation (owner rule): a parent without its
            // own start shows the span its descendants cover, styled as
            // derived — top-down and bottom-up planning both work.
            let startLabel = start ? toDateKey(start) : null
            let endLabel = start && own !== null ? toDateKey(derivedEnd(start, own)) : null
            let datesDerived = false
            if (!start && node.children.length > 0) {
                const span = subtreeSpan(node, startOf, endOf)
                if (span.start) {
                    startLabel = toDateKey(span.start)
                    endLabel = span.end && span.end > span.start ? toDateKey(span.end) : null
                    datesDerived = true
                }
            }
            const collapsed = this.collapsedNodes.has(node.path)
            rows.push({
                card,
                key: node.path,
                parentKey: node.parentPath ?? '',
                depth: node.depth,
                hasChildren: node.children.length > 0,
                collapsed,
                childCount: node.children.length,
                statusLabel: this.host.statusLabelFor(card),
                statusColor: this.host.statusColorFor(card),
                blocked: card.relationships.blocked_by.length > 0,
                duplicate: seenPaths.has(node.path),
                ownEstimate: own,
                rollupEstimate: rollup,
                startLabel,
                endLabel,
                datesDerived,
                progress: progress.value,
                progressDerived: progress.derived
            })
            seenPaths.add(node.path)
            if (!collapsed) for (const child of node.children) pushRows(child)
        }
        for (const tree of forest) pushRows(tree)

        renderWbs(
            boardEl,
            {
                rows,
                rootCount: forest.length,
                paneGroups: this.buildPaneGroups(cards),
                paneGrouped: this.distinctTypeCount(cards) > 1,
                panelCollapsed: this.panelCollapsed
            } satisfies WbsViewModel,
            {
                onOpen: (card, newTab) => this.host.openCard(card, newTab),
                onContextMenu: (card, event) =>
                    this.host.showCardMenu(card, event, (menu) => this.extendCardMenu(menu, card)),
                onToggleNode: (key) => this.toggleNode(key),
                onTogglePanel: () => {
                    this.panelCollapsed = !this.panelCollapsed
                    // A manual toggle wins over any earlier auto-collapse.
                    this.panelAutoCollapsed = false
                    this.persist()
                    this.host.refresh()
                },
                onTogglePaneGroup: (key) => {
                    this.paneCollapsed.set(key, !(this.paneCollapsed.get(key) ?? true))
                    this.host.refresh()
                },
                onEditEstimate: (card) => this.promptEstimate(card),
                onEditStart: (card) => this.promptStartDate(card),
                onEditProgress: (card) => this.promptProgress(card)
            }
        )
    }

    private distinctTypeCount(cards: KanbanCard[]): number {
        const ids = new Set<string>()
        for (const card of cards) {
            const type = this.host.noteTypeFor(card)
            if (type) ids.add(type.id)
        }
        // Untyped cards form their own "No type" bucket alongside typed ones.
        return ids.size + (cards.some((c) => !this.host.noteTypeFor(c)) ? 1 : 0)
    }

    /**
     * The "Needs planning" backlog: cards missing a start date OR an estimate
     * (owner rule — the pane is the estimation worklist), grouped note type →
     * status, all groups collapsed by default.
     */
    private buildPaneGroups(cards: KanbanCard[]): WbsPaneTypeGroupModel[] {
        const needsPlanning = cards.filter((card) => {
            const start = this.readDate(card, this.host.startProperty())
            const estimate = parseEstimate(
                getFrontmatterValue(this.host.app, card.file, this.host.estimateProperty())
            )
            return start === null || estimate === null
        })
        return groupByTypeAndStatus(
            needsPlanning,
            (card) => this.host.noteTypeFor(card),
            (card) => card.statusValue
        ).map((typeGroup) => ({
            key: typeGroup.typeId,
            label: typeGroup.typeName,
            count: typeGroup.groups.reduce((sum, g) => sum + g.items.length, 0),
            collapsed: this.paneCollapsed.get(typeGroup.typeId) ?? true,
            groups: typeGroup.groups.map((statusGroup) => {
                const key = `${typeGroup.typeId}::${statusGroup.status}`
                return {
                    key,
                    label: statusGroup.label,
                    collapsed: this.paneCollapsed.get(key) ?? true,
                    cards: statusGroup.items
                }
            })
        }))
    }

    private toggleNode(key: string): void {
        if (this.collapsedNodes.has(key)) this.collapsedNodes.delete(key)
        else this.collapsedNodes.add(key)
        this.host.persistCollapsedNodes([...this.collapsedNodes])
        this.host.refresh()
    }

    // ── Drag re-parenting (issues #76 + #14 write path) ───────

    /**
     * Whether re-parenting `sourceKey` under `targetKey` is committable:
     * never onto itself, an existing parent (incl. the context parent), or a
     * node inside its own subtree (a cycle), and only when a writable link
     * property exists for the parent or child role.
     */
    canDrop(sourceKey: string, _sourceParentKey: string | null, targetKey: string): boolean {
        if (sourceKey === targetKey) return false
        if (this.host.parentProperty() === '' && this.host.childProperty() === '') return false
        const rels = this.host.relationshipSets()
        if ((rels.get(sourceKey)?.parent ?? []).includes(targetKey)) return false
        return !this.isDescendant(sourceKey, targetKey)
    }

    /** Whether `candidate` sits anywhere inside `root`'s subtree (cycle-safe). */
    private isDescendant(root: string, candidate: string): boolean {
        const rels = this.host.relationshipSets()
        const seen = new Set<string>()
        const queue = [...(rels.get(root)?.child ?? [])]
        while (queue.length > 0) {
            const path = queue.shift()
            if (path === undefined || seen.has(path)) continue
            if (path === candidate) return true
            seen.add(path)
            queue.push(...(rels.get(path)?.child ?? []))
        }
        return false
    }

    /**
     * Commit a drop: re-parent `sourceKey` from its context parent to
     * `targetKey`. The stored link may live on either side (#14 semantics —
     * only DIRECT links are rewritable): a child-owned `parent` link moves on
     * the child; a parent-owned `children` link moves across the two parents;
     * a heuristic edge can't be removed — the new parent link is added and a
     * Notice explains. Optimistic (#64): the in-memory relationship sets and
     * card badges mutate first, the frontmatter writes follow.
     */
    handleDrop(sourceKey: string, sourceParentKey: string | null, targetKey: string): void {
        if (!this.canDrop(sourceKey, sourceParentKey, targetKey)) return
        const source = this.host.cardForKey(sourceKey)
        const target = this.host.cardForKey(targetKey)
        if (!source || !target) return
        const oldParent = sourceParentKey ? this.host.cardForKey(sourceParentKey) : undefined
        const parentProp = this.host.parentProperty()
        const childProp = this.host.childProperty()

        // Where is the old edge physically stored? Both checks run
        // independently — a redundantly stored edge (parent link on the
        // child AND a children link on the old parent) must be removed from
        // BOTH sides, or the surviving side's inverse resurrects it on the
        // echo rebuild.
        const childOwned =
            parentProp !== '' &&
            sourceParentKey !== null &&
            directLinkTargets(this.host.app, source.file, parentProp).some(
                (t) => t.path === sourceParentKey
            )
        const parentOwned =
            childProp !== '' &&
            oldParent !== undefined &&
            directLinkTargets(this.host.app, oldParent.file, childProp).some(
                (t) => t.path === sourceKey
            )
        const heuristicEdge = sourceParentKey !== null && !childOwned && !parentOwned

        // Optimistic: mutate the resolved sets + badges, re-render, then write.
        this.applyOptimisticReparent(source, target, heuristicEdge ? null : sourceParentKey)
        this.host.refresh()

        void (async () => {
            if (childOwned && sourceParentKey) {
                await removeRelationshipLink(
                    this.host.app,
                    source.file,
                    parentProp,
                    sourceParentKey
                )
            }
            if (parentOwned && oldParent) {
                await removeRelationshipLink(this.host.app, oldParent.file, childProp, sourceKey)
            }
            // Recreate the edge where it was stored (both sides when it was
            // redundant, preserving the vault's convention); a fresh edge
            // (pane drop / heuristic) prefers the child's parent property.
            let wrote = false
            if (parentOwned && childProp !== '') {
                await addRelationshipLink(this.host.app, target.file, childProp, source.file)
                wrote = true
            }
            if ((childOwned || !parentOwned) && parentProp !== '') {
                await addRelationshipLink(this.host.app, source.file, parentProp, target.file)
                wrote = true
            }
            if (!wrote && childProp !== '') {
                await addRelationshipLink(this.host.app, target.file, childProp, source.file)
                wrote = true
            }
            if (!wrote) return
            new Notice(
                heuristicEdge
                    ? `"${source.display.title}" moved under "${target.display.title}". The old parent came from a tag+link heuristic and still applies — adjust the note body to fully detach it.`
                    : `"${source.display.title}" moved under "${target.display.title}".`
            )
        })()
    }

    /**
     * Mutate the live relationship sets + card badge lists so the tree
     * re-renders in its post-move shape before the writes land. `oldParentKey`
     * null = nothing to detach (pane card, root, or a heuristic edge that
     * stays).
     */
    private applyOptimisticReparent(
        source: KanbanCard,
        target: KanbanCard,
        oldParentKey: string | null
    ): void {
        const rels = this.host.relationshipSets()
        const sourceSet = rels.get(source.key)
        if (sourceSet) {
            sourceSet.parent = sourceSet.parent.filter((p) => p !== oldParentKey)
            if (!sourceSet.parent.includes(target.key)) sourceSet.parent.push(target.key)
        }
        if (oldParentKey) {
            const oldParentSet = rels.get(oldParentKey)
            if (oldParentSet) {
                oldParentSet.child = oldParentSet.child.filter((c) => c !== source.key)
            }
            const oldParentCard = this.host.cardForKey(oldParentKey)
            if (oldParentCard) {
                oldParentCard.relationships.child = oldParentCard.relationships.child.filter(
                    (r) => r.key !== source.key
                )
            }
        }
        const targetSet = rels.get(target.key)
        if (targetSet && !targetSet.child.includes(source.key)) targetSet.child.push(source.key)

        source.relationships.parent = source.relationships.parent.filter(
            (r) => r.key !== oldParentKey
        )
        if (!source.relationships.parent.some((r) => r.key === target.key)) {
            source.relationships.parent.push({ key: target.key, label: target.display.title })
        }
        if (!target.relationships.child.some((r) => r.key === source.key)) {
            target.relationships.child.push({ key: source.key, label: source.display.title })
        }
    }

    // ── Editing (estimate / start / progress / distribute) ────

    /**
     * WBS extras appended to the standard card menu. Every item sits in the
     * `kap-wbs` section so the sectioned menu groups them at the end.
     */
    private extendCardMenu(menu: Menu, card: KanbanCard): void {
        if (this.host.parentProperty() !== '') {
            menu.addItem((item) =>
                item
                    .setTitle('Set parent…')
                    .setIcon('git-branch')
                    .setSection('kap-wbs')
                    .onClick(() => this.host.addParentRelationship(card))
            )
        }
        menu.addItem((item) =>
            item
                .setTitle('Set estimate…')
                .setIcon('ruler')
                .setSection('kap-wbs')
                .onClick(() => this.promptEstimate(card))
        )
        // The standard "Schedule on a date…" item already writes exactly the
        // scheduled property — skip the duplicate (the timeline convention).
        if (this.host.startProperty() !== this.host.scheduledProperty()) {
            menu.addItem((item) =>
                item
                    .setTitle('Set start date…')
                    .setIcon('calendar')
                    .setSection('kap-wbs')
                    .onClick(() => this.promptStartDate(card))
            )
        }
        menu.addItem((item) =>
            item
                .setTitle('Set progress…')
                .setIcon('percent')
                .setSection('kap-wbs')
                .onClick(() => this.promptProgress(card))
        )
        const own = parseEstimate(
            getFrontmatterValue(this.host.app, card.file, this.host.estimateProperty())
        )
        const node = this.nodeFor(card.key)
        // Save-the-rollup affordances (owner rule: rollups are displayed by
        // default, but easily persisted to the parent — bottom-up made
        // durable). Estimate: the children's rollup, when it differs from
        // the own value. Progress: the derived combination, when derived.
        const estimateRollup = childrenEstimate(node, this.estimateOfPath)
        if (estimateRollup !== null && estimateRollup !== own) {
            menu.addItem((item) =>
                item
                    .setTitle(`Save rolled-up estimate (${String(estimateRollup)}d)`)
                    .setIcon('sigma')
                    .setSection('kap-wbs')
                    .onClick(() => {
                        void setProperty(
                            this.host.app,
                            card.file,
                            this.host.estimateProperty(),
                            estimateRollup
                        )
                    })
            )
        }
        const progress = effectiveProgress(
            node,
            this.progressOfPath,
            (n) => effectiveEstimate(n, this.estimateOfPath).value
        )
        if (progress.derived && progress.value !== null) {
            const value = progress.value
            menu.addItem((item) =>
                item
                    .setTitle(`Save rolled-up progress (${String(value)}%)`)
                    .setIcon('sigma')
                    .setSection('kap-wbs')
                    .onClick(() => {
                        void setProperty(
                            this.host.app,
                            card.file,
                            this.host.progressProperty(),
                            value
                        )
                    })
            )
        }
        if (own !== null && node.children.length > 0) {
            menu.addItem((item) =>
                item
                    .setTitle('Distribute estimate to children')
                    .setIcon('divide')
                    .setSection('kap-wbs')
                    .onClick(() => void this.distributeToChildren(card, own))
            )
        }
    }

    /**
     * The subtree node for a path over the UNFILTERED result set (menu-time
     * math). The toolbar filter narrows what renders, but persisted numbers
     * (save-rollup, distribution, prefills) must see every in-Base child —
     * otherwise a transient filter would silently corrupt frontmatter.
     */
    private nodeFor(path: string): WbsNode {
        const rels = this.host.relationshipSets()
        return buildWbsNode(path, (p) =>
            (rels.get(p)?.child ?? []).filter((c) => this.host.allCardForKey(c) !== undefined)
        )
    }

    /** A path's own estimate, read from frontmatter (menu-time, uncached). */
    private readonly estimateOfPath = (path: string): number | null => {
        const card = this.host.allCardForKey(path)
        return card
            ? parseEstimate(
                  getFrontmatterValue(this.host.app, card.file, this.host.estimateProperty())
              )
            : null
    }

    /** A path's own progress, read from frontmatter (menu-time, uncached). */
    private readonly progressOfPath = (path: string): number | null => {
        const card = this.host.allCardForKey(path)
        return card
            ? parseProgress(
                  getFrontmatterValue(this.host.app, card.file, this.host.progressProperty())
              )
            : null
    }

    /**
     * Top-down estimates (owner comment on #76): split what remains of the
     * card's own estimate equally across direct children whose subtree has
     * no estimate at all. Existing values are never touched.
     */
    private async distributeToChildren(card: KanbanCard, own: number): Promise<void> {
        // Each child's effective estimate (own, else its children's rollup)
        // decides whether it still needs a share and what's allocated.
        const childEntries = this.nodeFor(card.key).children.map((child) => ({
            path: child.path,
            total: effectiveEstimate(child, this.estimateOfPath).value
        }))
        const shares = distributeEstimate(own, childEntries)
        if (!shares) {
            new Notice('Nothing to distribute: every child is estimated, or no days remain.')
            return
        }
        for (const [path, days] of shares) {
            const child = this.host.allCardForKey(path)
            if (!child) continue
            await setProperty(this.host.app, child.file, this.host.estimateProperty(), days)
        }
        new Notice(`Distributed ${String(own)}d across ${String(shares.size)} child note(s).`)
    }

    /**
     * "Set estimate…": days ≥ 1, written as a NUMBER; Clear deletes. A node
     * without an own value pre-fills the derived rollup, so persisting the
     * bottom-up total is a two-click affair (open, Set).
     */
    private promptEstimate(card: KanbanCard): void {
        const property = this.host.estimateProperty()
        const current = parseEstimate(getFrontmatterValue(this.host.app, card.file, property))
        const prefill = current ?? childrenEstimate(this.nodeFor(card.key), this.estimateOfPath)
        new EstimatePromptModal(
            this.host.app,
            `Set estimate — ${card.display.title}`,
            prefill,
            (days) => {
                void (days === null
                    ? deleteProperty(this.host.app, card.file, property)
                    : setProperty(this.host.app, card.file, property, days))
            }
        ).open()
    }

    /**
     * "Set progress…": 0–100, written as a NUMBER; Clear deletes. Pre-fills
     * the derived rollup when the node has no own value (like the estimate).
     */
    private promptProgress(card: KanbanCard): void {
        const property = this.host.progressProperty()
        const current = parseProgress(getFrontmatterValue(this.host.app, card.file, property))
        const derived = effectiveProgress(
            this.nodeFor(card.key),
            this.progressOfPath,
            (n) => effectiveEstimate(n, this.estimateOfPath).value
        )
        new ProgressPromptModal(
            this.host.app,
            `Set progress — ${card.display.title}`,
            current ?? (derived.derived ? derived.value : null),
            (progress) => {
                void (progress === null
                    ? deleteProperty(this.host.app, card.file, property)
                    : setProperty(this.host.app, card.file, property, progress))
            }
        ).open()
    }

    /** "Set start date…": pre-filled ISO date prompt; Set writes, Clear deletes. */
    private promptStartDate(card: KanbanCard): void {
        const property = this.host.startProperty()
        const current = this.readDate(card, property)
        new DatePromptModal(
            this.host.app,
            `Set start date — ${card.display.title}`,
            current ? toDateKey(current) : '',
            (isoDate) => void this.writeStartDate(card, property, isoDate)
        ).open()
    }

    private async writeStartDate(
        card: KanbanCard,
        property: string,
        isoDate: string | null
    ): Promise<void> {
        if (isoDate === null) {
            await deleteProperty(this.host.app, card.file, property)
            return
        }
        const date = parseFrontmatterDate(isoDate)
        if (!date) return
        await setProperty(
            this.host.app,
            card.file,
            property,
            formatDate(date, this.host.dateFormat())
        )
    }

    private readDate(card: KanbanCard, property: string): Date | null {
        return parseFrontmatterDate(getFrontmatterValue(this.host.app, card.file, property))
    }
}
