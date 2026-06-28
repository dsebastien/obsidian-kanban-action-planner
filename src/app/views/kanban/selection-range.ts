/**
 * The inclusive range of keys between `fromKey` and `toKey` in board order
 * (the keys a Shift-click selects — issue #18). Order-agnostic: works whether
 * `toKey` is before or after `fromKey`. When either endpoint isn't in `order`
 * (or `fromKey` is null), it degrades to just `[toKey]` so a Shift-click still
 * selects the clicked card. Pure, so the range math is unit-tested apart from
 * the selection controller's mutable state.
 */
export function inclusiveKeyRange(
    order: ReadonlyArray<string>,
    fromKey: string | null,
    toKey: string
): string[] {
    const a = fromKey ? order.indexOf(fromKey) : -1
    const b = order.indexOf(toKey)
    if (a < 0 || b < 0) return [toKey]
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const out: string[] = []
    for (let i = lo; i <= hi; i++) {
        const key = order[i]
        if (key) out.push(key)
    }
    return out
}
