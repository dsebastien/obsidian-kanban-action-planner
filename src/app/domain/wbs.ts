/**
 * Work-breakdown-structure math (issue #76) — pure, unit-tested.
 *
 * The WBS renders the resolved parent/child relationships as a forest:
 * trees are rooted at notes with no in-set parent — including loose notes
 * (no relationships at all), which render as childless depth-0 rows so a
 * flat board stays usable (approved exception to business rule 36). Notes
 * whose parents live OUTSIDE the result set can be grafted under those
 * ancestors via {@link collectContextAncestors} (same exception).
 * Multi-parent notes appear under EACH parent (duplicated instances).
 * Estimates and progress follow one model (owner rule): a note's OWN value
 * wins; a note without one derives its value from its children — so plans
 * work top-down, bottom-up, or mixed, and persisting a rollup to the parent
 * never double-counts. The resolved relationship edges may be cyclic
 * (`resolveRelationships` stores them as-is) — every walk here carries its
 * own guard.
 */

/** One rendered tree node. Duplicated instances (multi-parent) share `path`. */
export interface WbsNode {
    path: string
    /** The context parent's path — null for roots. */
    parentPath: string | null
    depth: number
    children: WbsNode[]
}

/**
 * Build the WBS forest over the (already filtered) result set.
 *
 * Roots are paths with no in-set parent — a parentless childless path roots
 * a single-row tree (loose notes stay visible and draggable on flat boards).
 * Children are expanded per branch with the branch's ancestry as the cycle
 * guard — a diamond (same node under two parents) still renders twice, but a
 * cycle stops where it would re-enter itself. Nodes locked inside a parent
 * cycle with no acyclic entry point are unreachable and simply don't render.
 */
export function buildWbsForest(
    paths: ReadonlyArray<string>,
    childrenOf: (path: string) => ReadonlyArray<string>,
    parentsOf: (path: string) => ReadonlyArray<string>,
    compare: (a: string, b: string) => number
): WbsNode[] {
    const inSet = new Set(paths)
    const setChildren = (path: string): string[] =>
        [...new Set(childrenOf(path))].filter((p) => inSet.has(p)).sort(compare)
    const roots = paths.filter((path) => !parentsOf(path).some((p) => inSet.has(p))).sort(compare)
    const expand = (path: string, parentPath: string | null, ancestry: Set<string>): WbsNode => {
        const nextAncestry = new Set(ancestry)
        nextAncestry.add(path)
        return {
            path,
            parentPath,
            depth: ancestry.size,
            children: setChildren(path)
                .filter((child) => !nextAncestry.has(child))
                .map((child) => expand(child, path, nextAncestry))
        }
    }
    return roots.map((root) => expand(root, null, new Set()))
}

/** Extra hierarchy edges discovered outside the result set (context rows). */
export interface ContextAncestors {
    /** Out-of-set ancestor paths, discovery order (BFS from the result set). */
    paths: string[]
    /** Extra parent→children edges (keyed by in-set OR context path). */
    childEdges: Map<string, string[]>
    /** Extra child→parents edges (context paths only). */
    parentEdges: Map<string, string[]>
}

/**
 * Discover the out-of-set ancestors referenced by the result set, so the WBS
 * can graft its trees under them (approved exception to business rule 36: a
 * base filtered to one note type keeps its cross-type hierarchy visible).
 *
 * Starts from every in-set path's resolved parents that are NOT in the set,
 * then climbs further via `climbParents` (metadata-cache resolution for
 * notes that have no resolved record), cycle-guarded. `exists` gates every
 * candidate — a dangling path (note deleted, unresolved link) is skipped and
 * its subtree roots itself, exactly as before. A climbed parent that turns
 * out to be IN the set is linked (extra child edge) but never climbed again.
 */
export function collectContextAncestors(
    inSetPaths: ReadonlyArray<string>,
    parentsOf: (path: string) => ReadonlyArray<string>,
    climbParents: (contextPath: string) => ReadonlyArray<string>,
    exists: (path: string) => boolean
): ContextAncestors {
    const inSet = new Set(inSetPaths)
    const paths: string[] = []
    const childEdges = new Map<string, string[]>()
    const parentEdges = new Map<string, string[]>()
    const addEdge = (map: Map<string, string[]>, key: string, value: string): void => {
        const list = map.get(key)
        if (!list) map.set(key, [value])
        else if (!list.includes(value)) list.push(value)
    }
    const discovered = new Set<string>()
    const queue: string[] = []
    const discover = (parent: string, child: string): void => {
        if (parent === child) return
        if (inSet.has(parent)) {
            // Climbed back into the set: link it, but the set's own resolved
            // relationships govern everything else about that note.
            addEdge(childEdges, parent, child)
            if (!inSet.has(child)) addEdge(parentEdges, child, parent)
            return
        }
        if (!exists(parent)) return
        addEdge(childEdges, parent, child)
        if (!inSet.has(child)) addEdge(parentEdges, child, parent)
        if (!discovered.has(parent)) {
            discovered.add(parent)
            paths.push(parent)
            queue.push(parent)
        }
    }
    for (const path of inSetPaths) {
        for (const parent of parentsOf(path)) {
            if (!inSet.has(parent)) discover(parent, path)
        }
    }
    while (queue.length > 0) {
        const path = queue.shift()
        if (path === undefined) continue
        for (const parent of climbParents(path)) discover(parent, path)
    }
    return { paths, childEdges, parentEdges }
}

/** All distinct descendant paths of a node (the node itself excluded). */
export function descendantPaths(node: WbsNode): Set<string> {
    const out = new Set<string>()
    const walk = (n: WbsNode): void => {
        for (const child of n.children) {
            if (!out.has(child.path)) {
                out.add(child.path)
                walk(child)
            }
        }
    }
    walk(node)
    return out
}

/**
 * Build one subtree node for `path` directly (no root detection) — the
 * single-node twin of {@link buildWbsForest}, for math on an arbitrary note
 * (menu rollups, distribution). Same per-branch cycle guard; child order is
 * the edge order.
 */
export function buildWbsNode(
    path: string,
    childrenOf: (path: string) => ReadonlyArray<string>
): WbsNode {
    const expand = (p: string, parentPath: string | null, ancestry: Set<string>): WbsNode => {
        const nextAncestry = new Set(ancestry)
        nextAncestry.add(p)
        return {
            path: p,
            parentPath,
            depth: ancestry.size,
            children: [...new Set(childrenOf(p))]
                .filter((child) => !nextAncestry.has(child))
                .map((child) => expand(child, p, nextAncestry))
        }
    }
    return expand(path, null, new Set())
}

/**
 * A node's effective estimate (issue #76, owner rule: estimates roll up like
 * progress — top-down, bottom-up, or mixed): the node's OWN value wins when
 * set; otherwise the value derives from the children
 * ({@link childrenEstimate}). `derived` marks a rolled-up value so it can be
 * styled distinctly and offered for persisting to the note. Because an own
 * value REPLACES its subtree's contribution (it never adds to it),
 * persisting a rollup to the parent can never double-count.
 */
export function effectiveEstimate(
    node: WbsNode,
    estimateOf: (path: string) => number | null
): { value: number | null; derived: boolean } {
    const own = estimateOf(node.path)
    if (own !== null) return { value: own, derived: false }
    const rollup = childrenEstimate(node, estimateOf)
    return rollup === null ? { value: null, derived: false } : { value: rollup, derived: true }
}

/**
 * The children's estimate rollup: the sum over the subtree's *contributing*
 * notes — descending from the node, a note with an own estimate contributes
 * it and prunes its subtree (own replaces, per the model); a note without
 * one is looked through. Contributors are **deduped by path**, so a shared
 * (multi-parent) subtree counts once even though it renders under each
 * parent. Null when no descendant carries any estimate. Shown next to an
 * own value as the coverage signal, and offered as the "save rolled-up
 * estimate" value.
 */
export function childrenEstimate(
    node: WbsNode,
    estimateOf: (path: string) => number | null
): number | null {
    const contributors = new Map<string, number>()
    const collect = (n: WbsNode): void => {
        for (const child of n.children) {
            const own = estimateOf(child.path)
            if (own !== null) contributors.set(child.path, own)
            else collect(child)
        }
    }
    collect(node)
    if (contributors.size === 0) return null
    let sum = 0
    for (const value of contributors.values()) sum += value
    return sum
}

/**
 * Parse a progress frontmatter value: a number (or numeric string) clamped
 * to 0–100, or null when unset/unusable. Progress is assumed to be 0–100.
 */
export function parseProgress(raw: unknown): number | null {
    let value: number
    if (typeof raw === 'number') value = raw
    else if (typeof raw === 'string' && raw.trim() !== '') value = Number(raw)
    else return null
    if (!Number.isFinite(value)) return null
    return Math.max(0, Math.min(100, value))
}

/**
 * A node's effective progress (issue #76, owner rule): the node's OWN value
 * wins when set and > 0. When the own value is missing, null, or 0, and at
 * least one descendant reports an EXPLICIT progress (an actual 0 counts —
 * children at "0%" roll a derived "0%" up, never a blank), the node derives
 * the weighted combination of its direct children's effective progress —
 * weighted by each child's effective estimate when EVERY child has one
 * (> 0), equally otherwise. `derived` marks a combined value so it can be
 * styled distinctly. A node with no signal anywhere keeps its own value
 * (possibly 0/null), underived.
 */
export function effectiveProgress(
    node: WbsNode,
    progressOf: (path: string) => number | null,
    estimateWeightOf: (node: WbsNode) => number | null
): { value: number | null; derived: boolean } {
    const own = progressOf(node.path)
    if (own !== null && own > 0) return { value: own, derived: false }
    if (node.children.length === 0) return { value: own, derived: false }
    const children = node.children.map((child) => ({
        progress: effectiveProgress(child, progressOf, estimateWeightOf).value,
        weight: estimateWeightOf(child)
    }))
    if (!children.some((c) => c.progress !== null)) {
        return { value: own, derived: false }
    }
    const weighted = children.every((c) => c.weight !== null && c.weight > 0)
    let sum = 0
    let weightSum = 0
    for (const child of children) {
        const weight = weighted ? (child.weight ?? 1) : 1
        sum += (child.progress ?? 0) * weight
        weightSum += weight
    }
    if (weightSum === 0) return { value: own, derived: false }
    return { value: Math.round(sum / weightSum), derived: true }
}

/** Memoized rollup math over one forest — see {@link createWbsRollups}. */
export interface WbsRollups {
    effectiveEstimate(node: WbsNode): { value: number | null; derived: boolean }
    childrenEstimate(node: WbsNode): number | null
    effectiveProgress(node: WbsNode): { value: number | null; derived: boolean }
}

/**
 * Per-render memoized twins of {@link effectiveEstimate},
 * {@link childrenEstimate}, and {@link effectiveProgress} (issue #100):
 * rendering calls the rollups once per visible row, and `effectiveProgress`
 * additionally re-walks every child's subtree for its weights — without a
 * memo the same subtree is recomputed for every ancestor row (quadratic on
 * deep or dense multi-parent forests). Results are cached per NODE INSTANCE,
 * not per path: a cycle-pruned duplicate can carry different children than
 * its twin, so a path-keyed cache could serve it the wrong subtree's value.
 * Progress weights follow the render convention: a child's weight is its
 * effective estimate. Create one instance per render pass — the caches
 * assume `estimateOf`/`progressOf` are stable for the instance's lifetime.
 */
export function createWbsRollups(
    estimateOf: (path: string) => number | null,
    progressOf: (path: string) => number | null
): WbsRollups {
    // Contributor maps (path → own estimate) memoized per node, preserving
    // childrenEstimate's dedupe-by-path semantics: a shared (multi-parent)
    // subtree inside the subtree still counts once.
    const contributorsCache = new Map<WbsNode, ReadonlyMap<string, number>>()
    const contributorsOf = (node: WbsNode): ReadonlyMap<string, number> => {
        const hit = contributorsCache.get(node)
        if (hit) return hit
        const out = new Map<string, number>()
        for (const child of node.children) {
            const own = estimateOf(child.path)
            if (own !== null) out.set(child.path, own)
            else for (const [path, value] of contributorsOf(child)) out.set(path, value)
        }
        contributorsCache.set(node, out)
        return out
    }
    const childrenEstimateMemo = (node: WbsNode): number | null => {
        const contributors = contributorsOf(node)
        if (contributors.size === 0) return null
        let sum = 0
        for (const value of contributors.values()) sum += value
        return sum
    }
    const effectiveEstimateMemo = (node: WbsNode): { value: number | null; derived: boolean } => {
        const own = estimateOf(node.path)
        if (own !== null) return { value: own, derived: false }
        const rollup = childrenEstimateMemo(node)
        return rollup === null ? { value: null, derived: false } : { value: rollup, derived: true }
    }
    const progressCache = new Map<WbsNode, { value: number | null; derived: boolean }>()
    const effectiveProgressMemo = (node: WbsNode): { value: number | null; derived: boolean } => {
        const hit = progressCache.get(node)
        if (hit) return hit
        // Same algorithm as the pure effectiveProgress, recursing through the
        // memo so every node in the forest is computed exactly once.
        const compute = (): { value: number | null; derived: boolean } => {
            const own = progressOf(node.path)
            if (own !== null && own > 0) return { value: own, derived: false }
            if (node.children.length === 0) return { value: own, derived: false }
            const children = node.children.map((child) => ({
                progress: effectiveProgressMemo(child).value,
                weight: effectiveEstimateMemo(child).value
            }))
            if (!children.some((c) => c.progress !== null)) {
                return { value: own, derived: false }
            }
            const weighted = children.every((c) => c.weight !== null && c.weight > 0)
            let sum = 0
            let weightSum = 0
            for (const child of children) {
                const weight = weighted ? (child.weight ?? 1) : 1
                sum += (child.progress ?? 0) * weight
                weightSum += weight
            }
            if (weightSum === 0) return { value: own, derived: false }
            return { value: Math.round(sum / weightSum), derived: true }
        }
        const result = compute()
        progressCache.set(node, result)
        return result
    }
    return {
        effectiveEstimate: effectiveEstimateMemo,
        childrenEstimate: childrenEstimateMemo,
        effectiveProgress: effectiveProgressMemo
    }
}

/**
 * The date span a node's subtree covers (issue #76, owner rule: derive
 * smartly when a parent carries no info of its own): the earliest start and
 * the latest end across the node itself and every distinct descendant.
 * `endOf` resolves a single path's own end (start + own estimate − 1);
 * paths without dates contribute nothing. Both bounds are null when nothing
 * in the subtree has a start.
 */
export function subtreeSpan(
    node: WbsNode,
    startOf: (path: string) => Date | null,
    endOf: (path: string) => Date | null
): { start: Date | null; end: Date | null } {
    let start: Date | null = null
    let end: Date | null = null
    const consider = (path: string): void => {
        const s = startOf(path)
        if (s && (!start || s < start)) start = s
        const e = endOf(path) ?? startOf(path)
        if (e && (!end || e > end)) end = e
    }
    consider(node.path)
    for (const path of descendantPaths(node)) consider(path)
    return { start, end }
}

/**
 * The subtree's tracked-time rollup (issue #119): the sum of OWN durations
 * over the node itself and every DISTINCT descendant. Unlike estimates
 * (where an own value replaces the subtree's contribution), tracked time is
 * an actual — time logged on the parent AND on its children both happened,
 * so they add. Distinct paths only, so a shared (multi-parent) subtree
 * counts once. Null when nothing in the subtree carries a duration.
 */
export function subtreeDuration(
    node: WbsNode,
    durationOf: (path: string) => number | null
): number | null {
    let sum = 0
    let found = false
    const consider = (path: string): void => {
        const own = durationOf(path)
        if (own !== null) {
            sum += own
            found = true
        }
    }
    consider(node.path)
    for (const path of descendantPaths(node)) consider(path)
    return found ? sum : null
}

/**
 * Top-down estimate distribution (issue #76, owner comment): split what
 * remains of the parent's OWN estimate — after subtracting the children's
 * effective estimates — equally across the direct children whose subtree
 * carries no estimate at all (effective === null). Existing values are never
 * overwritten. Every share is a whole day ≥ 1; leftover days go one each to
 * the first children. Returns null when there is nothing to distribute (no
 * estimate-less child, or no remaining budget for ≥ 1 day each).
 */
export function distributeEstimate(
    parentOwn: number,
    children: ReadonlyArray<{ path: string; total: number | null }>
): Map<string, number> | null {
    const missing = children.filter((c) => c.total === null)
    if (missing.length === 0) return null
    const allocated = children.reduce((sum, c) => sum + (c.total ?? 0), 0)
    const remaining = parentOwn - allocated
    if (remaining < missing.length) return null
    const base = Math.floor(remaining / missing.length)
    const extra = remaining % missing.length
    return new Map(missing.map((c, i) => [c.path, base + (i < extra ? 1 : 0)]))
}
