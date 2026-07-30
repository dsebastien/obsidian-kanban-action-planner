import { describe, expect, test } from 'bun:test'
import { collectFilterFacts, emptyFilterFacts, narrowestFolder } from './base-filters'

describe('collectFilterFacts', () => {
    test('returns empty facts for missing / malformed input', () => {
        expect(collectFilterFacts(undefined)).toEqual(emptyFilterFacts())
        expect(collectFilterFacts(null, 42, { nope: true })).toEqual(emptyFilterFacts())
    })

    test('reads a folder from file.inFolder', () => {
        const facts = collectFilterFacts({ and: ['file.inFolder("20 Actions/24 Tasks")'] })
        expect(facts.folders).toEqual(['20 Actions/24 Tasks'])
    })

    test('reads a folder from the file.folder equality form', () => {
        expect(collectFilterFacts({ and: ["file.folder == 'Inbox'"] }).folders).toEqual(['Inbox'])
    })

    test('reads tags from file.hasTag, stripping the hash', () => {
        const facts = collectFilterFacts({ and: ['file.hasTag("#type/task")'] })
        expect(facts.tags).toEqual(['type/task'])
    })

    test('a multi-argument hasTag is not a fact (it means "any of")', () => {
        expect(collectFilterFacts({ and: ['file.hasTag("a", "b")'] }).tags).toEqual([])
    })

    test('a negated / compared hasTag is not a fact', () => {
        expect(collectFilterFacts({ and: ['file.hasTag("draft") == false'] }).tags).toEqual([])
        expect(collectFilterFacts({ and: ['!file.hasTag("draft")'] }).tags).toEqual([])
    })

    test('an inline OR / AND expression contributes nothing', () => {
        const facts = collectFilterFacts({
            and: [
                'note.kind == "task" || note.kind == "project"',
                'file.inFolder("Tasks") || file.inFolder("Projects")',
                'file.folder == "Tasks" || file.folder == "Projects"',
                'note.a == "x" && note.b == "y"'
            ]
        })
        expect(facts).toEqual(emptyFilterFacts())
    })

    test('a not-equals comparison is not an equality fact', () => {
        expect(collectFilterFacts({ and: ['note.kind != "task"'] }).properties).toEqual({})
    })

    test('reads property equalities in every supported spelling', () => {
        const facts = collectFilterFacts({
            and: ['note.kind == "action"', 'archived == false', 'note["sort index"] == 3']
        })
        expect(facts.properties).toEqual({ 'kind': 'action', 'archived': false, 'sort index': 3 })
    })

    test('ignores equalities whose right-hand side is not a literal', () => {
        const facts = collectFilterFacts({ and: ['note.due == date(today)', 'note.a == note.b'] })
        expect(facts.properties).toEqual({})
    })

    test('reads list membership from prop.contains', () => {
        const facts = collectFilterFacts({ and: ['note.areas.contains("Health")'] })
        expect(facts.listProperties).toEqual({ areas: ['Health'] })
    })

    test('a property claimed as a list is not overwritten by an equality', () => {
        const facts = collectFilterFacts({
            and: ['note.areas.contains("Health")', 'note.areas == "Work"']
        })
        expect(facts.listProperties).toEqual({ areas: ['Health'] })
        expect(facts.properties).toEqual({})
    })

    test('descends into nested and-groups', () => {
        const facts = collectFilterFacts({
            and: ['file.inFolder("Tasks")', { and: ['file.hasTag("type/task")'] }]
        })
        expect(facts.folders).toEqual(['Tasks'])
        expect(facts.tags).toEqual(['type/task'])
    })

    test('ignores or / not branches — they are not facts a new note must satisfy', () => {
        const facts = collectFilterFacts({
            and: [
                'file.inFolder("Tasks")',
                { or: ['file.hasTag("a")', 'file.hasTag("b")'] },
                { not: ['file.hasTag("archived")'] }
            ]
        })
        expect(facts.folders).toEqual(['Tasks'])
        expect(facts.tags).toEqual([])
    })

    test('merges several filter trees (global + view filters) and dedupes', () => {
        const facts = collectFilterFacts(
            { and: ['file.hasTag("type/task")'] },
            { and: ['file.hasTag("type/task")', 'note.kind == "action"'] }
        )
        expect(facts.tags).toEqual(['type/task'])
        expect(facts.properties).toEqual({ kind: 'action' })
    })

    test('accepts a bare string filter', () => {
        expect(collectFilterFacts('file.inFolder("Inbox")').folders).toEqual(['Inbox'])
    })
})

describe('narrowestFolder', () => {
    test('is null when no folder is filtered on', () => {
        expect(narrowestFolder(emptyFilterFacts())).toBeNull()
    })

    test('picks the deepest folder — the only one that can satisfy the others', () => {
        const facts = collectFilterFacts({
            and: ['file.inFolder("Projects")', 'file.inFolder("Projects/Active")']
        })
        expect(narrowestFolder(facts)).toBe('Projects/Active')
    })
})
