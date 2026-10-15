import { describe, expect, test } from 'bun:test'
import { deferImage, isLaidOutHit, loadImage, LOADING_CLASS } from './lazy-images'
import type { LazyImageEl } from './lazy-images'

/** A DOM-free image double: records listeners and its box's classes. */
function fakeImage(): { img: LazyImageEl; box: Set<string>; fire: (type: string) => void } {
    const box = new Set<string>()
    const listeners = new Map<string, () => void>()
    const img: LazyImageEl = {
        dataset: {},
        parentElement: { classList: { add: (c) => box.add(c), remove: (c) => box.delete(c) } },
        src: '',
        decoding: 'auto',
        addEventListener: (type, listener) => listeners.set(type, listener)
    }
    return { img, box, fire: (type) => listeners.get(type)?.() }
}

describe('lazy card images', () => {
    test('deferImage parks the source and shows the placeholder', () => {
        const { img, box } = fakeImage()
        deferImage(img, 'https://example.com/poster.jpg')
        expect(img.src).toBe('')
        expect(img.dataset['kapSrc']).toBe('https://example.com/poster.jpg')
        expect(img.decoding).toBe('async')
        expect(box.has(LOADING_CLASS)).toBe(true)
    })

    test('loadImage sets the source once and drops the placeholder when it settles', () => {
        const { img, box, fire } = fakeImage()
        deferImage(img, 'app://local/cover.webp')
        loadImage(img)
        expect(img.src).toBe('app://local/cover.webp')
        expect(img.dataset['kapSrc']).toBeUndefined()
        expect(box.has(LOADING_CLASS)).toBe(true)
        fire('load')
        expect(box.has(LOADING_CLASS)).toBe(false)
    })

    test('a broken image also drops the placeholder; loading twice is a no-op', () => {
        const { img, box, fire } = fakeImage()
        deferImage(img, 'https://example.com/missing.jpg')
        loadImage(img)
        fire('error')
        expect(box.has(LOADING_CLASS)).toBe(false)
        img.src = 'changed'
        loadImage(img)
        expect(img.src).toBe('changed')
    })
})

describe('isLaidOutHit', () => {
    const box = { width: 40, height: 60 }
    test('loads only on a real hit with a laid-out target and root', () => {
        expect(
            isLaidOutHit({ isIntersecting: true, boundingClientRect: box, rootBounds: box })
        ).toBe(true)
        expect(
            isLaidOutHit({ isIntersecting: false, boundingClientRect: box, rootBounds: box })
        ).toBe(false)
    })

    test('ignores hidden images and boards in hidden leaves (0x0)', () => {
        const zero = { width: 0, height: 0 }
        expect(
            isLaidOutHit({ isIntersecting: true, boundingClientRect: zero, rootBounds: box })
        ).toBe(false)
        expect(
            isLaidOutHit({ isIntersecting: true, boundingClientRect: box, rootBounds: zero })
        ).toBe(false)
        expect(
            isLaidOutHit({ isIntersecting: true, boundingClientRect: box, rootBounds: null })
        ).toBe(false)
    })
})
