/**
 * Pure render-state signature for WBS mode (issue #110, item 1).
 *
 * WBS was deliberately left out of the issue-#105 render gate because two of
 * its render inputs are not represented in the board pass signature: the tree
 * **expansion state** and the **off-view context ancestors** resolved at render
 * time (ancestors the Base's filters exclude, grafted in so a filtered board
 * keeps its hierarchy — rule 36 exception). This signature captures ALL of a
 * WBS pass's inputs so the gate can skip a pass whose output is provably
 * identical to the last completed one.
 *
 * Correctness rule: every input the WBS render reads MUST appear here, or a
 * change to it would be gated away as a no-op (stale UI — the exact risk that
 * kept WBS ungated). It captures INPUTS, never derived outputs: two renders
 * with identical inputs produce an identical forest, rollups, and rows by
 * construction, so the derived values (rollup totals, subtree date spans,
 * context-row aggregates) need not appear.
 *
 * Kept pure (no DOM, no Obsidian) so the composition is unit-testable; the
 * controller maps its live data into these plain shapes.
 *
 * Separators are control characters guaranteed absent from the inputs (paths
 * and file basenames carry no control chars; `frontmatter`/`tags` come from
 * `JSON.stringify`, which escapes any control char in the source rather than
 * emitting it raw). Parts are joined once with a separator instead of nested
 * `JSON.stringify` (issue #110, item 2) to keep the constant factor low.
 */

/** Field separator (within one card record). */
const FS = String.fromCharCode(0x1f)
/** Record separator (between card records / edge entries). */
const RS = String.fromCharCode(0x1e)
/** Group separator (between the sub-parts of context/view/config). */
const GS = String.fromCharCode(0x1d)
/** Section separator (between the four top-level parts). */
const SS = String.fromCharCode(0x00)

export interface WbsSignatureCard {
    key: string
    order: number | null
    statusValue: string | null
    typeId: string
    typeName: string
    /** Status dot label/color — folds in the column config for this card. */
    statusLabel: string | null
    statusColor: string | null
    blocked: boolean
    /** Done-state result (issue #56) — folds in the per-type done config. */
    done: boolean
    /** Estimate property + unit — folds in the per-type estimate config. */
    estimateProperty: string
    estimateUnit: string
    /** Pre-stringified raw frontmatter (start/due/estimate/progress live here). */
    frontmatter: string
    /** Pre-joined tag list. */
    tags: string
    /**
     * Resolved relationship target paths. An optimistic re-parent (issue #64)
     * mutates these in place BEFORE the frontmatter is written, so the raw
     * frontmatter alone would miss it — the resolved sets must be included.
     */
    parent: readonly string[]
    child: readonly string[]
    sibling: readonly string[]
}

/** One `[path, targets]` graft edge (out-of-view ancestor → its children/parents). */
export type WbsSignatureEdge = readonly [path: string, targets: readonly string[]]

export interface WbsSignatureContext {
    /** Out-of-view ancestor paths (sorted) — existence drives context rows. */
    paths: readonly string[]
    /** `[path, basename]` per context path (sorted) — catches a context rename. */
    titles: readonly (readonly [path: string, title: string])[]
    /** Grafted child edges (sorted by path). */
    childEdges: readonly WbsSignatureEdge[]
    /** Grafted parent edges (sorted by path). */
    parentEdges: readonly WbsSignatureEdge[]
}

export interface WbsSignatureView {
    /** Collapsed node paths (sorted). */
    collapsedNodes: readonly string[]
    panelCollapsed: boolean
    /** `[key, collapsed]` pane-group collapse entries (sorted by key). */
    paneCollapsed: readonly (readonly [key: string, collapsed: boolean])[]
}

export interface WbsSignatureConfig {
    minutesPerDay: number
    startProperty: string
    deadlineProperty: string
    progressProperty: string
    dueSoonDays: number
    /** Today (ISO day) — the due countdown tone depends on it. */
    todayKey: string
    /** Comparator identity (sort mode / direction / property). */
    comparator: string
}

/** Compose a WBS pass's inputs into one deterministic signature string. */
export function wbsRenderSignature(
    cards: readonly WbsSignatureCard[],
    context: WbsSignatureContext,
    view: WbsSignatureView,
    config: WbsSignatureConfig
): string {
    const cardsPart = cards
        .map((c) =>
            [
                c.key,
                c.order === null ? '' : String(c.order),
                c.statusValue ?? '',
                c.typeId,
                c.typeName,
                c.statusLabel ?? '',
                c.statusColor ?? '',
                c.blocked ? '1' : '',
                c.done ? '1' : '',
                c.estimateProperty,
                c.estimateUnit,
                c.frontmatter,
                c.tags,
                c.parent.join(','),
                c.child.join(','),
                c.sibling.join(',')
            ].join(FS)
        )
        .join(RS)
    const edges = (list: readonly WbsSignatureEdge[]): string =>
        list.map(([path, targets]) => `${path}${FS}${targets.join(',')}`).join(RS)
    const contextPart = [
        context.paths.join(','),
        context.titles.map(([path, title]) => `${path}${FS}${title}`).join(RS),
        edges(context.childEdges),
        edges(context.parentEdges)
    ].join(GS)
    const viewPart = [
        view.collapsedNodes.join(','),
        view.panelCollapsed ? '1' : '',
        view.paneCollapsed
            .map(([key, collapsed]) => `${key}${FS}${collapsed ? '1' : '0'}`)
            .join(',')
    ].join(GS)
    const configPart = [
        String(config.minutesPerDay),
        config.startProperty,
        config.deadlineProperty,
        config.progressProperty,
        String(config.dueSoonDays),
        config.todayKey,
        config.comparator
    ].join(GS)
    return [cardsPart, contextPart, viewPart, configPart].join(SS)
}
