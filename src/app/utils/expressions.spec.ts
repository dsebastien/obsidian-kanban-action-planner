import { describe, expect, test } from 'bun:test'
import { isoWeek, resolvePlaceholders, type ExpressionContext } from './expressions'

// 2026-06-26 14:30:15 local — a Friday in ISO week 26, Q2.
function ctx(overrides: Partial<ExpressionContext> = {}): ExpressionContext {
    return {
        now: new Date(2026, 5, 26, 14, 30, 15),
        uuid: () => 'fixed-uuid',
        ...overrides
    }
}

describe('resolvePlaceholders', () => {
    test('resolves each date/time token', () => {
        expect(resolvePlaceholders('{{year}}', ctx())).toBe('2026')
        expect(resolvePlaceholders('{{month}}', ctx())).toBe('06')
        expect(resolvePlaceholders('{{day}}', ctx())).toBe('26')
        expect(resolvePlaceholders('{{week}}', ctx())).toBe('26')
        expect(resolvePlaceholders('{{quarter}}', ctx())).toBe('2')
        expect(resolvePlaceholders('{{date}}', ctx())).toBe('2026-06-26')
        expect(resolvePlaceholders('{{datetime}}', ctx())).toBe('2026-06-26-143015')
    })

    test('uuid comes from the context generator', () => {
        expect(resolvePlaceholders('{{uuid}}', ctx())).toBe('fixed-uuid')
    })

    test('token matching is case-insensitive and tolerates whitespace', () => {
        expect(resolvePlaceholders('{{YEAR}}', ctx())).toBe('2026')
        expect(resolvePlaceholders('{{ Month }}', ctx())).toBe('06')
    })

    test('resolves multiple tokens inside a folder path', () => {
        expect(resolvePlaceholders('Archive/{{year}}/{{month}}', ctx())).toBe('Archive/2026/06')
    })

    test('leaves unknown tokens untouched', () => {
        expect(resolvePlaceholders('Archive/{{foo}}', ctx())).toBe('Archive/{{foo}}')
    })

    test('returns paths without tokens unchanged', () => {
        expect(resolvePlaceholders('Archive', ctx())).toBe('Archive')
        expect(resolvePlaceholders('', ctx())).toBe('')
    })

    test('pads single-digit components', () => {
        const early = ctx({ now: new Date(2026, 0, 3, 9, 5, 7) }) // 2026-01-03 09:05:07
        expect(resolvePlaceholders('{{date}}', early)).toBe('2026-01-03')
        expect(resolvePlaceholders('{{datetime}}', early)).toBe('2026-01-03-090507')
    })
})

describe('isoWeek', () => {
    test('first Thursday rule', () => {
        expect(isoWeek(new Date(2026, 0, 1))).toBe(1) // 2026-01-01 is a Thursday → week 1
        expect(isoWeek(new Date(2026, 5, 26))).toBe(26)
        expect(isoWeek(new Date(2025, 11, 29))).toBe(1) // belongs to ISO 2026 week 1
    })
})
