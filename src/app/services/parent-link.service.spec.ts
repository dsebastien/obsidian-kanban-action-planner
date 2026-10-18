import { describe, expect, it } from 'bun:test'
import { App, TFile } from 'obsidian'
import { placeParentLink, resolveParentNote } from './parent-link.service'
import type { ParentLinkPlan } from '../domain/parent-link'

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

describe('placeParentLink (quick capture facts)', () => {
    const plan = (cardinality: 'one' | 'many'): ParentLinkPlan => ({
        kind: 'link',
        term: 'Severance (TV Show)',
        property: 'show',
        cardinality,
        link: '[[Severance (TV Show)]]'
    })

    it("a 'one' rule writes the scalar into properties, replacing a Base fact", () => {
        const properties: Record<string, unknown> = { Show: '[[Old]]', status: 'Todo' }
        const lists: Record<string, string[]> = {}
        placeParentLink(properties, lists, plan('one'))
        expect(properties).toEqual({ Show: '[[Severance (TV Show)]]', status: 'Todo' })
        expect(lists).toEqual({})
    })

    it("a 'many' rule appends to listProperties", () => {
        const properties: Record<string, unknown> = {}
        const lists: Record<string, string[]> = { show: ['[[Other]]'] }
        placeParentLink(properties, lists, plan('many'))
        expect(lists).toEqual({ show: ['[[Other]]', '[[Severance (TV Show)]]'] })
        expect(properties).toEqual({})
    })

    it('does nothing without a link plan', () => {
        const properties: Record<string, unknown> = {}
        const lists: Record<string, string[]> = {}
        placeParentLink(properties, lists, { kind: 'none' })
        expect(properties).toEqual({})
        expect(lists).toEqual({})
    })
})
