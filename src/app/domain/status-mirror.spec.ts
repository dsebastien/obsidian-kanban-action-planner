import { describe, expect, test } from 'bun:test'
import type { AutomationRule } from './note-type'
import type { SkResolvedStatus } from '../services/starter-kit.service'
import {
    mergeMirroredRules,
    mirroredDoneConfig,
    mirroredStampRules,
    reconcileDone,
    userRuleCovers,
    activeStatusValues,
    mirroredStatusRoles,
    mirroredArchiveConfig,
    reconcileArchive
} from './status-mirror'

const explicit: SkResolvedStatus = {
    property: 'status',
    explicit: true,
    values: [
        {
            value: '20 - Planned',
            done: false,
            outcome: null,
            role: 'scheduled',
            stampsDate: 'date_committed',
            stampOnlyIfEmpty: true
        },
        {
            value: '30 - Active',
            done: false,
            outcome: null,
            role: 'active',
            stampsDate: null,
            stampOnlyIfEmpty: true
        },
        {
            value: '60 - Completed',
            done: true,
            outcome: 'success',
            role: null,
            stampsDate: 'date_completed',
            stampOnlyIfEmpty: false
        },
        {
            value: '70 - Abandoned',
            done: true,
            outcome: 'failure',
            role: null,
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
        // The Starter Kit executes its own rules: nothing is mirrored, even when explicit.
        expect(mirroredStampRules(explicit, true)).toEqual([])
        expect(
            mergeMirroredRules(mirroredStampRules(explicit), mirroredStampRules(explicit, true))
        ).toEqual([])
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

describe('userRuleCovers (dedupe by status + property)', () => {
    const stampCompleted = mirroredStampRules(explicit)[1]!
    const userRule = (over: Partial<AutomationRule>): AutomationRule => ({
        id: 'project-completed',
        name: 'Completed',
        enabled: true,
        trigger: { kind: 'status-entered', statuses: ['60 - Completed'] },
        actions: [
            { kind: 'set-property', property: 'progress', value: '100' },
            {
                kind: 'set-property',
                property: 'Date_Completed',
                value: '{{date}}',
                onlyIfEmpty: true
            }
        ],
        ...over
    })
    test('a user status-entered rule stamping the same property covers the mirror', () => {
        expect(userRuleCovers(userRule({}), stampCompleted)).toBe(true)
        expect(
            mergeMirroredRules([userRule({})], mirroredStampRules(explicit)).map((r) => r.id)
        ).toEqual(['project-completed', 'sk-stamp:20 - Planned', 'sk-stamp:70 - Abandoned'])
    })
    test('disabled, other-status, other-property, done-entered or mirrored rules do not cover', () => {
        expect(userRuleCovers(userRule({ enabled: false }), stampCompleted)).toBe(false)
        expect(
            userRuleCovers(
                userRule({ trigger: { kind: 'status-entered', statuses: ['70 - Abandoned'] } }),
                stampCompleted
            )
        ).toBe(false)
        expect(
            userRuleCovers(
                userRule({
                    actions: [{ kind: 'set-property', property: 'progress', value: '100' }]
                }),
                stampCompleted
            )
        ).toBe(false)
        expect(
            userRuleCovers(userRule({ trigger: { kind: 'done-entered' } }), stampCompleted)
        ).toBe(false)
        expect(userRuleCovers(userRule({ id: 'sk-stamp:60 - Completed' }), stampCompleted)).toBe(
            false
        )
    })
})

describe('mirroredStatusRoles / activeStatusValues (issue #172)', () => {
    const columns = explicit.values.map((v) => ({ statusValue: v.value }))

    test('mirrors the roles of an explicit status and skips unset ones', () => {
        expect(mirroredStatusRoles(explicit)).toEqual({
            '20 - Planned': 'scheduled',
            '30 - Active': 'active'
        })
        expect(mirroredStatusRoles({ ...explicit, explicit: false })).toEqual({})
        expect(mirroredStatusRoles(null)).toEqual({})
    })

    test('active values come from the roles when known', () => {
        expect(activeStatusValues({ columns, statusRoles: mirroredStatusRoles(explicit) })).toEqual(
            ['30 - Active']
        )
    })

    test('without roles, every non-done value counts as active', () => {
        expect(
            activeStatusValues({
                columns,
                statusRoles: {},
                done: { enabled: true, values: ['60 - Completed', '70 - Abandoned'] }
            })
        ).toEqual(['20 - Planned', '30 - Active'])
        expect(activeStatusValues({ columns, statusRoles: {} })).toHaveLength(4)
    })
})

describe('archive mirror (Starter Kit ≥ 1.19)', () => {
    const skArchive = {
        folder: '60 Archives/Projects/{{year}}',
        afterDays: 7,
        statuses: ['60 - Completed', '70 - Abandoned']
    }

    test('mirrors folder, statuses, the dates those statuses stamp, and the per-type delay', () => {
        expect(mirroredArchiveConfig(skArchive, explicit)).toEqual({
            archiveFolder: '60 Archives/Projects/{{year}}',
            triggerStatuses: ['60 - Completed', '70 - Abandoned'],
            doneDateProperties: ['date_completed', 'date_abandoned'],
            graceDays: 7,
            mirrored: true
        })
    })

    test('a status that stamps no date contributes no done-date property', () => {
        const only = { ...skArchive, statuses: ['30 - Active'] }
        expect(mirroredArchiveConfig(only, explicit)?.doneDateProperties).toEqual([])
    })

    test('nothing to mirror without a Starter Kit archive', () => {
        expect(mirroredArchiveConfig(null, explicit)).toBeNull()
    })

    test('reconcile: the mirror wins; a plugin-owned config is kept; a stale mirror is handed back blank', () => {
        const local = { archiveFolder: 'Local', triggerStatuses: ['x'], doneDateProperties: [] }
        expect(reconcileArchive(local, skArchive, explicit).mirrored).toBe(true)
        expect(reconcileArchive(local, null, explicit)).toBe(local)
        expect(
            reconcileArchive({ ...local, mirrored: true, graceDays: 7 }, null, explicit)
        ).toEqual({
            archiveFolder: '',
            triggerStatuses: [],
            doneDateProperties: []
        })
    })
})
