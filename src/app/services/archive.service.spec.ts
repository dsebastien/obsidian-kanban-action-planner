import { describe, expect, test } from 'bun:test'
import { normalizeFolderPath, resolveArchiveFolder } from './archive.service'
import type { ExpressionContext } from '../utils/expressions'

const ctx: ExpressionContext = {
    now: new Date(2026, 5, 26, 14, 30, 15),
    uuid: () => 'fixed-uuid'
}

describe('normalizeFolderPath', () => {
    test('trims segments and collapses separators', () => {
        expect(normalizeFolderPath(' Archive / 2026 ')).toBe('Archive/2026')
        expect(normalizeFolderPath('Archive//2026/')).toBe('Archive/2026')
        expect(normalizeFolderPath('/Archive/')).toBe('Archive')
    })

    test('empty / whitespace-only becomes empty', () => {
        expect(normalizeFolderPath('')).toBe('')
        expect(normalizeFolderPath('  /  ')).toBe('')
    })
})

describe('resolveArchiveFolder', () => {
    test('resolves placeholders and normalizes', () => {
        expect(resolveArchiveFolder('Archive/{{year}}/{{month}}', ctx)).toBe('Archive/2026/06')
    })

    test('blank template disables archiving (null)', () => {
        expect(resolveArchiveFolder('', ctx)).toBeNull()
        expect(resolveArchiveFolder('   ', ctx)).toBeNull()
    })
})
