import { describe, expect, it } from 'bun:test'
import type { App } from 'obsidian'
import { checkNoteTypesAgainstStarterKit, describeFinding } from './note-type-check.service'
import { createDefaultSettings } from '../types/plugin-settings.intf'
import { createDefaultNoteType } from './note-type.service'
import { STARTER_KIT_PLUGIN_ID } from '../constants'

/** A fake app whose plugin registry holds the given Starter Kit API (or none). */
const appWith = (api: Record<string, unknown> | null): App =>
    Object.assign(Object.create(null) as App, {
        plugins: { plugins: api ? { [STARTER_KIT_PLUGIN_ID]: { api } } : {} }
    })

const movies = {
    id: 'movies',
    name: 'Movies',
    properties: [
        { name: 'status', type: 'select' },
        { name: 'time_spent', type: 'number' },
        { name: 'date_scheduled', type: 'text' }
    ]
}

describe('checkNoteTypesAgainstStarterKit (issue #232)', () => {
    it('reports the planner properties a Starter Kit type does not declare', () => {
        const settings = createDefaultSettings()
        const stored = createDefaultNoteType('movies', 'Movies', 'starter-kit')
        stored.relationships = []
        const app = appWith({
            listNoteTypes: () => [movies],
            listGlobalProperties: () => ({
                success: true,
                data: [{ name: 'manual_order', type: 'number' }]
            })
        })
        const report = checkNoteTypesAgainstStarterKit(app, {
            ...settings,
            noteTypes: [stored]
        })
        expect(report.kind).toBe('report')
        if (report.kind !== 'report') return
        const [type] = report.types
        expect(type?.configured).toBe(true)
        const names = type?.findings.map((f) => `${f.name}:${f.problem}`) ?? []
        expect(names).toContain('date_scheduled:wrong-type')
        expect(names).toContain('time_entries:undeclared')
        expect(names).not.toContain('time_spent:undeclared')
        expect(names).not.toContain('manual_order:undeclared')
        // Movies declare no estimate property: no estimate is planned at all.
        expect(names.some((n) => n.startsWith('estimate'))).toBe(false)
        const wrong = type?.findings.find((f) => f.name === 'date_scheduled')
        expect(wrong && describeFinding(wrong)).toBe(
            'Start date: `date_scheduled` is declared as text, expected date or datetime'
        )
    })

    it('says why there is no report', () => {
        const settings = { ...createDefaultSettings(), noteTypes: [] }
        expect(checkNoteTypesAgainstStarterKit(appWith(null), settings).kind).toBe('unavailable')
        expect(
            checkNoteTypesAgainstStarterKit(appWith({ listNoteTypes: () => [] }), settings).kind
        ).toBe('no-global-properties')
    })
})
