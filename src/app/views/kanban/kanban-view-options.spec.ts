import { describe, expect, it } from 'bun:test'
import { isSelectableProperty } from './kanban-view-options'

describe('isSelectableProperty (issue #8)', () => {
    it('keeps frontmatter (note.*) properties', () => {
        expect(isSelectableProperty('note.status', null)).toBe(true)
        expect(isSelectableProperty('note.date_due', null)).toBe(true)
    })

    it('drops file.* and formula.* and other non-frontmatter ids', () => {
        expect(isSelectableProperty('file.name', null)).toBe(false)
        expect(isSelectableProperty('file.path', null)).toBe(false)
        expect(isSelectableProperty('formula.priority_score', null)).toBe(false)
        expect(isSelectableProperty('status', null)).toBe(false) // no type prefix
    })

    it('restricts to known names when a Starter Kit set is provided', () => {
        const known = new Set(['status', 'urgency'])
        expect(isSelectableProperty('note.status', known)).toBe(true)
        expect(isSelectableProperty('note.URGENCY', known)).toBe(true) // case-insensitive
        expect(isSelectableProperty('note.random_prop', known)).toBe(false)
    })
})
