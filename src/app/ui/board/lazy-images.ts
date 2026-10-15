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
    private observers: IntersectionObserver[] = []

    /** Re-observe every parked image under `rootEl`; call after each board render. */
    sync(rootEl: HTMLElement): void {
        this.dispose()
        // The element's own window, so a board in a popout window is observed there.
        const Observer = (
            rootEl.win as Window & { IntersectionObserver: typeof IntersectionObserver }
        ).IntersectionObserver
        for (const list of Array.from(rootEl.querySelectorAll<HTMLElement>('.kap-column-cards'))) {
            const pending = Array.from(list.querySelectorAll<HTMLImageElement>('img[data-kap-src]'))
            if (pending.length === 0) continue
            const observer = new Observer(
                (entries: IntersectionObserverEntry[]) => {
                    for (const entry of entries) {
                        if (!entry.isIntersecting) continue
                        observer.unobserve(entry.target)
                        loadImage(entry.target as HTMLImageElement)
                    }
                },
                { root: list, rootMargin: LOOKAHEAD }
            )
            for (const img of pending) observer.observe(img)
            this.observers.push(observer)
        }
    }

    /** Stop observing (a later {@link sync} starts over). */
    dispose(): void {
        for (const observer of this.observers) observer.disconnect()
        this.observers = []
    }
}
