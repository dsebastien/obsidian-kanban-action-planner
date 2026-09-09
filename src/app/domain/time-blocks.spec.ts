import { describe, expect, test } from 'bun:test'
import {
    addSlot,
    findOverlap,
    formatDays,
    formatMinutes,
    formatTimeBlock,
    formatTimeBlocks,
    normalizeSlot,
    parseTimeBlock,
    parseTimeBlocks,
    plannedMinutesPerWeek,
    removeSlot,
    replaceSlot,
    slotIntervals,
    slotsOf,
    slotsOverlap,
    dayRunOf,
    spanRun
} from './time-blocks'
import type { OwnedSlot, TimeBlock } from './time-blocks'

const block = (text: string): TimeBlock => {
    const result = parseTimeBlock(text)
    if (!result.ok) throw new Error(result.error)
    return result.block
}

describe('parseTimeBlock (issue #172)', () => {
    test('a single day, a list, a range, and a mix', () => {
        expect(block('mon 09:00-12:00')).toEqual({ days: [0], start: 540, end: 720 })
        expect(block('tue,thu 14:00-15:30')).toEqual({ days: [1, 3], start: 840, end: 930 })
        expect(block('mon-fri 09:00-12:00').days).toEqual([0, 1, 2, 3, 4])
        expect(block('mon-wed,fri 09:00-12:00').days).toEqual([0, 1, 2, 4])
        expect(block('sat-mon 10:00-11:00').days).toEqual([0, 5, 6])
    })

    test('is case- and whitespace-tolerant', () => {
        expect(block('  MON-Fri  09:00 - 12:00 ')).toEqual({
            days: [0, 1, 2, 3, 4],
            start: 540,
            end: 720
        })
    })

    test('an end before (or at) the start crosses midnight; 24:00 ends the day', () => {
        expect(block('fri 23:00-01:00')).toEqual({ days: [4], start: 1380, end: 1500 })
        expect(block('sun 22:00-22:00')).toEqual({ days: [6], start: 1320, end: 2760 })
        expect(block('mon 00:00-24:00')).toEqual({ days: [0], start: 0, end: 1440 })
    })

    test('names the offending part', () => {
        const bad = (text: string): string => {
            const result = parseTimeBlock(text)
            return result.ok ? 'ok' : result.error
        }
        expect(bad('09:00-12:00')).toContain('not "<days> HH:MM-HH:MM"')
        expect(bad('funday 09:00-12:00')).toContain('unknown day "funday"')
        expect(bad('mon 09:10-12:00')).toContain('15-minute grid')
        expect(bad('mon 9:00-25:00')).toContain('out of range')
        expect(bad('mon 24:00-01:00')).toContain('before 24:00')
        expect(bad('mon-tue-wed 09:00-12:00')).toContain('bad day range')
        expect(bad('mon 09:00-12h')).toContain('bad time')
    })
})

describe('parseTimeBlocks (issue #172)', () => {
    test('keeps the good entries and reports the bad ones by entry', () => {
        const { blocks, errors } = parseTimeBlocks([
            'mon-fri 09:00-12:00',
            null,
            '',
            'nope',
            42,
            'sat 10:00-11:00'
        ])
        expect(blocks).toHaveLength(2)
        expect(errors).toEqual([
            { entry: 'nope', error: '"nope" is not "<days> HH:MM-HH:MM"' },
            { entry: '42', error: 'not a string' }
        ])
    })

    test('a scalar is one entry; unset is none', () => {
        expect(parseTimeBlocks('mon 09:00-10:00').blocks).toHaveLength(1)
        expect(parseTimeBlocks(undefined).blocks).toEqual([])
    })
})

describe('formatting round-trips (issue #172)', () => {
    test('formatMinutes / formatDays', () => {
        expect(formatMinutes(540)).toBe('09:00')
        expect(formatMinutes(0)).toBe('00:00')
        expect(formatMinutes(1440)).toBe('24:00')
        expect(formatMinutes(1500)).toBe('01:00')
        expect(formatDays([0, 1, 2, 3, 4])).toBe('mon-fri')
        expect(formatDays([1, 3])).toBe('tue,thu')
        expect(formatDays([0, 1, 2, 4])).toBe('mon-wed,fri')
        expect(formatDays([5, 6])).toBe('sat,sun')
        expect(formatDays([0, 1])).toBe('mon,tue')
    })

    test('formatTimeBlock is the canonical form and parses back', () => {
        for (const text of [
            'mon-fri 09:00-12:00',
            'tue,thu 14:00-15:30',
            'fri 23:00-01:00',
            'mon 00:00-24:00',
            'sat-mon 10:00-11:00'
        ]) {
            const canonical = formatTimeBlock(block(text))
            expect(block(canonical)).toEqual(block(text))
        }
        expect(formatTimeBlock(block('  MON-Fri  09:00 - 12:00 '))).toBe('mon-fri 09:00-12:00')
        expect(formatTimeBlock(block('sat-mon 10:00-11:00'))).toBe('mon,sat,sun 10:00-11:00')
        expect(formatTimeBlocks([block('fri 23:00-01:00')])).toEqual(['fri 23:00-01:00'])
    })
})

describe('slots and planned minutes (issue #172)', () => {
    test('a repeat expands to one slot per day and sums per week', () => {
        const blocks = [block('mon-fri 09:00-12:00'), block('sat 10:00-10:30')]
        expect(slotsOf(blocks)).toHaveLength(6)
        expect(plannedMinutesPerWeek(blocks)).toBe(5 * 180 + 30)
    })

    test('a midnight crosser counts its full length', () => {
        expect(plannedMinutesPerWeek([block('fri 23:00-01:00')])).toBe(120)
    })

    test('slotIntervals wraps a Sunday crosser into Monday', () => {
        expect(slotIntervals({ day: 6, start: 1380, end: 1500 })).toEqual([
            [6 * 1440 + 1380, 7 * 1440],
            [0, 60]
        ])
        expect(slotIntervals({ day: 0, start: 540, end: 720 })).toEqual([[540, 720]])
    })
})

describe('overlaps (issue #172)', () => {
    test('same day: touching is free, sharing a minute is not', () => {
        expect(
            slotsOverlap({ day: 0, start: 540, end: 720 }, { day: 0, start: 720, end: 780 })
        ).toBe(false)
        expect(
            slotsOverlap({ day: 0, start: 540, end: 720 }, { day: 0, start: 705, end: 780 })
        ).toBe(true)
        expect(
            slotsOverlap({ day: 0, start: 540, end: 720 }, { day: 1, start: 540, end: 720 })
        ).toBe(false)
    })

    test("a crosser overlaps the next day's early slot, and Sunday wraps into Monday", () => {
        expect(
            slotsOverlap({ day: 4, start: 1380, end: 1500 }, { day: 5, start: 30, end: 90 })
        ).toBe(true)
        expect(
            slotsOverlap({ day: 6, start: 1380, end: 1500 }, { day: 0, start: 0, end: 30 })
        ).toBe(true)
        expect(
            slotsOverlap({ day: 6, start: 1380, end: 1500 }, { day: 0, start: 60, end: 90 })
        ).toBe(false)
    })

    test('range vs list: mon-fri collides with tue,thu at the same hour', () => {
        const range = slotsOf([block('mon-fri 09:00-12:00')])
        const list = slotsOf([block('tue,thu 11:00-13:00')])
        expect(list.some((s) => range.some((r) => slotsOverlap(s, r)))).toBe(true)
    })

    test('findOverlap names the conflicting note and skips the origin slot', () => {
        const others: OwnedSlot[] = [
            { path: 'A.md', day: 0, start: 540, end: 720 },
            { path: 'B.md', day: 0, start: 780, end: 840 }
        ]
        expect(findOverlap({ day: 0, start: 600, end: 660 }, others)?.path).toBe('A.md')
        expect(findOverlap({ day: 0, start: 720, end: 780 }, others)).toBeNull()
        // Moving A's own slot slightly: its origin is not a conflict.
        expect(
            findOverlap({ day: 0, start: 555, end: 735 }, others, {
                day: 0,
                start: 540,
                end: 720
            })
        ).toBeNull()
    })
})

describe('editing the list (issue #172)', () => {
    test('normalizeSlot snaps to the grid and keeps at least one step', () => {
        expect(normalizeSlot({ day: 0, start: 547, end: 552 })).toEqual({
            day: 0,
            start: 540,
            end: 555
        })
        expect(normalizeSlot({ day: 7, start: -10, end: 3000 })).toEqual({
            day: 0,
            start: 0,
            end: 1440
        })
    })

    test('removeSlot takes one day off a repeat and drops an emptied entry', () => {
        const blocks = [block('mon-fri 09:00-12:00'), block('sat 10:00-11:00')]
        expect(formatTimeBlocks(removeSlot(blocks, { day: 2, start: 540, end: 720 }))).toEqual([
            'mon,tue,thu,fri 09:00-12:00',
            'sat 10:00-11:00'
        ])
        expect(formatTimeBlocks(removeSlot(blocks, { day: 5, start: 600, end: 660 }))).toEqual([
            'mon-fri 09:00-12:00'
        ])
    })

    test('addSlot joins an entry with the same time range, else appends', () => {
        const blocks = [block('mon-fri 09:00-12:00')]
        expect(formatTimeBlocks(addSlot(blocks, { day: 5, start: 540, end: 720 }))).toEqual([
            'mon-sat 09:00-12:00'
        ])
        expect(formatTimeBlocks(addSlot(blocks, { day: 5, start: 600, end: 660 }))).toEqual([
            'mon-fri 09:00-12:00',
            'sat 10:00-11:00'
        ])
        expect(formatTimeBlocks(addSlot(blocks, { day: 0, start: 540, end: 720 }))).toEqual([
            'mon-fri 09:00-12:00'
        ])
    })

    test('replaceSlot moves one occurrence and leaves the rest of the repeat', () => {
        const blocks = [block('mon-fri 09:00-12:00')]
        const moved = replaceSlot(
            blocks,
            { day: 2, start: 540, end: 720 },
            { day: 2, start: 840, end: 1020 }
        )
        expect(formatTimeBlocks(moved)).toEqual(['mon,tue,thu,fri 09:00-12:00', 'wed 14:00-17:00'])
        const resized = replaceSlot(
            blocks,
            { day: 4, start: 540, end: 720 },
            { day: 4, start: 540, end: 780 }
        )
        expect(formatTimeBlocks(resized)).toEqual(['mon-thu 09:00-12:00', 'fri 09:00-13:00'])
        expect(
            formatTimeBlocks(
                replaceSlot(
                    blocks,
                    { day: 4, start: 540, end: 720 },
                    { day: 4, start: 540, end: 720 }
                )
            )
        ).toEqual(['mon-fri 09:00-12:00'])
    })
})

describe('spanRun (issue #172): stretching a block across days', () => {
    test('dayRunOf finds the contiguous run containing a day', () => {
        expect(dayRunOf([0, 1, 2, 4], 1)).toEqual([0, 2])
        expect(dayRunOf([0, 1, 2, 4], 4)).toEqual([4, 4])
        expect(dayRunOf([0, 1, 2, 4], 5)).toEqual([5, 5])
    })

    test('dragging the right edge extends the run; dragging it back shrinks it', () => {
        const blocks = [block('mon-fri 09:00-10:30')]
        const grown = spanRun(blocks, { day: 4, start: 540, end: 630 }, 'right', 5)
        expect(formatTimeBlocks(grown.blocks)).toEqual(['mon-sat 09:00-10:30'])
        expect(grown.addedDays).toEqual([5])
        const shrunk = spanRun(blocks, { day: 4, start: 540, end: 630 }, 'right', 2)
        expect(formatTimeBlocks(shrunk.blocks)).toEqual(['mon-wed 09:00-10:30'])
        expect(shrunk.addedDays).toEqual([])
    })

    test('the left edge works the same and never crosses the other bound', () => {
        const blocks = [block('tue,thu 14:00-16:00')]
        const grown = spanRun(blocks, { day: 3, start: 840, end: 960 }, 'left', 1)
        expect(formatTimeBlocks(grown.blocks)).toEqual(['tue-thu 14:00-16:00'])
        expect(grown.addedDays).toEqual([2])
        const clamped = spanRun(blocks, { day: 3, start: 840, end: 960 }, 'left', 6)
        expect(formatTimeBlocks(clamped.blocks)).toEqual(['tue,thu 14:00-16:00'])
    })

    test('a slot that matches no entry leaves the list untouched', () => {
        const blocks = [block('mon 09:00-10:00')]
        expect(spanRun(blocks, { day: 3, start: 0, end: 60 }, 'right', 5).blocks).toEqual(blocks)
    })
})
