import { describe, expect, it } from 'bun:test'
import { App, TFile } from 'obsidian'
import {
    activeRoles,
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
