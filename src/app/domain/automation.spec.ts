import { describe, expect, it } from 'bun:test'
import {
    coerceActionValue,
    dedupeRules,
    doneIsStatusBased,
    normalizeTag,
    propertyConditionMet,
    tagMatches,
    rawValuesEqual,
    rulesForArchive,
    rulesForPropertyChange,
    rulesForTransition,
    watchedProperties
} from './automation'
import type { AutomationRule } from './note-type'
import type { ResolvedDoneConfig } from './done'

function rule(overrides: Partial<AutomationRule>): AutomationRule {
    return {
        id: 'r1',
        name: '',
        enabled: true,
        trigger: { kind: 'status-entered', statuses: ['80 - Done'] },
        actions: [],
        ...overrides
    }
}

const DONE: ResolvedDoneConfig = { property: 'status', values: ['80 - Done', '70 - Abandoned'] }

describe('rulesForTransition', () => {
    it('matches when the note enters a trigger status', () => {
        const rules = [rule({})]
        expect(
            rulesForTransition(rules, { from: '10 - Todo', to: '80 - Done' }, null, 'status')
        ).toHaveLength(1)
    })

    it('never fires without an actual transition', () => {
        const rules = [rule({})]
        expect(
            rulesForTransition(rules, { from: '80 - Done', to: '80 - Done' }, null, 'status')
        ).toHaveLength(0)
        expect(rulesForTransition(rules, { from: null, to: null }, null, 'status')).toHaveLength(0)
    })

    it('ignores disabled rules', () => {
        const rules = [rule({ enabled: false })]
        expect(
            rulesForTransition(rules, { from: null, to: '80 - Done' }, null, 'status')
        ).toHaveLength(0)
    })

    it('does not match a cleared status', () => {
        const rules = [rule({})]
        expect(
            rulesForTransition(rules, { from: '80 - Done', to: null }, null, 'status')
        ).toHaveLength(0)
    })

    it('matches done-entered when entering any done value from a non-done one', () => {
        const rules = [rule({ trigger: { kind: 'done-entered' } })]
        expect(
            rulesForTransition(rules, { from: '10 - Todo', to: '80 - Done' }, DONE, 'status')
        ).toHaveLength(1)
        expect(
            rulesForTransition(rules, { from: null, to: '70 - Abandoned' }, DONE, 'status')
        ).toHaveLength(1)
    })

    it('does not re-fire done-entered on a done → done move', () => {
        const rules = [rule({ trigger: { kind: 'done-entered' } })]
        expect(
            rulesForTransition(rules, { from: '80 - Done', to: '70 - Abandoned' }, DONE, 'status')
        ).toHaveLength(0)
    })

    it('done-entered needs a done config on the status property', () => {
        const rules = [rule({ trigger: { kind: 'done-entered' } })]
        expect(
            rulesForTransition(rules, { from: null, to: '80 - Done' }, null, 'status')
        ).toHaveLength(0)
        const otherProperty: ResolvedDoneConfig = { property: 'completed', values: [] }
        expect(
            rulesForTransition(rules, { from: null, to: '80 - Done' }, otherProperty, 'status')
        ).toHaveLength(0)
    })

    it('returns matches in configured order', () => {
        const rules = [
            rule({ id: 'a', trigger: { kind: 'done-entered' } }),
            rule({ id: 'b' }),
            rule({ id: 'c', trigger: { kind: 'status-entered', statuses: ['10 - Todo'] } })
        ]
        expect(
            rulesForTransition(rules, { from: '10 - Todo', to: '80 - Done' }, DONE, 'status').map(
                (r) => r.id
            )
        ).toEqual(['a', 'b'])
    })
})

describe('status-left trigger', () => {
    it('matches when the note leaves a trigger status', () => {
        const rules = [rule({ trigger: { kind: 'status-left', statuses: ['10 - Backlog'] } })]
        expect(
            rulesForTransition(
                rules,
                { from: '10 - Backlog', to: '50 - This Week' },
                null,
                'status'
            )
        ).toHaveLength(1)
        expect(
            rulesForTransition(rules, { from: '50 - This Week', to: '80 - Done' }, null, 'status')
        ).toHaveLength(0)
        expect(
            rulesForTransition(rules, { from: null, to: '10 - Backlog' }, null, 'status')
        ).toHaveLength(0)
    })
})

describe('rulesForArchive', () => {
    it('returns only enabled archived-trigger rules', () => {
        const rules = [
            rule({ id: 'a', trigger: { kind: 'archived' } }),
            rule({ id: 'b' }),
            rule({ id: 'c', enabled: false, trigger: { kind: 'archived' } })
        ]
        expect(rulesForArchive(rules).map((r) => r.id)).toEqual(['a'])
    })
})

describe('rulesForPropertyChange (edge-triggered)', () => {
    const progressRule = rule({
        trigger: { kind: 'property-condition', property: 'progress', operator: 'gte', value: '100' }
    })

    it('fires when the condition becomes true', () => {
        expect(rulesForPropertyChange([progressRule], 'progress', 40, 100)).toHaveLength(1)
        expect(rulesForPropertyChange([progressRule], 'progress', undefined, 100)).toHaveLength(1)
    })

    it('does not re-fire when the condition was already true', () => {
        expect(rulesForPropertyChange([progressRule], 'progress', 100, 120)).toHaveLength(0)
    })

    it('does not fire when the condition is false or the property differs', () => {
        expect(rulesForPropertyChange([progressRule], 'progress', 40, 60)).toHaveLength(0)
        expect(rulesForPropertyChange([progressRule], 'other', 40, 100)).toHaveLength(0)
    })

    it('matches property names case-insensitively', () => {
        expect(rulesForPropertyChange([progressRule], 'Progress', 0, 100)).toHaveLength(1)
    })
})

describe('propertyConditionMet', () => {
    it('compares numbers numerically', () => {
        expect(propertyConditionMet(100, 'gte', '100')).toBe(true)
        expect(propertyConditionMet('99', 'gte', '100')).toBe(false)
        expect(propertyConditionMet(5, 'lt', '10')).toBe(true)
        expect(propertyConditionMet('080', 'equals', '80')).toBe(true)
    })

    it('compares strings case-insensitively', () => {
        expect(propertyConditionMet('80 - Done', 'equals', '80 - done')).toBe(true)
        expect(propertyConditionMet('80 - Done', 'not-equals', '10 - Backlog')).toBe(true)
    })

    it('orders ISO dates lexically', () => {
        expect(propertyConditionMet('2026-07-16', 'gt', '2026-01-01')).toBe(true)
        expect(propertyConditionMet('2025-12-31', 'lt', '2026-01-01')).toBe(true)
    })

    it('handles set/unset on missing values', () => {
        expect(propertyConditionMet(undefined, 'unset', '')).toBe(true)
        expect(propertyConditionMet('', 'unset', '')).toBe(true)
        expect(propertyConditionMet(0, 'unset', '')).toBe(false)
        expect(propertyConditionMet(0, 'set', '')).toBe(true)
        expect(propertyConditionMet(null, 'set', '')).toBe(false)
    })

    it('missing values never satisfy comparisons, including not-equals', () => {
        expect(propertyConditionMet(undefined, 'not-equals', '100')).toBe(false)
        expect(propertyConditionMet(null, 'gte', '0')).toBe(false)
    })

    it('matches any element of a list for equals, all for not-equals', () => {
        expect(propertyConditionMet(['a', 'b'], 'equals', 'b')).toBe(true)
        expect(propertyConditionMet(['a', 'b'], 'not-equals', 'b')).toBe(false)
        expect(propertyConditionMet(['a', 'c'], 'not-equals', 'b')).toBe(true)
    })
})

describe('watchedProperties', () => {
    it('collects lowercase property names from enabled condition rules', () => {
        const rules = [
            rule({
                trigger: {
                    kind: 'property-condition',
                    property: 'Progress',
                    operator: 'gte',
                    value: '100'
                }
            }),
            rule({
                id: 'r2',
                enabled: false,
                trigger: { kind: 'property-condition', property: 'x', operator: 'set', value: '' }
            }),
            rule({ id: 'r3' })
        ]
        expect(watchedProperties(rules)).toEqual(['progress'])
    })
})

describe('dedupeRules', () => {
    it('keeps the first occurrence per id', () => {
        const a = rule({ id: 'a' })
        expect(dedupeRules([a, rule({ id: 'b' }), a]).map((r) => r.id)).toEqual(['a', 'b'])
    })
})

describe('rawValuesEqual', () => {
    it('treats undefined and null as the same missing value', () => {
        expect(rawValuesEqual(undefined, null)).toBe(true)
        expect(rawValuesEqual(undefined, '')).toBe(false)
    })

    it('compares arrays structurally', () => {
        expect(rawValuesEqual(['a'], ['a'])).toBe(true)
        expect(rawValuesEqual(['a'], ['a', 'b'])).toBe(false)
    })
})

describe('doneIsStatusBased', () => {
    it('compares case-insensitively', () => {
        expect(doneIsStatusBased({ property: 'Status', values: [] }, 'status')).toBe(true)
        expect(doneIsStatusBased({ property: 'completed', values: [] }, 'status')).toBe(false)
    })
})

describe('coerceActionValue', () => {
    it('coerces plain numbers', () => {
        expect(coerceActionValue('100')).toBe(100)
        expect(coerceActionValue(' 42.5 ')).toBe(42.5)
        expect(coerceActionValue('-3')).toBe(-3)
    })

    it('coerces booleans', () => {
        expect(coerceActionValue('true')).toBe(true)
        expect(coerceActionValue('false')).toBe(false)
    })

    it('keeps dates and text as strings', () => {
        expect(coerceActionValue('2026-07-16')).toBe('2026-07-16')
        expect(coerceActionValue('80 - Done')).toBe('80 - Done')
        expect(coerceActionValue('')).toBe('')
        expect(coerceActionValue('1e5')).toBe('1e5')
    })

    it('only coerces canonical numeric strings (no zero-padding/precision loss)', () => {
        expect(coerceActionValue('080')).toBe('080')
        expect(coerceActionValue('007')).toBe('007')
        expect(coerceActionValue('9007199254740993')).toBe('9007199254740993')
        expect(coerceActionValue('+5')).toBe('+5')
    })

    it('trims string results so padded values match status columns', () => {
        expect(coerceActionValue(' 80 - Done ')).toBe('80 - Done')
    })
})

describe('tagMatches', () => {
    it('matches case-insensitively and #-agnostically', () => {
        expect(tagMatches('Foo', 'foo')).toBe(true)
        expect(tagMatches('#foo', 'foo')).toBe(true)
        expect(tagMatches('foo/bar', 'FOO/BAR')).toBe(true)
        expect(tagMatches('bar', 'foo')).toBe(false)
        expect(tagMatches(42, 'foo')).toBe(false)
        expect(tagMatches(null, 'foo')).toBe(false)
    })
})

describe('normalizeTag', () => {
    it('strips leading hashes and whitespace', () => {
        expect(normalizeTag(' #type/task ')).toBe('type/task')
        expect(normalizeTag('##x')).toBe('x')
        expect(normalizeTag('  ')).toBe('')
    })
})
