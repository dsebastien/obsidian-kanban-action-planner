import { describe, expect, it } from 'bun:test'
import { guardWrite, refusalMessage, undeclaredOf } from './write-guard.service'

const movies = {
    name: 'Movies',
    declaredProperties: [{ name: 'time_spent', type: 'number' }, { name: 'date_last_session' }]
}

describe('write guard (issue #232)', () => {
    it('lists the undeclared names, once each, ignoring blanks', () => {
        expect(
            undeclaredOf(movies, [
                'time_entries',
                'time_spent',
                'time_entries',
                '',
                'Date_Last_Session'
            ])
        ).toEqual(['time_entries'])
    })

    it('never guards an unknown type or untyped note', () => {
        expect(undeclaredOf(undefined, ['x'])).toEqual([])
        expect(undeclaredOf({}, ['x'])).toEqual([])
        expect(guardWrite(undefined, 'x')).toBe(true)
        expect(guardWrite({ name: 'Local' }, 'x')).toBe(true)
        expect(guardWrite(movies, 'time_spent')).toBe(true)
    })

    it('names the type and the property in the refusal', () => {
        expect(refusalMessage(movies, 'date_scheduled')).toBe(
            'Movies notes do not declare "date_scheduled" in the Starter Kit, so nothing was written. Add the property to the note type to use this here.'
        )
    })
})
