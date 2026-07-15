import { Notice } from 'obsidian'
import type { App, Menu } from 'obsidian'
import { parseFrontmatterDate, startOfDay, toDateKey } from '../../domain/calendar'
import { formatCountdown } from '../../services/card-display.service'
import { derivedEnd, groupByTypeAndStatus } from '../../domain/timeline'
import {
    daysToUnit,
    durationParts,
    formatDuration,
    formatUnitValue,
    readEstimate
} from '../../domain/estimate'
import type { EstimateConfig, ResolvedEstimate } from '../../domain/estimate'
import {
    buildWbsForest,
    buildWbsNode,
    childrenEstimate,
    collectContextAncestors,
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
    labelForPath,
    removeRelationshipLink
} from '../../services/relationships.service'
import { renderWbs } from '../../ui/wbs/wbs-renderer'
import type { WbsPaneTypeGroupModel, WbsRowModel, WbsViewModel } from '../../ui/wbs/wbs-renderer'
import type { WbsDropTarget } from '../../ui/wbs/wbs-dnd'
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
    /** Open a note by vault path — context rows have no card to open with. */
    openPath(path: string, newTab: boolean): void
    showCardMenu(card: KanbanCard, event: MouseEvent, extend?: (menu: Menu) => void): void
    /** Status-only quick menu on the row's status dot (issue #98). */
    showStatusMenu(card: KanbanCard, event: MouseEvent): void
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
    /** Per-card estimate property + unit (per-note-type override). */
    estimateConfigFor(card: KanbanCard): EstimateConfig
    /** Minutes one work day represents (minute-estimate → days conversion). */
    minutesPerDay(): number
    progressProperty(): string
    scheduledProperty(): string
    /** Resolved due-date property (the rows' due chip reads and writes it). */
    deadlineProperty(): string
    /** The global "due soon" threshold (days) for the countdown tone ramp. */
    dueSoonDays(): number
    /**
     * The parent/children link-properties for an arbitrary vault path,
     * resolved from the note's OWN recognized type (per-type resolution:
     * a task stores its parent in `related_projects` while a project uses
     * `related_goals` on the same board; context-ancestor climbing needs the
     * same lookup for off-board notes). '' = role disabled.
     */
    parentPropertyForPath(path: string): string
    childPropertyForPath(path: string): string
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
    /** Every branch path from the last render — the collapse-all target set. */
    private lastBranchPaths = new Set<string>()
    /**
     * Extra parent→children edges from the last render's context-ancestor
     * discovery — the cycle check must see them (a drop onto a context row
     * whose chain climbs back through the source would loop).
     */
    private contextChildEdges = new Map<string, string[]>()
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
        // Out-of-set ancestors (approved rule-36 exception): graft the trees
        // under parents the Base's filters exclude, so e.g. a single-type
        // base keeps its cross-type hierarchy visible. Further ancestors are
        // climbed via each out-of-set note's OWN type's parent property.
        const context = collectContextAncestors(
            [...byKey.keys()],
            (path) => rels.get(path)?.parent ?? [],
            (path) => {
                const prop = this.host.parentPropertyForPath(path)
                if (prop === '') return []
                const file = this.host.app.vault.getFileByPath(path)
                return file ? directLinkTargets(this.host.app, file, prop).map((t) => t.path) : []
            },
            (path) => this.host.app.vault.getFileByPath(path) !== null
        )
        this.contextChildEdges = context.childEdges
        const childrenOf = (path: string): ReadonlyArray<string> => {
            const extra = context.childEdges.get(path)
            const own = rels.get(path)?.child ?? []
            return extra ? [...own, ...extra] : own
        }
        const parentsOf = (path: string): ReadonlyArray<string> => {
            const extra = context.parentEdges.get(path)
            const own = rels.get(path)?.parent ?? []
            return extra ? [...own, ...extra] : own
        }
        const compareCards = this.host.comparator()

        // Per-render frontmatter caches: one read per path, not per instance.
        const minutesPerDay = this.host.minutesPerDay()
        const estimateCache = new Map<string, ResolvedEstimate | null>()
        const resolvedEstimateOf = (path: string): ResolvedEstimate | null => {
            let value = estimateCache.get(path)
            if (value === undefined) {
                const card = byKey.get(path)
                value = card ? this.resolvedEstimateFor(card) : null
                estimateCache.set(path, value)
            }
            return value
        }
        // Rollup math runs in DAYS; minute estimates convert via minutesPerDay.
        const estimateOf = (path: string): number | null => resolvedEstimateOf(path)?.days ?? null
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
        // A path's OWN end: start + own span − 1 (the timeline convention;
        // a minute estimate covers ceil(days) whole days).
        const endOf = (path: string): Date | null => {
            const start = startOf(path)
            const estimate = resolvedEstimateOf(path)
            return start && estimate ? derivedEnd(start, estimate.spanDays) : null
        }

        // Sibling order (owner rule): planned (start) dates win — dated
        // siblings sort chronologically ahead of undated ones; the rest (and
        // date ties) follow the view's card sort, title as the last resort.
        const compare = (a: string, b: string): number => {
            const startA = startOf(a)
            const startB = startOf(b)
            if (startA && startB && startA.getTime() !== startB.getTime()) {
                return startA.getTime() - startB.getTime()
            }
            if (startA && !startB) return -1
            if (!startA && startB) return 1
            const cardA = byKey.get(a)
            const cardB = byKey.get(b)
            if (!cardA || !cardB) return labelForPath(a).localeCompare(labelForPath(b))
            return compareCards(cardA, cardB)
        }
        const forest = buildWbsForest(
            [...byKey.keys(), ...context.paths],
            childrenOf,
            parentsOf,
            compare
        )

        const today = startOfDay(new Date())
        const rows: WbsRowModel[] = []
        const seenPaths = new Set<string>()
        // Every branch (dedup by path) — the collapse-all target set.
        const branchPaths = new Set<string>()
        const pushRows = (node: WbsNode): void => {
            // No card → a context ancestor (outside the view's results):
            // rendered from derived values only, never skipped.
            const card = byKey.get(node.path) ?? null
            const own = resolvedEstimateOf(node.path)
            const rollup = childrenEstimate(node, estimateOf)
            // The chip's primary value: the own estimate, else the derived
            // rollup — segmented into fixed unit slots (d/h/m alignment).
            const primaryDays = own?.days ?? rollup
            const rollupDiffers =
                own !== null && rollup !== null && Math.abs(rollup - own.days) > 0.05
            const progress = effectiveProgress(node, progressOf, weightOf)
            const start = startOf(node.path)
            // Bottom-up date derivation (owner rule): a parent without its
            // own start shows the span its descendants cover, styled as
            // derived — top-down and bottom-up planning both work.
            let startLabel = start ? toDateKey(start) : null
            let endLabel = start && own ? toDateKey(derivedEnd(start, own.spanDays)) : null
            let datesDerived = false
            if (!start && node.children.length > 0) {
                const span = subtreeSpan(node, startOf, endOf)
                if (span.start) {
                    startLabel = toDateKey(span.start)
                    endLabel = span.end && span.end > span.start ? toDateKey(span.end) : null
                    datesDerived = true
                }
            }
            const due = card ? this.readDate(card, this.host.deadlineProperty()) : null
            const countdown = formatCountdown(due, today, this.host.dueSoonDays(), 'chip')
            const collapsed = this.collapsedNodes.has(node.path)
            rows.push({
                card,
                title: card?.display.title ?? labelForPath(node.path),
                key: node.path,
                parentKey: node.parentPath ?? '',
                depth: node.depth,
                hasChildren: node.children.length > 0,
                collapsed,
                childCount: node.children.length,
                statusLabel: card ? this.host.statusLabelFor(card) : null,
                statusColor: card ? this.host.statusColorFor(card) : null,
                blocked: card !== null && card.relationships.blocked_by.length > 0,
                duplicate: seenPaths.has(node.path),
                estimateParts:
                    primaryDays !== null ? durationParts(primaryDays, minutesPerDay) : null,
                estimateDerived: own === null && rollup !== null,
                rollupSuffix: rollupDiffers ? `Σ ${formatDuration(rollup, minutesPerDay)}` : null,
                startLabel,
                endLabel,
                datesDerived,
                progress: progress.value,
                progressDerived: progress.derived,
                dueLabel: countdown?.text ?? null,
                dueTone: countdown?.tone ?? null,
                dueDateKey: due ? toDateKey(due) : null
            })
            seenPaths.add(node.path)
            if (!collapsed) for (const child of node.children) pushRows(child)
        }
        // Collapse-all needs every branch, including ones hidden inside
        // already-collapsed subtrees — walk the full forest separately.
        const collectBranches = (n: WbsNode): void => {
            if (n.children.length > 0) branchPaths.add(n.path)
            for (const child of n.children) collectBranches(child)
        }
        for (const tree of forest) {
            pushRows(tree)
            collectBranches(tree)
        }
        this.lastBranchPaths = branchPaths

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
                onOpenPath: (path, newTab) => this.host.openPath(path, newTab),
                onContextMenu: (card, event) =>
                    this.host.showCardMenu(card, event, (menu) => this.extendCardMenu(menu, card)),
                onStatusDot: (card, event) => this.host.showStatusMenu(card, event),
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
                onEditDue: (card) => this.promptDueDate(card),
                onEditProgress: (card) => this.promptProgress(card),
                onExpandAll: () => {
                    this.collapsedNodes.clear()
                    this.host.persistCollapsedNodes([])
                    this.host.refresh()
                },
                onCollapseAll: () => {
                    this.collapsedNodes = new Set(this.lastBranchPaths)
                    this.host.persistCollapsedNodes([...this.collapsedNodes])
                    this.host.refresh()
                }
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
     * status, all groups collapsed by default, sorted inside each group by
     * the view's card sort (like the calendar's panel).
     */
    private buildPaneGroups(cards: KanbanCard[]): WbsPaneTypeGroupModel[] {
        const compare = this.host.comparator()
        const needsPlanning = cards
            .filter((card) => {
                const start = this.readDate(card, this.host.startProperty())
                const estimate = this.resolvedEstimateFor(card)
                return start === null || estimate === null
            })
            .sort(compare)
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
                    cards: statusGroup.items,
                    typeId: typeGroup.typeId,
                    status: statusGroup.status
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

    // ── Drag re-parenting / detaching (issues #76 + #14 write path) ───────

    /**
     * Whether dropping `sourceKey` on `target` is committable. Row targets:
     * never onto itself, an existing parent (incl. the context parent), or a
     * node inside its own subtree (a cycle), and only when a writable link
     * property exists for the parent or child role. Panel target: detach —
     * only for a row dragged from under a parent whose edge is physically
     * stored (a heuristic edge has no property to remove).
     */
    canDrop(sourceKey: string, sourceParentKey: string | null, target: WbsDropTarget): boolean {
        if (target.kind === 'panel') {
            if (sourceParentKey === null) return false
            const storage = this.edgeStorage(sourceKey, sourceParentKey)
            return storage.childOwned || storage.parentOwned
        }
        // Pane-group drops (set status) are validated and committed by the
        // host view, never by this controller.
        if (target.kind === 'paneGroup') return false
        if (sourceKey === target.targetKey) return false
        // The fresh edge lands on the source's parent property or the
        // target's children property — each per its OWN note type.
        if (
            this.host.parentPropertyForPath(sourceKey) === '' &&
            this.host.childPropertyForPath(target.targetKey) === ''
        ) {
            return false
        }
        const rels = this.host.relationshipSets()
        if ((rels.get(sourceKey)?.parent ?? []).includes(target.targetKey)) return false
        return !this.isDescendant(sourceKey, target.targetKey)
    }

    /** Hover-to-expand during a drag: open the collapsed branch in place. */
    hoverExpand(key: string): void {
        if (!this.collapsedNodes.has(key)) return
        this.collapsedNodes.delete(key)
        this.host.persistCollapsedNodes([...this.collapsedNodes])
        this.host.refresh()
    }

    /**
     * Where the `sourceKey` → `oldParentKey` edge is physically stored: as a
     * parent link on the child, a children link on the old parent, both
     * (redundant convention), or neither (heuristic — not removable).
     */
    private edgeStorage(
        sourceKey: string,
        oldParentKey: string
    ): { childOwned: boolean; parentOwned: boolean } {
        const parentProp = this.host.parentPropertyForPath(sourceKey)
        const childProp = this.host.childPropertyForPath(oldParentKey)
        const source = this.host.allCardForKey(sourceKey)
        const oldParent = this.host.allCardForKey(oldParentKey)
        const childOwned =
            parentProp !== '' &&
            source !== undefined &&
            directLinkTargets(this.host.app, source.file, parentProp).some(
                (t) => t.path === oldParentKey
            )
        const parentOwned =
            childProp !== '' &&
            oldParent !== undefined &&
            directLinkTargets(this.host.app, oldParent.file, childProp).some(
                (t) => t.path === sourceKey
            )
        return { childOwned, parentOwned }
    }

    /**
     * Whether `candidate` sits anywhere inside `root`'s subtree (cycle-safe).
     * Walks the resolved child edges PLUS the context edges — a context
     * ancestor reached through the source must not become its parent.
     */
    private isDescendant(root: string, candidate: string): boolean {
        const rels = this.host.relationshipSets()
        const childrenOf = (path: string): string[] => [
            ...(rels.get(path)?.child ?? []),
            ...(this.contextChildEdges.get(path) ?? [])
        ]
        const seen = new Set<string>()
        const queue = childrenOf(root)
        while (queue.length > 0) {
            const path = queue.shift()
            if (path === undefined || seen.has(path)) continue
            if (path === candidate) return true
            seen.add(path)
            queue.push(...childrenOf(path))
        }
        return false
    }

    /**
     * Commit a drop. Panel target → detach `sourceKey` from its context
     * parent. Row target → re-parent `sourceKey` from its context parent to
     * the row. The stored link may live on either side (#14 semantics —
     * only DIRECT links are rewritable): a child-owned `parent` link moves on
     * the child; a parent-owned `children` link moves across the two parents;
     * a redundant both-sides edge is removed from both; a heuristic edge
     * can't be removed — the new parent link is added and a Notice explains.
     * Optimistic (#64): the in-memory relationship sets and card badges
     * mutate first, the frontmatter writes follow.
     */
    handleDrop(sourceKey: string, sourceParentKey: string | null, dropTarget: WbsDropTarget): void {
        if (!this.canDrop(sourceKey, sourceParentKey, dropTarget)) return
        if (dropTarget.kind === 'panel') {
            if (sourceParentKey !== null) this.unparent(sourceKey, sourceParentKey)
            return
        }
        if (dropTarget.kind === 'paneGroup') return // host-owned (canDrop is false anyway)
        const targetKey = dropTarget.targetKey
        const source = this.host.cardForKey(sourceKey)
        if (!source) return
        // A context row has no card — resolve its file straight from the
        // vault (the edge is stored on the SOURCE, so this stays writable).
        const target = this.host.cardForKey(targetKey) ?? null
        const targetFile = target ? target.file : this.host.app.vault.getFileByPath(targetKey)
        if (!targetFile) return
        const targetLabel = target?.display.title ?? labelForPath(targetKey)
        const oldParent = sourceParentKey ? this.host.cardForKey(sourceParentKey) : undefined
        // Every write targets the OWNING note's role property: the source's
        // parent property, the old parent's children property, the new
        // target's children property — each per its own type.
        const parentProp = this.host.parentPropertyForPath(sourceKey)
        const oldChildProp = sourceParentKey ? this.host.childPropertyForPath(sourceParentKey) : ''
        const targetChildProp = this.host.childPropertyForPath(targetKey)

        // Where is the old edge physically stored? A redundantly stored edge
        // (parent link on the child AND a children link on the old parent)
        // must be removed from BOTH sides, or the surviving side's inverse
        // resurrects it on the echo rebuild.
        const { childOwned, parentOwned } = sourceParentKey
            ? this.edgeStorage(sourceKey, sourceParentKey)
            : { childOwned: false, parentOwned: false }
        const heuristicEdge = sourceParentKey !== null && !childOwned && !parentOwned

        // Optimistic: mutate the resolved sets + badges, re-render, then write.
        this.applyOptimisticReparent(
            source,
            targetKey,
            target,
            heuristicEdge ? null : sourceParentKey
        )
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
            if (parentOwned && oldParent && oldChildProp !== '') {
                await removeRelationshipLink(this.host.app, oldParent.file, oldChildProp, sourceKey)
            }
            // Recreate the edge where it was stored (both sides when it was
            // redundant, preserving the vault's convention); a fresh edge
            // (pane drop / heuristic) prefers the child's parent property.
            let wrote = false
            if (parentOwned && targetChildProp !== '') {
                await addRelationshipLink(this.host.app, targetFile, targetChildProp, source.file)
                wrote = true
            }
            if ((childOwned || !parentOwned) && parentProp !== '') {
                await addRelationshipLink(this.host.app, source.file, parentProp, targetFile)
                wrote = true
            }
            if (!wrote && targetChildProp !== '') {
                await addRelationshipLink(this.host.app, targetFile, targetChildProp, source.file)
                wrote = true
            }
            if (!wrote) return
            new Notice(
                heuristicEdge
                    ? `"${source.display.title}" moved under "${targetLabel}". The old parent came from a tag+link heuristic and still applies — adjust the note body to fully detach it.`
                    : `"${source.display.title}" moved under "${targetLabel}".`
            )
        })()
    }

    /**
     * Panel drop: detach `sourceKey` from `oldParentKey` — remove the stored
     * edge from every side it lives on (nothing is added; the note may join
     * the "Needs planning" backlog or root its own tree). Optimistic (#64).
     */
    private unparent(sourceKey: string, oldParentKey: string): void {
        const source = this.host.cardForKey(sourceKey)
        const oldParent = this.host.cardForKey(oldParentKey)
        if (!source) return
        const { childOwned, parentOwned } = this.edgeStorage(sourceKey, oldParentKey)
        if (!childOwned && !parentOwned) return // heuristic — canDrop blocks this

        // Optimistic: drop the edge from the live sets + badges, re-render.
        const rels = this.host.relationshipSets()
        const sourceSet = rels.get(sourceKey)
        if (sourceSet) sourceSet.parent = sourceSet.parent.filter((p) => p !== oldParentKey)
        const oldParentSet = rels.get(oldParentKey)
        if (oldParentSet) oldParentSet.child = oldParentSet.child.filter((c) => c !== sourceKey)
        source.relationships.parent = source.relationships.parent.filter(
            (r) => r.key !== oldParentKey
        )
        if (oldParent) {
            oldParent.relationships.child = oldParent.relationships.child.filter(
                (r) => r.key !== sourceKey
            )
        }
        this.host.refresh()

        void (async () => {
            if (childOwned) {
                await removeRelationshipLink(
                    this.host.app,
                    source.file,
                    this.host.parentPropertyForPath(sourceKey),
                    oldParentKey
                )
            }
            if (parentOwned && oldParent) {
                await removeRelationshipLink(
                    this.host.app,
                    oldParent.file,
                    this.host.childPropertyForPath(oldParentKey),
                    sourceKey
                )
            }
            new Notice(
                `"${source.display.title}" detached from "${oldParent?.display.title ?? labelForPath(oldParentKey)}".`
            )
        })()
    }

    /**
     * Mutate the live relationship sets + card badge lists so the tree
     * re-renders in its post-move shape before the writes land. `oldParentKey`
     * null = nothing to detach (pane card, root, or a heuristic edge that
     * stays). `target` is null for a context row — the re-render's context
     * discovery picks the new edge up from the source's parent list.
     */
    private applyOptimisticReparent(
        source: KanbanCard,
        targetKey: string,
        target: KanbanCard | null,
        oldParentKey: string | null
    ): void {
        const rels = this.host.relationshipSets()
        const sourceSet = rels.get(source.key)
        if (sourceSet) {
            sourceSet.parent = sourceSet.parent.filter((p) => p !== oldParentKey)
            if (!sourceSet.parent.includes(targetKey)) sourceSet.parent.push(targetKey)
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
        const targetSet = rels.get(targetKey)
        if (targetSet && !targetSet.child.includes(source.key)) targetSet.child.push(source.key)

        source.relationships.parent = source.relationships.parent.filter(
            (r) => r.key !== oldParentKey
        )
        if (!source.relationships.parent.some((r) => r.key === targetKey)) {
            source.relationships.parent.push({
                key: targetKey,
                label: target?.display.title ?? labelForPath(targetKey)
            })
        }
        if (target && !target.relationships.child.some((r) => r.key === source.key)) {
            target.relationships.child.push({ key: source.key, label: source.display.title })
        }
    }

    // ── Editing (estimate / start / progress / distribute) ────

    /**
     * WBS extras appended to the standard card menu. Every item sits in the
     * `kap-wbs` section so the sectioned menu groups them at the end.
     */
    private extendCardMenu(menu: Menu, card: KanbanCard): void {
        if (this.host.parentPropertyForPath(card.key) !== '') {
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
        const config = this.host.estimateConfigFor(card)
        const own = this.resolvedEstimateFor(card)
        const node = this.nodeFor(card.key)
        // Save-the-rollup affordances (owner rule: rollups are displayed by
        // default, but easily persisted to the parent — bottom-up made
        // durable). Estimate: the children's rollup, when it differs from
        // the own value. Progress: the derived combination, when derived.
        const estimateRollup = childrenEstimate(node, this.estimateOfPath)
        if (
            estimateRollup !== null &&
            (own === null || Math.abs(estimateRollup - own.days) > 0.05)
        ) {
            // Persist in the card's own unit (a minutes card saves minutes).
            const rollupValue = daysToUnit(estimateRollup, config.unit, this.host.minutesPerDay())
            menu.addItem((item) =>
                item
                    .setTitle(
                        `Save rolled-up estimate (${formatUnitValue(rollupValue, config.unit, this.host.minutesPerDay())})`
                    )
                    .setIcon('sigma')
                    .setSection('kap-wbs')
                    .onClick(() => {
                        void setProperty(this.host.app, card.file, config.property, rollupValue)
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
            const ownDays = own.days
            menu.addItem((item) =>
                item
                    .setTitle('Distribute estimate to children')
                    .setIcon('divide')
                    .setSection('kap-wbs')
                    .onClick(() => void this.distributeToChildren(card, ownDays))
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

    /** A path's own estimate in DAYS, read from frontmatter (menu-time, uncached). */
    private readonly estimateOfPath = (path: string): number | null => {
        const card = this.host.allCardForKey(path)
        return card ? (this.resolvedEstimateFor(card)?.days ?? null) : null
    }

    /** A card's parsed estimate (per-type property + unit; null when unset). */
    private resolvedEstimateFor(card: KanbanCard): ResolvedEstimate | null {
        const config = this.host.estimateConfigFor(card)
        return readEstimate(
            getFrontmatterValue(this.host.app, card.file, config.property),
            config.unit,
            this.host.minutesPerDay()
        )
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
            const childConfig = this.host.estimateConfigFor(child)
            await setProperty(
                this.host.app,
                child.file,
                childConfig.property,
                daysToUnit(days, childConfig.unit, this.host.minutesPerDay())
            )
        }
        new Notice(
            `Distributed ${formatDuration(own, this.host.minutesPerDay())} across ${String(shares.size)} child note(s).`
        )
    }

    /**
     * "Set estimate…": days ≥ 1, written as a NUMBER; Clear deletes. A node
     * without an own value pre-fills the derived rollup, so persisting the
     * bottom-up total is a two-click affair (open, Set).
     */
    private promptEstimate(card: KanbanCard): void {
        const config = this.host.estimateConfigFor(card)
        const current = this.resolvedEstimateFor(card)
        const rollup = childrenEstimate(this.nodeFor(card.key), this.estimateOfPath)
        // Pre-fill the own value, else the derived rollup — in the card's unit.
        const prefill =
            current?.raw ??
            (rollup !== null ? daysToUnit(rollup, config.unit, this.host.minutesPerDay()) : null)
        new EstimatePromptModal(
            this.host.app,
            `Set estimate — ${card.display.title}`,
            prefill,
            (value) => {
                void (value === null
                    ? deleteProperty(this.host.app, card.file, config.property)
                    : setProperty(this.host.app, card.file, config.property, value))
            },
            config.unit,
            this.host.minutesPerDay()
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
            (isoDate) => void this.writeDate(card, property, isoDate)
        ).open()
    }

    /** Due chip click: the same date prompt on the due-date property. */
    private promptDueDate(card: KanbanCard): void {
        const property = this.host.deadlineProperty()
        const current = this.readDate(card, property)
        new DatePromptModal(
            this.host.app,
            `Set due date — ${card.display.title}`,
            current ? toDateKey(current) : '',
            (isoDate) => void this.writeDate(card, property, isoDate)
        ).open()
    }

    private async writeDate(
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
