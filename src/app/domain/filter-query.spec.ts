import { describe, expect, it } from 'bun:test'
import {
    RESERVED_QUALIFIER_NAMES,
    getContextTerms,
    getZoomTerm,
    isEmptyQuery,
    matchesFilterQuery,
    parseFilterQuery,
    removeContextTerms,
    removeZoomTerm,
    setContextTerms,
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
        defer: null,
        scheduled: null,
        estimate: null,
        progress: null,
        order: null,
        done: false,
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

describe('context term helpers (GTD contexts)', () => {
    const PROP = 'contexts'

    it('setContextTerms serializes all values into ONE comma-separated exact token', () => {
        expect(setContextTerms('', PROP, ['@work', '@home'])).toBe('contexts:="@work","@home"')
    })

    it('serializes a single value as one quoted exact token', () => {
        expect(setContextTerms('', PROP, ['@work'])).toBe('contexts:="@work"')
    })

    it('NEVER emits two same-name tokens (would AND instead of OR)', () => {
        const serialized = setContextTerms('status:active', PROP, ['@work', '@home', '@errands'])
        // Exactly one `contexts:` occurrence — never a second clause of the same name.
        const occurrences = serialized.match(/contexts:/g) ?? []
        expect(occurrences).toHaveLength(1)
        expect(serialized).toBe('status:active contexts:="@work","@home","@errands"')
    })

    it('the single token parses to ONE clause with N OR-ed exact values', () => {
        const q = parseFilterQuery(setContextTerms('', PROP, ['@work', '@home']))
        expect(q.groups).toHaveLength(1)
        expect(q.groups[0]).toHaveLength(1) // one clause, not two ANDed clauses
        const clause = q.groups[0]?.[0]
        expect(clause?.name).toBe('contexts')
        expect(clause?.exact).toBe(true) // each value is an exact match
        expect(clause?.values).toEqual(['@work', '@home']) // parser lowercases; already lowercase
    })

    it('splitValues single-quoted-vs-multi guard: multi-value token splits, single stays whole', () => {
        // Multi-value: interior `","` means it is NOT one quoted value → splits to OR.
        const multi = parseFilterQuery('contexts:="@work","@home"').groups[0]?.[0]
        expect(multi?.values).toEqual(['@work', '@home'])
        expect(multi?.exact).toBe(true)
        // Single quoted value: the whole remainder IS one quoted string → one value, kept whole.
        const single = parseFilterQuery('contexts:="Deep, Focus"').groups[0]?.[0]
        expect(single?.values).toEqual(['deep, focus']) // interior comma NOT an OR boundary
        expect(single?.exact).toBe(true)
    })

    it('each serialized value parses exact=true (OR-of-exacts, not substrings)', () => {
        const rec = record({ props: new Map([['contexts', ['@work']]]) })
        // exact @work matches; exact @wor (substring) does not.
        expect(match(setContextTerms('', PROP, ['@work', '@home']), rec)).toBe(true)
        expect(match(setContextTerms('', PROP, ['@wor']), rec)).toBe(false)
    })

    it('quotes values with spaces and a leading @', () => {
        expect(setContextTerms('', PROP, ['@deep work', '@home'])).toBe(
            'contexts:="@deep work","@home"'
        )
        // Round-trips: the spaced/@-prefixed value survives the tokenizer and comes back intact.
        expect(getContextTerms(setContextTerms('', PROP, ['@deep work']), PROP)).toEqual([
            '@deep work'
        ])
    })

    it('strips embedded quotes from values (tokenizer has no escapes)', () => {
        expect(setContextTerms('', PROP, ['@wo"rk'])).toBe('contexts:="@work"')
    })

    it('empty or all-blank values remove the term', () => {
        expect(setContextTerms('status:active contexts:="@work"', PROP, [])).toBe('status:active')
        expect(setContextTerms('status:active contexts:="@work"', PROP, ['', '  '])).toBe(
            'status:active'
        )
    })

    it('setContextTerms swaps an existing context term instead of stacking', () => {
        const pinned = setContextTerms('status:active', PROP, ['@work'])
        expect(setContextTerms(pinned, PROP, ['@home', '@errands'])).toBe(
            'status:active contexts:="@home","@errands"'
        )
    })

    it('getContextTerms preserves original casing (parser would lowercase)', () => {
        expect(getContextTerms('contexts:="@Work","@Home"', PROP)).toEqual(['@Work', '@Home'])
        expect(getContextTerms(setContextTerms('', PROP, ['@Work', '@Home']), PROP)).toEqual([
            '@Work',
            '@Home'
        ])
    })

    it('getContextTerms returns [] when no context term is present', () => {
        expect(getContextTerms('status:active', PROP)).toEqual([])
        expect(getContextTerms('', PROP)).toEqual([])
    })

    it('set/get/remove round-trips', () => {
        const q = setContextTerms('', PROP, ['@work', '@home'])
        expect(getContextTerms(q, PROP)).toEqual(['@work', '@home'])
        const removed = removeContextTerms(q, PROP)
        expect(removed).toBe('')
        expect(getContextTerms(removed, PROP)).toEqual([])
    })

    it('coexists with a typed substring term untouched', () => {
        const q = setContextTerms('book title:launch', PROP, ['@work'])
        expect(q).toBe('book title:launch contexts:="@work"')
        expect(removeContextTerms(q, PROP)).toBe('book title:launch')
        expect(getContextTerms(q, PROP)).toEqual(['@work'])
    })

    it('coexists with a zoom (parent:=) term untouched', () => {
        const zoomed = setZoomTerm('status:active', 'App Backend', 'parent')
        const q = setContextTerms(zoomed, PROP, ['@work', '@home'])
        expect(q).toBe('status:active parent:="App Backend" contexts:="@work","@home"')
        // Removing contexts leaves the zoom term intact.
        expect(removeContextTerms(q, PROP)).toBe('status:active parent:="App Backend"')
        // getZoomTerm still finds the zoom; getContextTerms still finds the contexts.
        expect(getZoomTerm(q)).toEqual({ field: 'parent', title: 'App Backend' })
        expect(getContextTerms(q, PROP)).toEqual(['@work', '@home'])
    })

    it('honors a renamed contexts property (name is a parameter, never hardcoded)', () => {
        const q = setContextTerms('status:active', 'situations', ['@work'])
        expect(q).toBe('status:active situations:="@work"')
        expect(getContextTerms(q, 'situations')).toEqual(['@work'])
        expect(getContextTerms(q, 'contexts')).toEqual([]) // wrong prop finds nothing
        expect(removeContextTerms(q, 'situations')).toBe('status:active')
    })

    it('quoted value containing a comma stays one value through get', () => {
        // Author-typed single quoted value with an interior comma.
        expect(getContextTerms('contexts:="Deep, Focus"', PROP)).toEqual(['Deep, Focus'])
    })
})

describe('RESERVED_QUALIFIER_NAMES', () => {
    it('contains every qualifier name the matcher special-cases', () => {
        for (const name of [
            'title',
            'status',
            'parent',
            'ancestor',
            'ancestors',
            'child',
            'children',
            'sibling',
            'siblings',
            'blocked',
            'blocked_by',
            'blockedby',
            'tag',
            'tags',
            'due'
        ]) {
            expect(RESERVED_QUALIFIER_NAMES.has(name)).toBe(true)
        }
    })

    it('does not reserve an ordinary frontmatter property name', () => {
        expect(RESERVED_QUALIFIER_NAMES.has('contexts')).toBe(false)
        expect(RESERVED_QUALIFIER_NAMES.has('priority')).toBe(false)
    })
})

describe('defer: qualifier (issue #113)', () => {
    const future = new Date(2026, 6, 10) // after TODAY (2026-06-28)
    const past = new Date(2026, 5, 20)

    it('matches with the due-style keywords and comparisons', () => {
        expect(match('defer:none', record())).toBe(true)
        expect(match('defer:none', record({ defer: future }))).toBe(false)
        expect(match('defer:today', record({ defer: TODAY }))).toBe(true)
        // Operators apply to explicit dates (keywords ignore them, like due:).
        expect(match('defer:>2026-06-28', record({ defer: future }))).toBe(true)
        expect(match('defer:>2026-06-28', record({ defer: past }))).toBe(false)
        expect(match('defer:<2026-07-01', record({ defer: past }))).toBe(true)
    })
})

describe('is: qualifier (issue #113)', () => {
    const future = new Date(2026, 6, 10)
    const past = new Date(2026, 5, 20)

    it('is:deferred matches only future defer dates', () => {
        expect(match('is:deferred', record({ defer: future }))).toBe(true)
        expect(match('is:deferred', record({ defer: past }))).toBe(false)
        expect(match('is:deferred', record({ defer: TODAY }))).toBe(false) // today = actionable
        expect(match('is:deferred', record())).toBe(false)
    })

    it('is:blocked matches cards with blockers', () => {
        expect(
            match(
                'is:blocked',
                record({ rels: { parent: [], sibling: [], child: [], blocked_by: ['x'] } })
            )
        ).toBe(true)
        expect(match('is:blocked', record())).toBe(false)
    })

    it('is:done matches the resolved done state', () => {
        expect(match('is:done', record({ done: true }))).toBe(true)
        expect(match('is:done', record())).toBe(false)
    })

    it('is:available = not deferred AND not blocked AND not done', () => {
        expect(match('is:available', record())).toBe(true)
        expect(match('is:available', record({ defer: future }))).toBe(false)
        expect(match('is:available', record({ defer: past }))).toBe(true) // past defer is actionable
        expect(match('is:available', record({ done: true }))).toBe(false)
        expect(
            match(
                'is:available',
                record({ rels: { parent: [], sibling: [], child: [], blocked_by: ['x'] } })
            )
        ).toBe(false)
    })

    it('negates and composes like any clause', () => {
        expect(match('-is:deferred', record({ defer: future }))).toBe(false)
        expect(match('-is:done book', record({ haystack: 'my book' }))).toBe(true)
        expect(match('is:nonsense', record())).toBe(false) // unknown state never matches
    })

    it('is and defer are reserved qualifier names', () => {
        expect(RESERVED_QUALIFIER_NAMES.has('is')).toBe(true)
        expect(RESERVED_QUALIFIER_NAMES.has('defer')).toBe(true)
    })
})

describe('configured-property qualifier aliases (issue #169)', () => {
    const future = new Date(2026, 6, 10) // after TODAY (2026-06-28)
    const past = new Date(2026, 5, 20)

    it('parses comparison operators for the new qualifiers', () => {
        expect(parseFilterQuery('scheduled:>=2026-01-01').groups[0]?.[0]).toMatchObject({
            name: 'scheduled',
            op: '>=',
            values: ['2026-01-01']
        })
        expect(parseFilterQuery('estimate:>4h').groups[0]?.[0]).toMatchObject({
            name: 'estimate',
            op: '>',
            values: ['4h']
        })
        expect(parseFilterQuery('progress:<50').groups[0]?.[0]).toMatchObject({
            name: 'progress',
            op: '<',
            values: ['50']
        })
    })

    it('scheduled: takes the due-style keywords and comparisons', () => {
        expect(match('scheduled:none', record())).toBe(true)
        expect(match('scheduled:none', record({ scheduled: future }))).toBe(false)
        expect(match('scheduled:today', record({ scheduled: TODAY }))).toBe(true)
        expect(match('scheduled:overdue', record({ scheduled: past }))).toBe(true)
        expect(match('scheduled:overdue', record({ scheduled: future }))).toBe(false)
        expect(match('scheduled:>2026-06-28', record({ scheduled: future }))).toBe(true)
        expect(match('scheduled:>2026-06-28', record({ scheduled: past }))).toBe(false)
        expect(match('scheduled:week', record({ scheduled: TODAY }))).toBe(true)
    })

    it('estimate: compares plain numbers as days', () => {
        expect(match('estimate:none', record())).toBe(true)
        expect(match('estimate:none', record({ estimate: 2 }))).toBe(false)
        expect(match('estimate:2', record({ estimate: 2 }))).toBe(true)
        expect(match('estimate:>=2', record({ estimate: 2 }))).toBe(true)
        expect(match('estimate:>2', record({ estimate: 2 }))).toBe(false)
        expect(match('estimate:<3', record({ estimate: 2 }))).toBe(true)
    })

    it('estimate: converts d/h/m unit suffixes through minutesPerDay', () => {
        // 240 minutes at 480 min/day = 0.5 days.
        const half = record({ estimate: 0.5 })
        expect(match('estimate:4h', half)).toBe(true)
        expect(match('estimate:0.5', half)).toBe(true)
        expect(match('estimate:240m', half)).toBe(true)
        expect(match('estimate:>3h', half)).toBe(true)
        expect(match('estimate:<2h', half)).toBe(false)
        expect(match('estimate:1d', record({ estimate: 1 }))).toBe(true)
        // A custom minutes-per-day changes the conversion (240m = 1 day at 240/day).
        const ctx: FilterContext = { ...CTX, minutesPerDay: 240 }
        expect(
            matchesFilterQuery(record({ estimate: 1 }), parseFilterQuery('estimate:4h'), ctx)
        ).toBe(true)
    })

    it('estimate: never matches a malformed value', () => {
        expect(match('estimate:soon', record({ estimate: 2 }))).toBe(false)
        expect(match('estimate:4x', record({ estimate: 2 }))).toBe(false)
    })

    it('progress: and order: compare numbers, with none for unset', () => {
        expect(match('progress:none', record())).toBe(true)
        expect(match('progress:100', record({ progress: 100 }))).toBe(true)
        expect(match('progress:<50', record({ progress: 30 }))).toBe(true)
        expect(match('progress:<50', record({ progress: 80 }))).toBe(false)
        expect(match('progress:>=50', record({ progress: 50 }))).toBe(true)
        expect(match('order:none', record())).toBe(true)
        expect(match('order:>=10', record({ order: 12 }))).toBe(true)
        expect(match('order:<10', record({ order: 12 }))).toBe(false)
    })

    it('negates and composes like any clause', () => {
        expect(match('-progress:100', record({ progress: 100 }))).toBe(false)
        expect(match('-estimate:none book', record({ haystack: 'my book', estimate: 1 }))).toBe(
            true
        )
        expect(match('scheduled:today OR progress:100', record({ progress: 100 }))).toBe(true)
    })

    it('stays OFF the reserved-names guard so same-named properties are allowed', () => {
        for (const name of ['scheduled', 'estimate', 'progress', 'order']) {
            expect(RESERVED_QUALIFIER_NAMES.has(name)).toBe(false)
        }
    })
})

describe('context: qualifier aliases (issue #166)', () => {
    const withContexts = (prop: string, values: string[]): CardSearchRecord =>
        record({ props: new Map([[prop, values.map((v) => v.toLowerCase())]]) })
    const ctxWith = (contextsProp: string): FilterContext => ({ ...CTX, contextsProp })
    const matchWith = (input: string, rec: CardSearchRecord, ctx: FilterContext): boolean =>
        matchesFilterQuery(rec, parseFilterQuery(input), ctx)

    it('resolves context: and contexts: to the configured property', () => {
        const rec = withContexts('contexts', ['@work', '@home'])
        const ctx = ctxWith('contexts')
        expect(matchWith('context:@work', rec, ctx)).toBe(true)
        expect(matchWith('contexts:@work', rec, ctx)).toBe(true)
        expect(matchWith('context:@errands', rec, ctx)).toBe(false)
    })

    it('follows a custom contexts property name', () => {
        const rec = withContexts('gtd_contexts', ['@work'])
        const ctx = ctxWith('gtd_contexts')
        expect(matchWith('context:@work', rec, ctx)).toBe(true)
        expect(matchWith('contexts:@work', rec, ctx)).toBe(true)
        // The literal property lookup keeps working alongside the alias.
        expect(matchWith('gtd_contexts:@work', rec, ctx)).toBe(true)
    })

    it('falls back to a literal property lookup when no contextsProp is set', () => {
        const rec = withContexts('contexts', ['@work'])
        expect(match('contexts:@work', rec)).toBe(true)
        expect(match('context:@work', rec)).toBe(false) // no `context` property
    })

    it('supports exact matching, OR values, and negation', () => {
        const rec = withContexts('contexts', ['@work'])
        const ctx = ctxWith('contexts')
        expect(matchWith('context:="@work"', rec, ctx)).toBe(true)
        expect(matchWith('context:="@wo"', rec, ctx)).toBe(false)
        expect(matchWith('context:@home,@work', rec, ctx)).toBe(true)
        expect(matchWith('-context:@work', rec, ctx)).toBe(false)
        expect(matchWith('-context:@errands', rec, ctx)).toBe(true)
    })

    it('never matches a record without the configured property', () => {
        expect(matchWith('context:@work', record(), ctxWith('contexts'))).toBe(false)
    })

    it('stays OFF the reserved-names guard so the default property name is allowed', () => {
        expect(RESERVED_QUALIFIER_NAMES.has('context')).toBe(false)
        expect(RESERVED_QUALIFIER_NAMES.has('contexts')).toBe(false)
    })
})
