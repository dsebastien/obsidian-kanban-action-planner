import { describe, expect, test } from 'bun:test'
import { combineTrackedTime } from './linked-time'
import type { LinkedNoteTime } from './linked-time'
import { entryMinutes, latestEntryDate, parseTimeEntries } from './time-entries'
import {
    MANUAL_ADJUSTMENT,
    durationVerdict,
    lowerDecision,
    manualAdjustmentEntry,
    manualAdjustmentStart,
    planRecompute
} from './tracked-time-decision'
import type { LowerChoice, RecomputeInput } from './tracked-time-decision'

describe('durationVerdict (rule 79)', () => {
    test('stored above computed: the user decides', () => {
        expect(durationVerdict(120, true, 80)).toEqual({
            kind: 'lower',
            decision: { stored: 120, computed: 80, difference: 40 }
        })
        expect(durationVerdict('120', true, 80).kind).toBe('lower')
    })

    test('equal: nothing to write', () => {
        expect(durationVerdict(80, true, 80)).toEqual({ kind: 'same' })
    })

    test('stored below, empty or not a number: the computed value is written', () => {
        expect(durationVerdict(10, true, 80)).toEqual({ kind: 'write' })
        expect(durationVerdict(undefined, true, 80)).toEqual({ kind: 'write' })
        expect(durationVerdict('lots', true, 80)).toEqual({ kind: 'write' })
        expect(durationVerdict('80', true, 80)).toEqual({ kind: 'write' })
    })

    test('no entries and no sessions: left as it is, even when higher', () => {
        expect(durationVerdict(120, false, 0)).toEqual({ kind: 'leave' })
        expect(durationVerdict(undefined, false, 0)).toEqual({ kind: 'leave' })
    })

    test('stored values compare rounded', () => {
        expect(lowerDecision(80.4, 80)).toBeNull()
        expect(lowerDecision(80.6, 80)).toEqual({ stored: 81, computed: 80, difference: 1 })
    })
})

describe('manual adjustment entry', () => {
    test('starts at local midnight of the created day, taken as written', () => {
        const midnight = new Date(2026, 2, 14).getTime()
        expect(manualAdjustmentStart('2026-03-14', 0)).toBe(midnight)
        expect(manualAdjustmentStart('2026-03-14T18:30:00+05:00', 0)).toBe(midnight)
    })

    test('falls back to the local day of the file creation time', () => {
        const ctime = new Date(2025, 6, 2, 15, 45).getTime()
        const midnight = new Date(2025, 6, 2).getTime()
        expect(manualAdjustmentStart(undefined, ctime)).toBe(midnight)
        expect(manualAdjustmentStart('soon', ctime)).toBe(midnight)
        expect(manualAdjustmentStart(20250702, ctime)).toBe(midnight)
    })

    test('lasts the difference and counts exactly that many minutes', () => {
        const entry = manualAdjustmentEntry('2026-03-14', 0, 45)
        expect(entry).toEqual({
            startTime: '2026-03-14T00:00:00',
            endTime: '2026-03-14T00:45:00',
            description: MANUAL_ADJUSTMENT
        })
        expect(entryMinutes(entry)).toBe(45)
    })

    test('a difference past midnight ends on a later day (the entry day is its end day)', () => {
        const entry = manualAdjustmentEntry('2026-03-14', 0, 1500)
        expect(entry.endTime).toBe('2026-03-15T01:00:00')
        expect(entryMinutes(entry)).toBe(1500)
        expect(latestEntryDate([entry])).toBe('2026-03-15')
    })
})

const e30 = { startTime: '2026-09-08T09:00:00', endTime: '2026-09-08T09:30:00' }
/** 20 seconds: counts as 1 minute (`max(1, round)`). */
const tap = { startTime: '2026-09-09T10:00:00', endTime: '2026-09-09T10:00:20' }
const session: LinkedNoteTime = { path: 's.md', minutes: 50, date: '2026-10-02' }

function input(
    fm: Record<string, unknown>,
    choice: LowerChoice | null = null,
    linked: LinkedNoteTime[] = [session]
): RecomputeInput {
    return {
        rawEntries: fm['time_entries'],
        storedDuration: fm['time_spent'],
        storedLastSession: fm['date_last_session'],
        compute: (raw) => combineTrackedTime(parseTimeEntries(raw), linked, () => false),
        choice,
        created: fm['created'],
        fallbackCreatedMs: new Date(2020, 0, 1, 12).getTime()
    }
}

/** Apply a plan's writes to a frontmatter copy (as the service does). */
function apply(
    fm: Record<string, unknown>,
    plan: ReturnType<typeof planRecompute>
): Record<string, unknown> {
    const next = { ...fm }
    if (plan.entries) next['time_entries'] = plan.entries
    if (plan.duration !== undefined) next['time_spent'] = plan.duration
    if (plan.lastSession !== undefined) next['date_last_session'] = plan.lastSession
    return next
}

describe('planRecompute (rule 79)', () => {
    const fm = { time_spent: 120, time_entries: [e30], created: '2026-01-05' }

    test('stored above computed, no choice: the duration stays, the decision is reported', () => {
        const plan = planRecompute(input(fm))
        expect(plan.duration).toBeUndefined()
        expect(plan.entries).toBeUndefined()
        expect(plan.decision).toEqual({ stored: 120, computed: 80, difference: 40 })
        expect(plan.minutes).toBe(120)
        expect(plan.lastSession).toBe('2026-10-02')
    })

    test('keep: one manual adjustment entry on the created day; stored = computed', () => {
        const plan = planRecompute(input(fm, 'keep'))
        expect(plan.decision).toBeNull()
        expect(plan.adjusted).toBe(40)
        expect(plan.entries).toEqual([
            e30,
            {
                startTime: '2026-01-05T00:00:00',
                endTime: '2026-01-05T00:40:00',
                description: 'Manual adjustment'
            }
        ])
        expect(plan.result.minutes).toBe(120)
        expect(plan.result.entryMinutes).toBe(70)
        expect(plan.duration).toBeUndefined() // already 120
        expect(plan.minutes).toBe(120)
        expect(plan.lastSession).toBe('2026-10-02')
    })

    test('keep is idempotent: a second recompute changes nothing', () => {
        const kept = apply(fm, planRecompute(input(fm, 'keep')))
        const again = planRecompute(input(kept))
        expect(again.decision).toBeNull()
        expect(again.entries).toBeUndefined()
        expect(again.duration).toBeUndefined()
        expect(again.lastSession).toBeUndefined()
        expect(again.minutes).toBe(120)
        // A later keep or drop finds nothing to decide either.
        expect(apply(kept, planRecompute(input(kept, 'drop')))).toEqual(kept)
    })

    test('keep rounds a fractional stored value and writes the rounded total', () => {
        const fractional = { ...fm, time_spent: 90.6 }
        const plan = planRecompute(input(fractional, 'keep'))
        expect(plan.adjusted).toBe(11)
        expect(plan.duration).toBe(91)
        const again = planRecompute(input(apply(fractional, plan)))
        expect(again.duration).toBeUndefined()
        expect(again.decision).toBeNull()
    })

    test('keep counts entries max(1, round) each and drops empty items', () => {
        const withTap = { time_spent: 60, time_entries: [null, e30, tap], created: '2026-01-05' }
        const plan = planRecompute(input(withTap, 'keep', []))
        expect(plan.adjusted).toBe(29) // 60 − (30 + 1)
        expect(plan.entries).toHaveLength(3)
        expect(plan.entries?.[0]).toBe(e30)
        expect(plan.result.minutes).toBe(60)
    })

    test('keep without created: dated on the file creation day', () => {
        const plan = planRecompute(input({ time_spent: 100, time_entries: [e30] }, 'keep', []))
        const added = plan.entries?.[1] as { startTime: string } | undefined
        expect(added?.startTime).toBe('2020-01-01T00:00:00')
    })

    test('drop: the computed value is written', () => {
        const plan = planRecompute(input(fm, 'drop'))
        expect(plan.duration).toBe(80)
        expect(plan.entries).toBeUndefined()
        expect(plan.minutes).toBe(80)
        expect(planRecompute(input(apply(fm, plan))).duration).toBeUndefined()
    })

    test('equal: no duration write', () => {
        const plan = planRecompute(input({ ...fm, time_spent: 80 }))
        expect(plan.duration).toBeUndefined()
        expect(plan.decision).toBeNull()
    })

    test('stored below computed: raised without asking', () => {
        const plan = planRecompute(input({ ...fm, time_spent: 10 }))
        expect(plan.duration).toBe(80)
        expect(plan.decision).toBeNull()
    })

    test('no entries and no sessions: left as it is, whatever the choice', () => {
        for (const choice of [null, 'keep', 'drop'] as const) {
            const plan = planRecompute(input({ time_spent: 120 }, choice, []))
            expect(plan.duration).toBeUndefined()
            expect(plan.entries).toBeUndefined()
            expect(plan.decision).toBeNull()
            expect(plan.minutes).toBeNull()
        }
    })
})
