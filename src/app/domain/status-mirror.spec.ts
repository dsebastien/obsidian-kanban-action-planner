import { describe, expect, test } from 'bun:test'
import type { AutomationRule } from './note-type'
import type { SkResolvedStatus } from '../services/starter-kit.service'
import {
    mergeMirroredRules,
    mirroredDoneConfig,
    mirroredStampRules,
    reconcileDone
} from './status-mirror'

const explicit: SkResolvedStatus = {
    property: 'status',
    explicit: true,
    values: [
        {
            value: '20 - Planned',
            done: false,
            outcome: null,
            stampsDate: 'date_committed',
            stampOnlyIfEmpty: true
        },
        {
            value: '30 - Active',
            done: false,
            outcome: null,
            stampsDate: null,
            stampOnlyIfEmpty: true
        },
        {
            value: '60 - Completed',
            done: true,
            outcome: 'success',
            stampsDate: 'date_completed',
            stampOnlyIfEmpty: false
        },
        {
            value: '70 - Abandoned',
            done: true,
            outcome: 'failure',
            stampsDate: 'date_abandoned',
            stampOnlyIfEmpty: true
        }
    ]
}
const heuristic: SkResolvedStatus = { ...explicit, explicit: false }
const rule = (id: string): AutomationRule => ({
    id,
    name: id,
    enabled: true,
    trigger: { kind: 'done-entered' },
    actions: []
})

describe('mirroredDoneConfig / reconcileDone', () => {
    test('explicit status → read-only done config with the done values', () => {
        expect(mirroredDoneConfig(explicit)).toEqual({
            enabled: true,
            property: '',
            values: ['60 - Completed', '70 - Abandoned'],
            mirrored: true
        })
        expect(mirroredDoneConfig(heuristic)).toBeNull()
        expect(mirroredDoneConfig(null)).toBeNull()
    })
    test('reconcile keeps a plugin-owned config, and un-flags a previously mirrored one', () => {
        const own = { enabled: true, property: '', values: ['80 - Done'] }
        expect(reconcileDone(own, heuristic)).toBe(own)
        expect(reconcileDone(undefined, null)).toBeUndefined()
        expect(reconcileDone({ ...own, mirrored: true }, null)).toEqual(own)
        expect(reconcileDone(own, explicit)?.mirrored).toBe(true)
    })
})

describe('mirroredStampRules / mergeMirroredRules', () => {
    test('one status-entered rule per stamping value, only-if-empty carried over', () => {
        const rules = mirroredStampRules(explicit)
        expect(rules.map((r) => r.id)).toEqual([
            'sk-stamp:20 - Planned',
            'sk-stamp:60 - Completed',
            'sk-stamp:70 - Abandoned'
        ])
        expect(rules[0]).toMatchObject({
            name: 'Stamp date_committed on Planned',
            trigger: { kind: 'status-entered', statuses: ['20 - Planned'] },
            actions: [
                {
                    kind: 'set-property',
                    property: 'date_committed',
                    value: '{{date}}',
                    onlyIfEmpty: true
                }
            ]
        })
        expect(rules[1]?.actions[0]).toMatchObject({ onlyIfEmpty: false })
        expect(mirroredStampRules(heuristic)).toEqual([])
    })
    test('merge replaces stale mirrored rules in place and keeps user rules in order', () => {
        const existing = [
            rule('user-1'),
            rule('sk-stamp:old'),
            rule('user-2'),
            rule('sk-stamp:older')
        ]
        const fresh = mirroredStampRules(explicit)
        expect(mergeMirroredRules(existing, fresh).map((r) => r.id)).toEqual([
            'user-1',
            'sk-stamp:20 - Planned',
            'sk-stamp:60 - Completed',
            'sk-stamp:70 - Abandoned',
            'user-2'
        ])
        expect(mergeMirroredRules([rule('user-1')], fresh).map((r) => r.id)[0]).toBe('user-1')
        expect(mergeMirroredRules([rule('sk-stamp:old')], []).length).toBe(0)
    })
})
