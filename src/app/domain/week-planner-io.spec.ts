import { describe, expect, test } from 'bun:test'
import {
    matchImports,
    parseAppExport,
    parseAppJson,
    parseAppMarkdown,
    toAppBlocks,
    toAppJson,
    toAppMarkdown,
    toTimeBlocks
} from './week-planner-io'
import { formatTimeBlocks } from './time-blocks'

const appBlock = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: 'b',
    startTime: 540,
    duration: 60,
    startDay: 0,
    daySpan: 1,
    text: 'Running',
    color: '#3b82f6',
    textColor: '#ffffff',
    fontSize: 24,
    fontStyle: { bold: false, italic: false },
    textAlignment: 'center',
    verticalAlignment: 'middle',
    borderStyle: { width: 0, style: 'solid', color: '#3b82f6' },
    cornerRadius: 0,
    ...over
})

const json = (blocks: unknown[], version = '1.0'): string =>
    JSON.stringify({ version, blocks, config: {}, exportedAt: '2026-09-09T00:00:00.000Z' })

describe('parseAppJson (issue #172, phase D)', () => {
    test('a multi-day block becomes a day list; same times merge', () => {
        const result = parseAppJson(
            json([
                appBlock({
                    startDay: 0,
                    daySpan: 5,
                    startTime: 360,
                    duration: 60,
                    text: 'Wake up'
                }),
                appBlock({
                    id: 'c',
                    startDay: 6,
                    daySpan: 1,
                    startTime: 360,
                    duration: 60,
                    text: 'Wake up'
                })
            ])
        )
        expect(result.errors).toEqual([])
        expect(result.blocks).toEqual([
            { text: 'Wake up', days: [0, 1, 2, 3, 4, 6], start: 360, end: 420 }
        ])
    })

    test('a block running to midnight or past it uses the crosser grammar', () => {
        const result = parseAppJson(
            json([
                appBlock({ startTime: 1380, duration: 60, text: 'Late' }),
                appBlock({ id: 'c', startTime: 1380, duration: 120, text: 'Later' })
            ])
        )
        expect(result.blocks.map((b) => [b.text, b.start, b.end])).toEqual([
            ['Late', 1380, 0],
            ['Later', 1380, 60]
        ])
    })

    test('bad records are reported, not imported', () => {
        const result = parseAppJson(
            json([
                appBlock({ text: '   ' }),
                appBlock({ startDay: 9 }),
                appBlock({ startTime: 'x' }),
                'junk'
            ])
        )
        expect(result.blocks).toEqual([])
        expect(result.errors.map((e) => e.error)).toEqual([
            'No text (nothing to match a note on)',
            'Day 9 / span 1 out of range',
            'Missing start, duration or day',
            'Not an object'
        ])
    })

    test('an unknown version is flagged but its blocks still read', () => {
        const result = parseAppJson(json([appBlock({})], '2.0'))
        expect(result.errors[0]?.entry).toBe('version')
        expect(result.blocks).toHaveLength(1)
    })

    test('not JSON at all', () => {
        expect(parseAppJson('{nope').errors[0]?.error).toContain('Not JSON')
    })
})

describe('parseAppMarkdown', () => {
    const md = `---
date: "2026-09-09"
block_styles:
  - time_block: "[Monday - Wednesday] 09:00 - 10:30: Deep work"
    color: "#f97316"
---

# 2026-09-09 - Week Planning

## Monday
- 09:00 - 10:30: Deep work (Day 1/3)
- 12:00 - 13:00: Running

## Tuesday
- 09:00 - 10:30: Deep work (Day 2/3)
- nonsense line

## Wednesday
- 09:00 - 10:30: Deep work (Day 3/3)
- 23:00 - 00:30: Night shift

## Thursday
- No events scheduled

## Friday
- No events scheduled

## Saturday
- 10:00 - 11:00: Running

## Sunday
- No events scheduled
`

    test('day sections, (Day x/y) parts merged, midnight crossing, junk reported', () => {
        const result = parseAppMarkdown(md)
        expect(result.blocks).toEqual([
            { text: 'Deep work', days: [0, 1, 2], start: 540, end: 630 },
            { text: 'Running', days: [0], start: 720, end: 780 },
            { text: 'Night shift', days: [2], start: 1380, end: 30 },
            { text: 'Running', days: [5], start: 600, end: 660 }
        ])
        expect(result.errors).toEqual([
            { entry: '- nonsense line', error: 'Not a `- HH:MM - HH:MM: text` line' }
        ])
    })

    test('parseAppExport picks the format from the content', () => {
        expect(parseAppExport(md).blocks).toHaveLength(4)
        expect(parseAppExport(json([appBlock({})])).blocks).toHaveLength(1)
    })
})

describe('matchImports', () => {
    const notes = [
        { path: 'a/Running (Activity).md', title: 'Running (Activity)' },
        { path: 'b/Day Job (Activity).md', title: 'Day Job (Activity)' },
        { path: 'c/Write a book (Project).md', title: 'Write a book (Project)' }
    ]
    const block = (text: string): { text: string; days: number[]; start: number; end: number } => ({
        text,
        days: [0],
        start: 540,
        end: 600
    })

    test('exact, bare-title, case-insensitive, and unmatched', () => {
        const matched = matchImports(
            [block('Running (Activity)'), block('Running'), block('day job'), block('Yoga')],
            notes
        )
        expect(matched.map((m) => [m.path, m.how])).toEqual([
            ['a/Running (Activity).md', 'exact'],
            ['a/Running (Activity).md', 'exact'],
            ['b/Day Job (Activity).md', 'case-insensitive'],
            [null, 'none']
        ])
    })
})

describe('toTimeBlocks', () => {
    test('merges same times into one block and keeps the vault grammar', () => {
        const blocks = toTimeBlocks([
            { text: 'x', days: [0, 2], start: 540, end: 600 },
            { text: 'x', days: [4], start: 540, end: 600 },
            { text: 'x', days: [5], start: 1380, end: 0 }
        ])
        expect(formatTimeBlocks(blocks)).toEqual(['mon,wed,fri 09:00-10:00', 'sat 23:00-00:00'])
    })
})

describe('export', () => {
    const entries = [
        {
            title: 'Running (Activity)',
            blocks: [
                { days: [1, 2, 3], start: 720, end: 780 },
                { days: [5, 6], start: 600, end: 675 }
            ],
            color: '#3b82f6'
        },
        {
            title: 'Night shift (Activity)',
            blocks: [{ days: [4], start: 1380, end: 60 }],
            color: null
        }
    ]

    test('consecutive days become one app block; 15-minute slots round out and are reported', () => {
        const result = toAppBlocks(entries)
        expect(
            result.blocks.map((b) => [b.text, b.startDay, b.daySpan, b.startTime, b.duration])
        ).toEqual([
            ['Running (Activity)', 1, 3, 720, 60],
            ['Night shift (Activity)', 4, 1, 1380, 120],
            ['Running (Activity)', 5, 2, 600, 90]
        ])
        expect(result.rounded).toEqual([
            { title: 'Running (Activity)', from: '10:00–11:15', to: '10:00–11:30' }
        ])
    })

    test('the JSON round-trips through the importer', () => {
        const { blocks } = toAppBlocks(entries)
        const text = toAppJson(blocks, { startHour: 0, endHour: 24 }, new Date(2026, 8, 9))
        const back = parseAppJson(text)
        expect(back.errors).toEqual([])
        expect(back.blocks).toEqual([
            { text: 'Running (Activity)', days: [1, 2, 3], start: 720, end: 780 },
            { text: 'Night shift (Activity)', days: [4], start: 1380, end: 60 },
            { text: 'Running (Activity)', days: [5, 6], start: 600, end: 690 }
        ])
    })

    test('the Markdown round-trips through the importer', () => {
        const { blocks } = toAppBlocks(entries)
        const text = toAppMarkdown(blocks, new Date(2026, 8, 9))
        expect(text).toContain('## Tuesday\n- 12:00 - 13:00: Running (Activity) (Day 1/3)')
        expect(text).toContain('## Monday\n- No events scheduled')
        expect(text).toContain('## Friday\n- 23:00 - 01:00: Night shift (Activity)')
        expect(text).toContain(
            'time_block: "[Tuesday - Thursday] 12:00 - 13:00: Running (Activity)"'
        )
        const back = parseAppMarkdown(text)
        expect(back.errors).toEqual([])
        expect(back.blocks).toEqual([
            { text: 'Running (Activity)', days: [1, 2, 3], start: 720, end: 780 },
            { text: 'Night shift (Activity)', days: [4], start: 1380, end: 60 },
            { text: 'Running (Activity)', days: [5, 6], start: 600, end: 690 }
        ])
    })
})
