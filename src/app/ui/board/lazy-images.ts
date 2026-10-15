/**
 * Lazy card images (covers and compact thumbnails).
 *
 * A board can hold thousands of cards, each with a cover. Native
 * `loading="lazy"` measures distance to the WINDOW, so inside the board's
 * scrolling columns it still fetched and decoded every image of every
 * column up front (measured: 4,886 of 4,886 covers on a movie board). Here
 * the image source is parked on the element and only set when the image
 * nears the visible part of its own column, so a big board stays responsive
 * and only what you can scroll to soon is loaded.
 *
 * The image box is sized by CSS before anything loads (aspect ratio or fixed
 * height), so nothing reflows when an image arrives: the box shows a
 * placeholder until then ({@link LOADING_CLASS}).
 */

/** The parked source (`data-kap-src`) of an image not loaded yet. */
const SRC_KEY = 'kapSrc'
/** On the image's box while its image is not loaded yet: the placeholder. */
export const LOADING_CLASS = 'kap-img-loading'
/** How far ahead of a column's visible area images start loading. */
const LOOKAHEAD = '800px 0px'
/** Re-check cadence and cap while a board is not laid out yet. */
const RETRY_MS = 200
const RETRY_LIMIT = 50

/** The element subset {@link deferImage} and {@link loadImage} touch (DOM-free tests). */
export interface LazyImageEl {
    dataset: DOMStringMap
    parentElement: { classList: { add(c: string): void; remove(c: string): void } } | null
    src: string
    decoding: string
    addEventListener(
        type: 'load' | 'error',
        listener: () => void,
        options?: { once: boolean }
    ): void
}

/** Park `src` on a freshly created image; {@link LazyImages.sync} loads it when it nears view. */
export function deferImage(img: LazyImageEl, src: string): void {
    img.dataset[SRC_KEY] = src
    img.decoding = 'async'
    img.parentElement?.classList.add(LOADING_CLASS)
}

/** Load a parked image now: set its source and drop the placeholder once it settles. */
export function loadImage(img: LazyImageEl): void {
    const src = img.dataset[SRC_KEY]
    if (src === undefined) return
    delete img.dataset[SRC_KEY]
    const settle = (): void => img.parentElement?.classList.remove(LOADING_CLASS)
    img.addEventListener('load', settle, { once: true })
    img.addEventListener('error', settle, { once: true })
    img.src = src
}

/**
 * Loads a board's parked images as they near view, one observer per column
 * card list (its root), so the look-ahead follows each column's own scroll.
 * Hidden images (the compact thumbnail outside compact mode, a collapsed
 * column) never intersect, so they are not fetched until they show.
 */
export class LazyImages {
    /** One observer per column card list (its root). */
    private observers = new Map<HTMLElement, IntersectionObserver>()
    private rootEl: HTMLElement | null = null
    private retryTimer: number | null = null
    private retries = 0

    /**
     * Re-observe every parked image under `rootEl`; call after each board
     * render and when the board is resized or revealed. A board rendered in a
     * hidden leaf measures 0x0, and a zero-size root reports EVERY target as
     * intersecting (edge-adjacent), which would load the whole board: such
     * entries are ignored and stay observed, and the reveal's resize re-syncs
     * with real dimensions.
     */
    sync(rootEl: HTMLElement, retry = false): void {
        this.dispose()
        if (!retry) this.retries = 0
        this.rootEl = rootEl
        for (const list of Array.from(rootEl.querySelectorAll<HTMLElement>('.kap-column-cards'))) {
            this.observeList(list)
        }
    }

    /**
     * Observe the parked images of one card list, e.g. the cards a virtual
     * column just mounted while scrolling (issue #111). Observing an image
     * already observed is a no-op.
     */
    observeList(list: HTMLElement): void {
        const rootEl = this.rootEl
        if (!rootEl) return
        const pending = Array.from(list.querySelectorAll<HTMLImageElement>('img[data-kap-src]'))
        if (pending.length === 0) return
        let observer = this.observers.get(list)
        if (!observer) {
            // The element's own window, so a board in a popout window is observed there.
            const Observer = (
                list.win as Window & { IntersectionObserver: typeof IntersectionObserver }
            ).IntersectionObserver
            const created = new Observer(
                (entries: IntersectionObserverEntry[]) => {
                    for (const entry of entries) {
                        // The column itself is not laid out yet (a leaf still
                        // hidden or opening): the observer will not report
                        // again when it is, so look again shortly.
                        if (entry.isIntersecting && !hasSize(entry.rootBounds)) {
                            this.retryLater(rootEl)
                            continue
                        }
                        if (!isLaidOutHit(entry)) continue
                        created.unobserve(entry.target)
                        loadImage(entry.target as HTMLImageElement)
                    }
                },
                { root: list, rootMargin: LOOKAHEAD }
            )
            this.observers.set(list, created)
            observer = created
        }
        for (const img of pending) observer.observe(img)
    }

    /** Stop observing the images of cards a virtual column unmounted. */
    forget(list: HTMLElement, nodes: readonly HTMLElement[]): void {
        const observer = this.observers.get(list)
        if (!observer) return
        for (const node of nodes) {
            for (const img of Array.from(node.querySelectorAll('img[data-kap-src]'))) {
                observer.unobserve(img)
            }
        }
    }

    /** Stop observing (a later {@link sync} starts over). */
    dispose(): void {
        for (const observer of this.observers.values()) observer.disconnect()
        this.observers.clear()
        if (this.retryTimer !== null) window.clearTimeout(this.retryTimer)
        this.retryTimer = null
    }

    /** Re-sync once the board has had time to lay out (bounded: ~10 s). */
    private retryLater(rootEl: HTMLElement): void {
        if (this.retryTimer !== null || this.retries >= RETRY_LIMIT) return
        this.retries++
        this.retryTimer = window.setTimeout(() => {
            this.retryTimer = null
            if (rootEl.isConnected) this.sync(rootEl, true)
        }, RETRY_MS)
    }
}

/** The shape of an intersection entry {@link isLaidOutHit} reads (DOM-free tests). */
export interface IntersectionLike {
    isIntersecting: boolean
    boundingClientRect: { width: number; height: number }
    rootBounds: { width: number; height: number } | null
}

/**
 * A real hit: intersecting, with a laid-out target AND root. A hidden image
 * (display: none) or a board in a hidden leaf measures 0x0 and counts as
 * intersecting when it merely touches the root; loading on that would fetch
 * every image of the board.
 */
export function isLaidOutHit(entry: IntersectionLike): boolean {
    if (!entry.isIntersecting) return false
    const target = entry.boundingClientRect
    const root = entry.rootBounds
    if (target.width === 0 || target.height === 0) return false
    return hasSize(root)
}

/** A laid-out box (non-null, non-zero in both dimensions). */
function hasSize(box: { width: number; height: number } | null): boolean {
    return box !== null && box.width > 0 && box.height > 0
}
