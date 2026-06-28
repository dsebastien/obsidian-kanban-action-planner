import { describe, expect, it } from 'bun:test'
import { formatWikiLink, parseWikiLinkTarget, toLinkStringList } from './wikilinks'

describe('toLinkStringList', () => {
    it('keeps non-empty strings from an array', () => {
        expect(toLinkStringList(['[[A]]', '', '  ', '[[B]]'])).toEqual(['[[A]]', '[[B]]'])
        expect(toLinkStringList(['[[A]]', 3, null])).toEqual(['[[A]]'])
    })

    it('wraps a single string', () => {
        expect(toLinkStringList('[[A]]')).toEqual(['[[A]]'])
    })

    it('returns empty for blank / non-string-or-array', () => {
        expect(toLinkStringList('')).toEqual([])
        expect(toLinkStringList(undefined)).toEqual([])
        expect(toLinkStringList(42)).toEqual([])
    })
})

describe('parseWikiLinkTarget', () => {
    it('extracts the path from a plain wikilink', () => {
        expect(parseWikiLinkTarget('[[Project X]]')).toBe('Project X')
        expect(parseWikiLinkTarget('[[folder/Project X]]')).toBe('folder/Project X')
    })

    it('strips alias and subpath', () => {
        expect(parseWikiLinkTarget('[[Project X|Alias]]')).toBe('Project X')
        expect(parseWikiLinkTarget('[[Project X#Heading]]')).toBe('Project X')
        expect(parseWikiLinkTarget('[[folder/A|B#h]]')).toBe('folder/A')
    })

    it('handles a bare path (no brackets) and trims', () => {
        expect(parseWikiLinkTarget('  Project X  ')).toBe('Project X')
    })
})

describe('formatWikiLink', () => {
    it('wraps a linktext in double brackets', () => {
        expect(formatWikiLink('Project X')).toBe('[[Project X]]')
    })
})
