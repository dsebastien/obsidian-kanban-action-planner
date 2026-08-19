import { describe, expect, it } from 'bun:test'
import { parseEmbedParams } from './embed-params'
import type { EmbedParams } from './embed-params'
import type { NameMatcher } from './board-model'

/** Substring name terms: what a bare `columns=`/`lanes=` item parses to. */
const sub = (...names: string[]): NameMatcher[] => names.map((text) => ({ text, exact: false }))

/** Whole-name terms: what an `=`-prefixed item parses to. */
const exact = (...names: string[]): NameMatcher[] => names.map((text) => ({ text, exact: true }))

/** All-null params: what any alias without recognized keys must yield. */
const NONE: EmbedParams = {
    mode: null,
    heightPx: null,
    contexts: [],
    columns: [],
    lanes: [],
    filter: null
}

describe('parseEmbedParams', () => {
    it('yields zero params for empty and blank aliases', () => {
        expect(parseEmbedParams('')).toEqual(NONE)
        expect(parseEmbedParams('   ')).toEqual(NONE)
        expect(parseEmbedParams('\t \n')).toEqual(NONE)
    })

    it('yields zero params for a plain human alias', () => {
        expect(parseEmbedParams('My tasks')).toEqual(NONE)
        expect(parseEmbedParams('Kanban: Tasks')).toEqual(NONE) // display alias with colon
        expect(parseEmbedParams('key=value soup')).toEqual(NONE) // unknown key ignored
    })

    it('parses each of the five modes', () => {
        expect(parseEmbedParams('mode=board').mode).toBe('board')
        expect(parseEmbedParams('mode=calendar').mode).toBe('calendar')
        expect(parseEmbedParams('mode=timeline').mode).toBe('timeline')
        expect(parseEmbedParams('mode=triage').mode).toBe('triage')
        expect(parseEmbedParams('mode=wbs').mode).toBe('wbs')
    })

    it('accepts kanban as a synonym for board', () => {
        expect(parseEmbedParams('mode=kanban').mode).toBe('board')
        expect(parseEmbedParams('MODE=Kanban').mode).toBe('board')
    })

    it('matches mode key and value case-insensitively', () => {
        expect(parseEmbedParams('MODE=WBS').mode).toBe('wbs')
        expect(parseEmbedParams('Mode=Calendar').mode).toBe('calendar')
    })

    it('ignores invalid mode values', () => {
        expect(parseEmbedParams('mode=gantt').mode).toBeNull()
        expect(parseEmbedParams('mode=').mode).toBeNull()
        expect(parseEmbedParams('mode=board2').mode).toBeNull()
        expect(parseEmbedParams('mode=wbs mode=nope').mode).toBe('wbs') // invalid repeat does not clear
    })

    it('parses height as positive integer px', () => {
        expect(parseEmbedParams('height=400').heightPx).toBe(400)
        expect(parseEmbedParams('height=400px').heightPx).toBe(400) // px suffix tolerated
        expect(parseEmbedParams('HEIGHT=600').heightPx).toBe(600)
    })

    it('clamps height to [200, 2000]', () => {
        expect(parseEmbedParams('height=50').heightPx).toBe(200)
        expect(parseEmbedParams('height=200').heightPx).toBe(200)
        expect(parseEmbedParams('height=2000').heightPx).toBe(2000)
        expect(parseEmbedParams('height=99999').heightPx).toBe(2000)
    })

    it('ignores garbage height values', () => {
        expect(parseEmbedParams('height=abc').heightPx).toBeNull()
        expect(parseEmbedParams('height=-100').heightPx).toBeNull()
        expect(parseEmbedParams('height=12.5').heightPx).toBeNull()
        expect(parseEmbedParams('height=0').heightPx).toBeNull() // not positive
        expect(parseEmbedParams('height=').heightPx).toBeNull()
        expect(parseEmbedParams('height=400 height=oops').heightPx).toBe(400)
    })

    it('filter consumes the remainder of the alias verbatim', () => {
        expect(parseEmbedParams('filter=status:doing').filter).toBe('status:doing')
        // key=value-looking text after filter= belongs to the query.
        expect(parseEmbedParams('filter=status:doing OR mode=x height=1').filter).toBe(
            'status:doing OR mode=x height=1'
        )
        expect(parseEmbedParams('mode=board filter=due:<week parent:="My Project"')).toEqual({
            mode: 'board',
            heightPx: null,
            contexts: [],
            columns: [],
            lanes: [],
            filter: 'due:<week parent:="My Project"'
        })
    })

    it('parses context= as a comma-separated list before filter=', () => {
        expect(parseEmbedParams('context=@work').contexts).toEqual(['@work'])
        expect(parseEmbedParams('context=@work,@home').contexts).toEqual(['@work', '@home'])
        expect(parseEmbedParams('CONTEXTS=@work').contexts).toEqual(['@work']) // key + plural alias
        expect(parseEmbedParams('context=').contexts).toEqual([]) // empty ignored
        expect(parseEmbedParams('context=@a context=@b').contexts).toEqual(['@b']) // last wins
        // context= must precede filter= (filter swallows the rest).
        expect(parseEmbedParams('mode=board context=@work filter=status:doing')).toEqual({
            mode: 'board',
            heightPx: null,
            contexts: ['@work'],
            columns: [],
            lanes: [],
            filter: 'status:doing'
        })
    })

    it('parses columns= as a comma-separated list with optional quotes', () => {
        expect(parseEmbedParams('columns=todo').columns).toEqual(sub('todo'))
        expect(parseEmbedParams('columns=todo,doing').columns).toEqual(sub('todo', 'doing'))
        expect(parseEmbedParams('COLUMN=done').columns).toEqual(sub('done')) // key + singular alias
        expect(parseEmbedParams('columns="10 TODO"').columns).toEqual(sub('10 TODO'))
        expect(parseEmbedParams('columns="10 TODO","20 In progress"').columns).toEqual(
            sub('10 TODO', '20 In progress')
        )
        expect(parseEmbedParams('columns="10 TODO",done').columns).toEqual(sub('10 TODO', 'done'))
        expect(parseEmbedParams('columns=').columns).toEqual([]) // empty ignored
        expect(parseEmbedParams('columns=,,').columns).toEqual([]) // blanks dropped
        expect(parseEmbedParams('columns=a columns=b').columns).toEqual(sub('b')) // last wins
        // Unterminated quote runs to the end of the token, never throws.
        expect(parseEmbedParams('columns="10 TODO').columns).toEqual(sub('10 TODO'))
    })

    it('reads a leading = on an item as a whole-name (exact) term', () => {
        expect(parseEmbedParams('columns==doing').columns).toEqual(exact('doing'))
        // The `=` may sit on either side of the quotes — quotes are stripped first.
        expect(parseEmbedParams('columns=="20 Doing"').columns).toEqual(exact('20 Doing'))
        expect(parseEmbedParams('columns="=20 Doing"').columns).toEqual(exact('20 Doing'))
        // Per item, so a list mixes both kinds freely.
        expect(parseEmbedParams('columns==todo,doing').columns).toEqual([
            ...exact('todo'),
            ...sub('doing')
        ])
        // Whitespace between the prefix and the name is tolerated.
        expect(parseEmbedParams('columns="= 20 Doing"').columns).toEqual(exact('20 Doing'))
        // A bare `=` names nothing and is dropped like any other blank item.
        expect(parseEmbedParams('columns==').columns).toEqual([])
        expect(parseEmbedParams('columns==,doing').columns).toEqual(sub('doing'))
        // A name that really starts with `=` is written with a doubled prefix.
        expect(parseEmbedParams('columns===odd').columns).toEqual(exact('=odd'))
        // Same syntax on lanes=.
        expect(parseEmbedParams('lanes==work').lanes).toEqual(exact('work'))
    })

    it('parses lanes= with the same list syntax as columns=', () => {
        expect(parseEmbedParams('lanes=work').lanes).toEqual(sub('work'))
        expect(parseEmbedParams('LANE=work').lanes).toEqual(sub('work')) // key + singular alias
        expect(parseEmbedParams('lanes="10 Must",ungrouped').lanes).toEqual(
            sub('10 Must', 'ungrouped')
        )
        expect(parseEmbedParams('lanes=').lanes).toEqual([]) // empty ignored
        expect(parseEmbedParams('lanes=a lanes=b').lanes).toEqual(sub('b')) // last wins
        expect(parseEmbedParams('filter=tag:x lanes=a').lanes).toEqual([]) // after filter=
        // Combines with columns=.
        expect(parseEmbedParams('lanes=work columns=doing')).toEqual({
            mode: null,
            heightPx: null,
            contexts: [],
            columns: sub('doing'),
            lanes: sub('work'),
            filter: null
        })
    })

    it('columns= must precede filter= (filter swallows the rest)', () => {
        expect(parseEmbedParams('mode=board columns="10 TODO" filter=tag:urgent')).toEqual({
            mode: 'board',
            heightPx: null,
            contexts: [],
            columns: sub('10 TODO'),
            lanes: [],
            filter: 'tag:urgent'
        })
        expect(parseEmbedParams('filter=tag:urgent columns=todo').columns).toEqual([])
    })

    it('quoted runs elsewhere in the alias do not disturb other keys', () => {
        expect(parseEmbedParams('"some words" mode=wbs').mode).toBe('wbs')
        expect(parseEmbedParams('columns="a b" height=300').heightPx).toBe(300)
    })

    it('matches the filter key case-insensitively and ignores an empty filter', () => {
        expect(parseEmbedParams('FILTER=tag:urgent').filter).toBe('tag:urgent')
        expect(parseEmbedParams('filter=').filter).toBeNull()
        expect(parseEmbedParams('mode=wbs filter=   ').filter).toBeNull()
    })

    it('combines all keys', () => {
        expect(
            parseEmbedParams('mode=timeline height=350 context=@work filter=status:doing')
        ).toEqual({
            mode: 'timeline',
            heightPx: 350,
            contexts: ['@work'],
            columns: [],
            lanes: [],
            filter: 'status:doing'
        })
    })

    it('ignores unrecognized tokens before filter=', () => {
        expect(parseEmbedParams('wat mode=triage bogus=1 height=250')).toEqual({
            mode: 'triage',
            heightPx: 250,
            contexts: [],
            columns: [],
            lanes: [],
            filter: null
        })
    })

    it('tolerates weird whitespace between tokens', () => {
        expect(parseEmbedParams('  mode=calendar \t  height=500  ')).toEqual({
            mode: 'calendar',
            heightPx: 500,
            contexts: [],
            columns: [],
            lanes: [],
            filter: null
        })
        expect(parseEmbedParams('\tfilter=  title:foo  ').filter).toBe('title:foo') // outer trim only
    })
})
