import { describe, expect, test } from 'bun:test'
import {
    buildWbsForest,
    buildWbsNode,
    childrenEstimate,
    collectContextAncestors,
    createWbsRollups,
    descendantPaths,
    distributeEstimate,
    effectiveEstimate,
    effectiveProgress,
    parseProgress,
    subtreeSpan
} from './wbs'
import type { WbsNode } from './wbs'

const byName = (a: string, b: string): number => a.localeCompare(b)

/** Forest helper over a plain parent→children edge map. */
function forest(
    paths: string[],
    edges: Record<string, string[]>
): ReturnType<typeof buildWbsForest> {
    const childrenOf = (path: string): string[] => edges[path] ?? []
    const parentsOf = (path: string): string[] =>
        Object.entries(edges)
            .filter(([, children]) => children.includes(path))
            .map(([parent]) => parent)
    return buildWbsForest(paths, childrenOf, parentsOf, byName)
}

describe('buildWbsForest', () => {
    test('roots at notes with no in-set parent; linked leaves only nested', () => {
        const trees = forest(['goal', 'project', 'task', 'loose'], {
            goal: ['project'],
            project: ['task']
        })
        expect(trees.map((t) => t.path)).toEqual(['goal', 'loose'])
        expect(trees[0]?.children.map((c) => c.path)).toEqual(['project'])
        expect(trees[0]?.children[0]?.children.map((c) => c.path)).toEqual(['task'])
        // 'loose' (no relationships) roots a childless single-row tree —
        // approved exception to rule 36 so flat boards stay usable.
        expect(trees[1]?.children).toEqual([])
    })

    test('a flat (edge-less) board renders every note as a standalone row', () => {
        const trees = forest(['b', 'a'], {})
        expect(trees.map((t) => t.path)).toEqual(['a', 'b'])
        expect(trees.every((t) => t.children.length === 0)).toBe(true)
    })

    test('multi-parent notes appear under each parent', () => {
        const trees = forest(['p1', 'p2', 'shared'], { p1: ['shared'], p2: ['shared'] })
        expect(trees.map((t) => t.path)).toEqual(['p1', 'p2'])
        expect(trees[0]?.children[0]?.path).toBe('shared')
        expect(trees[1]?.children[0]?.path).toBe('shared')
    })

    test('an off-set parent does not stop a note from rooting its tree', () => {
        // 'ghost' is the parent but filtered out of the result set.
        const childrenOf = (p: string): string[] =>
            p === 'ghost' ? ['goal'] : p === 'goal' ? ['task'] : []
        const parentsOf = (p: string): string[] =>
            p === 'goal' ? ['ghost'] : p === 'task' ? ['goal'] : []
        const trees = buildWbsForest(['goal', 'task'], childrenOf, parentsOf, byName)
        expect(trees.map((t) => t.path)).toEqual(['goal'])
    })

    test('cycles stop where a branch would re-enter itself', () => {
        // a → b → a, entered from root r → a.
        const trees = forest(['r', 'a', 'b'], { r: ['a'], a: ['b'], b: ['a'] })
        expect(trees.map((t) => t.path)).toEqual(['r'])
        const a = trees[0]?.children[0]
        expect(a?.path).toBe('a')
        expect(a?.children.map((c) => c.path)).toEqual(['b'])
        expect(a?.children[0]?.children).toEqual([])
    })

    test('depths and context parents are recorded', () => {
        const trees = forest(['g', 'p', 't'], { g: ['p'], p: ['t'] })
        const p = trees[0]?.children[0]
        const t = p?.children[0]
        expect(trees[0]?.depth).toBe(0)
        expect(trees[0]?.parentPath).toBeNull()
        expect(p?.depth).toBe(1)
        expect(p?.parentPath).toBe('g')
        expect(t?.depth).toBe(2)
        expect(t?.parentPath).toBe('p')
    })

    test('siblings and roots sort with the comparator', () => {
        const trees = forest(['r', 'b', 'a'], { r: ['b', 'a'] })
        expect(trees[0]?.children.map((c) => c.path)).toEqual(['a', 'b'])
    })
})

describe('collectContextAncestors', () => {
    const collect = (
        inSet: string[],
        parents: Record<string, string[]>,
        climb: Record<string, string[]>,
        missing: string[] = []
    ): ReturnType<typeof collectContextAncestors> =>
        collectContextAncestors(
            inSet,
            (p) => parents[p] ?? [],
            (p) => climb[p] ?? [],
            (p) => !missing.includes(p)
        )

    test('discovers out-of-set parents and inverts the edges', () => {
        // Two in-set tasks point at the same filtered-out project.
        const ctx = collect(['t1', 't2'], { t1: ['proj'], t2: ['proj'] }, {})
        expect(ctx.paths).toEqual(['proj'])
        expect(ctx.childEdges.get('proj')).toEqual(['t1', 't2'])
        // In-set children keep their resolved parents; no extra parent edge.
        expect(ctx.parentEdges.size).toBe(0)
    })

    test('climbs ancestor chains through out-of-set notes', () => {
        const ctx = collect(['task'], { task: ['proj'] }, { proj: ['goal'] })
        expect(ctx.paths).toEqual(['proj', 'goal'])
        expect(ctx.childEdges.get('goal')).toEqual(['proj'])
        expect(ctx.parentEdges.get('proj')).toEqual(['goal'])
    })

    test('a climbed parent already in the set is linked but not climbed', () => {
        // task → proj (out) → epic (IN set): epic gains proj as extra child.
        const ctx = collect(['task', 'epic'], { task: ['proj'] }, { proj: ['epic'] })
        expect(ctx.paths).toEqual(['proj'])
        expect(ctx.childEdges.get('epic')).toEqual(['proj'])
        expect(ctx.parentEdges.get('proj')).toEqual(['epic'])
    })

    test('dangling paths (note gone) are skipped; in-set parents ignored', () => {
        const ctx = collect(['t1', 't2', 'p2'], { t1: ['ghost'], t2: ['p2'] }, {}, ['ghost'])
        expect(ctx.paths).toEqual([])
        expect(ctx.childEdges.size).toBe(0)
    })

    test('cyclic out-of-set links terminate (edges kept, no infinite climb)', () => {
        const ctx = collect(['task'], { task: ['a'] }, { a: ['b'], b: ['a'] })
        expect(ctx.paths).toEqual(['a', 'b'])
        expect(ctx.childEdges.get('b')).toEqual(['a'])
        expect(ctx.childEdges.get('a')).toEqual(['task', 'b'])
        expect(ctx.parentEdges.get('a')).toEqual(['b'])
        expect(ctx.parentEdges.get('b')).toEqual(['a'])
    })

    test('self-links never form an edge', () => {
        const ctx = collect(['t'], { t: ['p'] }, { p: ['p'] })
        expect(ctx.paths).toEqual(['p'])
        expect(ctx.parentEdges.size).toBe(0)
    })
})

describe('effectiveEstimate / childrenEstimate', () => {
    const estimates: Record<string, number> = { g: 5, t1: 2, t2: 3 }
    const estimateOf = (p: string): number | null => estimates[p] ?? null

    test('an own value wins over the children', () => {
        const [tree] = forest(['g', 't1'], { g: ['t1'] })
        expect(effectiveEstimate(tree as WbsNode, estimateOf)).toEqual({
            value: 5,
            derived: false
        })
        // The children rollup stays visible as the coverage signal.
        expect(childrenEstimate(tree as WbsNode, estimateOf)).toBe(2)
    })

    test('no own value → derived from the children (bottom-up)', () => {
        const [tree] = forest(['x', 't1', 't2'], { x: ['t1', 't2'] })
        expect(effectiveEstimate(tree as WbsNode, estimateOf)).toEqual({
            value: 5,
            derived: true
        })
    })

    test('derivation recurses through estimate-less middle layers', () => {
        // goal → project (no estimate) → tasks 2 + 3: goal derives 5.
        const [tree] = forest(['goal', 'p', 't1', 't2'], { goal: ['p'], p: ['t1', 't2'] })
        expect(effectiveEstimate(tree as WbsNode, estimateOf)).toEqual({
            value: 5,
            derived: true
        })
    })

    test("a child's own value replaces its subtree (never adds to it)", () => {
        // p has own 2 even though its child t2 has 3 — p contributes 2.
        const estimatesMid: Record<string, number> = { p: 2, t2: 3 }
        const [tree] = forest(['g', 'p', 't2'], { g: ['p'], p: ['t2'] })
        expect(childrenEstimate(tree as WbsNode, (p) => estimatesMid[p] ?? null)).toBe(2)
    })

    test('persisting a rollup never double-counts', () => {
        // Before: x derives 5 from its children. Save 5 to x → own 5 wins,
        // and the children rollup still reads 5 (no 2× drift).
        const saved: Record<string, number> = { x: 5, t1: 2, t2: 3 }
        const [tree] = forest(['x', 't1', 't2'], { x: ['t1', 't2'] })
        const savedOf = (p: string): number | null => saved[p] ?? null
        expect(effectiveEstimate(tree as WbsNode, savedOf)).toEqual({ value: 5, derived: false })
        expect(childrenEstimate(tree as WbsNode, savedOf)).toBe(5)
    })

    test('null when nothing in the subtree has an estimate', () => {
        const [tree] = forest(['x', 'y'], { x: ['y'] })
        expect(effectiveEstimate(tree as WbsNode, estimateOf)).toEqual({
            value: null,
            derived: false
        })
        expect(childrenEstimate(tree as WbsNode, estimateOf)).toBeNull()
    })

    test('a diamond (shared subtree) counts once in the rollup', () => {
        // g → a, g → b, a → t, b → t; only t has an estimate (5). The tree
        // renders t under both a and b, but g's rollup must stay 5, not 10.
        const [tree] = forest(['g', 'a', 'b', 't'], { g: ['a', 'b'], a: ['t'], b: ['t'] })
        const only = (p: string): number | null => (p === 't' ? 5 : null)
        expect(childrenEstimate(tree as WbsNode, only)).toBe(5)
        expect(effectiveEstimate(tree as WbsNode, only)).toEqual({ value: 5, derived: true })
    })
})

describe('buildWbsNode', () => {
    test('expands a single path with the branch cycle guard', () => {
        const edges: Record<string, string[]> = { a: ['b'], b: ['a'] }
        const node = buildWbsNode('a', (p) => edges[p] ?? [])
        expect(node.children.map((c) => c.path)).toEqual(['b'])
        expect(node.children[0]?.children).toEqual([])
    })
})

describe('parseProgress', () => {
    test('numbers and numeric strings, clamped to 0–100', () => {
        expect(parseProgress(42)).toBe(42)
        expect(parseProgress('42')).toBe(42)
        expect(parseProgress(-5)).toBe(0)
        expect(parseProgress(250)).toBe(100)
        expect(parseProgress(0)).toBe(0)
    })

    test('unusable values are null', () => {
        expect(parseProgress(undefined)).toBeNull()
        expect(parseProgress(null)).toBeNull()
        expect(parseProgress('')).toBeNull()
        expect(parseProgress('half')).toBeNull()
        expect(parseProgress(true)).toBeNull()
        expect(parseProgress(Number.NaN)).toBeNull()
    })
})

describe('effectiveProgress', () => {
    const node = (path: string, ...children: WbsNode[]): WbsNode => ({
        path,
        parentPath: null,
        depth: 0,
        children
    })
    const progress =
        (values: Record<string, number>) =>
        (path: string): number | null =>
            values[path] ?? null
    const estimates =
        (values: Record<string, number>) =>
        (n: WbsNode): number | null =>
            values[n.path] ?? null

    test('own value > 0 wins over children', () => {
        const tree = node('p', node('c'))
        const result = effectiveProgress(tree, progress({ p: 30, c: 90 }), estimates({}))
        expect(result).toEqual({ value: 30, derived: false })
    })

    test('own 0 derives from children (owner rule)', () => {
        const tree = node('p', node('a'), node('b'))
        const result = effectiveProgress(tree, progress({ p: 0, a: 50, b: 100 }), estimates({}))
        expect(result).toEqual({ value: 75, derived: true })
    })

    test('missing own value derives from children', () => {
        const tree = node('p', node('a'), node('b'))
        const result = effectiveProgress(tree, progress({ a: 40 }), estimates({}))
        // b has no progress → counts as 0 with equal weight: (40 + 0) / 2.
        expect(result).toEqual({ value: 20, derived: true })
    })

    test('weights by estimate totals when every child has one', () => {
        const tree = node('p', node('a'), node('b'))
        const result = effectiveProgress(
            tree,
            progress({ a: 100, b: 0 }),
            estimates({ a: 1, b: 3 })
        )
        expect(result).toEqual({ value: 25, derived: true })
    })

    test('falls back to equal weights when a child lacks an estimate', () => {
        const tree = node('p', node('a'), node('b'))
        const result = effectiveProgress(tree, progress({ a: 100, b: 0 }), estimates({ a: 4 }))
        expect(result).toEqual({ value: 50, derived: true })
    })

    test('no descendant progress at all → own value kept, underived', () => {
        const tree = node('p', node('a'))
        expect(effectiveProgress(tree, progress({}), estimates({}))).toEqual({
            value: null,
            derived: false
        })
        expect(effectiveProgress(tree, progress({ p: 0 }), estimates({}))).toEqual({
            value: 0,
            derived: false
        })
    })

    test('children with an explicit 0% derive a 0% parent (not a blank)', () => {
        const tree = node('p', node('a'), node('b'))
        expect(effectiveProgress(tree, progress({ a: 0, b: 0 }), estimates({}))).toEqual({
            value: 0,
            derived: true
        })
    })

    test('derivation recurses through estimate-less middle layers', () => {
        const tree = node('g', node('p', node('t')))
        const result = effectiveProgress(tree, progress({ t: 80 }), estimates({}))
        expect(result).toEqual({ value: 80, derived: true })
    })
})

describe('distributeEstimate', () => {
    test('splits the remainder equally over estimate-less children', () => {
        const shares = distributeEstimate(10, [
            { path: 'a', total: 4 },
            { path: 'b', total: null },
            { path: 'c', total: null }
        ])
        expect(shares).toEqual(
            new Map([
                ['b', 3],
                ['c', 3]
            ])
        )
    })

    test('leftover days go one each to the first children', () => {
        const shares = distributeEstimate(8, [
            { path: 'a', total: null },
            { path: 'b', total: null },
            { path: 'c', total: null }
        ])
        expect(shares).toEqual(
            new Map([
                ['a', 3],
                ['b', 3],
                ['c', 2]
            ])
        )
    })

    test('null when every child already has an estimate', () => {
        expect(distributeEstimate(10, [{ path: 'a', total: 2 }])).toBeNull()
    })

    test('null when the remaining budget cannot give each child a day', () => {
        expect(
            distributeEstimate(3, [
                { path: 'a', total: 3 },
                { path: 'b', total: null }
            ])
        ).toBeNull()
    })
})

describe('subtreeSpan', () => {
    const day = (n: number): Date => new Date(2026, 6, n)

    test('earliest start and latest end across the subtree', () => {
        const [tree] = forest(['g', 'a', 'b'], { g: ['a', 'b'] })
        const starts: Record<string, Date> = { a: day(10), b: day(14) }
        const ends: Record<string, Date> = { a: day(12), b: day(16) }
        const span = subtreeSpan(
            tree as WbsNode,
            (p) => starts[p] ?? null,
            (p) => ends[p] ?? null
        )
        expect(span).toEqual({ start: day(10), end: day(16) })
    })

    test("the node's own dates participate", () => {
        const [tree] = forest(['g', 'a'], { g: ['a'] })
        const span = subtreeSpan(
            tree as WbsNode,
            (p) => (p === 'g' ? day(1) : day(5)),
            () => null
        )
        // endOf null falls back to the start, so g..a spans 1 → 5.
        expect(span).toEqual({ start: day(1), end: day(5) })
    })

    test('nothing dated → null bounds', () => {
        const [tree] = forest(['g', 'a'], { g: ['a'] })
        expect(
            subtreeSpan(
                tree as WbsNode,
                () => null,
                () => null
            )
        ).toEqual({
            start: null,
            end: null
        })
    })
})

describe('descendantPaths', () => {
    test('collects distinct descendants across a diamond', () => {
        const [tree] = forest(['g', 'a', 'b', 't'], { g: ['a', 'b'], a: ['t'], b: ['t'] })
        expect([...descendantPaths(tree as WbsNode)].sort()).toEqual(['a', 'b', 't'])
    })
})

describe('createWbsRollups', () => {
    /** Every node instance in the forest, parents before their children. */
    const allNodes = (trees: WbsNode[]): WbsNode[] =>
        trees.flatMap((t) => [t, ...allNodes(t.children)])

    test('matches the pure rollups on every node of a mixed forest', () => {
        // Mixed top-down/bottom-up values, an estimate-less middle layer,
        // a done-like 100% leaf, a 0% child, and a diamond (shared under
        // p1 AND p2) — the shapes the render pass actually meets.
        const trees = forest(['g', 'p1', 'p2', 't1', 't2', 't3', 'shared'], {
            g: ['p1', 'p2'],
            p1: ['t1', 't2', 'shared'],
            p2: ['t3', 'shared']
        })
        const estimates: Record<string, number> = { t1: 2, t3: 4, shared: 5, p2: 10 }
        const estimateOf = (p: string): number | null => estimates[p] ?? null
        const progresses: Record<string, number> = { t1: 50, t2: 0, shared: 100, p2: 20, g: 0 }
        const progressOf = (p: string): number | null => progresses[p] ?? null
        const weightOf = (n: WbsNode): number | null => effectiveEstimate(n, estimateOf).value

        const rollups = createWbsRollups(estimateOf, progressOf)
        for (const node of allNodes(trees)) {
            expect(rollups.childrenEstimate(node)).toBe(childrenEstimate(node, estimateOf))
            expect(rollups.effectiveEstimate(node)).toEqual(effectiveEstimate(node, estimateOf))
            expect(rollups.effectiveProgress(node)).toEqual(
                effectiveProgress(node, progressOf, weightOf)
            )
        }
    })

    test('a diamond inside the subtree still counts once', () => {
        const [tree] = forest(['g', 'a', 'b', 't'], { g: ['a', 'b'], a: ['t'], b: ['t'] })
        const rollups = createWbsRollups(
            (p) => (p === 't' ? 5 : null),
            () => null
        )
        expect(rollups.childrenEstimate(tree as WbsNode)).toBe(5)
        expect(rollups.effectiveEstimate(tree as WbsNode)).toEqual({ value: 5, derived: true })
    })

    test('cycle-pruned duplicate instances keep instance-correct values', () => {
        // r → a, r → b, a → b, b → a: path 'a' renders twice — under r with
        // child b, and under b with its re-entering child pruned. A per-PATH
        // cache would serve both the same rollup; per-instance must not.
        const trees = forest(['r', 'a', 'b'], { r: ['a', 'b'], a: ['b'], b: ['a'] })
        const rollups = createWbsRollups(
            (p) => (p === 'b' ? 3 : null),
            () => null
        )
        const root = trees[0] as WbsNode
        const aUnderR = root.children.find((c) => c.path === 'a') as WbsNode
        const bUnderR = root.children.find((c) => c.path === 'b') as WbsNode
        const aUnderB = bUnderR.children[0] as WbsNode
        expect(aUnderR.children.map((c) => c.path)).toEqual(['b'])
        expect(aUnderB.children).toEqual([])
        expect(rollups.childrenEstimate(aUnderR)).toBe(3)
        expect(rollups.childrenEstimate(aUnderB)).toBeNull()
    })

    test('computes each node once — progress is read once per instance', () => {
        // Chain c0 → … → c4: querying every row must not re-walk subtrees
        // (the pure function would read progress quadratically often).
        const paths = ['c0', 'c1', 'c2', 'c3', 'c4']
        const edges = { c0: ['c1'], c1: ['c2'], c2: ['c3'], c3: ['c4'] }
        const trees = forest(paths, edges)
        let reads = 0
        const rollups = createWbsRollups(
            () => null,
            () => {
                reads++
                return 40
            }
        )
        for (const node of allNodes(trees)) rollups.effectiveProgress(node)
        expect(reads).toBe(paths.length)
    })
})
