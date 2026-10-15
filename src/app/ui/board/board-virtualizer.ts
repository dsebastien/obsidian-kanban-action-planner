/**
 * Column virtualization (issue #111): the DOM side.
 *
 * A column with {@link VIRTUALIZE_MIN_CARDS} cards or more keeps only the
 * cards in or near its visible area mounted, between two spacers that stand
 * in for the rest (see `virtual-window.ts` for the math). Smaller columns are
 * rendered in full, exactly as before.
 *
 * Every card on a board has the same height (Business Rule 8a), published by
 * `card-equalize.ts` as `--kap-card-height` on the board host, so a virtual
 * column is a fixed-pitch list and every offset is exact. The uniform height
 * is the max over the cards that can be measured: the mounted ones, a few
 * "probe" cards per virtual column picked by what makes a card tall
 * ({@link mountHeightProbes}), and a cache of heights already measured. A
 * card mounted later that still turns out taller raises the height for the
 * whole board, with every virtual column re-anchored on the card at its top
 * so nothing slides ({@link growCardHeight}).
 *
 * Never unmounted while it matters: the card being dragged (or lifted by a
 * long press), and the focused card. Outside the window they are positioned
 * absolutely at their exact slot (`.kap-card-pinned`), placed in the DOM
 * before or after the window so the Tab order stays the column order.
 *
 * Per list state lives in a WeakMap keyed by the card list element, so the
 * stateless board renderer keeps its shape. Work is batched READ then WRITE
 * ({@link syncLists}): a render pass queues its columns
 * ({@link renderVirtualColumn}) and lays them out once in
 * {@link flushVirtualColumns}. Scrolls and size changes of each list (its
 * own ResizeObserver from the element's own window, popout-safe) re-window
 * it synchronously, before the next paint. A list that is not height-limited
 * (a Markdown embed growing with its content) windows against the area its
 * scrolling ancestor actually shows.
 */

import { hasAnyRelationship } from '../../services/relationships.service'
import { cssEscapeAttr } from '../../utils/css-escape'
import { planReconcile } from './reconcile'
import type { KanbanCard } from './types'
import {
    FALLBACK_CARD_HEIGHT_PX,
    anchoredScrollTop,
    captureKeyAnchor,
    cardTop,
    nextWindow,
    pickProbeIndices,
    restoreKeyAnchor,
    revealScrollTop,
    scrollAnchor,
    shouldVirtualize,
    spacerHeights
} from './virtual-window'
import type {
    CardHeightFeatures,
    ColumnGeometry,
    IndexRange,
    KeyAnchor,
    ScrollAnchor
} from './virtual-window'

/** CSS custom property holding the board-wide uniform card height. */
export const CARD_HEIGHT_VAR = '--kap-card-height'
/** On a card list while it is virtualized. */
export const VIRTUAL_CLASS = 'kap-column-virtual'
/** The two spacers of a virtual card list. */
export const SPACER_CLASS = 'kap-column-spacer'
/** A mounted card outside the window (dragged or focused), positioned at its slot. */
export const PINNED_CLASS = 'kap-card-pinned'
/** A card mounted only for the height measurement. */
export const PROBE_CLASS = 'kap-card-probe'
/** Probe cards per height feature and virtual column (see {@link pickProbeIndices}). */
const PROBES_PER_FEATURE = 8
/** Height-cache entries kept per board before the cache starts over. */
const HEIGHT_CACHE_LIMIT = 20_000
/** Heights closer than this (px) are the same height. */
const HEIGHT_EPSILON = 0.01
/** A focus change this soon (ms) after a Tab key press came from that Tab. */
const TAB_FOCUS_MS = 300
/** Host and root classes that change card heights (the height-cache epoch). */
const HEIGHT_CLASS_RE =
    /^kap-(compact|cover-|card-color-|accent-|chips-|mobile|phone|embedded|in-canvas)/

/** Called with the card nodes a virtual column mounts or unmounts. */
export interface VirtualColumnHooks {
    onMount?: (listEl: HTMLElement, nodes: HTMLElement[]) => void
    onUnmount?: (listEl: HTMLElement, nodes: HTMLElement[]) => void
}

/** What a card list renders: the column's cards and how to draw and diff one. */
export interface ColumnCardsSource {
    cards: readonly KanbanCard[]
    /** The card's render signature (stamped on its node as `data-card-sig`). */
    signature: (card: KanbanCard) => string
    /** Build a fully wired card node. */
    build: (card: KanbanCard) => HTMLElement
    hooks: VirtualColumnHooks
}

interface ListMetrics {
    gap: number
    padTop: number
    padBottom: number
}

interface VirtualList extends ColumnCardsSource {
    listEl: HTMLElement
    hostEl: HTMLElement
    indexByKey: Map<string, number>
    range: IndexRange | null
    top: HTMLElement
    bottom: HTMLElement
    metrics: ListMetrics | null
    /** The list's visible height as last read (null: never read). */
    viewport: number | null
    /** Not height-limited (an embed growing with its content): window against `outer`. */
    unbounded: boolean
    /** The scrolling ancestor of an unbounded list (null: the window). */
    outer: HTMLElement | null
    /** Cards handed over by a render pass, swapped in by the next flush. */
    pending: ColumnCardsSource | null
    onScroll: () => void
    onFocusIn: (e: FocusEvent) => void
}

interface HeightEntry {
    hash: number
    width: number
    height: number
}

interface HeightCache {
    epoch: string
    entries: Map<string, HeightEntry>
}

interface WindowState {
    resizeObserver: ResizeObserver
    unbounded: Set<VirtualList>
    lastTab: { at: number; shift: boolean; scrolls: Map<HTMLElement, number> } | null
}

const virtualLists = new WeakMap<HTMLElement, VirtualList>()
const heightCaches = new WeakMap<HTMLElement, HeightCache>()
const windowStates = new WeakMap<Window, WindowState>()

/** The per-list state of a virtual card list, or undefined for a fully rendered one. */
function stateOf(listEl: HTMLElement): VirtualList | undefined {
    return virtualLists.get(listEl)
}

/** Every virtual card list under `rootEl`. */
function virtualListsUnder(rootEl: HTMLElement): VirtualList[] {
    const out: VirtualList[] = []
    for (const el of Array.from(rootEl.querySelectorAll<HTMLElement>(`.${VIRTUAL_CLASS}`))) {
        const v = stateOf(el)
        if (v) out.push(v)
    }
    return out
}

/** `el` as an HTMLElement when it is one (realm-safe: popout windows have their own classes). */
function asElement(el: unknown): HTMLElement | null {
    if (el === null || typeof el !== 'object') return null
    return 'dataset' in el && 'focus' in el ? (el as HTMLElement) : null
}

/** The board's current uniform card height (px), or null before the first measurement. */
export function readCardHeight(hostEl: HTMLElement): number | null {
    const value = Number.parseFloat(hostEl.style.getPropertyValue(CARD_HEIGHT_VAR))
    return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * The height to publish for a measured max: rounded UP to a whole pixel, so
 * a fractional natural height (76.4px) never gets a smaller envelope than its
 * content and every card has exactly the published height.
 */
export function publishedCardHeight(measured: number): number {
    return Math.ceil(measured - HEIGHT_EPSILON)
}

function cardHeightOf(v: VirtualList): number {
    return readCardHeight(v.hostEl) ?? FALLBACK_CARD_HEIGHT_PX
}

function metricsOf(v: VirtualList): ListMetrics {
    if (v.metrics) return v.metrics
    const style = v.listEl.win.getComputedStyle(v.listEl)
    const num = (value: string): number => {
        const n = Number.parseFloat(value)
        return Number.isFinite(n) ? n : 0
    }
    v.metrics = {
        gap: num(style.rowGap),
        padTop: num(style.paddingTop),
        padBottom: num(style.paddingBottom)
    }
    return v.metrics
}

/** Per-window shared state: the ResizeObserver, unbounded lists, the Tab tracker. */
function windowState(el: HTMLElement): WindowState {
    const win = el.win
    let state = windowStates.get(win)
    if (state) return state
    const Observer = (win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver
    const resizeObserver = new Observer((entries: ResizeObserverEntry[]) => {
        const lists: VirtualList[] = []
        // READ every entry first (layout is clean inside the callback)...
        for (const entry of entries) {
            const el = entry.target as HTMLElement
            const v = stateOf(el)
            if (!v || !el.isConnected) {
                resizeObserver.unobserve(el)
                continue
            }
            readBounds(v)
            lists.push(v)
        }
        // ...then re-window them.
        syncLists(lists.map((v) => ({ v })))
    })
    const created: WindowState = { resizeObserver, unbounded: new Set(), lastTab: null }
    const doc = el.doc
    // Scrolls of whatever an unbounded list scrolls with (capture: scroll
    // events do not bubble).
    doc.addEventListener(
        'scroll',
        (e: Event) => {
            if (created.unbounded.size === 0) return
            const target = e.target
            const lists: VirtualList[] = []
            for (const v of created.unbounded) {
                if (!v.listEl.isConnected || stateOf(v.listEl) !== v) {
                    created.unbounded.delete(v)
                    continue
                }
                const node = asElement(target)
                if (target === doc || (node && node.contains(v.listEl))) lists.push(v)
            }
            if (lists.length > 0) syncLists(lists.map((v) => ({ v })))
        },
        { capture: true, passive: true }
    )
    // Where each virtual list was scrolled when Tab was pressed, so a Tab
    // landing on a mounted card far from the view can be redirected.
    doc.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return
            const scrolls = new Map<HTMLElement, number>()
            for (const el of Array.from(doc.querySelectorAll<HTMLElement>(`.${VIRTUAL_CLASS}`))) {
                scrolls.set(el, el.scrollTop)
            }
            created.lastTab = { at: e.timeStamp, shift: e.shiftKey, scrolls }
        },
        { capture: true }
    )
    windowStates.set(win, created)
    state = created
    return state
}

/**
 * Read a list's visible height and whether it is height-limited. A list
 * whose content is not clipped (its scroll extent equals its height) grows
 * with its content, e.g. inside a Markdown embed: it windows against its
 * scrolling ancestor instead (see {@link readGeometry}).
 */
function readBounds(v: VirtualList): void {
    const el = v.listEl
    const height = el.clientHeight
    v.viewport = height
    const unbounded = height > 0 && v.range !== null && el.scrollHeight <= height + 1
    if (unbounded === v.unbounded) return
    v.unbounded = unbounded
    const state = windowState(el)
    if (unbounded) {
        v.outer = scrollingAncestor(el)
        state.unbounded.add(v)
    } else {
        v.outer = null
        state.unbounded.delete(v)
    }
}

/** The nearest ancestor that scrolls vertically, or null (the window). */
function scrollingAncestor(el: HTMLElement): HTMLElement | null {
    const win = el.win
    for (let node = el.parentElement; node; node = node.parentElement) {
        const overflow = win.getComputedStyle(node).overflowY
        if (
            (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') &&
            node.scrollHeight > node.clientHeight + 1
        ) {
            return node
        }
    }
    return null
}

/**
 * Render a column's cards into its list: queued for windowing (laid out by
 * {@link flushVirtualColumns}) when the column is long enough, else return
 * false and leave the list to the caller's full keyed reconcile (after
 * undoing any previous virtualization of the list).
 */
export function renderVirtualColumn(
    listEl: HTMLElement,
    hostEl: HTMLElement,
    source: ColumnCardsSource
): boolean {
    const existing = stateOf(listEl)
    if (!shouldVirtualize(source.cards.length, existing !== undefined)) {
        releaseVirtualColumn(listEl)
        return false
    }
    const v = existing ?? createVirtualList(listEl, hostEl, source)
    v.hostEl = hostEl
    v.pending = source
    return true
}

function createVirtualList(
    listEl: HTMLElement,
    hostEl: HTMLElement,
    source: ColumnCardsSource
): VirtualList {
    const spacer = (): HTMLElement =>
        listEl.createDiv({ cls: SPACER_CLASS, attr: { 'aria-hidden': 'true' } })
    const top = spacer()
    const bottom = spacer()
    listEl.prepend(top)
    listEl.appendChild(bottom)
    listEl.addClass(VIRTUAL_CLASS)
    const v: VirtualList = {
        ...source,
        cards: [],
        listEl,
        hostEl,
        indexByKey: new Map(),
        range: null,
        top,
        bottom,
        metrics: null,
        viewport: null,
        unbounded: false,
        outer: null,
        pending: null,
        onScroll: () => {
            if (stateOf(listEl) === v) syncLists([{ v }])
        },
        onFocusIn: (e: FocusEvent) => redirectTabFocus(v, e)
    }
    virtualLists.set(listEl, v)
    listEl.addEventListener('scroll', v.onScroll, { passive: true })
    listEl.addEventListener('focusin', v.onFocusIn)
    windowState(listEl).resizeObserver.observe(listEl)
    return v
}

/** Lay out every virtual column queued by the render pass under `rootEl`. */
export function flushVirtualColumns(rootEl: HTMLElement): void {
    const lists = virtualListsUnder(rootEl).filter((v) => v.pending !== null)
    if (lists.length > 0) syncLists(lists.map((v) => ({ v, force: true })))
}

/** Undo virtualization of a list (it shrank below the threshold, or is being torn down). */
export function releaseVirtualColumn(listEl: HTMLElement): void {
    const v = stateOf(listEl)
    if (!v) return
    virtualLists.delete(listEl)
    listEl.removeEventListener('scroll', v.onScroll)
    listEl.removeEventListener('focusin', v.onFocusIn)
    const state = windowStates.get(listEl.win)
    state?.resizeObserver.unobserve(listEl)
    state?.unbounded.delete(v)
    v.top.remove()
    v.bottom.remove()
    listEl.removeClass(VIRTUAL_CLASS)
    for (const el of Array.from(listEl.querySelectorAll<HTMLElement>(':scope > .kap-card'))) {
        unpin(el)
        el.removeAttribute('aria-posinset')
        el.removeAttribute('aria-setsize')
    }
}

/** Release every virtual list under `rootEl` (before a full re-render or another mode empties it). */
export function releaseVirtualColumns(rootEl: HTMLElement): void {
    for (const v of virtualListsUnder(rootEl)) releaseVirtualColumn(v.listEl)
}

function unpin(el: HTMLElement): void {
    if (!el.hasClass(PINNED_CLASS)) return
    el.removeClass(PINNED_CLASS)
    el.style.removeProperty('top')
}

/** Keys of mounted cards that must stay mounted wherever the window goes. */
function pinnedKeys(v: VirtualList, extra: string | null): Set<string> {
    const pins = new Set<string>()
    if (extra !== null) pins.add(extra)
    for (const el of Array.from(
        v.listEl.querySelectorAll<HTMLElement>(
            ':scope > .kap-card-dragging, :scope > .kap-card-lifted'
        )
    )) {
        pins.add(el.dataset['cardKey'] ?? '')
    }
    const active = asElement(v.listEl.doc.activeElement)
    if (active && v.listEl.contains(active)) {
        const cardEl = active.closest<HTMLElement>('.kap-card')
        if (cardEl?.parentElement === v.listEl) pins.add(cardEl.dataset['cardKey'] ?? '')
    }
    pins.delete('')
    return pins
}

/** One list to (re)window in a {@link syncLists} batch. */
interface SyncEntry {
    v: VirtualList
    /** Reconcile even when the window did not move (the cards changed). */
    force?: boolean
    /** Window for this scroll offset, and set it once the spacers are sized. */
    scrollTop?: number
    /** A card-height anchor: the scroll offset is derived from it in the write phase. */
    heightAnchor?: ScrollAnchor
    /** Also mount this card (pinned at its slot when outside the window). */
    pin?: string
}

interface ReadState {
    collapsed: boolean
    /** Current scroll offset (or, unbounded, the visible top in list coordinates). */
    scrollTop: number
    viewport: number
    /** Where the cards at the top of the view were, before the cards change. */
    keyAnchor: KeyAnchor | null
}

function geometry(v: VirtualList, scrollTop: number, viewport: number): ColumnGeometry {
    const m = metricsOf(v)
    return {
        count: v.cards.length,
        cardHeight: cardHeightOf(v),
        gap: m.gap,
        padTop: m.padTop,
        padBottom: m.padBottom,
        scrollTop,
        viewportHeight: viewport
    }
}

/** READ phase for one list: no DOM writes. */
function readGeometry(e: SyncEntry): ReadState {
    const v = e.v
    const el = v.listEl
    metricsOf(v)
    const collapsed = el.closest('.kap-column-collapsed, .kap-lane-collapsed') !== null
    if (v.viewport === null) readBounds(v)
    let scrollTop = el.scrollTop
    // The live height, read in this batch's read phase (no extra layout): a
    // leaf hidden since the last observer tick reports 0 here, and its
    // scroll offset reads 0 too, so the window must be kept, not moved to
    // the top (that would unmount every card and flash the covers on return).
    let viewport = el.clientHeight
    v.viewport = viewport
    if (v.unbounded) {
        // Window against what the scrolling ancestor (or the window) shows.
        const rect = el.getBoundingClientRect()
        const clip = v.outer ? v.outer.getBoundingClientRect() : null
        const clipTop = Math.max(0, clip ? clip.top : 0)
        const clipBottom = Math.min(el.win.innerHeight, clip ? clip.bottom : el.win.innerHeight)
        const top = Math.max(clipTop, rect.top)
        const bottom = Math.min(clipBottom, rect.bottom)
        scrollTop = top - rect.top
        viewport = Math.max(0, bottom - top)
    }
    let keyAnchor: KeyAnchor | null = null
    if (v.pending && v.range !== null && !v.unbounded && e.scrollTop === undefined) {
        const cards = v.cards
        keyAnchor = captureKeyAnchor(
            cards.length,
            (i) => cards[i]?.key,
            geometry(v, scrollTop, viewport)
        )
    }
    return { collapsed, scrollTop, viewport, keyAnchor }
}

/**
 * (Re)window a batch of virtual lists: READ every list's geometry first,
 * then WRITE every list (cards, spacers, scroll offsets), then READ the new
 * nodes' heights once to catch a card taller than the uniform height. No
 * read is interleaved with the writes, so a batch forces at most two
 * layouts however many columns it touches.
 */
function syncLists(entries: SyncEntry[]): void {
    if (entries.length === 0) return
    const reads = entries.map((e) => readGeometry(e))
    const created: Array<{ v: VirtualList; nodes: HTMLElement[] }> = []
    const firstMount: VirtualList[] = []
    entries.forEach((e, i) => {
        const read = reads[i]
        if (!read) return
        if (e.v.range === null) firstMount.push(e.v)
        const nodes = writeWindow(e, read)
        if (nodes.length > 0) created.push({ v: e.v, nodes })
    })
    // A list's first window: only now (spacers in) can it tell whether it
    // is height-limited. One not limited (an embed) re-windows against its
    // scrolling ancestor right away instead of waiting for the observer.
    const unbounded = firstMount.filter((v) => {
        readBounds(v)
        return v.unbounded
    })
    if (created.length > 0) checkGrowth(created)
    if (unbounded.length > 0) syncLists(unbounded.map((v) => ({ v, force: true })))
}

/** WRITE phase for one list. Returns the in-window card nodes it created. */
function writeWindow(e: SyncEntry, read: ReadState): HTMLElement[] {
    const v = e.v
    const pending = v.pending
    if (pending) {
        v.pending = null
        v.cards = pending.cards
        v.signature = pending.signature
        v.build = pending.build
        v.hooks = pending.hooks
        v.indexByKey = new Map(pending.cards.map((c, i) => [c.key, i]))
    }
    const height = cardHeightOf(v)
    const m = metricsOf(v)
    // The scroll offset to window for: an explicit one, a card-height
    // anchor, the cards that were at the top of the view (inserts/removals
    // above it must not shift what the user is looking at), or the current.
    let target = e.scrollTop
    if (target === undefined && e.heightAnchor) {
        target = anchoredScrollTop(e.heightAnchor, height, m.gap, m.padTop)
    }
    if (target === undefined && read.keyAnchor) {
        const restored = restoreKeyAnchor(
            read.keyAnchor,
            (key) => v.indexByKey.get(key) ?? -1,
            height,
            m.gap,
            m.padTop
        )
        if (restored !== null && Math.abs(restored - read.scrollTop) > 0.5) target = restored
    }
    if (v.unbounded) target = undefined
    const g = geometry(v, target ?? read.scrollTop, read.viewport)
    // Collapsed: mount nothing. Hidden (no viewport) or plain scroll: keep or
    // extend the mounted window. A jump to a new offset: a fresh window.
    const current = read.collapsed
        ? null
        : read.viewport <= 0 || target === undefined
          ? v.range
          : null
    const range = read.collapsed ? { start: 0, end: 0 } : nextWindow(current, g)
    const moved = v.range === null || range.start !== v.range.start || range.end !== v.range.end
    if (!moved && !e.force && e.pin === undefined && target === undefined && !pending) return []
    v.range = range
    // Moving a node (a pinned card entering or leaving the flow) blurs it.
    const active = asElement(v.listEl.doc.activeElement)
    const createdNodes = reconcileWindow(v, range, pinnedKeys(v, e.pin ?? null), g)
    if (
        active &&
        active !== v.listEl.doc.activeElement &&
        active.isConnected &&
        v.listEl.contains(active)
    ) {
        active.focus({ preventScroll: true })
    }
    const spacers = spacerHeights(v.cards.length, range, g.cardHeight, g.gap)
    setSpacer(v.top, spacers.top)
    setSpacer(v.bottom, spacers.bottom)
    if (target !== undefined && target !== read.scrollTop) v.listEl.scrollTop = target
    return createdNodes
}

function setSpacer(el: HTMLElement, height: number): void {
    const hidden = height <= 0
    if (el.hasClass('kap-hidden') !== hidden) el.toggleClass('kap-hidden', hidden)
    const value = `${String(Math.max(0, height))}px`
    if (el.style.height !== value) el.style.height = value
}

/**
 * Keyed reconcile of the mounted window (plus pinned cards): unchanged cards
 * keep their node (focus, hover, an in-flight drag), changed ones are
 * rebuilt, cards leaving the window are removed. Pinned cards go before the
 * top spacer (above the window) or after the bottom one (below), in column
 * order, so the Tab order stays the column order. Returns the in-window
 * nodes it created.
 */
function reconcileWindow(
    v: VirtualList,
    range: IndexRange,
    pins: ReadonlySet<string>,
    g: ColumnGeometry
): HTMLElement[] {
    const listEl = v.listEl
    const nodeByKey = new Map<string, HTMLElement>()
    const existing: Array<{ key: string; signature: string }> = []
    for (const el of Array.from(listEl.querySelectorAll<HTMLElement>(':scope > .kap-card'))) {
        if (el.hasClass(PROBE_CLASS)) continue
        const key = el.dataset['cardKey'] ?? ''
        nodeByKey.set(key, el)
        existing.push({ key, signature: el.dataset['cardSig'] ?? '' })
    }
    const inWindow = v.cards.slice(range.start, range.end)
    const desiredKeys = new Set(inWindow.map((c) => c.key))
    const pinnedOutside: KanbanCard[] = []
    for (const key of pins) {
        const index = v.indexByKey.get(key)
        const card = index === undefined ? undefined : v.cards[index]
        if (card && !desiredKeys.has(key)) pinnedOutside.push(card)
    }
    pinnedOutside.sort((a, b) => (v.indexByKey.get(a.key) ?? 0) - (v.indexByKey.get(b.key) ?? 0))
    const cardByKey = new Map([...inWindow, ...pinnedOutside].map((c) => [c.key, c]))
    const plan = planReconcile(existing, [
        ...pinnedOutside.map((c) => ({ key: c.key, signature: v.signature(c) })),
        ...inWindow.map((c) => ({ key: c.key, signature: v.signature(c) }))
    ])
    const removed: HTMLElement[] = []
    for (const key of plan.remove) {
        const node = nodeByKey.get(key)
        if (!node) continue
        node.remove()
        removed.push(node)
    }

    const mountedNew: HTMLElement[] = []
    const nodeFor = (key: string, create: boolean): HTMLElement | undefined => {
        const card = cardByKey.get(key)
        if (!card) return undefined
        if (create) {
            const node = v.build(card)
            mountedNew.push(node)
            return node
        }
        return nodeByKey.get(key)
    }
    const entryByKey = new Map(plan.ordered.map((entry) => [entry.key, entry]))

    // Pinned cards first, OUT of the window's way: a focused card that just
    // left the window would otherwise sit at the cursor and make every
    // in-window node move (and re-insert) around it. Above the window:
    // right before the top spacer; below: right after the bottom one; both
    // in column order, so Tab / Shift+Tab follow the column.
    const above: HTMLElement[] = []
    const below: HTMLElement[] = []
    for (const card of pinnedOutside) {
        const entry = entryByKey.get(card.key)
        const node = entry ? nodeFor(card.key, entry.create || entry.update) : undefined
        if (!node) continue
        const index = v.indexByKey.get(card.key) ?? 0
        node.addClass(PINNED_CLASS)
        const top = `${String(cardTop(index, g.cardHeight, g.gap, g.padTop))}px`
        if (node.style.top !== top) node.style.top = top
        ;(index < range.start ? above : below).push(node)
    }
    for (let i = above.length - 1; i >= 0; i--) {
        const node = above[i]
        const next = above[i + 1] ?? v.top
        if (node && node.nextElementSibling !== next) listEl.insertBefore(node, next)
    }
    below.forEach((node, i) => {
        const prev = below[i - 1] ?? v.bottom
        if (node.previousElementSibling !== prev) prev.after(node)
    })

    // In-window cards, in order, between the spacers (React-style cursor).
    const created: HTMLElement[] = []
    let cursor: Element | null = v.top.nextElementSibling
    for (const card of inWindow) {
        const entry = entryByKey.get(card.key)
        if (!entry) continue
        const node = nodeFor(card.key, entry.create || entry.update)
        if (!node) continue
        unpin(node)
        if (entry.create || entry.update) created.push(node)
        if (node === cursor) cursor = cursor.nextElementSibling
        else listEl.insertBefore(node, cursor)
    }
    if (cursor !== v.bottom) listEl.insertBefore(v.bottom, cursor)

    // Screen readers get each card's place in the WHOLE column.
    const setsize = String(v.cards.length)
    for (const key of cardByKey.keys()) {
        const node = listEl.querySelector<HTMLElement>(
            `:scope > .kap-card[data-card-key="${cssEscapeAttr(key)}"]`
        )
        if (!node) continue
        const posinset = String((v.indexByKey.get(key) ?? 0) + 1)
        if (node.getAttribute('aria-posinset') !== posinset) {
            node.setAttribute('aria-posinset', posinset)
        }
        if (node.getAttribute('aria-setsize') !== setsize)
            node.setAttribute('aria-setsize', setsize)
    }

    if (removed.length > 0) v.hooks.onUnmount?.(listEl, removed)
    if (mountedNew.length > 0) v.hooks.onMount?.(listEl, mountedNew)
    return created
}

/**
 * A newly mounted card taller than the board's uniform height (one the
 * measurement could not see) raises the height for the whole board. One
 * read for the whole batch, after every write.
 */
function checkGrowth(created: ReadonlyArray<{ v: VirtualList; nodes: HTMLElement[] }>): void {
    let tallest = 0
    let hostEl: HTMLElement | null = null
    const measured: Array<{ v: VirtualList; el: HTMLElement; height: number }> = []
    for (const { v, nodes } of created) {
        for (const el of nodes) {
            if (!el.isConnected) continue
            const h = el.getBoundingClientRect().height
            measured.push({ v, el, height: h })
            if (h > tallest) {
                tallest = h
                hostEl = v.hostEl
            }
        }
    }
    if (!hostEl || tallest <= 0) return
    const current = readCardHeight(hostEl)
    if (current !== null && tallest <= current + HEIGHT_EPSILON) return
    const cache = heightCacheFor(hostEl, null)
    for (const { v, el, height } of measured) {
        if (height <= (current ?? 0) + HEIGHT_EPSILON) continue
        const key = el.dataset['cardKey']
        if (key !== undefined) {
            rememberHeight(cache, key, el.dataset['cardSig'] ?? '', v.listEl.clientWidth, height)
        }
    }
    growCardHeight(hostEl, publishedCardHeight(tallest))
}

/** Raise the board's uniform card height to `height` (px), keeping every virtual column anchored. */
export function growCardHeight(hostEl: HTMLElement, height: number): void {
    const anchors = captureVirtualAnchors(hostEl)
    hostEl.style.setProperty(CARD_HEIGHT_VAR, `${String(height)}px`)
    restoreVirtualAnchors(hostEl, anchors)
}

/** Each virtual list's scroll position as an anchor card, captured before a height change. */
export type VirtualAnchors = Map<HTMLElement, ScrollAnchor>

/** Capture every virtual list's anchor (call BEFORE the card height changes). */
export function captureVirtualAnchors(hostEl: HTMLElement): VirtualAnchors {
    const anchors: VirtualAnchors = new Map()
    for (const v of virtualListsUnder(hostEl)) {
        if (v.unbounded || v.range === null) continue
        const m = metricsOf(v)
        anchors.set(v.listEl, scrollAnchor(v.listEl.scrollTop, cardHeightOf(v), m.gap, m.padTop))
    }
    return anchors
}

/**
 * Re-window every virtual list under `hostEl` for the current card height,
 * putting each list's anchor card back where it was. Refreshes the cached
 * list metrics (gap, padding), which a resize or a style change can alter.
 */
export function restoreVirtualAnchors(hostEl: HTMLElement, anchors: VirtualAnchors): void {
    const lists = virtualListsUnder(hostEl)
    for (const v of lists) v.metrics = null
    syncLists(
        lists.map((v) => {
            const anchor = anchors.get(v.listEl)
            return anchor ? { v, force: true, heightAnchor: anchor } : { v, force: true }
        })
    )
}

/** Re-window every virtual list under `rootEl` for its current scroll offset. */
export function syncVirtualColumns(rootEl: HTMLElement): void {
    syncLists(virtualListsUnder(rootEl).map((v) => ({ v })))
}

/**
 * Make sure the card `key` has a node, wherever its virtual column is
 * scrolled. With `reveal`, its column scrolls the least needed to show it
 * (then the caller's `scrollIntoView` handles the board and lanes); without,
 * it is mounted pinned at its slot and the viewport stays put. Returns the
 * node, or null when no column holds the card.
 */
export function ensureCardMounted(
    rootEl: HTMLElement,
    key: string,
    reveal: boolean
): HTMLElement | null {
    const selector = `:scope > .kap-card[data-card-key="${cssEscapeAttr(key)}"]`
    for (const v of virtualListsUnder(rootEl)) {
        const index = v.indexByKey.get(key)
        if (index === undefined) continue
        const mounted = v.listEl.querySelector<HTMLElement>(selector)
        if (mounted && !reveal) return mounted
        let scrollTop: number | null = null
        if (reveal && !v.unbounded) {
            const m = metricsOf(v)
            scrollTop = revealScrollTop(index, {
                count: v.cards.length,
                cardHeight: cardHeightOf(v),
                gap: m.gap,
                padTop: m.padTop,
                padBottom: m.padBottom,
                scrollTop: v.listEl.scrollTop,
                viewportHeight: v.viewport ?? v.listEl.clientHeight
            })
        }
        if (scrollTop !== null) syncLists([{ v, force: true, scrollTop }])
        else if (!mounted) syncLists([{ v, force: true, pin: key }])
        return v.listEl.querySelector<HTMLElement>(selector)
    }
    return null
}

/**
 * Tab into a scrolled long column lands on the first mounted card, up to the
 * overscan above the view: send it to the first (Shift+Tab: last) card the
 * user can actually see, and keep the scroll where it was.
 */
function redirectTabFocus(v: VirtualList, e: FocusEvent): void {
    const state = windowStates.get(v.listEl.win)
    const tab = state?.lastTab
    if (!tab || v.unbounded || e.timeStamp - tab.at > TAB_FOCUS_MS) return
    const target = asElement(e.target)
    if (!target || target.parentElement !== v.listEl || !target.hasClass('kap-card')) return
    const from = asElement(e.relatedTarget)
    if (from && v.listEl.contains(from)) return
    const scrollTop = tab.scrolls.get(v.listEl) ?? v.listEl.scrollTop
    const viewport = v.viewport ?? v.listEl.clientHeight
    const inView = (el: HTMLElement): boolean =>
        el.offsetTop >= scrollTop - 0.5 &&
        el.offsetTop + el.offsetHeight <= scrollTop + viewport + 0.5
    if (inView(target)) return
    const visible = Array.from(
        v.listEl.querySelectorAll<HTMLElement>(`:scope > .kap-card:not(.${PINNED_CLASS})`)
    ).filter(inView)
    const next = tab.shift ? visible[visible.length - 1] : visible[0]
    if (v.listEl.scrollTop !== scrollTop) v.listEl.scrollTop = scrollTop
    if (next && next !== target) next.focus({ preventScroll: true })
}

/** Every card key of a column, in order (the model, not the mounted subset), or null when not virtual. */
export function virtualCardKeys(listEl: HTMLElement): string[] | null {
    const v = stateOf(listEl)
    if (!v) return null
    return (v.pending?.cards ?? v.cards).map((c) => c.key)
}

/** A column's card count (model for a virtual list, DOM otherwise). */
export function columnCardCount(listEl: HTMLElement): number {
    const v = stateOf(listEl)
    if (v) return (v.pending?.cards ?? v.cards).length
    return listEl.querySelectorAll(':scope > .kap-card').length
}

/** What the drag-and-drop hit test needs from a virtual list (null when fully rendered). */
export interface VirtualDropGeometry {
    count: number
    cardHeight: number
    gap: number
    padTop: number
    indexOf: (key: string) => number
}

export function virtualDropGeometry(listEl: HTMLElement): VirtualDropGeometry | null {
    const v = stateOf(listEl)
    if (!v) return null
    const m = metricsOf(v)
    return {
        count: v.cards.length,
        cardHeight: cardHeightOf(v),
        gap: m.gap,
        padTop: m.padTop,
        indexOf: (key) => v.indexByKey.get(key) ?? -1
    }
}

/** The height-relevant features of a card (see {@link pickProbeIndices}). */
export function cardHeightFeatures(card: KanbanCard): CardHeightFeatures {
    const d = card.display
    const cd = d.countdown
    let bodyLength = 0
    for (const f of d.fields) bodyLength += f.text.length + (f.label?.length ?? 0)
    const bodyRows =
        d.fields.length +
        (d.budget ? 1 : 0) +
        (cd && (cd.placement === 'chip' || cd.placement === 'footer') ? 1 : 0) +
        (hasAnyRelationship(card.relationships) ? 1 : 0)
    return {
        titleLength: d.title.length,
        hasCover: d.coverUrl !== null,
        bodyRows,
        bodyLength
    }
}

/**
 * Mount the probe cards of every laid-out virtual list (invisible, in the
 * flow, at the list's width) so the equalize pass can measure them. The
 * caller measures and then removes them in the same task.
 */
export function mountHeightProbes(hostEl: HTMLElement): HTMLElement[] {
    const lists = virtualListsUnder(hostEl)
    // READ (widths) before any WRITE.
    const laidOut = lists.filter((v) => v.listEl.clientWidth > 0)
    const probes: HTMLElement[] = []
    for (const v of laidOut) {
        const mounted = new Set(
            Array.from(v.listEl.querySelectorAll<HTMLElement>(':scope > .kap-card')).map(
                (el) => el.dataset['cardKey'] ?? ''
            )
        )
        for (const index of pickProbeIndices(
            v.cards.map((c) => cardHeightFeatures(c)),
            PROBES_PER_FEATURE
        )) {
            const card = v.cards[index]
            if (!card || mounted.has(card.key)) continue
            const node = v.build(card)
            node.addClass(PROBE_CLASS)
            v.listEl.appendChild(node)
            probes.push(node)
        }
    }
    return probes
}

/** 32-bit FNV-1a hash of a string (the height cache stores this, not whole signatures). */
export function hashString(value: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

/**
 * The board's measured-height cache (natural card heights by card key, with
 * a hash of the content signature and the list width they were measured
 * at). Starts over when `epoch` changes; a null epoch reads it as is.
 */
function heightCacheFor(hostEl: HTMLElement, epoch: string | null): HeightCache {
    let cache = heightCaches.get(hostEl)
    if (!cache || (epoch !== null && cache.epoch !== epoch)) {
        cache = { epoch: epoch ?? cache?.epoch ?? '', entries: new Map() }
        heightCaches.set(hostEl, cache)
    }
    return cache
}

function rememberHeight(
    cache: HeightCache,
    key: string,
    signature: string,
    width: number,
    height: number
): void {
    if (height <= 0 || width <= 0) return
    if (cache.entries.size >= HEIGHT_CACHE_LIMIT) cache.entries.clear()
    cache.entries.set(key, { hash: hashString(signature), width, height })
}

/** Forget every measured height of a board (a theme, font or snippet change). */
export function clearHeightCache(hostEl: HTMLElement): void {
    heightCaches.delete(hostEl)
}

/**
 * The height-cache epoch of a board host: everything outside card content
 * that changes card heights. Only the host / root classes that do (compact,
 * cover layout, chip / color / accent style, mobile, embed) count, never
 * transient ones (selecting, dragging, a refused drop), plus the computed
 * font size and the device pixel ratio (zoom).
 */
export function heightEpoch(hostEl: HTMLElement): string {
    const root = hostEl.closest<HTMLElement>('.kap-root')
    const classes = [
        ...Array.from(hostEl.classList),
        ...(root && root !== hostEl ? Array.from(root.classList) : [])
    ]
        .filter((c) => HEIGHT_CLASS_RE.test(c))
        .sort()
    const fontSize = hostEl.win.getComputedStyle(hostEl).fontSize
    return `${classes.join(' ')}|${fontSize}|${String(hostEl.win.devicePixelRatio)}`
}

/**
 * Record the natural heights just measured (cards inside virtual lists only:
 * fully rendered columns are measured whole on every pass anyway) and return
 * the cached heights of cards still on the board, unchanged and at the same
 * list width, that are not mounted now.
 */
export function cachedHeights(
    hostEl: HTMLElement,
    measured: ReadonlyArray<{ el: HTMLElement; height: number }>
): number[] {
    const cache = heightCacheFor(hostEl, heightEpoch(hostEl))
    const widthOf = new Map<HTMLElement, number>()
    const width = (listEl: HTMLElement): number => {
        let w = widthOf.get(listEl)
        if (w === undefined) {
            w = listEl.clientWidth
            widthOf.set(listEl, w)
        }
        return w
    }
    const seen = new Set<string>()
    for (const { el, height } of measured) {
        const listEl = el.parentElement
        if (!listEl || !stateOf(listEl)) continue
        const key = el.dataset['cardKey'] ?? ''
        seen.add(key)
        rememberHeight(cache, key, el.dataset['cardSig'] ?? '', width(listEl), height)
    }
    const out: number[] = []
    const lists = virtualListsUnder(hostEl)
    for (const [key, entry] of cache.entries) {
        if (seen.has(key)) continue
        for (const v of lists) {
            const index = v.indexByKey.get(key)
            const card = index === undefined ? undefined : v.cards[index]
            if (!card) continue
            if (entry.width === width(v.listEl) && entry.hash === hashString(v.signature(card))) {
                out.push(entry.height)
            }
            break
        }
    }
    return out
}
