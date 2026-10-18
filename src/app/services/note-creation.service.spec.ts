import { describe, expect, it } from 'bun:test'
import { mergeList } from './note-creation.service'

describe('mergeList (quick-capture list properties)', () => {
    it('keeps what a template wrote and appends the new values, deduped', () => {
        expect(mergeList(['[[A]]'], ['[[B]]', '[[A]]'], false)).toEqual(['[[A]]', '[[B]]'])
    })

    it('promotes a scalar and starts a fresh list from nothing', () => {
        expect(mergeList('[[A]]', ['[[B]]'], false)).toEqual(['[[A]]', '[[B]]'])
        expect(mergeList(undefined, ['[[B]]'], false)).toEqual(['[[B]]'])
        expect(mergeList(null, ['[[B]]'], false)).toEqual(['[[B]]'])
    })

    it('drops a template placeholder (related_projects: [null]) so the link stands alone', () => {
        expect(mergeList([null], ['[[AI Tooling (Project)]]'], false)).toEqual([
            '[[AI Tooling (Project)]]'
        ])
    })

    it('matches tags case-insensitively', () => {
        expect(mergeList(['Type/Task'], ['type/task', 'x'], true)).toEqual(['Type/Task', 'x'])
    })
})
