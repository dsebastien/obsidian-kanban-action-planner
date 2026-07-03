import { describe, expect, it } from 'bun:test'
import {
    getZoomTerm,
    isEmptyQuery,
    matchesFilterQuery,
    parseFilterQuery,
    removeZoomTerm,
    setZoomTerm
} from './filter-query'
import type { CardSearchRecord, FilterContext } from './filter-query'
import { periodRange } from './calendar'

const TODAY = new Date(2026, 5, 28) // 2026-06-28 (Sunday)

const CTX: FilterContext = {
    today: TODAY,
    periods: {
        week: periodRange('week', TODAY),
        month: periodRange('month', TODAY),
        quarter: periodRange('quarter', TODAY),
        year: periodRange('year', TODAY)
    }
}

function record(over: Partial<CardSearchRecord> = {}): CardSearchRecord {
    const base: CardSearchRecord = {
        title: '',
        haystack: '',
        statusText: [],
        rels: { parent: [], sibling: [], child: [], blocked_by: [] },
        ancestors: [],
        tags: [],
        due: null,
        props: new Map()
    }
    return { ...base, ...over }
}

function match(input: string, rec: CardSearchRecord): boolean {
    return matchesFilterQuery(rec, parseFilterQuery(input), CTX)
}

describe('parseFilterQuery', () => {
    it('treats whitespace as AND within one group', () => {
        const q = parseFilterQuery('book project')
        expect(q.groups).toHaveLength(1)
        expect(q.groups[0]).toHaveLength(2)
    })

    it('splits OR (keyword and pipe) into groups, AND binding tighter', () => {
        const q = parseFilterQuery('book project OR goal | plan')
        expect(q.groups).toHaveLength(3)
        expect(q.groups[0]).toHaveLength(2) // book AND project
        expect(q.groups[1]?.[0]?.values).toEqual(['goal'])
        expect(q.groups[2]?.[0]?.values).toEqual(['plan'])
    })

    it('parses a qualifier with quoted value', () => {
        const q = parseFilterQuery('parent:"PKM Library"')
        expect(q.groups[0]?.[0]).toMatchObject({
            name: 'parent',
            values: ['pkm library'],
            negated: false
        })
    })

    it('splits comma values into OR candidates', () => {
        expect(parseFilterQuery('status:active,done').groups[0]?.[0]?.values).toEqual([
            'active',
            'done'
        ])
    })

    it('parses leading-dash and NOT negation', () => {
        expect(parseFilterQuery('-status:done').groups[0]?.[0]?.negated).toBe(true)
        expect(parseFilterQuery('NOT book').groups[0]?.[0]).toMatchObject({
            negated: true,
            name: null
        })
    })

    it('parses due operators', () => {
        expect(parseFilterQuery('due:>=2026-01-01').groups[0]?.[0]).toMatchObject({
            name: 'due',
            op: '>=',
            values: ['2026-01-01']
        })
    })

    it('parses the := exact operator (quoted and unquoted)', () => {
        expect(parseFilterQuery('parent:="Website Redesign"').groups[0]?.[0]).toMatchObject({
            name: 'parent',
            values: ['website redesign'],
            exact: true
        })
        expect(parseFilterQuery('status:=done').groups[0]?.[0]).toMatchObject({
            name: 'status',
            values: ['done'],
            exact: true
        })
        expect(parseFilterQuery('parent:app').groups[0]?.[0]?.exact).toBe(false)
    })

    it('due:= parses as the exact-day = comparison', () => {
        expect(parseFilterQuery('due:=2026-01-15').groups[0]?.[0]).toMatchObject({
            name: 'due',
            op: '=',
            values: ['2026-01-15']
        })
    })

    it('is empty for blank or separator-only input', () => {
        expect(isEmptyQuery(parseFilterQuery(''))).toBe(true)
        expect(isEmptyQuery(parseFilterQuery('   '))).toBe(true)
        expect(isEmptyQuery(parseFilterQuery('OR'))).toBe(true)
    })
})

describe('matchesFilterQuery', () => {
    it('matches everything when empty', () => {
        expect(match('', record({ haystack: 'anything' }))).toBe(true)
    })

    it('bare term is a case-insensitive substring of the haystack', () => {
        const rec = record({ haystack: 'write the context book' })
        expect(match('BOOK', rec)).toBe(true)
        expect(match('magazine', rec)).toBe(false)
    })

    it('AND requires all terms; OR requires one group', () => {
        const rec = record({ haystack: 'book project' })
        expect(match('book project', rec)).toBe(true)
        expect(match('book magazine', rec)).toBe(false)
        expect(match('magazine OR project', rec)).toBe(true)
    })

    it('title/status/tag qualifiers', () => {
        const rec = record({
            title: 'launch plan',
            statusText: ['30 - active', 'active'],
            tags: ['type/task', 'work']
        })
        expect(match('title:launch', rec)).toBe(true)
        expect(match('status:active', rec)).toBe(true)
        expect(match('status:done', rec)).toBe(false)
        expect(match('tag:work', rec)).toBe(true)
    })

    it('relationship qualifiers with aliases', () => {
        const rec = record({
            rels: {
                parent: ['pkm library'],
                child: ['subtask a'],
                sibling: [],
                blocked_by: ['blocker x']
            }
        })
        expect(match('parent:pkm', rec)).toBe(true)
        expect(match('children:subtask', rec)).toBe(true) // alias of child
        expect(match('blocked:"blocker x"', rec)).toBe(true) // alias of blocked_by
        expect(match('sibling:anything', rec)).toBe(false)
    })

    it('ancestor qualifier matches any transitive parent (exact and substring)', () => {
        const rec = record({
            rels: { parent: ['project x'], sibling: [], child: [], blocked_by: [] },
            ancestors: ['project x', 'area y']
        })
        expect(match('ancestor:"area y"', rec)).toBe(true)
        expect(match('ancestor:="Area Y"', rec)).toBe(true)
        expect(match('ancestors:area', rec)).toBe(true) // alias + substring
        expect(match('ancestor:="Area"', rec)).toBe(false) // exact, whole value
        expect(match('parent:"area y"', rec)).toBe(false) // parent stays direct-only
    })

    it('generic frontmatter property qualifier (lists match any element)', () => {
        const rec = record({ props: new Map([['contexts', ['work', 'deep-focus']]]) })
        expect(match('contexts:deep', rec)).toBe(true)
        expect(match('contexts:home', rec)).toBe(false)
        expect(match('missing:x', rec)).toBe(false)
    })

    it('comma values OR within a field', () => {
        const rec = record({ statusText: ['done'] })
        expect(match('status:active,done', rec)).toBe(true)
    })

    it('negation inverts a clause', () => {
        const rec = record({ statusText: ['done'], haystack: 'a done card' })
        expect(match('-status:done', rec)).toBe(false)
        expect(match('-status:active', rec)).toBe(true)
        expect(match('card -status:active', rec)).toBe(true)
    })

    it('due: keywords', () => {
        expect(match('due:none', record({ due: null }))).toBe(true)
        expect(match('due:none', record({ due: new Date(2026, 5, 28) }))).toBe(false)
        expect(match('due:today', record({ due: new Date(2026, 5, 28) }))).toBe(true)
        expect(match('due:overdue', record({ due: new Date(2026, 5, 27) }))).toBe(true)
        expect(match('due:overdue', record({ due: new Date(2026, 5, 28) }))).toBe(false)
    })

    it('due: month/quarter period membership', () => {
        expect(match('due:month', record({ due: new Date(2026, 5, 1) }))).toBe(true)
        expect(match('due:month', record({ due: new Date(2026, 6, 1) }))).toBe(false)
        expect(match('due:quarter', record({ due: new Date(2026, 3, 1) }))).toBe(true)
        expect(match('due:quarter', record({ due: new Date(2026, 6, 1) }))).toBe(false)
    })

    it('due: date comparisons', () => {
        const rec = record({ due: new Date(2026, 0, 15) })
        expect(match('due:>2026-01-01', rec)).toBe(true)
        expect(match('due:<2026-01-01', rec)).toBe(false)
        expect(match('due:2026-01-15', rec)).toBe(true)
        expect(match('due:>=2026-01-15', rec)).toBe(true)
    })

    it(':= matches the whole value case-insensitively, never a substring', () => {
        const rec = record({
            title: 'launch plan',
            statusText: ['30 - active', 'active'],
            tags: ['work'],
            rels: { parent: ['app backend'], sibling: [], child: [], blocked_by: [] },
            props: new Map([['contexts', ['deep-focus']]])
        })
        expect(match('parent:="App Backend"', rec)).toBe(true)
        expect(match('parent:="App"', rec)).toBe(false) // substring would match
        expect(match('parent:app', rec)).toBe(true) // : keeps substring semantics
        expect(match('title:="Launch Plan"', rec)).toBe(true)
        expect(match('title:=launch', rec)).toBe(false)
        expect(match('status:=active', rec)).toBe(true)
        expect(match('status:=act', rec)).toBe(false)
        expect(match('tag:=work', rec)).toBe(true)
        expect(match('tag:=wor', rec)).toBe(false)
        expect(match('contexts:=deep-focus', rec)).toBe(true)
        expect(match('contexts:=deep', rec)).toBe(false)
    })

    it('combines qualifiers and terms across OR groups', () => {
        const rec = record({
            title: 'book',
            statusText: ['active'],
            rels: { parent: ['pkm'], sibling: [], child: [], blocked_by: [] },
            haystack: 'book pkm active'
        })
        expect(match('book parent:"pkm" status:active', rec)).toBe(true)
        expect(match('book parent:"pkm" status:done OR due:overdue', rec)).toBe(false)
    })
})

describe('zoom helpers (issue #74)', () => {
    it('setZoomTerm appends an exact quoted term to the existing query', () => {
        expect(setZoomTerm('', 'Website Redesign', 'parent')).toBe('parent:="Website Redesign"')
        expect(setZoomTerm('status:active', 'Website Redesign', 'parent')).toBe(
            'status:active parent:="Website Redesign"'
        )
        expect(setZoomTerm('status:active', 'Website Redesign', 'ancestor')).toBe(
            'status:active ancestor:="Website Redesign"'
        )
    })

    it('setZoomTerm swaps an existing zoom term instead of stacking', () => {
        const zoomed = setZoomTerm('status:active', 'App', 'parent')
        expect(setZoomTerm(zoomed, 'App Backend', 'parent')).toBe(
            'status:active parent:="App Backend"'
        )
        expect(setZoomTerm('parent:app status:active', 'App Backend', 'parent')).toBe(
            'status:active parent:="App Backend"'
        )
    })

    it('setZoomTerm swaps across fields (children zoom replaces descendants zoom)', () => {
        const deep = setZoomTerm('status:active', 'App', 'ancestor')
        expect(setZoomTerm(deep, 'App Backend', 'parent')).toBe(
            'status:active parent:="App Backend"'
        )
        expect(setZoomTerm('parent:"App" x', 'App', 'ancestor')).toBe('x ancestor:="App"')
    })

    it('setZoomTerm strips quotes from the title (tokenizer has no escapes)', () => {
        expect(setZoomTerm('', 'Say "hi"', 'parent')).toBe('parent:="Say hi"')
    })

    it('setZoomTerm leaves a negated -parent: exclusion alone', () => {
        expect(setZoomTerm('-parent:old', 'App', 'parent')).toBe('-parent:old parent:="App"')
    })

    it('removeZoomTerm removes only the zoom term (either field)', () => {
        expect(removeZoomTerm('status:active parent:="Website Redesign"')).toBe('status:active')
        expect(removeZoomTerm('status:active ancestor:="App"')).toBe('status:active')
        expect(removeZoomTerm('parent:app')).toBe('')
        expect(removeZoomTerm('status:active')).toBe('status:active')
        expect(removeZoomTerm('-parent:old status:active')).toBe('-parent:old status:active')
    })

    it('getZoomTerm returns the field and original-cased title, or null', () => {
        expect(getZoomTerm('status:active parent:="Website Redesign"')).toEqual({
            field: 'parent',
            title: 'Website Redesign'
        })
        expect(getZoomTerm('ancestor:="App"')).toEqual({ field: 'ancestor', title: 'App' })
        expect(getZoomTerm('parent:App')).toEqual({ field: 'parent', title: 'App' })
        expect(getZoomTerm('status:active')).toBeNull()
        expect(getZoomTerm('-parent:old')).toBeNull()
        expect(getZoomTerm('')).toBeNull()
    })
})
