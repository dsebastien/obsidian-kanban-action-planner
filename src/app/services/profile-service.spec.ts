import { describe, expect, it } from 'bun:test'
import {
    colorForStatus,
    columnsFromValues,
    createDefaultProfile,
    DEFAULT_PROFILE_ID
} from './profile-service'
import { profileSchema } from '../domain/profile'
import { autoAssignColor } from './colors.service'

describe('createDefaultProfile', () => {
    it('produces a fully-populated, schema-valid profile', () => {
        const profile = createDefaultProfile(DEFAULT_PROFILE_ID, 'Default', 'local')
        expect(() => profileSchema.parse(profile)).not.toThrow()
        expect(profile.colors.autoAssign).toBe(true)
        expect(profile.laneGrouping).toEqual({ kind: 'none' })
        expect(profile.card.titleSource).toEqual({ kind: 'note-name' })
    })
})

describe('colorForStatus', () => {
    const base = createDefaultProfile('p', 'P', 'local')

    it('uses an explicit override when present', () => {
        const profile = {
            ...base,
            colors: {
                autoAssign: true,
                overrides: { Done: { kind: 'hex', value: '#123456' } as const }
            }
        }
        expect(colorForStatus(profile, 'Done')).toEqual({ kind: 'hex', value: '#123456' })
    })

    it('auto-assigns when enabled and no override', () => {
        expect(colorForStatus(base, 'Doing')).toEqual(autoAssignColor('Doing'))
    })

    it('uses a neutral when auto-assign is off', () => {
        const profile = { ...base, colors: { autoAssign: false, overrides: {} } }
        expect(colorForStatus(profile, 'Doing')).toEqual({ kind: 'palette', token: 'slate' })
    })
})

describe('columnsFromValues', () => {
    const profile = createDefaultProfile('p', 'P', 'local')

    it('preserves order when asked (e.g. Starter Kit allowed values)', () => {
        const cols = columnsFromValues(['30 Done', '10 Todo', '20 Doing'], profile, true)
        expect(cols.map((c) => c.statusValue)).toEqual(['30 Done', '10 Todo', '20 Doing'])
    })

    it('sorts by numeric/lexical prefix when not preserving order', () => {
        const cols = columnsFromValues(['30 Done', '10 Todo', '20 Doing'], profile, false)
        expect(cols.map((c) => c.statusValue)).toEqual(['10 Todo', '20 Doing', '30 Done'])
        expect(cols.map((c) => c.label)).toEqual(['Todo', 'Doing', 'Done'])
    })

    it('de-duplicates values', () => {
        const cols = columnsFromValues(['a', 'a', 'b'], profile, true)
        expect(cols.map((c) => c.statusValue)).toEqual(['a', 'b'])
    })
})
