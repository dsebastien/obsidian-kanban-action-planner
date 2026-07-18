import { describe, expect, it } from 'bun:test'
import { parseEmbedParams } from './embed-params'
import type { EmbedParams } from './embed-params'

/** All-null params: what any alias without recognized keys must yield. */
const NONE: EmbedParams = { mode: null, heightPx: null, contexts: [], filter: null }

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
            filter: 'status:doing'
        })
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
            filter: 'status:doing'
        })
    })

    it('ignores unrecognized tokens before filter=', () => {
        expect(parseEmbedParams('wat mode=triage bogus=1 height=250')).toEqual({
            mode: 'triage',
            heightPx: 250,
            contexts: [],
            filter: null
        })
    })

    it('tolerates weird whitespace between tokens', () => {
        expect(parseEmbedParams('  mode=calendar \t  height=500  ')).toEqual({
            mode: 'calendar',
            heightPx: 500,
            contexts: [],
            filter: null
        })
        expect(parseEmbedParams('\tfilter=  title:foo  ').filter).toBe('title:foo') // outer trim only
    })
})
