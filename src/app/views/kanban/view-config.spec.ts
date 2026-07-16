import { describe, expect, it } from 'bun:test'
import {
    basesPropToName,
    EmbedAwareConfig,
    laneValueForLaneId,
    normalizeLaneValue,
    readCompactMode,
    readIdArray,
    readLaneGroupingOverride,
    readSortMode,
    readStringArray,
    readTriageConfig,
    resolveEffectiveLaneGrouping
} from './view-config'

/** A config whose `get` returns values from a plain record. */
function config(values: Record<string, unknown>): { get(key: string): unknown } {
    return { get: (key: string): unknown => values[key] }
}

describe('EmbedAwareConfig (issue #103)', () => {
    /** A recording backing store: tracks every write that reaches it. */
    function store(values: Record<string, unknown>): {
        get(key: string): unknown
        set(key: string, value: unknown): void
        writes: Array<[string, unknown]>
    } {
        const writes: Array<[string, unknown]> = []
        return {
            get: (key: string): unknown => values[key],
            set: (key: string, value: unknown): void => {
                values[key] = value
                writes.push([key, value])
            },
            writes
        }
    }

    it('passes reads and writes through when not embedded', () => {
        const backing = store({ compactMode: true })
        const cfg = new EmbedAwareConfig(
            () => backing,
            () => false
        )
        expect(cfg.get('compactMode')).toBe(true)
        cfg.set('calendarPanelCollapsed', true)
        expect(backing.writes).toEqual([['calendarPanelCollapsed', true]])
        expect(cfg.get('calendarPanelCollapsed')).toBe(true)
    })

    it('NEVER writes to the backing store while embedded (the .base stays untouched)', () => {
        const backing = store({})
        const cfg = new EmbedAwareConfig(
            () => backing,
            () => true
        )
        cfg.set('calendarPanelCollapsed', true)
        cfg.set('compactMode', true)
        cfg.set('statuses', ['a', 'b'])
        expect(backing.writes).toEqual([])
    })

    it('round-trips embedded writes through the overlay so interactions still work', () => {
        const backing = store({ calendarPanelCollapsed: false })
        const cfg = new EmbedAwareConfig(
            () => backing,
            () => true
        )
        expect(cfg.get('calendarPanelCollapsed')).toBe(false) // falls through
        cfg.set('calendarPanelCollapsed', true)
        expect(cfg.get('calendarPanelCollapsed')).toBe(true) // overlay wins
        expect(backing.get('calendarPanelCollapsed')).toBe(false)
    })

    it('prefers an overlay value even when it is undefined/null', () => {
        const backing = store({ calendarTab: 'deadline' })
        const cfg = new EmbedAwareConfig(
            () => backing,
            () => true
        )
        cfg.set('calendarTab', null)
        expect(cfg.get('calendarTab')).toBeNull()
    })

    it('becomes ephemeral the moment embed detection flips (lazy detection)', () => {
        // Embed detection is lazy: the first rebuild may run before the root
        // is attached. Writes before detection persist; writes after stay in
        // memory.
        const backing = store({})
        let embedded = false
        const cfg = new EmbedAwareConfig(
            () => backing,
            () => embedded
        )
        cfg.set('collapsedLanes', ['x'])
        embedded = true
        cfg.set('collapsedLanes', ['x', 'y'])
        expect(backing.writes).toEqual([['collapsedLanes', ['x']]])
        expect(cfg.get('collapsedLanes')).toEqual(['x', 'y'])
    })
})

describe('readTriageConfig (issue #53)', () => {
    it('defaults gating to the editable set and scope to clarify', () => {
        const c = readTriageConfig(config({ triageUpdateProps: ['priority', 'urgency'] }))
        expect(c.scope).toBe('clarify')
        expect(c.updateProps).toEqual(['priority', 'urgency'])
        expect(c.gateProps).toEqual(['priority', 'urgency'])
        expect(c.seeProps).toEqual([])
        expect(c.tokens).toEqual([])
    })

    it('keeps an explicit gating set and reads scope/tokens', () => {
        const c = readTriageConfig(
            config({
                triageScope: 'all',
                triageUpdateProps: ['priority'],
                triageGateProps: ['priority', 'effort'],
                triageSeeProps: ['formula.priority_score'],
                triageTokens: ['TBD', 'No Target']
            })
        )
        expect(c.scope).toBe('all')
        expect(c.gateProps).toEqual(['priority', 'effort'])
        expect(c.seeProps).toEqual(['formula.priority_score'])
        expect(c.tokens).toEqual(['TBD', 'No Target'])
    })
})

describe('readSortMode', () => {
    it('accepts name/property and defaults everything else to order', () => {
        expect(readSortMode('name')).toBe('name')
        expect(readSortMode('property')).toBe('property')
        expect(readSortMode('order')).toBe('order')
        expect(readSortMode(undefined)).toBe('order')
        expect(readSortMode('bogus')).toBe('order')
    })
})

describe('readStringArray', () => {
    it('keeps non-empty strings from an array', () => {
        expect(readStringArray(['a', '', '  ', 'b'])).toEqual(['a', 'b'])
        expect(readStringArray(['a', 1, null])).toEqual(['a'])
    })

    it('splits a string on newlines and commas', () => {
        expect(readStringArray('a, b\nc')).toEqual(['a', 'b', 'c'])
    })

    it('returns empty for blanks and non-string/array input', () => {
        expect(readStringArray('')).toEqual([])
        expect(readStringArray('   ')).toEqual([])
        expect(readStringArray(42)).toEqual([])
        expect(readStringArray(undefined)).toEqual([])
    })
})

describe('readIdArray', () => {
    it('keeps non-empty strings from an array without splitting', () => {
        expect(readIdArray(['a', '', '  ', 'b'])).toEqual(['a', 'b'])
        expect(readIdArray(['a, b', 'c'])).toEqual(['a, b', 'c'])
        expect(readIdArray(['x', 1, null])).toEqual(['x'])
    })

    it('returns empty for non-array input', () => {
        expect(readIdArray('a,b')).toEqual([])
        expect(readIdArray(undefined)).toEqual([])
        expect(readIdArray(null)).toEqual([])
    })
})

describe('readLaneGroupingOverride', () => {
    it('maps none / note-type kinds directly', () => {
        expect(readLaneGroupingOverride(config({ laneGrouping: 'none' }))).toEqual({ kind: 'none' })
        expect(readLaneGroupingOverride(config({ laneGrouping: 'note-type' }))).toEqual({
            kind: 'note-type'
        })
    })

    it('keeps the raw Bases property id (note or formula) for property grouping (#50)', () => {
        // The view parses it (parsePropertyRef); a formula grouping is read-only.
        expect(
            readLaneGroupingOverride(
                config({ laneGrouping: 'property', laneGroupingProperty: 'note.area' })
            )
        ).toEqual({ kind: 'property', property: 'note.area' })
        expect(
            readLaneGroupingOverride(
                config({ laneGrouping: 'property', laneGroupingProperty: 'formula.action_type' })
            )
        ).toEqual({ kind: 'property', property: 'formula.action_type' })
    })

    it('defers (null) for an unset kind or a property grouping with no property', () => {
        expect(readLaneGroupingOverride(config({}))).toBeNull()
        expect(readLaneGroupingOverride(config({ laneGrouping: '__profile__' }))).toBeNull()
        expect(readLaneGroupingOverride(config({ laneGrouping: 'property' }))).toBeNull()
    })
})

describe('resolveEffectiveLaneGrouping (mixed-type boards)', () => {
    it('a per-view override always wins — an explicit None disables lanes', () => {
        expect(resolveEffectiveLaneGrouping({ kind: 'none' }, { kind: 'none' }, 3)).toEqual({
            kind: 'none'
        })
        expect(
            resolveEffectiveLaneGrouping(
                { kind: 'property', property: 'note.area' },
                { kind: 'none' },
                3
            )
        ).toEqual({ kind: 'property', property: 'note.area' })
    })

    it('auto-enables note-type lanes when the profile has none and >1 recognized type', () => {
        expect(resolveEffectiveLaneGrouping(null, { kind: 'none' }, 2)).toEqual({
            kind: 'note-type'
        })
    })

    it('keeps the profile grouping for a single-type (or empty) board', () => {
        expect(resolveEffectiveLaneGrouping(null, { kind: 'none' }, 1)).toEqual({ kind: 'none' })
        expect(resolveEffectiveLaneGrouping(null, { kind: 'none' }, 0)).toEqual({ kind: 'none' })
    })

    it('never overrides a non-none profile grouping', () => {
        expect(
            resolveEffectiveLaneGrouping(null, { kind: 'property', property: 'note.area' }, 2)
        ).toEqual({ kind: 'property', property: 'note.area' })
        expect(resolveEffectiveLaneGrouping(null, { kind: 'note-type' }, 2)).toEqual({
            kind: 'note-type'
        })
    })
})

describe('readCompactMode', () => {
    it('is on only for an explicit true (off by default / on missing)', () => {
        expect(readCompactMode(config({ compactMode: true }))).toBe(true)
        expect(readCompactMode(config({ compactMode: false }))).toBe(false)
        expect(readCompactMode(config({}))).toBe(false)
        expect(readCompactMode(config({ compactMode: 'true' }))).toBe(false)
    })
})

describe('normalizeLaneValue', () => {
    it('trims strings and maps blanks/objects to null', () => {
        expect(normalizeLaneValue('  Work ')).toBe('Work')
        expect(normalizeLaneValue('   ')).toBeNull()
        expect(normalizeLaneValue(null)).toBeNull()
        expect(normalizeLaneValue({})).toBeNull()
    })

    it('stringifies numbers and booleans', () => {
        expect(normalizeLaneValue(3)).toBe('3')
        expect(normalizeLaneValue(false)).toBe('false')
    })
})

describe('laneValueForLaneId (issue #105, finding 4.1)', () => {
    const UNGROUPED = '__ungrouped__'

    it('clears the value for the Ungrouped lane', () => {
        expect(laneValueForLaneId(UNGROUPED, UNGROUPED)).toBeNull()
    })

    it('normalizes any other lane id exactly like the echo re-derivation', () => {
        // The optimistic in-memory value must equal normalizeLaneValue(written
        // frontmatter), so the render-signature gate absorbs the echo.
        expect(laneValueForLaneId('Work', UNGROUPED)).toBe('Work')
        expect(laneValueForLaneId('  Work ', UNGROUPED)).toBe(normalizeLaneValue('  Work '))
        expect(laneValueForLaneId('3', UNGROUPED)).toBe(normalizeLaneValue(3))
    })
})

describe('basesPropToName', () => {
    it('returns a bare name unchanged', () => {
        expect(basesPropToName('status')).toBe('status')
    })

    it('strips the note. prefix and rejects non-note namespaces', () => {
        expect(basesPropToName('note.status')).toBe('status')
        expect(basesPropToName('file.name')).toBeNull()
        expect(basesPropToName('formula.x')).toBeNull()
    })

    it('returns null for empty / non-string input', () => {
        expect(basesPropToName('')).toBeNull()
        expect(basesPropToName(undefined)).toBeNull()
        expect(basesPropToName(42)).toBeNull()
    })
})
