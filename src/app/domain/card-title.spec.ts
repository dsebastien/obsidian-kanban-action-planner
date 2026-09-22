import { describe, expect, it } from 'bun:test'
import {
    cardTitleAffixes,
    defaultNamingConfig,
    defaultTitleDisplayConfig,
    namingConfigSchema,
    stripTitleAffixes,
    titleDisplaySchema,
    type NamingConfig,
    type TitleDisplayConfig
} from './card-title'

const display = (patch: Partial<TitleDisplayConfig> = {}): TitleDisplayConfig => ({
    ...defaultTitleDisplayConfig(),
    ...patch
})

describe('titleDisplaySchema', () => {
    it('defaults both toggles ON so stored types with no block still filter', () => {
        expect(titleDisplaySchema.parse({})).toEqual({
            stripPrefix: true,
            stripSuffix: true,
            extraPrefixes: [],
            extraSuffixes: []
        })
    })

    it('keeps an explicit opt-out', () => {
        expect(titleDisplaySchema.parse({ stripSuffix: false }).stripSuffix).toBe(false)
    })
})

/** A naming config with the Starter Kit's optional flags off unless asked. */
function naming(
    prefix: string,
    suffix: string,
    optional?: { prefixOptional?: boolean; suffixOptional?: boolean }
): NamingConfig {
    return {
        prefix,
        suffix,
        prefixOptional: optional?.prefixOptional ?? false,
        suffixOptional: optional?.suffixOptional ?? false
    }
}

describe('namingConfigSchema', () => {
    it('defaults the optional flags to FALSE, so a stored type behaves as before', () => {
        expect(namingConfigSchema.parse({ prefix: '', suffix: ' (Task)' })).toEqual({
            prefix: '',
            suffix: ' (Task)',
            prefixOptional: false,
            suffixOptional: false
        })
    })

    it('keeps the flags the Starter Kit declares', () => {
        expect(namingConfigSchema.parse({ suffixOptional: true }).suffixOptional).toBe(true)
    })
})

describe('cardTitleAffixes', () => {
    it('uses the type naming when there is no creation override', () => {
        expect(
            cardTitleAffixes({
                titleDisplay: display(),
                naming: naming('AI Wiki - ', '')
            })
        ).toEqual({ prefixes: ['AI Wiki - '], suffixes: [] })
    })

    it('prefers the creation override over the mirrored naming', () => {
        expect(
            cardTitleAffixes({
                titleDisplay: display(),
                naming: naming('', ' (Task)'),
                creation: { namePrefix: '', nameSuffix: ' (Chore)' }
            }).suffixes
        ).toEqual([' (Chore)'])
    })

    it('adds the extras and sorts longest first', () => {
        expect(
            cardTitleAffixes({
                titleDisplay: display({ extraSuffixes: [' (Draft)', ' (X)'] }),
                naming: naming('', ' (Task)')
            }).suffixes
        ).toEqual([' (Draft)', ' (Task)', ' (X)'])
    })

    it('drops a whole side when its toggle is off, extras included', () => {
        expect(
            cardTitleAffixes({
                titleDisplay: display({ stripSuffix: false, extraSuffixes: [' (Draft)'] }),
                naming: naming('', ' (Task)')
            }).suffixes
        ).toEqual([])
    })

    it('deduplicates an override that equals the mirrored value', () => {
        expect(
            cardTitleAffixes({
                titleDisplay: display({ extraSuffixes: [' (Task)'] }),
                naming: naming('', ' (Task)')
            }).suffixes
        ).toEqual([' (Task)'])
    })

    it('still strips an affix the Starter Kit marks optional', () => {
        expect(
            cardTitleAffixes({
                titleDisplay: display(),
                naming: naming('', ' (Task)', { suffixOptional: true })
            }).suffixes
        ).toEqual([' (Task)'])
    })

    it('is empty for a type with no decoration', () => {
        expect(
            cardTitleAffixes({ titleDisplay: display(), naming: defaultNamingConfig() })
        ).toEqual({ prefixes: [], suffixes: [] })
    })
})

describe('stripTitleAffixes', () => {
    const affixes = { prefixes: ['AI Wiki - '], suffixes: [' (Task)'] }

    it('strips a suffix', () => {
        expect(stripTitleAffixes('Ship the plugin (Task)', affixes)).toBe('Ship the plugin')
    })

    it('strips a prefix', () => {
        expect(stripTitleAffixes('AI Wiki - Vector search', affixes)).toBe('Vector search')
    })

    it('strips both ends at once', () => {
        expect(stripTitleAffixes('AI Wiki - Vector search (Task)', affixes)).toBe('Vector search')
    })

    it('leaves a title that carries neither affix alone', () => {
        expect(stripTitleAffixes('Ship the plugin', affixes)).toBe('Ship the plugin')
    })

    it('only strips at the ends, never mid-title', () => {
        expect(stripTitleAffixes('A (Task) of two halves', affixes)).toBe('A (Task) of two halves')
    })

    it('strips one suffix, not a repeated one', () => {
        expect(stripTitleAffixes('Ship it (Task) (Task)', affixes)).toBe('Ship it (Task)')
    })

    it('prefers the longest matching affix', () => {
        expect(
            stripTitleAffixes('Standup (Meeting Note)', {
                prefixes: [],
                suffixes: [' (Meeting Note)', ' (Meeting)']
            })
        ).toBe('Standup')
    })

    it('never blanks a card whose whole name is the decoration', () => {
        expect(stripTitleAffixes('(Task)', { prefixes: [], suffixes: ['(Task)'] })).toBe('(Task)')
    })

    it('never blanks a card that is exactly prefix + suffix', () => {
        expect(
            stripTitleAffixes('AI Wiki -  (Task)', {
                prefixes: ['AI Wiki - '],
                suffixes: [' (Task)']
            })
        ).toBe('AI Wiki -  (Task)')
    })

    it('is a no-op when no affixes are configured', () => {
        expect(stripTitleAffixes('Ship it (Task)', { prefixes: [], suffixes: [] })).toBe(
            'Ship it (Task)'
        )
    })

    it('matches a placeholder prefix by shape, not by its literal template', () => {
        expect(
            stripTitleAffixes('2026-09-22 - Standup', { prefixes: ['{{date}} - '], suffixes: [] })
        ).toBe('Standup')
    })

    it('leaves a title whose head does not fit the placeholder shape', () => {
        expect(stripTitleAffixes('Q3 - Standup', { prefixes: ['{{date}} - '], suffixes: [] })).toBe(
            'Q3 - Standup'
        )
    })

    it('handles every supported placeholder shape', () => {
        expect(
            stripTitleAffixes('2026-Q3-38 - Review', {
                prefixes: ['{{year}}-{{quarter}}-{{week}} - '],
                suffixes: []
            })
        ).toBe('Review')
    })

    it('treats an unknown placeholder as a literal', () => {
        expect(
            stripTitleAffixes('{{nope}} - Review', { prefixes: ['{{nope}} - '], suffixes: [] })
        ).toBe('Review')
    })

    it('escapes regex metacharacters in a templated affix', () => {
        expect(
            stripTitleAffixes('Review [2026]', { prefixes: [], suffixes: [' [{{year}}]'] })
        ).toBe('Review')
    })
})
