import { choiceProblem, chosenProperty, selectLinkProperty } from './relationship-rules'
import type { LinkRule } from './relationship-rules'

/**
 * Quick capture writes the parent link a `parent:` search term asks for
 * (business rule 72). Pure planning: which note the term names, which
 * property links the new card to it, and how to say so (or why not).
 */

/** A note a search term may name. */
export interface NoteRef {
    path: string
    basename: string
}

/** Which note a `parent:` term names. */
export type ParentMatch =
    { kind: 'found'; note: NoteRef } | { kind: 'missing' } | { kind: 'ambiguous'; count: number }

/**
 * Match a search title against vault notes: the case-insensitive exact
 * basename first (a unique one), else a unique note whose basename contains
 * the title (the filter's own `parent:"X"` is a substring match). Several
 * candidates at the same step are never guessed between.
 */
export function matchParentTitle(title: string, notes: ReadonlyArray<NoteRef>): ParentMatch {
    const needle = title.trim().toLowerCase()
    if (needle.length === 0) return { kind: 'missing' }
    const exact = notes.filter((n) => n.basename.toLowerCase() === needle)
    if (exact.length === 1 && exact[0]) return { kind: 'found', note: exact[0] }
    if (exact.length > 1) return { kind: 'ambiguous', count: exact.length }
    const partial = notes.filter((n) => n.basename.toLowerCase().includes(needle))
    if (partial.length === 1 && partial[0]) return { kind: 'found', note: partial[0] }
    if (partial.length > 1) return { kind: 'ambiguous', count: partial.length }
    return { kind: 'missing' }
}

export interface ParentTerm {
    field: 'parent' | 'ancestor'
    title: string
}

/** What a new card does about the board's `parent:` / `ancestor:` term. */
export type ParentLinkPlan =
    /** No such term: nothing to link. */
    | { kind: 'none' }
    /** Write `link` into `property` (a list of wikilinks) of the new note. */
    | { kind: 'link'; term: string; property: string; link: string }
    /** The term can not be honored; `reason` says why. */
    | { kind: 'blocked'; field: ParentTerm['field']; term: string; reason: string }

export interface PlanParentLinkInput {
    term: ParentTerm | null
    /** The note the term names (only read for `parent:` terms). */
    match: ParentMatch
    /** The named note's recognized type id (null = unrecognized). */
    parentTypeId: string | null
    /** The NEW card's own parent rules. */
    rules: ReadonlyArray<LinkRule>
    /** The wikilink to store, e.g. `[[AI Tooling (Project)]]`. */
    link: string
}

export function planParentLink(input: PlanParentLinkInput): ParentLinkPlan {
    const { term } = input
    if (!term) return { kind: 'none' }
    const quoted = `"${term.title}"`
    if (term.field === 'ancestor') {
        return {
            kind: 'blocked',
            field: term.field,
            term: term.title,
            reason: `ancestor:${quoted} matches a whole subtree, not one direct parent`
        }
    }
    if (input.match.kind === 'missing') {
        return {
            kind: 'blocked',
            field: term.field,
            term: term.title,
            reason: `no note is named ${quoted}`
        }
    }
    if (input.match.kind === 'ambiguous') {
        return {
            kind: 'blocked',
            field: term.field,
            term: term.title,
            reason: `${String(input.match.count)} notes match ${quoted}`
        }
    }
    const choice = selectLinkProperty(input.rules, input.parentTypeId)
    const property = chosenProperty(choice)
    if (property.length === 0) {
        return {
            kind: 'blocked',
            field: term.field,
            term: term.title,
            reason: choiceProblem(choice, 'parent', input.match.note.basename)
        }
    }
    return { kind: 'link', term: term.title, property, link: input.link }
}

/** The create modal's sentence about the plan ('' when there is no term). */
export function parentLinkSubtitle(plan: ParentLinkPlan): string {
    if (plan.kind === 'link') return `Linked to ${plan.link} via ${plan.property}.`
    if (plan.kind === 'blocked') return `Not linked to "${plan.term}": ${plan.reason}.`
    return ''
}

/** The unmet-filter fragment for the post-create notice, or null when linked / no term. */
export function parentLinkUnmet(plan: ParentLinkPlan): string | null {
    return plan.kind === 'blocked' ? `${plan.field} "${plan.term}" (${plan.reason})` : null
}
