import { describe, expect, it } from 'bun:test'
import { App, TFile } from 'obsidian'
import { resolveParentNote } from './parent-link.service'

const file = (path: string): TFile =>
    Object.assign(new TFile(), { path, basename: path.replace(/^.*\//, '').replace(/\.md$/, '') })

function appWith(files: TFile[], linked: Record<string, TFile> = {}): App {
    return Object.assign(new App(), {
        metadataCache: {
            getFirstLinkpathDest: (linkpath: string): TFile | null => linked[linkpath] ?? null
        },
        vault: { getMarkdownFiles: (): TFile[] => files }
    })
}

describe('resolveParentNote', () => {
    const project = file('Projects/AI Tooling (Project).md')
    const task = file('Tasks/AI Tooling (Task).md')

    it('uses the link resolution of the embedding note first', () => {
        const app = appWith([project, task], { 'AI Tooling (Project)': project })
        const out = resolveParentNote(app, 'AI Tooling (Project)', 'Notes/Host.md')
        expect(out.file).toBe(project)
        expect(out.match.kind).toBe('found')
    })

    it('falls back to a unique vault basename', () => {
        const app = appWith([project, task])
        const out = resolveParentNote(app, 'ai tooling (project)', 'Notes/Host.md')
        expect(out.file).toBe(project)
    })

    it('refuses an ambiguous substring', () => {
        const app = appWith([project, task])
        const out = resolveParentNote(app, 'AI Tooling', 'Notes/Host.md')
        expect(out.file).toBeNull()
        expect(out.match).toEqual({ kind: 'ambiguous', count: 2 })
    })

    it('reports a missing note', () => {
        const out = resolveParentNote(appWith([project]), 'Nothing', 'Notes/Host.md')
        expect(out.file).toBeNull()
        expect(out.match.kind).toBe('missing')
        expect(resolveParentNote(appWith([project]), '  ', '').match.kind).toBe('missing')
    })
})
