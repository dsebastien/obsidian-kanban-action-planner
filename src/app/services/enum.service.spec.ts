import { describe, expect, it } from 'bun:test'
import { manualAllowedValues, pickAllowedValues } from './enum.service'
import { createDefaultNoteType } from './note-type.service'

describe('manualAllowedValues (issue #52)', () => {
    const noteType = {
        ...createDefaultNoteType('t', 'T', 'local'),
        enumProperties: { Priority: ['10 - Top', '99 - TBD'] }
    }

    it('reads a manual list by case-insensitive property name', () => {
        expect(manualAllowedValues(noteType, 'priority')).toEqual(['10 - Top', '99 - TBD'])
        expect(manualAllowedValues(noteType, 'Priority')).toEqual(['10 - Top', '99 - TBD'])
    })

    it('returns undefined for an unknown property or missing note type', () => {
        expect(manualAllowedValues(noteType, 'effort')).toBeUndefined()
        expect(manualAllowedValues(undefined, 'priority')).toBeUndefined()
    })
})

describe('pickAllowedValues (issue #52)', () => {
    it('prefers a non-empty manual list over the Starter Kit list', () => {
        expect(pickAllowedValues(['m'], ['s1', 's2'])).toEqual(['m'])
    })

    it('falls back to the Starter Kit list when manual is empty/absent', () => {
        expect(pickAllowedValues([], ['s1', 's2'])).toEqual(['s1', 's2'])
        expect(pickAllowedValues(undefined, ['s1'])).toEqual(['s1'])
    })

    it('returns [] when neither source has values', () => {
        expect(pickAllowedValues(undefined, [])).toEqual([])
    })
})
