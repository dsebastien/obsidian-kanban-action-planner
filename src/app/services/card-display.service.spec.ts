import { describe, expect, it } from 'bun:test'
import type { App, BasesEntry, BasesPropertyId, TFile } from 'obsidian'
import {
    buildCardDisplay,
    computeDueState,
    formatCountdown,
    heatLevel,
    parseEnumPrefix,
    parseProgressField,
    resolveCardTitle,
    stripEnumPrefix
} from './card-display.service'

const TODAY = new Date(2026, 5, 28)

/** A minimal BasesEntry double: `getValue` returns a `toString`-able Value or null. */
const entryOf = (values: Record<string, string>): BasesEntry =>
    ({
        getValue: (id: BasesPropertyId) => {
            const v = values[id]
            return v === undefined ? null : { toString: (): string => v }
        }
    }) as unknown as BasesEntry

describe('resolveCardTitle (issue #4)', () => {
    const entry = entryOf({
        'note.title': 'Technical meeting',
        'note.blank': '   ',
        'note.unset': 'null'
    })

    it('uses the note name when no title property is configured', () => {
        expect(resolveCardTitle(entry, null, '2026-07-07-technical-meeting')).toBe(
            '2026-07-07-technical-meeting'
        )
    })

    it('shows the configured property value instead of the note name', () => {
        expect(resolveCardTitle(entry, 'note.title', '2026-07-07-technical-meeting')).toBe(
            'Technical meeting'
        )
    })

    it('falls back to the note name when the property is missing, blank, or null', () => {
        expect(resolveCardTitle(entry, 'note.missing', 'fallback')).toBe('fallback')
        expect(resolveCardTitle(entry, 'note.blank', 'fallback')).toBe('fallback')
        expect(resolveCardTitle(entry, 'note.unset', 'fallback')).toBe('fallback')
        expect(resolveCardTitle(undefined, 'note.title', 'fallback')).toBe('fallback')
    })

    it('treats an explicit file.name as the note name', () => {
        expect(resolveCardTitle(entry, 'file.name', 'the-note')).toBe('the-note')
    })
})

describe('buildCardDisplay title property (issue #4)', () => {
    // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fake: only .basename is read
    const file = { basename: '2026-07-07-technical-meeting' } as unknown as TFile
    const config = {
        getOrder: (): BasesPropertyId[] => ['file.name', 'note.title', 'note.status'],
        getDisplayName: (id: BasesPropertyId): string => id.split('.')[1] ?? id
    }
    const entry = entryOf({ 'note.title': 'Technical meeting', 'note.status': 'Doing' })
    const build = (titleProperty: BasesPropertyId | null) =>
        buildCardDisplay({} as App, file, entry, config, titleProperty, null, TODAY, {
            show: false,
            soonDays: 7,
            placement: 'title'
        })

    it('titles the card from the property and drops it from the fields', () => {
        const display = build('note.title')
        expect(display.title).toBe('Technical meeting')
        expect(display.fields.map((f) => f.label)).toEqual(['status'])
    })

    it('keeps the note name and shows the property as a field when unconfigured', () => {
        const display = build(null)
        expect(display.title).toBe('2026-07-07-technical-meeting')
        expect(display.fields.map((f) => f.label)).toEqual(['title', 'status'])
    })
})

describe('formatCountdown (issue #62)', () => {
    const SOON = 7
    const at = (offsetDays: number): Date => {
        const d = new Date(TODAY)
        d.setDate(d.getDate() + offsetDays)
        return d
    }

    it('is null without a due date', () => {
        expect(formatCountdown(null, TODAY, SOON, 'title')).toBeNull()
    })

    it('is "today" (amber) on the due day', () => {
        expect(formatCountdown(TODAY, TODAY, SOON, 'title')).toEqual({
            text: 'today',
            tone: 'today',
            placement: 'title'
        })
    })

    it('counts overdue days in the past (red)', () => {
        expect(formatCountdown(at(-1), TODAY, SOON, 'title')).toEqual({
            text: '1d overdue',
            tone: 'overdue',
            placement: 'title'
        })
        expect(formatCountdown(at(-2), TODAY, SOON, 'chip')).toEqual({
            text: '2d overdue',
            tone: 'overdue',
            placement: 'chip'
        })
    })

    it('is "soon" within the threshold, "future" beyond it', () => {
        expect(formatCountdown(at(3), TODAY, SOON, 'title')).toEqual({
            text: 'in 3d',
            tone: 'soon',
            placement: 'title'
        })
        // Boundary: exactly the threshold is still "soon"; one day past is "future".
        expect(formatCountdown(at(7), TODAY, SOON, 'title')).toEqual({
            text: 'in 7d',
            tone: 'soon',
            placement: 'title'
        })
        expect(formatCountdown(at(8), TODAY, SOON, 'title')).toEqual({
            text: 'in 8d',
            tone: 'future',
            placement: 'title'
        })
    })

    it('auto-scales granularity: days → weeks → months', () => {
        const text = (offset: number): string | undefined =>
            formatCountdown(at(offset), TODAY, SOON, 'title')?.text
        expect(text(13)).toBe('in 13d')
        expect(text(14)).toBe('in 2w')
        expect(text(21)).toBe('in 3w')
        expect(text(60)).toBe('in 2mo')
        expect(text(90)).toBe('in 3mo')
    })

    it('carries the placement through unchanged', () => {
        const placement = (p: 'corner' | 'footer'): string | undefined =>
            formatCountdown(at(3), TODAY, SOON, p)?.placement
        expect(placement('corner')).toBe('corner')
        expect(placement('footer')).toBe('footer')
    })
})

describe('computeDueState (issue #22)', () => {
    it('is "none" with no due date', () => {
        expect(computeDueState(null, TODAY)).toBe('none')
    })

    it('is "overdue" strictly before today', () => {
        expect(computeDueState(new Date(2026, 5, 27), TODAY)).toBe('overdue')
        expect(computeDueState(new Date(2026, 4, 1), TODAY)).toBe('overdue')
    })

    it('is "today" on the same day (ignores time of day)', () => {
        expect(computeDueState(new Date(2026, 5, 28), TODAY)).toBe('today')
        expect(computeDueState(new Date(2026, 5, 28, 23, 59), TODAY)).toBe('today')
    })

    it('is "none" in the future', () => {
        expect(computeDueState(new Date(2026, 5, 29), TODAY)).toBe('none')
    })
})

describe('parseProgressField', () => {
    it('detects percentage-like labels and clamps to 0–100', () => {
        expect(parseProgressField('Progress %', '0')).toBe(0)
        expect(parseProgressField('Progress %', '45')).toBe(45)
        expect(parseProgressField('Progress', '100')).toBe(100)
        expect(parseProgressField('Progress %', '45%')).toBe(45)
        expect(parseProgressField('Progress %', '150')).toBe(100)
        expect(parseProgressField('Progress %', '-10')).toBe(0)
    })

    it('returns null when the label is not progress/percentage', () => {
        expect(parseProgressField('Priority Score', '13')).toBeNull()
        expect(parseProgressField('Urgency', '20 - Soon')).toBeNull()
        expect(parseProgressField(null, '50')).toBeNull()
    })

    it('returns null when the value is not numeric', () => {
        expect(parseProgressField('Progress %', 'n/a')).toBeNull()
        expect(parseProgressField('Progress %', '')).toBeNull()
    })
})

describe('stripEnumPrefix', () => {
    it('strips a leading NN - prefix, keeps the label', () => {
        expect(stripEnumPrefix('30 - High')).toBe('High')
        expect(stripEnumPrefix('99 - ⏰ No Target')).toBe('⏰ No Target')
        expect(stripEnumPrefix('10 - Now')).toBe('Now')
    })

    it('leaves non-prefixed values untouched', () => {
        expect(stripEnumPrefix('High')).toBe('High')
        expect(stripEnumPrefix('2026-01-15')).toBe('2026-01-15')
        expect(stripEnumPrefix('13')).toBe('13')
    })
})

describe('parseEnumPrefix', () => {
    it('reads the leading integer of an NN - value', () => {
        expect(parseEnumPrefix('30 - High')).toBe(30)
        expect(parseEnumPrefix('99 - TBD')).toBe(99)
    })
    it('is null without a prefix', () => {
        expect(parseEnumPrefix('High')).toBeNull()
        expect(parseEnumPrefix('2026-01-15')).toBeNull()
    })
})

describe('heatLevel', () => {
    const priority = [
        '99 - TBD',
        '10 - Top',
        '20 - Very High',
        '30 - High',
        '40 - Medium',
        '50 - Low',
        '60 - Very Low'
    ]

    it('ranks by prefix regardless of allowed-list order (warm=low, cool=high)', () => {
        expect(heatLevel('10 - Top', priority)).toBe(0) // lowest prefix → warmest
        expect(heatLevel('99 - TBD', priority)).toBe(4) // highest prefix → coolest
        const high = heatLevel('30 - High', priority)
        expect(high).not.toBeNull()
        expect(high).toBeGreaterThan(0)
        expect(high).toBeLessThan(4)
    })

    it('is null when the value has no prefix or the scale is too small', () => {
        expect(heatLevel('High', priority)).toBeNull()
        expect(heatLevel('10 - Top', ['10 - Top'])).toBeNull()
        expect(heatLevel('10 - Top', [])).toBeNull()
    })
})
