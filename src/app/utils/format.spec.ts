import { describe, expect, it } from 'bun:test'
import { formatScalar, stripWikiLink } from './format'

describe('stripWikiLink', () => {
    it('returns plain text unchanged', () => {
        expect(stripWikiLink('hello')).toBe('hello')
    })

    it('extracts the target from a wikilink and uses the basename', () => {
        expect(stripWikiLink('[[Projects/Goal X]]')).toBe('Goal X')
    })

    it('honours an alias', () => {
        expect(stripWikiLink('[[Goal X|My Goal]]')).toBe('My Goal')
    })

    it('handles embeds', () => {
        expect(stripWikiLink('![[cover.png]]')).toBe('cover.png')
    })
})

describe('formatScalar', () => {
    it('renders blanks for nullish', () => {
        expect(formatScalar(null)).toBe('')
        expect(formatScalar(undefined)).toBe('')
    })

    it('renders numbers and booleans', () => {
        expect(formatScalar(3)).toBe('3')
        expect(formatScalar(true)).toBe('Yes')
        expect(formatScalar(false)).toBe('No')
    })

    it('joins arrays and strips links within them', () => {
        expect(formatScalar(['[[A]]', 'b', ''])).toBe('A, b')
    })

    it('strips a wikilink string', () => {
        expect(formatScalar('[[Area/Health]]')).toBe('Health')
    })
})
