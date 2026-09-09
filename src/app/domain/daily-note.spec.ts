import { describe, expect, test } from 'bun:test'
import { dailyNotePath, pickDailyNoteSource } from './daily-note'

/** A tiny momentjs stand-in covering the tokens the specs use. */
const format = (date: Date, fmt: string): string => {
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
    return fmt
        .replaceAll('YYYY', String(date.getFullYear()))
        .replaceAll('MM', pad(date.getMonth() + 1))
        .replaceAll('DD', pad(date.getDate()))
}

const date = new Date(2026, 8, 9)

describe('pickDailyNoteSource (issue #172)', () => {
    const fallback = { folder: 'Fallback', format: 'YYYY-MM-DD' }

    test('Periodic Notes wins, then core Daily Notes, then the plugin fallback', () => {
        expect(
            pickDailyNoteSource({
                periodic: { folder: 'Periodic', format: 'YYYY/MM/YYYY-MM-DD' },
                core: { folder: 'Core', format: 'YYYY-MM-DD' },
                fallback
            }).folder
        ).toBe('Periodic')
        expect(
            pickDailyNoteSource({
                periodic: null,
                core: { folder: 'Core', format: 'YYYY-MM-DD' },
                fallback
            }).folder
        ).toBe('Core')
        expect(pickDailyNoteSource({ periodic: null, core: null, fallback }).folder).toBe(
            'Fallback'
        )
    })

    test('a source with blank folder AND format is skipped', () => {
        expect(
            pickDailyNoteSource({
                periodic: { folder: '', format: '' },
                core: { folder: 'Core', format: '' },
                fallback
            }).folder
        ).toBe('Core')
    })
})

describe('dailyNotePath (issue #172)', () => {
    test('composes folder and formatted date into a vault path', () => {
        expect(dailyNotePath({ folder: 'Dailies', format: 'YYYY-MM-DD' }, date, format)).toBe(
            'Dailies/2026-09-09.md'
        )
    })

    test('a format carrying folders keeps them; slashes are normalized', () => {
        expect(
            dailyNotePath(
                { folder: '/20 Actions/21 Dailies/', format: 'YYYY/MM/YYYY-MM-DD' },
                date,
                format
            )
        ).toBe('20 Actions/21 Dailies/2026/09/2026-09-09.md')
    })

    test('a blank folder is the vault root; a blank format is YYYY-MM-DD', () => {
        expect(dailyNotePath({ folder: '', format: '' }, date, format)).toBe('2026-09-09.md')
    })
})
