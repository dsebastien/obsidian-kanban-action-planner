import { describe, expect, it } from 'bun:test'
import { TFile, TFolder } from 'obsidian'
import { firstCoverText, parseCoverReference, resolveCoverUrl } from './card-cover.service'
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
