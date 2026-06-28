import { describe, expect, it } from 'bun:test'
import { archiveFolderPrefix, archiveFolderPrefixes, isArchivedPath } from './archive-paths'

describe('archiveFolderPrefix', () => {
    it('takes everything before the first placeholder, normalized', () => {
        expect(archiveFolderPrefix('Archive/{{year}}/{{month}}')).toBe('Archive')
        expect(archiveFolderPrefix('Reference/Archive/{{year}}')).toBe('Reference/Archive')
        expect(archiveFolderPrefix('Archive')).toBe('Archive')
    })

    it('collapses stray separators and whitespace', () => {
        expect(archiveFolderPrefix(' Archive // Done /{{year}}')).toBe('Archive/Done')
        expect(archiveFolderPrefix('Archive/')).toBe('Archive')
    })

    it('yields empty for a template that starts with a placeholder or is blank', () => {
        expect(archiveFolderPrefix('{{year}}/Archive')).toBe('')
        expect(archiveFolderPrefix('')).toBe('')
        expect(archiveFolderPrefix('   ')).toBe('')
    })
})

describe('archiveFolderPrefixes', () => {
    it('dedupes and drops empty prefixes across templates', () => {
        expect(
            archiveFolderPrefixes([
                'Archive/{{year}}',
                'Archive/{{year}}/{{month}}',
                'Done/{{quarter}}',
                '{{year}}',
                ''
            ])
        ).toEqual(['Archive', 'Done'])
    })
})

describe('isArchivedPath', () => {
    const prefixes = ['Archive', 'Reference/Archive']

    it('matches a note under a prefix folder', () => {
        expect(isArchivedPath('Archive/2026/B.md', prefixes)).toBe(true)
        expect(isArchivedPath('Reference/Archive/X.md', prefixes)).toBe(true)
    })

    it('does not match active notes outside the prefixes', () => {
        expect(isArchivedPath('Projects/Project X.md', prefixes)).toBe(false)
        // Guard against a same-named-prefix false positive on a sibling folder.
        expect(isArchivedPath('Archived Stuff/Y.md', prefixes)).toBe(false)
    })

    it('is false when there are no prefixes', () => {
        expect(isArchivedPath('Archive/2026/B.md', [])).toBe(false)
    })
})
