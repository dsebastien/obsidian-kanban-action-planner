import { describe, expect, it } from 'bun:test'
import { App, TFile } from 'obsidian'
import {
    activeRoles,
    addRelationshipLink,
    directLinkTargets,
    removeRelationshipLink,
    resolveBoardRelationships
} from './relationships.service'
import { roleProperties } from '../domain/relationship-rules'
import { createDefaultNoteType } from './note-type.service'
import type { NoteType, RelationshipRole } from '../domain/note-type'

function noteTypeWith(rules: NoteType['relationships'], mirrored = false): NoteType {
    const noteType = createDefaultNoteType('p', 'P', 'local')
    return {
        ...noteType,
        relationships: rules,
        ...(mirrored ? { relationshipsMirrored: true } : {})
    }
}

describe('activeRoles', () => {
    it('a mirrored type receives every role, so a parent with no child rule gets inverses', () => {
        const noteType = noteTypeWith(
            [{ role: 'parent', linkProperty: 'show', mirrored: true, cardinality: 'one' }],
            true
        )
        expect(activeRoles(noteType, roleProperties(noteType)).size).toBe(4)
    })

    it('marks a role active when it has a non-empty link-property', () => {
        const noteType = noteTypeWith([{ role: 'parent', linkProperty: 'parent' }])
        const props = roleProperties(noteType)
        expect(activeRoles(noteType, props).has('parent')).toBe(true)
    })

    it('marks a role inactive when its link-property is empty ("None") and it has no heuristic', () => {
        const noteType = noteTypeWith([
            { role: 'parent', linkProperty: '' },
            { role: 'sibling', linkProperty: '' },
            { role: 'child', linkProperty: '' },
            { role: 'blocked_by', linkProperty: '' }
        ])
        const props = roleProperties(noteType)
        const active = activeRoles(noteType, props)
        expect(active.has('parent')).toBe(false)
        expect(active.has('sibling')).toBe(false)
        expect(active.has('child')).toBe(false)
        expect(active.has('blocked_by')).toBe(false)
    })

    it('keeps a role active when it has a heuristic even with an empty property', () => {
        const noteType = noteTypeWith([
            {
                role: 'child',
                linkProperty: '',
                heuristic: { allowedTypeTags: ['#task'], requiresLinkToSource: true }
            }
        ])
        const props = roleProperties(noteType)
        expect(activeRoles(noteType, props).has('child')).toBe(true)
    })

    it('treats a role with no rule as active (out-of-the-box default property)', () => {
        // A noteType missing a rule for a role falls back to that role's default
        // property in roleProperties, so the role stays on by default.
        const noteType = noteTypeWith([{ role: 'blocked_by', linkProperty: '' }])
        const props = roleProperties(noteType)
        const active = activeRoles(noteType, props)
        const defaulted: RelationshipRole[] = ['parent', 'sibling', 'child']
        for (const role of defaulted) expect(active.has(role)).toBe(true)
        expect(active.has('blocked_by')).toBe(false)
    })
})

// ── Multi-rule reads and writes (business rules 70-71) ───────────────────

interface FakeNote {
    file: TFile
    links: Array<{ key: string; link: string }>
}

function note(path: string, links: Array<{ key: string; link: string }> = []): FakeNote {
    const basename = path.replace(/^.*\//, '').replace(/\.md$/, '')
    return { file: Object.assign(new TFile(), { path, basename }), links }
}

/** A minimal metadata cache over named notes: link text resolves by basename. */
function appOver(notes: FakeNote[]): App {
    const byName = new Map(notes.map((n) => [n.file.basename, n.file]))
    return Object.assign(new App(), {
        metadataCache: {
            getFileCache: (file: TFile) => {
                const found = notes.find((n) => n.file.path === file.path)
                return found
                    ? {
                          frontmatterLinks: found.links.map((l) => ({
                              key: l.key,
                              link: l.link,
                              original: `[[${l.link}]]`
                          }))
                      }
                    : null
            },
            getFirstLinkpathDest: (linkpath: string): TFile | null => byName.get(linkpath) ?? null,
            resolvedLinks: {}
        }
    })
}

describe('resolveBoardRelationships (several rules per role)', () => {
    const task = note('T/Task (Task).md', [
        { key: 'related_projects', link: 'Project (Project)' },
        { key: 'related_goals.0', link: 'Goal (Goal)' }
    ])
    const project = note('P/Project (Project).md')
    const goal = note('G/Goal (Goal).md')
    const app = appOver([task, project, goal])

    it('unions every parent property of the note type', () => {
        const type = noteTypeWith([
            { role: 'parent', linkProperty: 'related_projects', targetTypeIds: ['projects'] },
            { role: 'parent', linkProperty: 'related_goals', targetTypeIds: ['goals'] }
        ])
        const sets = resolveBoardRelationships(app, [task.file], type)
        expect(sets.get(task.file.path)?.parent.sort()).toEqual([
            'G/Goal (Goal).md',
            'P/Project (Project).md'
        ])
    })

    it('a single-rule type still reads only that property (the older behavior)', () => {
        const type = noteTypeWith([{ role: 'parent', linkProperty: 'related_projects' }])
        const sets = resolveBoardRelationships(app, [task.file], type)
        expect(sets.get(task.file.path)?.parent).toEqual(['P/Project (Project).md'])
    })

    it('gives the inverse child to each parent present on the board', () => {
        const type = noteTypeWith([
            { role: 'parent', linkProperty: 'related_projects' },
            { role: 'parent', linkProperty: 'related_goals' }
        ])
        const sets = resolveBoardRelationships(app, [task.file, project.file, goal.file], type)
        expect(sets.get(project.file.path)?.child).toEqual([task.file.path])
        expect(sets.get(goal.file.path)?.child).toEqual([task.file.path])
    })

    it('reads only the mirrored rules once the Starter Kit owns the type', () => {
        const type = noteTypeWith(
            [
                { role: 'parent', linkProperty: 'related_goals', mirrored: true },
                { role: 'parent', linkProperty: 'related_projects' }
            ],
            true
        )
        const sets = resolveBoardRelationships(app, [task.file], type)
        expect(sets.get(task.file.path)?.parent).toEqual(['G/Goal (Goal).md'])
    })
})

describe('removeRelationshipLink (from the property that holds the link)', () => {
    it('leaves the other parent properties alone', async () => {
        const fm: Record<string, unknown> = {
            related_projects: ['[[Project (Project)]]'],
            related_goals: ['[[Goal (Goal)]]']
        }
        const file = Object.assign(new TFile(), { path: 'T/Task.md', basename: 'Task' })
        const app = Object.assign(new App(), {
            metadataCache: {
                getFirstLinkpathDest: (linkpath: string): TFile | null =>
                    Object.assign(new TFile(), {
                        path: `X/${linkpath}.md`,
                        basename: linkpath
                    })
            },
            fileManager: {
                processFrontMatter: async (
                    _file: TFile,
                    fn: (frontmatter: Record<string, unknown>) => void
                ): Promise<void> => {
                    fn(fm)
                    await Promise.resolve()
                }
            }
        })
        await removeRelationshipLink(app, file, 'related_projects', 'X/Project (Project).md')
        expect('related_projects' in fm).toBe(false)
        expect(fm['related_goals']).toEqual(['[[Goal (Goal)]]'])
    })
})

// ── Single-link (scalar) properties (business rule 73) ───────────────────

/** An app whose frontmatter is the given object, over resolvable notes. */
function appWithFrontmatter(
    fm: Record<string, unknown>,
    links: Array<{ key: string; link: string }>,
    writes: string[] = []
): App {
    const show = note('Shows/Severance (TV Show).md')
    const other = note('Shows/Andor (TV Show).md')
    const season = note('Seasons/Severance S1 (TV Season).md', links)
    const base = appOver([show, other, season])
    return Object.assign(base, {
        metadataCache: {
            ...base.metadataCache,
            fileToLinktext: (file: TFile): string => file.basename
        },
        fileManager: {
            processFrontMatter: async (
                _file: TFile,
                fn: (frontmatter: Record<string, unknown>) => void
            ): Promise<void> => {
                fn(fm)
                writes.push(JSON.stringify(fm))
                await Promise.resolve()
            }
        }
    })
}

describe('single-link properties', () => {
    it('the parent of a single-link season gets it as a child (parents store no rule)', () => {
        const season = note('S/Show S1 (TV Season).md', [{ key: 'show', link: 'Show (TV Show)' }])
        const show = note('S/Show (TV Show).md')
        const app = appOver([season, show])
        const seasonType = noteTypeWith(
            [{ role: 'parent', linkProperty: 'show', mirrored: true, cardinality: 'one' }],
            true
        )
        const showType = noteTypeWith([], true)
        const sets = resolveBoardRelationships(
            app,
            [season.file, show.file],
            seasonType,
            [],
            (path) => (path === show.file.path ? showType : seasonType)
        )
        expect(sets.get(show.file.path)?.child).toEqual([season.file.path])
    })

    const seasonFile = Object.assign(new TFile(), {
        path: 'Seasons/Severance S1 (TV Season).md',
        basename: 'Severance S1 (TV Season)'
    })
    const showFile = Object.assign(new TFile(), {
        path: 'Shows/Severance (TV Show).md',
        basename: 'Severance (TV Show)'
    })
    const andorFile = Object.assign(new TFile(), {
        path: 'Shows/Andor (TV Show).md',
        basename: 'Andor (TV Show)'
    })

    it('reads a scalar wikilink as the parent (no list needed)', () => {
        const season = note('Seasons/Severance S1 (TV Season).md', [
            { key: 'show', link: 'Severance (TV Show)' }
        ])
        const show = note('Shows/Severance (TV Show).md')
        const app = appOver([season, show])
        const type = noteTypeWith([
            {
                role: 'parent',
                linkProperty: 'show',
                cardinality: 'one',
                targetTypeIds: ['tv_shows']
            }
        ])
        const sets = resolveBoardRelationships(app, [season.file, show.file], type)
        expect(sets.get(season.file.path)?.parent).toEqual([show.file.path])
        expect(sets.get(show.file.path)?.child).toEqual([season.file.path])
        expect(directLinkTargets(app, season.file, 'show')).toEqual([
            { path: show.file.path, label: 'Severance (TV Show)' }
        ])
    })

    it("writing to a 'one' property sets a scalar wikilink, not a list", async () => {
        const fm: Record<string, unknown> = {}
        const app = appWithFrontmatter(fm, [])
        expect(await addRelationshipLink(app, seasonFile, 'show', showFile, 'one')).toBe(true)
        expect(fm['show']).toBe('[[Severance (TV Show)]]')
    })

    it("writing to a 'one' property REPLACES the previous value (re-parent)", async () => {
        const fm: Record<string, unknown> = { Show: '[[Andor (TV Show)]]' }
        const app = appWithFrontmatter(fm, [{ key: 'Show', link: 'Andor (TV Show)' }])
        expect(await addRelationshipLink(app, seasonFile, 'show', showFile, 'one')).toBe(true)
        expect(fm).toEqual({ Show: '[[Severance (TV Show)]]' })
    })

    it("re-linking the same target of a 'one' property is a no-op", async () => {
        const fm: Record<string, unknown> = { show: '[[Severance (TV Show)]]' }
        const writes: string[] = []
        const app = appWithFrontmatter(fm, [{ key: 'show', link: 'Severance (TV Show)' }], writes)
        expect(await addRelationshipLink(app, seasonFile, 'show', showFile, 'one')).toBe(false)
        expect(writes).toEqual([])
    })

    it("a 'one' write turns a stray list into the scalar", async () => {
        const fm: Record<string, unknown> = {
            show: ['[[Andor (TV Show)]]', '[[Severance (TV Show)]]']
        }
        const app = appWithFrontmatter(fm, [
            { key: 'show.0', link: 'Andor (TV Show)' },
            { key: 'show.1', link: 'Severance (TV Show)' }
        ])
        expect(await addRelationshipLink(app, seasonFile, 'show', showFile, 'one')).toBe(true)
        expect(fm['show']).toBe('[[Severance (TV Show)]]')
    })

    it("'many' (the default) still appends to a list", async () => {
        const fm: Record<string, unknown> = { related: ['[[Andor (TV Show)]]'] }
        const app = appWithFrontmatter(fm, [{ key: 'related.0', link: 'Andor (TV Show)' }])
        await addRelationshipLink(app, seasonFile, 'related', showFile)
        expect(fm['related']).toEqual(['[[Andor (TV Show)]]', '[[Severance (TV Show)]]'])
    })

    it('removing the link of a scalar property deletes the property', async () => {
        const fm: Record<string, unknown> = { show: '[[Severance (TV Show)]]', status: 'Todo' }
        const app = appWithFrontmatter(fm, [{ key: 'show', link: 'Severance (TV Show)' }])
        await removeRelationshipLink(app, seasonFile, 'show', showFile.path)
        expect(fm).toEqual({ status: 'Todo' })
    })

    it('removing another note leaves a scalar property alone', async () => {
        const fm: Record<string, unknown> = { show: '[[Severance (TV Show)]]' }
        const app = appWithFrontmatter(fm, [{ key: 'show', link: 'Severance (TV Show)' }])
        await removeRelationshipLink(app, seasonFile, 'show', andorFile.path)
        expect(fm).toEqual({ show: '[[Severance (TV Show)]]' })
    })
})
