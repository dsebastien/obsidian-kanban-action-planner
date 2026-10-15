/**
 * DOM-side coverage for the column virtualizer (issue #111), on a small fake
 * DOM with a fixed-pitch layout model: a list lays its in-flow children out
 * as a flex column (padding, gap), a card is max(natural height, the board's
 * `--kap-card-height`), a spacer is its style height, a pinned card sits at
 * its style top. Enough to check the windowing, the reconcile, pinning, the
 * threshold, the height cache, growth and scroll anchoring end to end.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import {
    CARD_HEIGHT_VAR,
    PINNED_CLASS,
    VIRTUAL_CLASS,
    cachedHeights,
    captureVirtualAnchors,
    clearHeightCache,
    columnCardCount,
    ensureCardMounted,
    flushVirtualColumns,
    hashString,
    heightEpoch,
    publishedCardHeight,
    readCardHeight,
    releaseVirtualColumns,
    renderVirtualColumn,
    restoreVirtualAnchors,
    syncVirtualColumns,
    virtualCardKeys,
    virtualDropGeometry
} from './board-virtualizer'
import { LazyImages } from './lazy-images'
import type { KanbanCard } from './types'
import { cardTop } from './virtual-window'

// ── Fake DOM ─────────────────────────────────────────────────

const PAD = 8
const GAP = 8

type Listener = (e: FakeEvent) => void

interface FakeEvent {
    type: string
    target?: unknown
    relatedTarget?: unknown
    timeStamp: number
    key?: string
    shiftKey?: boolean
}

class FakeClassList {
    private set = new Set<string>()
    add(...c: string[]): void {
        for (const x of c) this.set.add(x)
    }
    remove(...c: string[]): void {
        for (const x of c) this.set.delete(x)
    }
    contains(c: string): boolean {
        return this.set.has(c)
    }
    toggle(c: string, force?: boolean): boolean {
        const on = force ?? !this.set.has(c)
        if (on) this.set.add(c)
        else this.set.delete(c)
        return on
    }
    [Symbol.iterator](): Iterator<string> {
        return this.set[Symbol.iterator]()
    }
}

class FakeStyle {
    private props = new Map<string, string>()
    get height(): string {
        return this.props.get('height') ?? ''
    }
    set height(v: string) {
        this.props.set('height', v)
    }
    get top(): string {
        return this.props.get('top') ?? ''
    }
    set top(v: string) {
        this.props.set('top', v)
    }
    setProperty(k: string, v: string): void {
        this.props.set(k, v)
    }
    getPropertyValue(k: string): string {
        return this.props.get(k) ?? ''
    }
    removeProperty(k: string): void {
        this.props.delete(k)
    }
}

interface Selector {
    child: boolean
    tag: string | null
    classes: string[]
    not: string[]
    attrs: Array<{ name: string; value: string | null }>
}

function parseSelector(text: string): Selector[] {
    return text.split(',').map((raw) => {
        let s = raw.trim()
        const child = s.startsWith(':scope >')
        if (child) s = s.slice(':scope >'.length).trim()
        const sel: Selector = { child, tag: null, classes: [], not: [], attrs: [] }
        const tag = /^[a-z]+/.exec(s)
        if (tag) {
            sel.tag = tag[0]
            s = s.slice(tag[0].length)
        }
        for (const m of s.matchAll(/:not\(\.([\w-]+)\)/g)) sel.not.push(m[1] ?? '')
        s = s.replace(/:not\(\.[\w-]+\)/g, '')
        for (const m of s.matchAll(/\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]/g)) {
            sel.attrs.push({ name: m[1] ?? '', value: m[2] === undefined ? null : m[2] })
        }
        s = s.replace(/\[[^\]]*\]/g, '')
        for (const m of s.matchAll(/\.([\w-]+)/g)) sel.classes.push(m[1] ?? '')
        return sel
    })
}

let focused: FakeEl | null = null

/** Focus `el`, firing a bubbling focusin (relatedTarget: the previous focus). */
function focusEl(el: FakeEl): void {
    const prev = focused
    focused = el
    const e = { type: 'focusin', target: el, relatedTarget: prev, timeStamp: clock }
    for (const n of lineage(el)) n.dispatch(e)
}

/** `el` and its ancestors, innermost first. */
function lineage(el: FakeEl): FakeEl[] {
    const out: FakeEl[] = []
    for (let n: FakeEl | null = el; n; n = n.parent) out.push(n)
    return out
}
let clock = 0

class FakeWindow {
    innerHeight = 1000
    devicePixelRatio = 1
    resizeObservers: FakeResizeObserver[] = []
    intersectionObservers: FakeIntersectionObserver[] = []
    readonly ResizeObserver = observerClass(FakeResizeObserver, this.resizeObservers)
    readonly IntersectionObserver = observerClass(
        FakeIntersectionObserver,
        this.intersectionObservers
    )
    getComputedStyle(el: FakeEl): Record<string, string> {
        return {
            rowGap: `${String(GAP)}px`,
            paddingTop: `${String(PAD)}px`,
            paddingBottom: `${String(PAD)}px`,
            overflowY: el.overflowY,
            fontSize: el.fontSize
        }
    }
}

/** A constructor that records every instance it makes in `registry`. */
function observerClass<A extends unknown[], T>(
    Base: new (...args: A) => T,
    registry: T[]
): new (...args: A) => T {
    return function Recorded(...args: A): T {
        const made = new Base(...args)
        registry.push(made)
        return made
    } as never
}

class FakeResizeObserver {
    targets = new Set<FakeEl>()
    constructor(readonly cb: (entries: Array<{ target: FakeEl }>) => void) {}
    observe(el: FakeEl): void {
        this.targets.add(el)
    }
    unobserve(el: FakeEl): void {
        this.targets.delete(el)
    }
    /** Fire the callback for `el` (a size change). */
    fire(el: FakeEl): void {
        if (this.targets.has(el)) this.cb([{ target: el }])
    }
}

class FakeIntersectionObserver {
    targets = new Set<FakeEl>()
    constructor(
        readonly cb: unknown,
        readonly options: unknown
    ) {}
    observe(el: FakeEl): void {
        this.targets.add(el)
    }
    unobserve(el: FakeEl): void {
        this.targets.delete(el)
    }
    disconnect(): void {
        this.targets.clear()
    }
}

class FakeDoc {
    listeners = new Map<string, Listener[]>()
    body: FakeEl
    constructor(readonly win: FakeWindow) {
        this.body = new FakeEl('body', this)
        this.body.connected = true
    }
    get activeElement(): FakeEl | null {
        return focused
    }
    addEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
    }
    querySelectorAll(sel: string): FakeEl[] {
        return this.body.querySelectorAll(sel)
    }
    dispatch(e: FakeEvent): void {
        for (const fn of this.listeners.get(e.type) ?? []) fn(e)
    }
}

class FakeEl {
    children: FakeEl[] = []
    parent: FakeEl | null = null
    classList = new FakeClassList()
    dataset: Record<string, string | undefined> = {}
    style = new FakeStyle()
    attrs = new Map<string, string>()
    listeners = new Map<string, Listener[]>()
    connected = false
    /** Layout knobs. */
    fixedHeight: number | null = null
    fixedWidth = 300
    natural = 70
    overflowY = 'visible'
    fontSize = '16px'
    private scroll = 0

    constructor(
        readonly tag: string,
        readonly doc: FakeDoc
    ) {}

    get win(): FakeWindow {
        return this.doc.win
    }
    setCssProps(props: Record<string, string>): void {
        for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v)
    }
    get parentElement(): FakeEl | null {
        return this.parent
    }
    get isConnected(): boolean {
        return lineage(this).some((n) => n.connected)
    }
    get nextElementSibling(): FakeEl | null {
        const p = this.parent
        if (!p) return null
        return p.children[p.children.indexOf(this) + 1] ?? null
    }
    get previousElementSibling(): FakeEl | null {
        const p = this.parent
        if (!p) return null
        return p.children[p.children.indexOf(this) - 1] ?? null
    }
    get firstElementChild(): FakeEl | null {
        return this.children[0] ?? null
    }
    // Obsidian helpers
    addClass(...c: string[]): void {
        this.classList.add(...c)
    }
    removeClass(...c: string[]): void {
        this.classList.remove(...c)
    }
    hasClass(c: string): boolean {
        return this.classList.contains(c)
    }
    toggleClass(c: string, on: boolean): void {
        this.classList.toggle(c, on)
    }
    createDiv(o: { cls?: string; attr?: Record<string, string> } = {}): FakeEl {
        const el = new FakeEl('div', this.doc)
        if (o.cls) el.addClass(...o.cls.split(' '))
        for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v)
        this.appendChild(el)
        return el
    }
    setAttribute(k: string, v: string): void {
        this.attrs.set(k, v)
    }
    getAttribute(k: string): string | null {
        return this.attrs.get(k) ?? null
    }
    removeAttribute(k: string): void {
        this.attrs.delete(k)
    }
    // Tree
    private detach(): void {
        if (!this.parent) return
        const p = this.parent
        p.children.splice(p.children.indexOf(this), 1)
        this.parent = null
        if (focused && (focused === this || this.contains(focused))) focused = null
    }
    appendChild(el: FakeEl): FakeEl {
        el.detach()
        el.parent = this
        this.children.push(el)
        return el
    }
    prepend(el: FakeEl): void {
        el.detach()
        el.parent = this
        this.children.unshift(el)
    }
    insertBefore(el: FakeEl, ref: FakeEl | null): FakeEl {
        if (ref === null) return this.appendChild(el)
        el.detach()
        el.parent = this
        this.children.splice(this.children.indexOf(ref), 0, el)
        return el
    }
    before(el: FakeEl): void {
        this.parent?.insertBefore(el, this)
    }
    after(el: FakeEl): void {
        this.parent?.insertBefore(el, this.nextElementSibling)
    }
    remove(): void {
        this.detach()
    }
    contains(el: FakeEl | null): boolean {
        for (let n = el; n; n = n.parent) if (n === this) return true
        return false
    }
    matches(sel: Selector): boolean {
        if (sel.tag && sel.tag !== this.tag) return false
        if (!sel.classes.every((c) => this.hasClass(c))) return false
        if (sel.not.some((c) => this.hasClass(c))) return false
        return sel.attrs.every(({ name, value }) => {
            if (name.startsWith('data-')) {
                const key = name.slice(5).replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase())
                const v = this.dataset[key]
                return v !== undefined && (value === null || v === value.replace(/\\(.)/g, '$1'))
            }
            const v = this.attrs.get(name)
            return v !== undefined && (value === null || v === value)
        })
    }
    closest(text: string): FakeEl | null {
        const sels = parseSelector(text)
        return lineage(this).find((n) => sels.some((s) => n.matches(s))) ?? null
    }
    querySelectorAll(text: string): FakeEl[] {
        const sels = parseSelector(text)
        const out: FakeEl[] = []
        const walk = (el: FakeEl, depth: number): void => {
            for (const c of el.children) {
                if (sels.some((s) => (!s.child || depth === 0) && c.matches(s))) out.push(c)
                walk(c, depth + 1)
            }
        }
        walk(this, 0)
        return out
    }
    querySelector(text: string): FakeEl | null {
        return this.querySelectorAll(text)[0] ?? null
    }
    addEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
    }
    removeEventListener(type: string, fn: Listener): void {
        this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter((f) => f !== fn)
        )
    }
    dispatch(e: FakeEvent): void {
        for (const fn of this.listeners.get(e.type) ?? []) fn(e)
    }
    focus(): void {
        focusEl(this)
    }
    // Layout
    private hostHeightVar(): number {
        for (let n = this.parent; n; n = n.parent) {
            const v = Number.parseFloat(n.style.getPropertyValue(CARD_HEIGHT_VAR))
            if (Number.isFinite(v)) return v
        }
        return 44
    }
    get ownHeight(): number {
        if (this.hasClass('kap-hidden')) return 0
        if (this.fixedHeight !== null) return this.fixedHeight
        if (this.hasClass('kap-card')) return Math.max(this.natural, this.hostHeightVar())
        if (this.hasClass('kap-column-spacer')) return Number.parseFloat(this.style.height) || 0
        return this.contentHeight
    }
    private inFlow(): FakeEl[] {
        return this.children.filter((c) => !c.hasClass('kap-hidden') && !c.hasClass(PINNED_CLASS))
    }
    get contentHeight(): number {
        const flow = this.inFlow()
        let y = PAD
        for (const c of flow) y += c.ownHeight + GAP
        return flow.length > 0 ? y - GAP + PAD : 2 * PAD
    }
    get offsetTop(): number {
        if (this.hasClass(PINNED_CLASS)) return Number.parseFloat(this.style.top) || 0
        const p = this.parent
        if (!p) return 0
        let y = PAD
        for (const c of p.inFlow()) {
            if (c === this) return y
            y += c.ownHeight + GAP
        }
        return y
    }
    get offsetHeight(): number {
        return Math.round(this.ownHeight)
    }
    get clientHeight(): number {
        if (!this.isConnected || this.closest('.kap-column-collapsed')) return 0
        return this.fixedHeight ?? this.contentHeight
    }
    get clientWidth(): number {
        return this.isConnected ? this.fixedWidth : 0
    }
    get scrollHeight(): number {
        return Math.max(this.contentHeight, this.clientHeight)
    }
    get scrollTop(): number {
        return this.scroll
    }
    set scrollTop(v: number) {
        this.scroll = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight))
    }
    getBoundingClientRect(): { top: number; bottom: number; height: number; width: number } {
        const p = this.parent
        const top = p ? p.getBoundingClientRect().top + this.offsetTop - p.scrollTop : 0
        return { top, bottom: top + this.ownHeight, height: this.ownHeight, width: this.fixedWidth }
    }
}

/** Hand a fake element to code typed for real ones. */
function el(f: FakeEl): HTMLElement {
    return f as never
}

// ── Fixtures ─────────────────────────────────────────────────

function card(key: string): KanbanCard {
    return {
        key,
        title: key,
        statusValue: 'todo',
        order: null,
        display: {
            title: key,
            fields: [],
            coverUrl: null,
            cardColor: null,
            accentColor: null,
            wrap: false,
            dueState: 'none',
            countdown: null,
            budget: null
        },
        relationships: { blocked_by: [], parent: [], child: [], sibling: [] },
        contexts: [],
        deferred: false
    } as never
}

const keys = (n: number, prefix = 'c'): string[] =>
    Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`)

interface Board {
    win: FakeWindow
    doc: FakeDoc
    host: FakeEl
    list: FakeEl
    built: string[]
    mounted: string[]
    unmounted: string[]
    naturals: Map<string, number>
    render: (cardKeys: string[]) => void
    ro: () => FakeResizeObserver
}

function board(viewport = 500): Board {
    const win = new FakeWindow()
    const doc = new FakeDoc(win)
    const root = doc.body.createDiv({ cls: 'kap-root' })
    const host = root.createDiv({ cls: 'kap-board-host' })
    const column = host.createDiv({ cls: 'kap-column' })
    const list = column.createDiv({ cls: 'kap-column-cards' })
    list.fixedHeight = viewport
    const b: Board = {
        win,
        doc,
        host,
        list,
        built: [],
        mounted: [],
        unmounted: [],
        naturals: new Map(),
        render: (cardKeys) => {
            const cards = cardKeys.map(card)
            if (
                !renderVirtualColumn(el(list), el(host), {
                    cards,
                    signature: (c) => `sig:${c.key}`,
                    build: (c) => {
                        b.built.push(c.key)
                        const node = new FakeEl('div', doc)
                        node.addClass('kap-card')
                        node.dataset['cardKey'] = c.key
                        node.dataset['cardSig'] = `sig:${c.key}`
                        node.natural = b.naturals.get(c.key) ?? 70
                        return el(node)
                    },
                    hooks: {
                        onMount: (_l, nodes) => b.mounted.push(...nodes.map(keyOf)),
                        onUnmount: (_l, nodes) => b.unmounted.push(...nodes.map(keyOf))
                    }
                })
            ) {
                // Full render (below the threshold): every card, like the renderer.
                for (const c of [...list.children]) if (c.hasClass('kap-card')) c.remove()
                for (const c of cards) {
                    const node = list.createDiv({ cls: 'kap-card' })
                    node.dataset['cardKey'] = c.key
                }
            }
            flushVirtualColumns(el(host))
        },
        ro: () => {
            const ro = win.resizeObservers[0]
            if (!ro) throw new Error('no ResizeObserver')
            return ro
        }
    }
    host.setCssProps({ [CARD_HEIGHT_VAR]: '76px' })
    return b
}

function keyOf(node: HTMLElement): string {
    return node.dataset['cardKey'] ?? ''
}

/** The mounted card keys in DOM order (pinned included), and their in-flow subset. */
function mountedKeys(list: FakeEl): string[] {
    return list.children
        .filter((c) => c.hasClass('kap-card'))
        .map((c) => c.dataset['cardKey'] ?? '')
}

function scrollTo(b: Board, top: number): void {
    b.list.scrollTop = top
    b.list.dispatch({ type: 'scroll', timeStamp: clock })
}

/** Every mounted in-flow card sits exactly at its full-render slot. */
function misplaced(b: Board, all: string[]): string[] {
    const h = readCardHeight(el(b.host)) ?? 44
    return b.list.children
        .filter((c) => c.hasClass('kap-card'))
        .filter(
            (c) =>
                Math.abs(
                    c.offsetTop - cardTop(all.indexOf(c.dataset['cardKey'] ?? ''), h, GAP, PAD)
                ) > 0.01
        )
        .map((c) => c.dataset['cardKey'] ?? '')
}

/** The cards intersecting the viewport, by geometry. */
function visible(b: Board): string[] {
    const top = b.list.scrollTop
    const bottom = top + b.list.clientHeight
    return b.list.children
        .filter((c) => c.hasClass('kap-card') && !c.hasClass(PINNED_CLASS))
        .filter((c) => c.offsetTop + c.ownHeight > top && c.offsetTop < bottom)
        .map((c) => c.dataset['cardKey'] ?? '')
}

beforeEach(() => {
    focused = null
    clock = 0
})

// ── Tests ────────────────────────────────────────────────────

describe('windowing', () => {
    test('a long column mounts a window, with the full scroll extent', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        expect(b.list.hasClass(VIRTUAL_CLASS)).toBe(true)
        const mounted = mountedKeys(b.list)
        expect(mounted.length).toBeGreaterThan(5)
        expect(mounted.length).toBeLessThan(40)
        expect(b.list.scrollHeight).toBe(PAD + 1000 * 84 - GAP + PAD)
        expect(misplaced(b, all)).toEqual([])
    })

    test('scrolling remounts with exact positions and the viewport always covered', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        for (const top of [300, 700, 5000, 40_000, 83_000, 10, 60_000]) {
            scrollTo(b, top)
            expect(misplaced(b, all)).toEqual([])
            const vis = visible(b)
            const first = Math.max(0, Math.floor((top - PAD - 76) / 84) + 1)
            expect(vis[0]).toBe(all[first])
            expect(vis.length).toBeGreaterThanOrEqual(Math.floor(500 / 84))
        }
    })

    test('a small scroll inside the window touches no node', () => {
        const b = board()
        b.render(keys(1000))
        scrollTo(b, 5000)
        const before = b.built.length
        scrollTo(b, 5100)
        expect(b.built.length).toBe(before)
    })

    test('mount / unmount hooks follow the window (lazy covers, selection)', () => {
        const b = board()
        b.render(keys(1000))
        b.mounted.length = 0
        scrollTo(b, 50_000)
        expect(b.mounted.length).toBeGreaterThan(0)
        expect(b.unmounted.length).toBeGreaterThan(0)
    })

    test('aria-posinset / aria-setsize give each card its place in the whole column', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        scrollTo(b, 30_000)
        for (const c of b.list.children.filter((x) => x.hasClass('kap-card'))) {
            expect(c.getAttribute('aria-setsize')).toBe('1000')
            expect(c.getAttribute('aria-posinset')).toBe(
                String(all.indexOf(c.dataset['cardKey'] ?? '') + 1)
            )
        }
    })
})

describe('threshold', () => {
    test('below 100 cards a column renders in full; at 100 it virtualizes', () => {
        const b = board()
        b.render(keys(99))
        expect(b.list.hasClass(VIRTUAL_CLASS)).toBe(false)
        expect(mountedKeys(b.list).length).toBe(99)
        b.render(keys(100))
        expect(b.list.hasClass(VIRTUAL_CLASS)).toBe(true)
        expect(mountedKeys(b.list).length).toBeLessThan(100)
    })

    test('hysteresis: stays virtual down to 90 cards, full below', () => {
        const b = board()
        b.render(keys(120))
        b.render(keys(95))
        expect(b.list.hasClass(VIRTUAL_CLASS)).toBe(true)
        b.render(keys(89))
        expect(b.list.hasClass(VIRTUAL_CLASS)).toBe(false)
        expect(b.list.querySelectorAll('.kap-column-spacer').length).toBe(0)
        expect(b.list.querySelectorAll(`.${PINNED_CLASS}`).length).toBe(0)
    })

    test('columnCardCount and virtualCardKeys read the model, not the mounted subset', () => {
        const b = board()
        const all = keys(500)
        b.render(all)
        expect(columnCardCount(el(b.list))).toBe(500)
        expect(virtualCardKeys(el(b.list))).toEqual(all)
        const small = board()
        small.render(keys(12))
        expect(columnCardCount(el(small.list))).toBe(12)
        expect(virtualCardKeys(el(small.list))).toBeNull()
    })
})

describe('anchoring: inserts and removals above the view (review finding 1)', () => {
    test('a card removed above the view leaves the visible cards in place', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        scrollTo(b, cardTop(300, 76, GAP, PAD) + 20)
        const before = visible(b)
        b.render(all.filter((k) => k !== 'c5'))
        expect(visible(b)).toEqual(before)
    })

    test('a card inserted above the view leaves the visible cards in place', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        scrollTo(b, cardTop(300, 76, GAP, PAD))
        const before = visible(b)
        b.render(['new', ...all])
        expect(visible(b)).toEqual(before)
    })

    test('a drag from card 5 to slot 210 while looking there keeps the view', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        scrollTo(b, cardTop(205, 76, GAP, PAD))
        const before = visible(b)
        const moved = all.filter((k) => k !== 'c5')
        moved.splice(210, 0, 'c5')
        b.render(moved)
        const after = visible(b)
        // The same cards stay on screen, at the same place; c5 lands at its slot.
        expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, before.length - 1))
        const c5 = b.list.children.find((c) => c.dataset['cardKey'] === 'c5')
        expect(c5?.offsetTop).toBe(cardTop(210, 76, GAP, PAD))
    })

    test('at the very top the list stays at the top', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        b.render(['new', ...all])
        expect(b.list.scrollTop).toBe(0)
        expect(visible(b)[0]).toBe('new')
    })
})

describe('pinning', () => {
    test('a focused card stays mounted at its slot when scrolled away, keeps focus, and returns', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        const node = b.list.children.find((c) => c.dataset['cardKey'] === 'c3')
        node?.focus()
        scrollTo(b, 50_000)
        expect(node?.isConnected).toBe(true)
        expect(node?.hasClass(PINNED_CLASS)).toBe(true)
        expect(node?.offsetTop).toBe(cardTop(3, 76, GAP, PAD))
        // Pinned ABOVE the window: before the top spacer, so Tab order = column order.
        const idx = b.list.children.indexOf(node ?? b.list)
        const topSpacer = b.list.children.findIndex((c) => c.hasClass('kap-column-spacer'))
        expect(idx).toBeLessThan(topSpacer)
        scrollTo(b, 0)
        expect(node?.hasClass(PINNED_CLASS)).toBe(false)
        expect(focused).toBe(node ?? null)
        expect(misplaced(b, all)).toEqual([])
    })

    test('a pinned card below the window goes after the bottom spacer', () => {
        const b = board()
        b.render(keys(1000))
        scrollTo(b, 60_000)
        const node = b.list.children.find(
            (c) => c.hasClass('kap-card') && !c.hasClass(PINNED_CLASS)
        )
        node?.addClass('kap-card-dragging')
        scrollTo(b, 0)
        const spacers = b.list.children.filter((c) => c.hasClass('kap-column-spacer'))
        const bottom = spacers[1]
        expect(node?.hasClass(PINNED_CLASS)).toBe(true)
        expect(
            bottom && node ? b.list.children.indexOf(node) > b.list.children.indexOf(bottom) : false
        ).toBe(true)
    })

    test('leaving the window with a focused card does not rebuild the window', () => {
        const b = board()
        b.render(keys(1000))
        scrollTo(b, 5000)
        const node = b.list.children.find(
            (c) => c.hasClass('kap-card') && !c.hasClass(PINNED_CLASS)
        )
        node?.focus()
        const built = b.built.length
        scrollTo(b, 5000 + 1500)
        // Only the newly entering cards were built, nothing re-created.
        expect(b.built.length - built).toBeLessThan(25)
        expect(node?.isConnected).toBe(true)
    })

    test('ensureCardMounted reveals a far card, or pins it without moving the view', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        const revealed = ensureCardMounted(el(b.host), 'c700', true)
        expect(revealed?.dataset['cardKey']).toBe('c700')
        expect(visible(b)).toContain('c700')
        scrollTo(b, 100)
        const pinned = ensureCardMounted(el(b.host), 'c500', false)
        expect(pinned?.dataset['cardKey']).toBe('c500')
        expect(b.list.scrollTop).toBe(100)
        expect(ensureCardMounted(el(b.host), 'nope', true)).toBeNull()
    })
})

describe('hidden leaf and collapse (review finding 2)', () => {
    test('a 0-height tick keeps the mounted cards; the column keeps its window', () => {
        const b = board()
        b.render(keys(1000))
        scrollTo(b, 20_000)
        const before = mountedKeys(b.list)
        b.list.fixedHeight = 0
        b.ro().fire(b.list)
        expect(mountedKeys(b.list)).toEqual(before)
        b.list.fixedHeight = 500
        b.ro().fire(b.list)
        expect(mountedKeys(b.list)).toEqual(before)
    })

    test('a collapsed column mounts nothing', () => {
        const b = board()
        b.render(keys(1000))
        b.list.parent?.addClass('kap-column-collapsed')
        b.render(keys(1000))
        expect(mountedKeys(b.list)).toEqual([])
    })
})

describe('height: fractional, growth, cache (review findings 3 and 7)', () => {
    test('a fractional natural height publishes the next whole pixel', () => {
        expect(publishedCardHeight(76.4)).toBe(77)
        expect(publishedCardHeight(76)).toBe(76)
        expect(publishedCardHeight(76.000001)).toBe(76)
    })

    test('a taller card scrolled in raises the height, anchored on the top card', () => {
        const b = board()
        const all = keys(1000)
        b.naturals.set('c590', 90.3)
        b.render(all)
        scrollTo(b, cardTop(580, 76, GAP, PAD))
        expect(readCardHeight(el(b.host))).toBe(91)
        // The card that was at the top is still at the top under the new pitch.
        expect(visible(b)[0]).toBe('c580')
        expect(misplaced(b, all)).toEqual([])
    })

    test('captured anchors survive a height change', () => {
        const b = board()
        b.render(keys(1000))
        scrollTo(b, cardTop(400, 76, GAP, PAD) + 30)
        const anchors = captureVirtualAnchors(el(b.host))
        b.host.setCssProps({ [CARD_HEIGHT_VAR]: '100px' })
        restoreVirtualAnchors(el(b.host), anchors)
        expect(b.list.scrollTop).toBe(cardTop(400, 100, GAP, PAD) + 30)
        expect(visible(b)[0]).toBe('c400')
    })

    test('the cache returns heights of unmounted, unchanged cards at the same width', () => {
        const b = board()
        b.render(keys(1000))
        const node = b.list.children.find((c) => c.dataset['cardKey'] === 'c2')
        if (!node) throw new Error('c2 not mounted')
        cachedHeights(el(b.host), [{ el: el(node), height: 88 }])
        scrollTo(b, 60_000)
        expect(cachedHeights(el(b.host), [])).toEqual([88])
        // Another width: not reused.
        b.list.fixedWidth = 200
        expect(cachedHeights(el(b.host), [])).toEqual([])
        b.list.fixedWidth = 300
        expect(cachedHeights(el(b.host), [])).toEqual([88])
        clearHeightCache(el(b.host))
        expect(cachedHeights(el(b.host), [])).toEqual([])
    })

    test('the cache epoch ignores transient classes, follows height classes and font size', () => {
        const b = board()
        const base = heightEpoch(el(b.host))
        b.host.addClass('kap-board-selecting')
        b.host.addClass('kap-dragging')
        b.host.addClass('kap-drop-forbidden')
        expect(heightEpoch(el(b.host))).toBe(base)
        b.host.addClass('kap-compact')
        expect(heightEpoch(el(b.host))).not.toBe(base)
        b.host.removeClass('kap-compact')
        b.host.fontSize = '15px'
        expect(heightEpoch(el(b.host))).not.toBe(base)
    })

    test('hashString is stable and spreads', () => {
        expect(hashString('abc')).toBe(hashString('abc'))
        expect(hashString('abc')).not.toBe(hashString('abd'))
    })
})

describe('drop geometry and teardown', () => {
    test('virtualDropGeometry exposes the model count and indices', () => {
        const b = board()
        b.render(keys(300))
        const g = virtualDropGeometry(el(b.list))
        expect(g?.count).toBe(300)
        expect(g?.cardHeight).toBe(76)
        expect(g?.indexOf('c250')).toBe(250)
        expect(g?.indexOf('x')).toBe(-1)
    })

    test('releaseVirtualColumns drops spacers, pins, aria and the observers', () => {
        const b = board()
        b.render(keys(300))
        releaseVirtualColumns(el(b.host))
        expect(b.list.hasClass(VIRTUAL_CLASS)).toBe(false)
        expect(b.list.querySelectorAll('.kap-column-spacer').length).toBe(0)
        expect(b.ro().targets.size).toBe(0)
        for (const c of b.list.children) expect(c.getAttribute('aria-posinset')).toBeNull()
        expect(virtualDropGeometry(el(b.list))).toBeNull()
    })

    test('syncVirtualColumns re-windows for an externally set scroll offset', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        b.list.scrollTop = 42_000
        syncVirtualColumns(el(b.host))
        expect(visible(b).length).toBeGreaterThan(4)
        expect(misplaced(b, all)).toEqual([])
    })
})

describe('Tab into a scrolled long column (review finding 4)', () => {
    test('lands on the first card in view, not the first mounted one', () => {
        const b = board()
        const all = keys(1000)
        b.render(all)
        scrollTo(b, 20_000)
        clock = 1000
        b.doc.dispatch({ type: 'keydown', key: 'Tab', shiftKey: false, timeStamp: 1000 })
        const first = b.list.children.find(
            (c) => c.hasClass('kap-card') && !c.hasClass(PINNED_CLASS)
        )
        first?.focus()
        expect(focused?.dataset['cardKey']).toBe(visible(b)[0])
        expect(b.list.scrollTop).toBe(20_000)
    })

    test('Shift+Tab lands on the last card in view', () => {
        const b = board()
        b.render(keys(1000))
        scrollTo(b, 20_000)
        clock = 1000
        b.doc.dispatch({ type: 'keydown', key: 'Tab', shiftKey: true, timeStamp: 1000 })
        const cards = b.list.children.filter((c) => c.hasClass('kap-card'))
        cards[cards.length - 1]?.focus()
        const vis = visible(b).filter((k) => {
            const n = b.list.children.find((c) => c.dataset['cardKey'] === k)
            return n ? n.offsetTop + n.ownHeight <= 20_000 + 500 : false
        })
        expect(focused?.dataset['cardKey']).toBe(vis[vis.length - 1])
    })

    test('a focus that is not from Tab is left alone', () => {
        const b = board()
        b.render(keys(1000))
        scrollTo(b, 20_000)
        clock = 5000
        const first = b.list.children.find((c) => c.hasClass('kap-card'))
        first?.focus()
        expect(focused).toBe(first ?? null)
    })
})

describe('Markdown embed: the list is not height-limited (review finding 8)', () => {
    test('windows against the scrolling ancestor instead of mounting everything', () => {
        const b = board()
        // The list grows with its content; its ancestor scrolls.
        b.list.fixedHeight = null
        const scroller = b.list.parent?.parent?.parent
        if (!scroller) throw new Error('no scroller')
        scroller.overflowY = 'auto'
        scroller.fixedHeight = 600
        // Detected on the first window, without waiting for the observer.
        b.render(keys(1000))
        const mounted = mountedKeys(b.list).length
        expect(mounted).toBeGreaterThan(3)
        expect(mounted).toBeLessThan(60)
        // Scroll the ancestor: the window follows.
        scroller.scrollTop = 30_000
        b.doc.dispatch({ type: 'scroll', target: scroller, timeStamp: clock })
        const vis = mountedKeys(b.list).map((k) => Number(k.slice(1)))
        expect(Math.min(...vis)).toBeLessThanOrEqual(Math.floor(30_000 / 84))
        expect(Math.max(...vis)).toBeGreaterThanOrEqual(Math.floor((30_000 + 600) / 84))
    })
})

describe('LazyImages.observeList / forget', () => {
    test('observes the parked images of newly mounted cards and forgets unmounted ones', () => {
        const b = board()
        const lazy = new LazyImages()
        lazy.sync(el(b.host))
        const node = b.list.createDiv({ cls: 'kap-card' })
        const img = new FakeEl('img', b.doc)
        img.dataset['kapSrc'] = 'app://cover.png'
        node.appendChild(img)
        lazy.observeList(el(b.list))
        const io = b.win.intersectionObservers[0]
        expect(io?.targets.has(img)).toBe(true)
        lazy.forget(el(b.list), [el(node)])
        expect(io?.targets.has(img)).toBe(false)
        lazy.dispose()
    })
})
