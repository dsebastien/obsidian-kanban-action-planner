import { describe, expect, test } from 'bun:test'
import { guardVerdict, recoveryChoices } from './session-guard'

const MIN = 60_000
const settings = { idleMinutes: 30, maxMinutes: 480 }

describe('guardVerdict (issue #197)', () => {
    const session = { startedAt: 1_000_000 }

    test('a fresh, active session is fine', () => {
        expect(
            guardVerdict(
                session,
                session.startedAt + 5 * MIN,
                session.startedAt + 10 * MIN,
                settings
            )
        ).toEqual({ kind: 'ok' })
    })

    test('idleness counts from the last activity, never before the session started', () => {
        const now = session.startedAt + 31 * MIN
        expect(guardVerdict(session, 0, now, settings)).toEqual({
            kind: 'idle',
            idleSince: session.startedAt,
            idleMinutes: 31
        })
        expect(guardVerdict(session, now - 29 * MIN, now, settings).kind).toBe('ok')
    })

    test('the cap wins over idleness', () => {
        const now = session.startedAt + 500 * MIN
        expect(guardVerdict(session, 0, now, settings)).toEqual({
            kind: 'capped',
            capAt: session.startedAt + 480 * MIN,
            elapsedMinutes: 500
        })
    })

    test('0 disables each check independently', () => {
        const now = session.startedAt + 1000 * MIN
        expect(guardVerdict(session, 0, now, { idleMinutes: 0, maxMinutes: 0 }).kind).toBe('ok')
        expect(guardVerdict(session, 0, now, { idleMinutes: 0, maxMinutes: 480 }).kind).toBe(
            'capped'
        )
        expect(guardVerdict(session, now, now, { idleMinutes: 30, maxMinutes: 0 }).kind).toBe('ok')
    })
})

describe('recoveryChoices (issue #197)', () => {
    const session = { startedAt: 1_000_000 }

    test('a short session is not worth a prompt', () => {
        expect(recoveryChoices(session, session.startedAt + 10 * MIN, settings)).toEqual({
            elapsedMinutes: 10,
            trimTo: null,
            suspicious: false
        })
    })

    test('a session past the idle threshold is suspicious but has no trim point', () => {
        const choices = recoveryChoices(session, session.startedAt + 45 * MIN, settings)
        expect(choices.suspicious).toBe(true)
        expect(choices.trimTo).toBeNull()
    })

    test('a session past the cap offers the cap as the trim point', () => {
        const choices = recoveryChoices(session, session.startedAt + 600 * MIN, settings)
        expect(choices).toEqual({
            elapsedMinutes: 600,
            trimTo: session.startedAt + 480 * MIN,
            suspicious: true
        })
    })
})
