import { describe, expect, it } from 'bun:test'
import { matchesMapping, matchesAnyMapping, recognizeLocalType } from './note-type-recognition'
import type { RecognitionFile, RecognitionMapping } from './note-type-recognition'

const file: RecognitionFile = {
    path: 'Areas/Work/Task A.md',
    tags: ['type/task', 'work']
}

const m = (
    type: RecognitionMapping['type'],
    value: string,
    enabled = true
): RecognitionMapping => ({ type, value, enabled })

describe('matchesMapping', () => {
    it('matches an exact tag (case-insensitive, # optional)', () => {
        expect(matchesMapping(file, m('tag', 'type/task'))).toBe(true)
        expect(matchesMapping(file, m('tag', '#Type/Task'))).toBe(true)
        expect(matchesMapping(file, m('tag', 'type/project'))).toBe(false)
    })

    it('matches a parent tag', () => {
        expect(matchesMapping(file, m('tag', 'type'))).toBe(true) // type/task is under type
    })

    it('matches a folder (file inside it or a subfolder)', () => {
        expect(matchesMapping(file, m('folder', 'Areas'))).toBe(true)
        expect(matchesMapping(file, m('folder', 'Areas/Work'))).toBe(true)
        expect(matchesMapping(file, m('folder', 'Areas/Home'))).toBe(false)
        expect(matchesMapping(file, m('folder', 'Are'))).toBe(false) // not a path segment
    })

    it('matches a regex against the path', () => {
        expect(matchesMapping(file, m('regex', 'Task .+\\.md$'))).toBe(true)
        expect(matchesMapping(file, m('regex', '^Projects/'))).toBe(false)
    })

    it('ignores disabled, blank, or invalid mappings', () => {
        expect(matchesMapping(file, m('tag', 'type/task', false))).toBe(false)
        expect(matchesMapping(file, m('folder', '  '))).toBe(false)
        expect(matchesMapping(file, m('regex', '('))).toBe(false) // invalid regex
    })
})

describe('matchesAnyMapping / recognizeLocalType', () => {
    it('matches when any mapping matches', () => {
        expect(matchesAnyMapping(file, [m('tag', 'nope'), m('folder', 'Areas')])).toBe(true)
        expect(matchesAnyMapping(file, [m('tag', 'nope')])).toBe(false)
    })

    it('returns the first matching candidate id', () => {
        const candidates = [
            { id: 'a', mappings: [m('tag', 'unrelated')] },
            { id: 'b', mappings: [m('folder', 'Areas')] },
            { id: 'c', mappings: [m('tag', 'work')] }
        ]
        expect(recognizeLocalType(file, candidates)).toBe('b')
        expect(recognizeLocalType(file, [{ id: 'x', mappings: [m('tag', 'none')] }])).toBeNull()
    })
})
