import { describe, expect, it } from 'bun:test'
import { cssEscapeAttr } from './css-escape'

describe('cssEscapeAttr', () => {
    it('leaves a plain value untouched', () => {
        // Under bun there is no global CSS.escape, so the regex fallback runs.
        expect(cssEscapeAttr('Notes/Card.md')).toBe('Notes/Card.md')
    })

    it('escapes double quotes and backslashes that would break the selector', () => {
        expect(cssEscapeAttr('a"b')).toBe('a\\"b')
        expect(cssEscapeAttr('a\\b')).toBe('a\\\\b')
        expect(cssEscapeAttr('a"b\\c')).toBe('a\\"b\\\\c')
    })

    it('handles an empty string', () => {
        expect(cssEscapeAttr('')).toBe('')
    })
})
