import { describe, expect, test } from 'bun:test'
import {
    LinkedNotesIndex,
    computeTrackedTimeOf,
    linkedNotesOf,
    linkedTargetsOf,
    linkedTimeConfigForType
} from './linked-time.service'
import type { LinkedTimeConfig } from '../domain/linked-time'
import { fakeVault } from './linked-time.fixture'

const CONFIG: LinkedTimeConfig = {
    linkProperty: 'related_activities',
    minutesProperty: 'time_spent',
    dateProperty: 'date',
    requiredTag: 'type/session'
}

const RUN = 'Activities/Run (Activity).md'

const session = (
    links: unknown,
    extra: Record<string, unknown> = {},
    tags: unknown = ['type/session/sport/running']
): Record<string, unknown> => ({ tags, related_activities: links, ...extra })

describe('linkedTimeConfigForType', () => {
    test('null when the type has no block or the block is off', () => {
        expect(linkedTimeConfigForType(undefined)).toBeNull()
        expect(linkedTimeConfigForType({ timeTracking: undefined })).toBeNull()
        expect(
            linkedTimeConfigForType({
                timeTracking: {
                    durationProperty: '',
                    totalDurationProperty: '',
                    entriesProperty: '',
                    lastSessionProperty: '',
                    linkedNotes: { ...CONFIG, enabled: false }
                }
            })
        ).toBeNull()
    })

    test('blank fields fall back to the defaults', () => {
        expect(
            linkedTimeConfigForType({
                timeTracking: {
                    durationProperty: '',
                    totalDurationProperty: '',
                    entriesProperty: '',
                    lastSessionProperty: '',
                    linkedNotes: {
                        enabled: true,
                        linkProperty: ' ',
                        minutesProperty: 'minutes',
                        dateProperty: '',
                        requiredTag: ''
                    }
                }
            })
        ).toEqual({
            linkProperty: 'related_activities',
            minutesProperty: 'minutes',
            dateProperty: 'date',
            requiredTag: 'type/session'
        })
    })
})

describe('linkedTargetsOf', () => {
    test('resolves list links, aliases included, to the target', () => {
        const v = fakeVault({
            [RUN]: {},
            'Activities/Swim (Activity).md': {},
            's.md': session(['[[Run (Activity)|Run]]', '[[Swim (Activity)]]'])
        })
        expect([...linkedTargetsOf(v.app, v.file('s.md'), CONFIG)].sort()).toEqual([
            'Activities/Run (Activity).md',
            'Activities/Swim (Activity).md'
        ])
    })

    test('accepts a single link value and a single tag string', () => {
        const v = fakeVault({
            [RUN]: {},
            's.md': session('[[Run (Activity)]]', {}, '#type/session')
        })
        expect([...linkedTargetsOf(v.app, v.file('s.md'), CONFIG)]).toEqual([RUN])
    })

    test('duplicate links give the target once', () => {
        const v = fakeVault({
            [RUN]: {},
            's.md': session(['[[Run (Activity)]]', '[[Run (Activity)|again]]'])
        })
        expect([...linkedTargetsOf(v.app, v.file('s.md'), CONFIG)]).toEqual([RUN])
    })

    test('nothing without the required tag', () => {
        const v = fakeVault({
            [RUN]: {},
            's.md': session(['[[Run (Activity)]]'], {}, ['type/note'])
        })
        expect(linkedTargetsOf(v.app, v.file('s.md'), CONFIG).size).toBe(0)
    })

    test('only the configured link property counts (case-insensitive name)', () => {
        const v = fakeVault({
            [RUN]: {},
            'other.md': { tags: ['type/session'], related: ['[[Run (Activity)]]'] },
            'upper.md': { tags: ['type/session'], Related_Activities: ['[[Run (Activity)]]'] }
        })
        expect(linkedTargetsOf(v.app, v.file('other.md'), CONFIG).size).toBe(0)
        expect([...linkedTargetsOf(v.app, v.file('upper.md'), CONFIG)]).toEqual([RUN])
    })

    test('unresolved links and self links are ignored', () => {
        const v = fakeVault({ 's.md': session(['[[Nowhere]]', '[[s]]']) })
        expect(linkedTargetsOf(v.app, v.file('s.md'), CONFIG).size).toBe(0)
    })
})

describe('LinkedNotesIndex', () => {
    test('builds lazily and answers sorted sources per target', () => {
        const v = fakeVault({
            [RUN]: {},
            'b.md': session(['[[Run (Activity)]]']),
            'a.md': session(['[[Run (Activity)]]']),
            'c.md': { tags: ['type/note'], related_activities: ['[[Run (Activity)]]'] }
        })
        const index = new LinkedNotesIndex(v.app)
        expect(index.isBuilt).toBe(false)
        expect(index.sourcesFor(RUN, CONFIG)).toEqual(['a.md', 'b.md'])
        expect(index.isBuilt).toBe(true)
    })

    test('update reports the old and new targets and keeps the reverse map current', () => {
        const v = fakeVault({ [RUN]: {}, 'Swim.md': {}, 'a.md': session(['[[Run (Activity)]]']) })
        const index = new LinkedNotesIndex(v.app)
        index.sourcesFor(RUN, CONFIG)
        v.set('a.md', session(['[[Swim]]']))
        expect([...index.update(v.file('a.md'))].sort()).toEqual([RUN, 'Swim.md'])
        expect(index.sourcesFor(RUN, CONFIG)).toEqual([])
        expect(index.sourcesFor('Swim.md', CONFIG)).toEqual(['a.md'])
        // A minutes-only edit: membership mode reports nothing, 'all' the target.
        v.set('a.md', session(['[[Swim]]'], { time_spent: 5 }))
        expect(index.update(v.file('a.md'), 'membership').size).toBe(0)
        expect([...index.update(v.file('a.md'), 'all')]).toEqual(['Swim.md'])
    })

    test('a note losing its tag leaves; remove drops a deleted note', () => {
        const v = fakeVault({
            [RUN]: {},
            'a.md': session(['[[Run (Activity)]]']),
            'b.md': session(['[[Run (Activity)]]'])
        })
        const index = new LinkedNotesIndex(v.app)
        index.sourcesFor(RUN, CONFIG)
        v.set('a.md', session(['[[Run (Activity)]]'], {}, ['type/note']))
        index.update(v.file('a.md'))
        expect(index.sourcesFor(RUN, CONFIG)).toEqual(['b.md'])
        v.delete('b.md')
        expect([...index.remove('b.md')]).toEqual([RUN])
        expect(index.sourcesFor(RUN, CONFIG)).toEqual([])
    })

    test('invalidate forces a rebuild on the next query', () => {
        const v = fakeVault({ [RUN]: {} })
        const index = new LinkedNotesIndex(v.app)
        expect(index.sourcesFor(RUN, CONFIG)).toEqual([])
        v.set('a.md', session(['[[Run (Activity)]]']))
        expect(index.sourcesFor(RUN, CONFIG)).toEqual([])
        index.invalidate()
        expect(index.sourcesFor(RUN, CONFIG)).toEqual(['a.md'])
    })
})

describe('linkedNotesOf / computeTrackedTimeOf', () => {
    const vault = (): ReturnType<typeof fakeVault> =>
        fakeVault({
            [RUN]: {},
            'Sessions/2026-11-02 Run.md': session(['[[Run (Activity)]]'], {
                time_spent: 30,
                date: '2026-11-02'
            }),
            'Sessions/2026-11-03 Run.md': session(
                ['[[Run (Activity)]]', '[[Run (Activity)|twice]]'],
                { time_spent: '45', date: '2026-11-03T07:15:00' }
            ),
            'Sessions/Undated.md': session(['[[Run (Activity)]]'], { time_spent: 20 }),
            'Sessions/2026-11-04 Play.md': session(['[[Run (Activity)]]'], {
                time_spent: '',
                date: '2026-11-04'
            }),
            'Sessions/Bad.md': session(['[[Run (Activity)]]'], {
                time_spent: 'long',
                date: 'yesterday'
            })
        })

    test('reads minutes and dates per note, each note once', () => {
        const v = vault()
        const index = new LinkedNotesIndex(v.app)
        expect(linkedNotesOf(v.app, index, v.file(RUN), CONFIG)).toEqual([
            { path: 'Sessions/2026-11-02 Run.md', minutes: 30, date: '2026-11-02' },
            { path: 'Sessions/2026-11-03 Run.md', minutes: 45, date: '2026-11-03' },
            { path: 'Sessions/2026-11-04 Play.md', minutes: 0, date: '2026-11-04' },
            { path: 'Sessions/Bad.md', minutes: 0, date: null },
            { path: 'Sessions/Undated.md', minutes: 20, date: null }
        ])
    })

    test('entries + linked notes; an entry linking to a counted note is skipped', () => {
        const v = vault()
        const index = new LinkedNotesIndex(v.app)
        const entries = [
            { startTime: '2026-10-01T10:00:00', endTime: '2026-10-01T10:30:00', description: '' },
            // The 2026-11-03 run, logged as an entry too: counts once, as the note.
            {
                startTime: '2026-11-03T07:00:00',
                endTime: '2026-11-03T08:00:00',
                description: ' [[2026-11-03 Run|Morning run]] '
            },
            // A link to a note NOT counted for the target stays an entry.
            {
                startTime: '2026-10-05T10:00:00',
                endTime: '2026-10-05T10:10:00',
                description: '[[Run (Activity)]]'
            }
        ]
        const result = computeTrackedTimeOf(v.app, index, v.file(RUN), entries, CONFIG)
        expect(result.entryMinutes).toBe(40)
        expect(result.linkedMinutes).toBe(95)
        expect(result.minutes).toBe(135)
        expect(result.lastSession).toBe('2026-11-04')
        expect(result.linkedNotes).toHaveLength(5)
    })

    test('without a config only the entries count (no entry skipped)', () => {
        const v = vault()
        const index = new LinkedNotesIndex(v.app)
        const entries = [
            {
                startTime: '2026-11-03T07:00:00',
                endTime: '2026-11-03T08:00:00',
                description: '[[2026-11-03 Run]]'
            }
        ]
        const result = computeTrackedTimeOf(v.app, index, v.file(RUN), entries, null)
        expect(result.minutes).toBe(60)
        expect(result.lastSession).toBe('2026-11-03')
        expect(result.linkedNotes).toEqual([])
    })
})
