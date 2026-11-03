import { describe, expect, test } from 'bun:test'
import {
    LinkedNotesIndex,
    computeTrackedTimeOf,
    linkedNotesEventHandlers,
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

describe('linkedTargetsOf: tags and link resolution', () => {
    test("reads tags the way Obsidian does: comma / space strings and 'tag:'", () => {
        const v = fakeVault({
            [RUN]: {},
            'comma.md': {
                tags: 'journal, type/session/music',
                related_activities: '[[Run (Activity)]]'
            },
            'space.md': { tags: 'journal #Type/Session', related_activities: '[[Run (Activity)]]' },
            'tag.md': { tag: 'type/session', related_activities: '[[Run (Activity)]]' },
            'prefix.md': { tags: 'type/sessions', related_activities: '[[Run (Activity)]]' }
        })
        for (const path of ['comma.md', 'space.md', 'tag.md']) {
            expect([...linkedTargetsOf(v.app, v.file(path), CONFIG)]).toEqual([RUN])
        }
        expect(linkedTargetsOf(v.app, v.file('prefix.md'), CONFIG).size).toBe(0)
    })

    test('two targets with the same basename: each link resolves from its source', () => {
        const v = fakeVault({
            'Work/Run.md': {},
            'Sport/Run.md': {},
            'Work/a.md': session(['[[Run]]']),
            'Sport/b.md': session(['[[Run]]']),
            'Sport/c.md': session(['[[Work/Run]]'])
        })
        const index = new LinkedNotesIndex(v.app)
        expect(index.sourcesFor('Work/Run.md', CONFIG)).toEqual(['Sport/c.md', 'Work/a.md'])
        expect(index.sourcesFor('Sport/Run.md', CONFIG)).toEqual(['Sport/b.md'])
    })
})

describe('linkedNotesEventHandlers (the plugin wiring)', () => {
    test('ignores events until an index is built, then reports touched targets', () => {
        const v = fakeVault({
            [RUN]: {},
            'a.md': session(['[[Run (Activity)]]'], { time_spent: 5 })
        })
        const index = new LinkedNotesIndex(v.app)
        const seen: string[][] = []
        const handlers = linkedNotesEventHandlers(
            () => index,
            (targets) => seen.push([...targets].sort())
        )
        v.set('a.md', session(['[[Run (Activity)]]'], { time_spent: 6 }))
        handlers.changed(v.file('a.md'))
        expect(seen).toEqual([])
        index.sourcesFor(RUN, CONFIG)
        handlers.changed(v.file('a.md'))
        handlers.resolve(v.file('a.md'))
        expect(seen).toEqual([])
        v.set('a.md', session(['[[Run (Activity)]]'], { time_spent: 7 }))
        handlers.changed(v.file('a.md'))
        handlers.resolve(v.file('a.md'))
        expect(seen).toEqual([[RUN]])
        const fm = v.frontmatter.get('a.md') ?? {}
        v.delete('a.md')
        handlers.rename(v.set('b.md', fm), 'a.md')
        expect(seen).toHaveLength(1)
        expect(index.sourcesFor(RUN, CONFIG)).toEqual(['b.md'])
        v.delete('b.md')
        handlers.deleted('b.md')
        expect(seen).toEqual([[RUN], [RUN]])
    })

    test('no index at all: handlers do nothing', () => {
        const v = fakeVault({ 'a.md': {} })
        const seen: unknown[] = []
        const handlers = linkedNotesEventHandlers(
            () => null,
            (targets) => seen.push(targets)
        )
        handlers.changed(v.file('a.md'))
        handlers.deleted('a.md')
        expect(seen).toEqual([])
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
    })

    test('notifies a target only when the minutes, date or targets change', () => {
        const v = fakeVault({
            [RUN]: {},
            'Swim.md': {},
            'a.md': session(['[[Run (Activity)]]', '[[Swim]]'], {
                time_spent: 5,
                date: '2026-11-02'
            })
        })
        const index = new LinkedNotesIndex(v.app)
        index.sourcesFor(RUN, CONFIG)
        // Body-only edit (same frontmatter): nothing to refresh.
        expect(index.update(v.file('a.md')).size).toBe(0)
        // Another property: nothing either.
        v.set(
            'a.md',
            session(['[[Run (Activity)]]', '[[Swim]]'], {
                time_spent: 5,
                date: '2026-11-02',
                mood: 'ok'
            })
        )
        expect(index.update(v.file('a.md')).size).toBe(0)
        // Minutes: every target. Rounding to the same value: none.
        v.set(
            'a.md',
            session(['[[Run (Activity)]]', '[[Swim]]'], { time_spent: 6, date: '2026-11-02' })
        )
        expect([...index.update(v.file('a.md'))].sort()).toEqual([RUN, 'Swim.md'])
        v.set(
            'a.md',
            session(['[[Run (Activity)]]', '[[Swim]]'], { time_spent: '6.2', date: '2026-11-02' })
        )
        expect(index.update(v.file('a.md')).size).toBe(0)
        // Date: every target.
        v.set(
            'a.md',
            session(['[[Run (Activity)]]', '[[Swim]]'], { time_spent: 6, date: '2026-11-03' })
        )
        expect([...index.update(v.file('a.md'))].sort()).toEqual([RUN, 'Swim.md'])
        // Dropping one target: only that one.
        v.set('a.md', session(['[[Run (Activity)]]'], { time_spent: 6, date: '2026-11-03' }))
        expect([...index.update(v.file('a.md'))]).toEqual(['Swim.md'])
        expect(index.linkedFor(RUN, CONFIG)).toEqual([
            { path: 'a.md', minutes: 6, date: '2026-11-03' }
        ])
    })

    test('rename re-keys a moved source and a moved target', () => {
        const v = fakeVault({
            [RUN]: {},
            'a.md': session(['[[Run (Activity)]]'], { time_spent: 10, date: '2026-11-02' })
        })
        const index = new LinkedNotesIndex(v.app)
        index.sourcesFor(RUN, CONFIG)
        // The source moves.
        const fm = v.frontmatter.get('a.md') ?? {}
        v.delete('a.md')
        const moved = v.set('Sessions/a.md', fm)
        expect([...index.rename(moved, 'a.md')]).toEqual([])
        expect(index.linkedFor(RUN, CONFIG)).toEqual([
            { path: 'Sessions/a.md', minutes: 10, date: '2026-11-02' }
        ])
        // The target moves (its links keep resolving by basename).
        v.delete(RUN)
        const target = v.set('Areas/Run (Activity).md', {})
        expect([...index.rename(target, RUN)].sort()).toEqual([RUN, 'Areas/Run (Activity).md'])
        expect(index.sourcesFor(RUN, CONFIG)).toEqual([])
        expect(index.sourcesFor('Areas/Run (Activity).md', CONFIG)).toEqual(['Sessions/a.md'])
        expect(index.isBuilt).toBe(true)
    })

    test('retain drops the indexes no type uses', () => {
        const v = fakeVault({ [RUN]: {}, 'a.md': session(['[[Run (Activity)]]']) })
        const index = new LinkedNotesIndex(v.app)
        const other = { ...CONFIG, requiredTag: 'type/play' }
        index.sourcesFor(RUN, CONFIG)
        index.sourcesFor(RUN, other)
        index.retain([CONFIG])
        expect(index.isBuilt).toBe(true)
        index.retain([])
        expect(index.isBuilt).toBe(false)
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
        expect(linkedNotesOf(index, v.file(RUN), CONFIG)).toEqual([
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

    test('an entry linking to a note with 0 minutes is kept (minutes and last session)', () => {
        const v = vault()
        const index = new LinkedNotesIndex(v.app)
        const entries = [
            {
                startTime: '2026-11-05T19:00:00',
                endTime: '2026-11-05T20:00:00',
                description: '[[2026-11-04 Play]]'
            }
        ]
        const result = computeTrackedTimeOf(v.app, index, v.file(RUN), entries, CONFIG)
        expect(result.entryMinutes).toBe(60)
        expect(result.lastSession).toBe('2026-11-05')
    })

    test('a session note with minutes hides its entry from the last session too', () => {
        const v = vault()
        const index = new LinkedNotesIndex(v.app)
        const entries = [
            {
                startTime: '2026-11-09T07:00:00',
                endTime: '2026-11-09T08:00:00',
                description: '[[2026-11-03 Run]]'
            }
        ]
        const result = computeTrackedTimeOf(v.app, index, v.file(RUN), entries, CONFIG)
        expect(result.entryMinutes).toBe(0)
        expect(result.lastSession).toBe('2026-11-04')
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
