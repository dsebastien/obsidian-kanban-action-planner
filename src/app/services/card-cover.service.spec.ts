import { describe, expect, it } from 'bun:test'
import { TFile, TFolder } from 'obsidian'
import {
    coverRawFromValue,
    firstCoverText,
    parseCoverReference,
    resolveCoverUrl
} from './card-cover.service'
import type { CoverApp } from './card-cover.service'

const fileAt = (path: string): TFile => Object.assign(new TFile(), { path })

/** A vault double: `files` by exact path, `links` by linkpath. */
function appWith(
    files: Record<string, TFile | TFolder>,
    links: Record<string, TFile> = {}
): CoverApp & { linkCalls: Array<[string, string]> } {
    const linkCalls: Array<[string, string]> = []
    return {
        linkCalls,
        vault: {
            getAbstractFileByPath: (p: string) => files[p] ?? null,
            getResourcePath: (f: TFile) => `app://res/${f.path}`
        },
        metadataCache: {
            getFirstLinkpathDest: (linkpath: string, source: string) => {
                linkCalls.push([linkpath, source])
                return links[linkpath] ?? null
            }
        }
    }
}

/** A Bases value double: anything with a string form (Image/Link/File/Url/NullValue). */
const valueOf = (text: string): { toString(): string } => ({ toString: (): string => text })

/** A Bases `ListValue` double (public surface: `length()` + `get(i)`). */
const listOf = (...items: unknown[]): { length(): number; get(i: number): unknown } => ({
    length: (): number => items.length,
    get: (i: number): unknown => items[i] ?? valueOf('null')
})

describe('coverRawFromValue (Bases values)', () => {
    it('uses the string form of single values', () => {
        // image("https://…") and image("path") as Bases prints them
        expect(coverRawFromValue(valueOf('![](https://x/y.png)'))).toBe('![](https://x/y.png)')
        expect(coverRawFromValue(valueOf('![[att/Poster.jpg]]'))).toBe('![[att/Poster.jpg]]')
        // LinkValue, FileValue
        expect(coverRawFromValue(valueOf('[[Poster.jpg|Poster.jpg]]'))).toBe(
            '[[Poster.jpg|Poster.jpg]]'
        )
        expect(coverRawFromValue(valueOf('att/Poster.jpg'))).toBe('att/Poster.jpg')
    })
    it('unwraps lists item by item instead of their joined string', () => {
        const list = listOf(valueOf('[[a.jpg]]'), valueOf('[[b.jpg]]'))
        expect(coverRawFromValue(list)).toEqual(['[[a.jpg]]', '[[b.jpg]]'])
        expect(firstCoverText(coverRawFromValue(list))).toBe('[[a.jpg]]')
        expect(
            firstCoverText(coverRawFromValue(listOf(valueOf('null'), listOf(valueOf('x.png')))))
        ).toBe('x.png')
    })
    it('passes raw strings and arrays through and drops the rest', () => {
        expect(coverRawFromValue('a.jpg')).toBe('a.jpg')
        expect(coverRawFromValue(['a.jpg'])).toEqual(['a.jpg'])
        expect(coverRawFromValue(null)).toBeNull()
        expect(coverRawFromValue(undefined)).toBeNull()
        expect(coverRawFromValue(42)).toBeNull()
    })
})

describe('firstCoverText', () => {
    it('trims strings and drops empties / "null"', () => {
        expect(firstCoverText('  a.jpg ')).toBe('a.jpg')
        expect(firstCoverText('')).toBeNull()
        expect(firstCoverText('null')).toBeNull()
        expect(firstCoverText(undefined)).toBeNull()
        expect(firstCoverText(42)).toBeNull()
    })
    it('takes the first non-empty list item', () => {
        expect(firstCoverText(['', null, 'b.png', 'c.png'])).toBe('b.png')
        expect(firstCoverText([])).toBeNull()
    })
})

describe('parseCoverReference', () => {
    it('passes http(s) URLs through', () => {
        expect(parseCoverReference('https://img.example/x.jpg')).toEqual({
            kind: 'url',
            url: 'https://img.example/x.jpg'
        })
        expect(parseCoverReference('HTTP://a/b')).toEqual({ kind: 'url', url: 'HTTP://a/b' })
    })
    it('parses wikilinks and embeds, dropping alias and subpath', () => {
        expect(parseCoverReference('[[Cover.jpg]]')).toEqual({
            kind: 'link',
            linkpath: 'Cover.jpg'
        })
        expect(parseCoverReference('![[a/Cover.jpg|200]]')).toEqual({
            kind: 'link',
            linkpath: 'a/Cover.jpg'
        })
        expect(parseCoverReference('[[Note#Heading]]')).toEqual({ kind: 'link', linkpath: 'Note' })
        expect(parseCoverReference('[[|alias]]')).toBeNull()
    })
    it('parses Markdown images', () => {
        expect(parseCoverReference('![alt](https://x/y.png)')).toEqual({
            kind: 'url',
            url: 'https://x/y.png'
        })
        expect(parseCoverReference('![](a/My%20Cover.png)')).toEqual({
            kind: 'link',
            linkpath: 'a/My Cover.png'
        })
    })
    it('keeps parentheses inside a Markdown image target', () => {
        expect(parseCoverReference('![](https://x/File:Poster_(1999).jpg)')).toEqual({
            kind: 'url',
            url: 'https://x/File:Poster_(1999).jpg'
        })
    })
    it('parses what the image() formula prints', () => {
        expect(parseCoverReference('![](https://img.example/p.jpg)')).toEqual({
            kind: 'url',
            url: 'https://img.example/p.jpg'
        })
        expect(parseCoverReference('![[att/My Poster.jpg]]')).toEqual({
            kind: 'link',
            linkpath: 'att/My Poster.jpg'
        })
    })
    it('treats anything else as a vault path', () => {
        expect(parseCoverReference('50 Res/Att/Blind Spot (book).jpg')).toEqual({
            kind: 'path',
            path: '50 Res/Att/Blind Spot (book).jpg'
        })
        expect(parseCoverReference('/a/b.jpg')).toEqual({ kind: 'path', path: 'a/b.jpg' })
    })
    it('rejects other URL schemes and empties', () => {
        expect(parseCoverReference('file:///etc/x.png')).toBeNull()
        expect(parseCoverReference('data:image/png;base64,AAAA')).toBeNull()
        expect(parseCoverReference('   ')).toBeNull()
        expect(parseCoverReference(null)).toBeNull()
    })
})

describe('resolveCoverUrl', () => {
    const img = fileAt('att/Cover.jpg')

    it('returns URLs as is (no vault lookup)', () => {
        const app = appWith({})
        expect(resolveCoverUrl(app, 'https://x/y.jpg', 'n.md')).toBe('https://x/y.jpg')
        expect(app.linkCalls).toEqual([])
    })
    it('resolves wikilinks relative to the card note', () => {
        const app = appWith({}, { 'Cover.jpg': img })
        expect(resolveCoverUrl(app, '![[Cover.jpg]]', 'notes/n.md')).toBe('app://res/att/Cover.jpg')
        expect(app.linkCalls).toEqual([['Cover.jpg', 'notes/n.md']])
    })
    it('resolves plain vault paths', () => {
        const app = appWith({ 'att/Cover.jpg': img })
        expect(resolveCoverUrl(app, 'att/Cover.jpg', 'n.md')).toBe('app://res/att/Cover.jpg')
    })
    it('falls back to link resolution for a bare file name', () => {
        const app = appWith({}, { 'Cover.jpg': img })
        expect(resolveCoverUrl(app, 'Cover.jpg', 'n.md')).toBe('app://res/att/Cover.jpg')
    })
    it('returns null when nothing resolves', () => {
        const app = appWith({})
        expect(resolveCoverUrl(app, '[[Missing.png]]', 'n.md')).toBeNull()
        expect(resolveCoverUrl(app, 'missing/x.png', 'n.md')).toBeNull()
        expect(resolveCoverUrl(app, '', 'n.md')).toBeNull()
    })
    it('ignores folders', () => {
        const app = appWith({ att: Object.assign(new TFolder(), { path: 'att' }) })
        expect(resolveCoverUrl(app, 'att', 'n.md')).toBeNull()
    })
})
