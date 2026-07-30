import { describe, expect, test } from 'bun:test'
import {
    applyCoreTemplatePlaceholders,
    buildNoteBasename,
    buildUniquePath,
    defaultCreationConfig,
    emptyInheritedDefaults,
    normalizeCreationFolder,
    resolveCreationConfig,
    sanitizeNoteName
} from './note-creation'
import type { ExpressionContext } from '../utils/expressions'

const ctx: ExpressionContext = {
    now: new Date(2026, 6, 30, 14, 5, 9),
    uuid: () => 'uuid-1'
}

describe('resolveCreationConfig', () => {
    const inherited = {
        folder: '20 Actions/24 Tasks',
        templatePath: 'Templates/TPL Task.md',
        namePrefix: '',
        nameSuffix: ' (Task)'
    }

    test('inherits everything when no override is stored (no backfill)', () => {
        const resolved = resolveCreationConfig(undefined, inherited, 'Filtered', 'Inbox')
        expect(resolved.folder).toBe('20 Actions/24 Tasks')
        expect(resolved.templatePath).toBe('Templates/TPL Task.md')
        expect(resolved.nameSuffix).toBe(' (Task)')
        expect(resolved.openAfterCreate).toBe(true)
    })

    test('a non-empty override wins over the Starter Kit', () => {
        const resolved = resolveCreationConfig(
            { ...defaultCreationConfig(), folder: 'Inbox', templatePath: 'T.md' },
            inherited,
            'Filtered',
            'Fallback'
        )
        expect(resolved.folder).toBe('Inbox')
        expect(resolved.templatePath).toBe('T.md')
        // Untouched fields still inherit.
        expect(resolved.nameSuffix).toBe(' (Task)')
    })

    test("falls back to the Base's filter folder, then to Obsidian's default", () => {
        const none = emptyInheritedDefaults()
        expect(resolveCreationConfig(undefined, none, 'Filtered', 'Fallback').folder).toBe(
            'Filtered'
        )
        expect(resolveCreationConfig(undefined, none, null, 'Fallback').folder).toBe('Fallback')
        expect(resolveCreationConfig(undefined, none, null, '').folder).toBe('')
    })

    test('openAfterCreate is taken from the override, not inherited', () => {
        const resolved = resolveCreationConfig(
            { ...defaultCreationConfig(), openAfterCreate: false },
            inherited,
            null,
            ''
        )
        expect(resolved.openAfterCreate).toBe(false)
    })
})

describe('sanitizeNoteName', () => {
    test('strips characters Obsidian rejects in a file name', () => {
        expect(sanitizeNoteName('a/b:c*d?e"f<g>h|i#j^k[l]m')).toBe('abcdefghijklm')
    })

    test('collapses whitespace and trims leading/trailing dots', () => {
        expect(sanitizeNoteName('  ..Ship   the   thing.. ')).toBe('Ship the thing')
    })
})

describe('buildNoteBasename', () => {
    const config = { namePrefix: '', nameSuffix: ' (Task)' }

    test('appends the suffix', () => {
        expect(buildNoteBasename('Ship it', config, ctx)).toBe('Ship it (Task)')
    })

    test('does not repeat a suffix the typed name already carries', () => {
        expect(buildNoteBasename('Ship it (Task)', config, ctx)).toBe('Ship it (Task)')
    })

    test('does not repeat an already-present prefix', () => {
        const prefixed = { namePrefix: 'AI Wiki - ', nameSuffix: '' }
        expect(buildNoteBasename('AI Wiki - Bases', prefixed, ctx)).toBe('AI Wiki - Bases')
        expect(buildNoteBasename('Bases', prefixed, ctx)).toBe('AI Wiki - Bases')
    })

    test('expands placeholders in the prefix and suffix', () => {
        const dated = { namePrefix: '{{date}} ', nameSuffix: '' }
        expect(buildNoteBasename('Standup', dated, ctx)).toBe('2026-07-30 Standup')
    })

    test('returns an empty basename for a title with nothing usable left', () => {
        expect(buildNoteBasename('  ///  ', { namePrefix: '', nameSuffix: '' }, ctx)).toBe('')
    })

    test('a decorated empty title never yields a note named after the decoration', () => {
        expect(buildNoteBasename('  ', config, ctx)).toBe('')
    })

    test("keeps a decoration's internal whitespace (recognition regexes depend on it)", () => {
        const spaced = { namePrefix: '', nameSuffix: '  (Task)' }
        expect(buildNoteBasename('Ship it', spaced, ctx)).toBe('Ship it  (Task)')
    })

    test('strips illegal characters coming from a prefix or suffix', () => {
        const bad = { namePrefix: 'a/b ', nameSuffix: ' #c' }
        expect(buildNoteBasename('Note', bad, ctx)).toBe('ab Note c')
    })
})

describe('normalizeCreationFolder', () => {
    test('collapses separators and trims segments', () => {
        expect(normalizeCreationFolder(' /20 Actions// 24 Tasks / ')).toBe('20 Actions/24 Tasks')
    })

    test('an empty folder means the vault root', () => {
        expect(normalizeCreationFolder('   ')).toBe('')
    })

    test('drops traversal segments so nothing can be created outside the vault', () => {
        expect(normalizeCreationFolder('Safe/../../Outside')).toBe('Safe/Outside')
        expect(normalizeCreationFolder('./Inbox/.')).toBe('Inbox')
        expect(normalizeCreationFolder('..')).toBe('')
    })
})

describe('buildUniquePath', () => {
    test('uses the plain path when it is free', () => {
        expect(buildUniquePath('Tasks', 'Ship it', () => false)).toBe('Tasks/Ship it.md')
    })

    test('writes to the vault root when there is no folder', () => {
        expect(buildUniquePath('', 'Ship it', () => false)).toBe('Ship it.md')
    })

    test('suffixes until the path is free', () => {
        const taken = new Set(['Tasks/Ship it.md', 'Tasks/Ship it 1.md'])
        expect(buildUniquePath('Tasks', 'Ship it', (p) => taken.has(p))).toBe('Tasks/Ship it 2.md')
    })
})

describe('applyCoreTemplatePlaceholders', () => {
    const values = {
        title: 'Ship it',
        date: '2026-07-30',
        time: '14:05',
        format: (token: string) => `<${token}>`
    }

    test('substitutes title, date and time', () => {
        expect(applyCoreTemplatePlaceholders('{{title}} {{date}} {{time}}', values)).toBe(
            'Ship it 2026-07-30 14:05'
        )
    })

    test('passes an explicit format through to the formatter', () => {
        expect(applyCoreTemplatePlaceholders('{{date:YYYY}}', values)).toBe('<YYYY>')
    })

    test('leaves unknown placeholders untouched', () => {
        expect(applyCoreTemplatePlaceholders('{{foo}}', values)).toBe('{{foo}}')
    })
})
