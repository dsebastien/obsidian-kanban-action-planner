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
 * Mounted on top of the window, never unmounted while it matters: the card
 * being dragged (or lifted by a long press), and the focused card. Outside
 * the window they are positioned absolutely at their exact slot
 * (`.kap-card-pinned`), so a drag or the keyboard focus survives any scroll.
 *
 * Per list state lives in a WeakMap keyed by the card list element, so the
 * stateless board renderer keeps its shape; scrolls and size changes of each
 * list (its own ResizeObserver from the element's own window, popout-safe)
 * re-window it synchronously, before the next paint.
 */

import { hasAnyRelationship } from '../../services/relationships.service'
import { cssEscapeAttr } from '../../utils/css-escape'
import { planReconcile } from './reconcile'
import type { KanbanCard } from './types'
import {
    FALLBACK_CARD_HEIGHT_PX,
    anchoredScrollTop,
    cardTop,
    nextWindow,
    pickProbeIndices,
    revealScrollTop,
    scrollAnchor,
    shouldVirtualize,
    spacerHeights
} from './virtual-window'
import type { CardHeightFeatures, ColumnGeometry, IndexRange, ScrollAnchor } from './virtual-window'

/** CSS custom property holding the board-wide uniform card height. */
export const CARD_HEIGHT_VAR = '--kap-card-height'
/** On a card list while it is virtualized. */
export const VIRTUAL_CLASS = 'kap-column-virtual'
/** The two spacers of a virtual card list. */
const SPACER_CLASS = 'kap-column-spacer'
/** A mounted card outside the window (dragged or focused), positioned at its slot. */
const PINNED_CLASS = 'kap-card-pinned'
/** A card mounted only for the height measurement. */
const PROBE_CLASS = 'kap-card-probe'
/** Probe cards per height feature and virtual column (see {@link pickProbeIndices}). */
const PROBES_PER_FEATURE = 8
/** Height-cache entries kept per board before the cache starts over. */
const HEIGHT_CACHE_LIMIT = 20_000

/** Called with the card nodes a virtual column mounts or unmounts outside a render pass. */
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
    onScroll: () => void
}

interface HeightEntry {
    signature: string
    width: number
    height: number
}

interface HeightCache {
    epoch: string
    entries: Map<string, HeightEntry>
}

const virtualLists = new WeakMap<HTMLElement, VirtualList>()
const heightCaches = new WeakMap<HTMLElement, HeightCache>()
const resizeObservers = new WeakMap<Window, ResizeObserver>()

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

/** The board's current uniform card height (px), or null before the first measurement. */
export function readCardHeight(hostEl: HTMLElement): number | null {
    const value = Number.parseFloat(hostEl.style.getPropertyValue(CARD_HEIGHT_VAR))
    return Number.isFinite(value) && value > 0 ? value : null
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

function geometryOf(v: VirtualList, scrollTop = v.listEl.scrollTop): ColumnGeometry {
    const m = metricsOf(v)
    return {
        count: v.cards.length,
        cardHeight: cardHeightOf(v),
        gap: m.gap,
        padTop: m.padTop,
        scrollTop,
        viewportHeight: v.listEl.clientHeight
    }
}

/** Shared per-window ResizeObserver re-windowing the virtual lists it watches. */
function resizeObserverFor(win: Window): ResizeObserver {
    let observer = resizeObservers.get(win)
    if (!observer) {
        const Observer = (win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver
        const created = new Observer((entries: ResizeObserverEntry[]) => {
            for (const entry of entries) {
                const el = entry.target as HTMLElement
                const v = stateOf(el)
                if (!v || !el.isConnected) {
                    created.unobserve(el)
                    continue
                }
                updateWindow(v)
            }
        })
        resizeObservers.set(win, created)
        observer = created
    }
    return observer
}

/**
 * Render a column's cards into its list: windowed when the column is long
 * enough, else return false and leave the list to the caller's full keyed
 * reconcile (after undoing any previous virtualization of the list).
 */
export function renderVirtualColumn(
    listEl: HTMLElement,
    hostEl: HTMLElement,
    source: ColumnCardsSource
): boolean {
    if (!shouldVirtualize(source.cards.length)) {
        releaseVirtualColumn(listEl)
        return false
    }
    let v = stateOf(listEl)
    if (!v) {
        const top = createDiv({ cls: SPACER_CLASS, attr: { 'aria-hidden': 'true' } })
        const bottom = createDiv({ cls: SPACER_CLASS, attr: { 'aria-hidden': 'true' } })
        listEl.prepend(top)
        listEl.appendChild(bottom)
        listEl.addClass(VIRTUAL_CLASS)
        const onScroll = (): void => {
            const state = stateOf(listEl)
            if (state) updateWindow(state)
        }
        v = {
            ...source,
            listEl,
            hostEl,
            indexByKey: new Map(),
            range: null,
            top,
            bottom,
            metrics: null,
            onScroll
        }
        virtualLists.set(listEl, v)
        listEl.addEventListener('scroll', onScroll, { passive: true })
        resizeObserverFor(listEl.win).observe(listEl)
    }
    v.cards = source.cards
    v.signature = source.signature
    v.build = source.build
    v.hooks = source.hooks
    v.hostEl = hostEl
    v.indexByKey = new Map(source.cards.map((c, i) => [c.key, i]))
    updateWindow(v, { force: true })
    return true
}

/** Undo virtualization of a list (it shrank below the threshold, or is being torn down). */
export function releaseVirtualColumn(listEl: HTMLElement): void {
    const v = stateOf(listEl)
    if (!v) return
    virtualLists.delete(listEl)
    listEl.removeEventListener('scroll', v.onScroll)
    resizeObservers.get(listEl.win)?.unobserve(listEl)
    v.top.remove()
    v.bottom.remove()
    listEl.removeClass(VIRTUAL_CLASS)
    for (const el of Array.from(
        listEl.querySelectorAll<HTMLElement>(`:scope > .${PINNED_CLASS}`)
    )) {
        unpin(el)
    }
}

/** Release every virtual list under `rootEl` (before a full re-render empties it). */
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
    const active = v.listEl.doc.activeElement
    if (active?.instanceOf(HTMLElement) && v.listEl.contains(active)) {
        const cardEl = active.closest<HTMLElement>('.kap-card')
        if (cardEl?.parentElement === v.listEl) pins.add(cardEl.dataset['cardKey'] ?? '')
    }
    pins.delete('')
    return pins
}

interface UpdateOptions {
    /** Reconcile even when the window did not move (the cards changed). */
    force?: boolean
    /** Window for this scroll offset, and set it once the spacers are sized. */
    scrollTop?: number
    /** Also mount this card (pinned at its slot when outside the window). */
    pin?: string
}

/**
 * Re-window one virtual list: compute the window for its scroll offset and,
 * when it moved (or `force`), reconcile the mounted cards and spacers.
 */
function updateWindow(v: VirtualList, options: UpdateOptions = {}): void {
    const g = geometryOf(v, options.scrollTop ?? v.listEl.scrollTop)
    // A forced pass (the cards changed) keeps the mounted window while it
    // still covers the view, so a patch does not churn nodes that are right.
    const range = nextWindow(options.scrollTop === undefined ? v.range : null, g)
    const moved = v.range === null || range.start !== v.range.start || range.end !== v.range.end
    if (!moved && !options.force && options.pin === undefined) return
    v.range = range
    // Moving a node (a pinned card re-entering the flow) blurs it: keep focus.
    const active = v.listEl.doc.activeElement
    const created = reconcileWindow(v, range, pinnedKeys(v, options.pin ?? null), g)
    if (
        active?.instanceOf(HTMLElement) &&
        active !== v.listEl.doc.activeElement &&
        active.isConnected &&
        v.listEl.contains(active)
    ) {
        active.focus({ preventScroll: true })
    }
    const spacers = spacerHeights(v.cards.length, range, g.cardHeight, g.gap)
    setSpacer(v.top, spacers.top)
    setSpacer(v.bottom, spacers.bottom)
    if (options.scrollTop !== undefined && v.listEl.scrollTop !== options.scrollTop) {
        v.listEl.scrollTop = options.scrollTop
    }
    if (created.length > 0) checkGrowth(v, created)
}

function setSpacer(el: HTMLElement, height: number): void {
    el.toggleClass('kap-hidden', height <= 0)
    el.style.height = `${String(Math.max(0, height))}px`
}

/**
 * Keyed reconcile of the mounted window (plus pinned cards): unchanged cards
 * keep their node (focus, hover, an in-flight drag), changed ones are
 * rebuilt, cards leaving the window are removed. Returns the in-window nodes
 * it created.
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
    const desiredCards = [...inWindow, ...pinnedOutside]
    const cardByKey = new Map(desiredCards.map((c) => [c.key, c]))
    const plan = planReconcile(
        existing,
        desiredCards.map((c) => ({ key: c.key, signature: v.signature(c) }))
    )
    const removed: HTMLElement[] = []
    for (const key of plan.remove) {
        const node = nodeByKey.get(key)
        if (!node) continue
        node.remove()
        removed.push(node)
    }

    const created: HTMLElement[] = []
    const mountedNew: HTMLElement[] = []
    const pinnedNodes: Array<{ node: HTMLElement; key: string }> = []
    // In-window cards, in order, between the spacers (React-style cursor).
    // Anything the cursor never reaches (a card that just left the window
    // but is pinned) ends up after the bottom spacer.
    let cursor: Element | null = v.top.nextElementSibling
    for (const entry of plan.ordered) {
        const card = cardByKey.get(entry.key)
        if (!card) continue
        let node: HTMLElement | undefined
        if (entry.create || entry.update) {
            node = v.build(card)
            mountedNew.push(node)
        } else {
            node = nodeByKey.get(entry.key)
        }
        if (!node) continue
        if (!desiredKeys.has(entry.key)) {
            pinnedNodes.push({ node, key: entry.key })
            continue
        }
        unpin(node)
        if (entry.create || entry.update) created.push(node)
        if (node === cursor) cursor = cursor.nextElementSibling
        else listEl.insertBefore(node, cursor)
    }
    if (cursor !== v.bottom) listEl.insertBefore(v.bottom, cursor)
    // Pinned cards outside the window: out of the flow, at the exact offset
    // they would have in a full render (a drag or the focus survives).
    for (const { node, key } of pinnedNodes) {
        node.addClass(PINNED_CLASS)
        const index = v.indexByKey.get(key) ?? 0
        node.style.top = `${String(cardTop(index, g.cardHeight, g.gap, g.padTop))}px`
        if (node.parentElement !== listEl) v.bottom.after(node)
    }
    if (removed.length > 0) v.hooks.onUnmount?.(listEl, removed)
    if (mountedNew.length > 0) v.hooks.onMount?.(listEl, mountedNew)
    return created
}

/**
 * A newly mounted card taller than the board's uniform height (one the
 * measurement could not see) raises the height for the whole board. Reading
 * the new nodes' height lays out only what the next paint lays out anyway.
 */
function checkGrowth(v: VirtualList, created: HTMLElement[]): void {
    const current = readCardHeight(v.hostEl)
    let max = 0
    for (const el of created) {
        if (!el.isConnected) continue
        const h = el.offsetHeight
        if (h > max) max = h
    }
    if (max <= 0) return
    if (current !== null && max <= current + 0.5) return
    const width = v.listEl.clientWidth
    const cache = heightCacheFor(v.hostEl, null)
    for (const el of created) {
        const key = el.dataset['cardKey']
        if (key !== undefined && el.offsetHeight === max) {
            rememberHeight(cache, key, el.dataset['cardSig'] ?? '', width, max)
        }
    }
    growCardHeight(v.hostEl, max)
}

/** Raise the board's uniform card height to `height` (px), keeping every virtual column anchored. */
export function growCardHeight(hostEl: HTMLElement, height: number): void {
    withAnchoredColumns(hostEl, () => {
        hostEl.style.setProperty(CARD_HEIGHT_VAR, `${String(height)}px`)
    })
}

/** Each virtual list's scroll position as an anchor card, captured before a height change. */
export type VirtualAnchors = Map<HTMLElement, ScrollAnchor>

/** Capture every virtual list's anchor (call BEFORE the card height changes). */
export function captureVirtualAnchors(hostEl: HTMLElement): VirtualAnchors {
    const anchors: VirtualAnchors = new Map()
    for (const v of virtualListsUnder(hostEl)) {
        const g = geometryOf(v)
        anchors.set(v.listEl, scrollAnchor(g.scrollTop, g.cardHeight, g.gap, g.padTop))
    }
    return anchors
}

/**
 * Re-window every virtual list under `hostEl` for the current card height,
 * putting each list's anchor card back where it was. Refreshes the cached
 * list metrics (gap, padding), which a resize or a style change can alter.
 */
export function restoreVirtualAnchors(hostEl: HTMLElement, anchors: VirtualAnchors): void {
    for (const v of virtualListsUnder(hostEl)) {
        v.metrics = null
        const anchor = anchors.get(v.listEl)
        if (!anchor) {
            updateWindow(v, { force: true })
            continue
        }
        const g = geometryOf(v)
        updateWindow(v, {
            force: true,
            scrollTop: anchoredScrollTop(anchor, g.cardHeight, g.gap, g.padTop)
        })
    }
}

function withAnchoredColumns(hostEl: HTMLElement, change: () => void): void {
    const anchors = captureVirtualAnchors(hostEl)
    change()
    restoreVirtualAnchors(hostEl, anchors)
}

/** Re-window every virtual list under `rootEl` for its current scroll offset. */
export function syncVirtualColumns(rootEl: HTMLElement): void {
    for (const v of virtualListsUnder(rootEl)) updateWindow(v)
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
        const g = geometryOf(v)
        const scrollTop = reveal ? revealScrollTop(index, g) : null
        if (scrollTop !== null) updateWindow(v, { force: true, scrollTop })
        else if (!mounted) updateWindow(v, { force: true, pin: key })
        return v.listEl.querySelector<HTMLElement>(selector)
    }
    return null
}

/** Every card key of a column, in order (the model, not the mounted subset), or null when not virtual. */
export function virtualCardKeys(listEl: HTMLElement): string[] | null {
    const v = stateOf(listEl)
    return v ? v.cards.map((c) => c.key) : null
}

/** A column's card count (model for a virtual list, DOM otherwise). */
export function columnCardCount(listEl: HTMLElement): number {
    const v = stateOf(listEl)
    return v ? v.cards.length : listEl.querySelectorAll(':scope > .kap-card').length
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
    const g = geometryOf(v)
    return {
        count: g.count,
        cardHeight: g.cardHeight,
        gap: g.gap,
        padTop: g.padTop,
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
    const probes: HTMLElement[] = []
    for (const v of virtualListsUnder(hostEl)) {
        if (v.listEl.clientWidth === 0) continue
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

/**
 * The board's measured-height cache (natural card heights by card key, with
 * the content signature and list width they were measured at). Starts over
 * when `epoch` (the board's and root's classes: compact mode, cover layout,
 * chip style) changes; a null epoch reads the cache as is.
 */
function heightCacheFor(hostEl: HTMLElement, epoch: string | null): HeightCache {
    let cache = heightCaches.get(hostEl)
    if (!cache || (epoch !== null && cache.epoch !== epoch)) {
        cache = { epoch: epoch ?? '', entries: new Map() }
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
    cache.entries.set(key, { signature, width, height })
}

/** The cache epoch of a board host: everything outside card content that changes card heights. */
export function heightEpoch(hostEl: HTMLElement): string {
    const root = hostEl.closest('.kap-root')
    return `${hostEl.className}|${root?.className ?? ''}`
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
    const seen = new Set<string>()
    for (const { el, height } of measured) {
        const listEl = el.parentElement
        if (!listEl || !stateOf(listEl)) continue
        let width = widthOf.get(listEl)
        if (width === undefined) {
            width = listEl.clientWidth
            widthOf.set(listEl, width)
        }
        const key = el.dataset['cardKey'] ?? ''
        seen.add(key)
        rememberHeight(cache, key, el.dataset['cardSig'] ?? '', width, height)
    }
    const out: number[] = []
    const lists = virtualListsUnder(hostEl)
    for (const [key, entry] of cache.entries) {
        if (seen.has(key)) continue
        for (const v of lists) {
            const index = v.indexByKey.get(key)
            const card = index === undefined ? undefined : v.cards[index]
            if (!card) continue
            let width = widthOf.get(v.listEl)
            if (width === undefined) {
                width = v.listEl.clientWidth
                widthOf.set(v.listEl, width)
            }
            if (entry.width === width && entry.signature === v.signature(card)) {
                out.push(entry.height)
            }
            break
        }
    }
    return out
}
