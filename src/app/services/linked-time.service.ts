import type { App, CachedMetadata, TFile } from 'obsidian'
import {
    DEFAULT_LINKED_TIME_DATE_PROPERTY,
    DEFAULT_LINKED_TIME_LINK_PROPERTY,
    DEFAULT_LINKED_TIME_MINUTES_PROPERTY,
    DEFAULT_LINKED_TIME_REQUIRED_TAG
} from '../constants'
import type { NoteType } from '../domain/note-type'
import type { LinkedNoteTime, LinkedTimeConfig, TrackedTimeResult } from '../domain/linked-time'
import {
    combineTrackedTime,
    entryDescriptionLinkpath,
    linkedDate,
    linkedMinutes,
    normalizeTag,
    tagsInclude
} from '../domain/linked-time'
import type { TimeEntry } from '../domain/time-entries'
import { parseTimeEntries } from '../domain/time-entries'
import { findKeyCaseInsensitive } from './frontmatter.service'

/**
 * Time from linked notes: the vault side (see `domain/linked-time.ts` for the
 * rule). A reverse index — target path → paths of the notes counted for it —
 * built lazily per (link property, required tag) on the first query, by one
 * pass over the markdown files' metadata cache, then kept current one file at
 * a time from metadata events (wired by the plugin). Minutes and dates are
 * read at query time, so the index only tracks membership.
 */

/** The slice of `App` the index reads. */
export interface LinkedTimeApp {
    vault: Pick<App['vault'], 'getMarkdownFiles' | 'getFileByPath'>
    metadataCache: Pick<App['metadataCache'], 'getFileCache' | 'getFirstLinkpathDest'>
}

/**
 * A note type's linked-time config with blanks filled by the defaults, or
 * null when the feature is off (or the type has no block).
 */
export function linkedTimeConfigForType(
    noteType: Pick<NoteType, 'timeTracking'> | undefined
): LinkedTimeConfig | null {
    const block = noteType?.timeTracking?.linkedNotes
    if (!block?.enabled) return null
    const pick = (value: string, fallback: string): string =>
        value.trim() !== '' ? value.trim() : fallback
    return {
        linkProperty: pick(block.linkProperty, DEFAULT_LINKED_TIME_LINK_PROPERTY),
        minutesProperty: pick(block.minutesProperty, DEFAULT_LINKED_TIME_MINUTES_PROPERTY),
        dateProperty: pick(block.dateProperty, DEFAULT_LINKED_TIME_DATE_PROPERTY),
        requiredTag: pick(block.requiredTag, DEFAULT_LINKED_TIME_REQUIRED_TAG)
    }
}

/** A frontmatter value by property name (case-insensitive), from a cache. */
function frontmatterValue(cache: CachedMetadata | null, property: string): unknown {
    const fm = cache?.frontmatter
    const key = findKeyCaseInsensitive(fm, property)
    return key === null || !fm ? undefined : fm[key]
}

/**
 * The paths a note counts for under `config`: empty unless it carries the
 * required tag; else every target its link property (a list or a single
 * value) links to, resolved from the note's own path. The note itself is
 * never its own target.
 */
export function linkedTargetsOf(
    app: LinkedTimeApp,
    file: TFile,
    config: Pick<LinkedTimeConfig, 'linkProperty' | 'requiredTag'>
): Set<string> {
    const targets = new Set<string>()
    const cache = app.metadataCache.getFileCache(file)
    if (!cache?.frontmatter) return targets
    if (!tagsInclude(frontmatterValue(cache, 'tags'), config.requiredTag)) return targets
    const property = config.linkProperty.toLowerCase()
    for (const link of cache.frontmatterLinks ?? []) {
        // Keys are `prop` (single value) or `prop.<i>` (list item).
        const dot = link.key.indexOf('.')
        const prop = (dot < 0 ? link.key : link.key.slice(0, dot)).toLowerCase()
        if (prop !== property) continue
        const linkpath = link.link.split('#')[0] ?? ''
        if (linkpath.trim() === '') continue
        const dest = app.metadataCache.getFirstLinkpathDest(linkpath, file.path)
        if (dest && dest.path !== file.path) targets.add(dest.path)
    }
    return targets
}

/** One (link property, tag) index. */
interface IndexState {
    config: Pick<LinkedTimeConfig, 'linkProperty' | 'requiredTag'>
    sourceToTargets: Map<string, Set<string>>
    targetToSources: Map<string, Set<string>>
}

function indexKey(config: Pick<LinkedTimeConfig, 'linkProperty' | 'requiredTag'>): string {
    return `${config.linkProperty.trim().toLowerCase()}\u0000${normalizeTag(config.requiredTag)}`
}

/** The reverse index of linked notes, shared by every view and the public API. */
export class LinkedNotesIndex {
    private readonly states = new Map<string, IndexState>()

    constructor(private readonly app: LinkedTimeApp) {}

    /** Paths of the notes counted for `targetPath` under `config`, sorted. */
    sourcesFor(
        targetPath: string,
        config: Pick<LinkedTimeConfig, 'linkProperty' | 'requiredTag'>
    ): string[] {
        const sources = this.state(config).targetToSources.get(targetPath)
        return sources ? [...sources].sort() : []
    }

    /** Whether any built index is current (events only matter then). */
    get isBuilt(): boolean {
        return this.states.size > 0
    }

    /**
     * Re-index one note (its metadata changed or its links re-resolved).
     * Returns the targets whose linked set or linked values may have changed:
     * its old and new targets (`all`) or only the ones it joined or left.
     */
    update(file: TFile, mode: 'all' | 'membership' = 'all'): Set<string> {
        const touched = new Set<string>()
        for (const state of this.states.values()) {
            const before = state.sourceToTargets.get(file.path) ?? new Set<string>()
            const after = linkedTargetsOf(this.app, file, state.config)
            for (const target of before) {
                if (mode === 'all' || !after.has(target)) touched.add(target)
            }
            for (const target of after) {
                if (mode === 'all' || !before.has(target)) touched.add(target)
            }
            this.setTargets(state, file.path, after)
        }
        return touched
    }

    /** Drop a deleted note. Returns the targets it counted for. */
    remove(path: string): Set<string> {
        const touched = new Set<string>()
        for (const state of this.states.values()) {
            for (const target of state.sourceToTargets.get(path) ?? []) touched.add(target)
            this.setTargets(state, path, new Set())
        }
        return touched
    }

    /** Forget everything; the next query rebuilds (a rename can move any link). */
    invalidate(): void {
        this.states.clear()
    }

    private state(config: Pick<LinkedTimeConfig, 'linkProperty' | 'requiredTag'>): IndexState {
        const key = indexKey(config)
        let state = this.states.get(key)
        if (state) return state
        state = {
            config: { linkProperty: config.linkProperty, requiredTag: config.requiredTag },
            sourceToTargets: new Map(),
            targetToSources: new Map()
        }
        for (const file of this.app.vault.getMarkdownFiles()) {
            const targets = linkedTargetsOf(this.app, file, state.config)
            if (targets.size > 0) this.setTargets(state, file.path, targets)
        }
        this.states.set(key, state)
        return state
    }

    private setTargets(state: IndexState, source: string, targets: Set<string>): void {
        for (const target of state.sourceToTargets.get(source) ?? []) {
            const sources = state.targetToSources.get(target)
            sources?.delete(source)
            if (sources?.size === 0) state.targetToSources.delete(target)
        }
        if (targets.size === 0) {
            state.sourceToTargets.delete(source)
            return
        }
        state.sourceToTargets.set(source, targets)
        for (const target of targets) {
            let sources = state.targetToSources.get(target)
            if (!sources) {
                sources = new Set()
                state.targetToSources.set(target, sources)
            }
            sources.add(source)
        }
    }
}

/** The linked notes counted for `target`, with their minutes and dates. */
export function linkedNotesOf(
    app: LinkedTimeApp,
    index: LinkedNotesIndex,
    target: TFile,
    config: LinkedTimeConfig
): LinkedNoteTime[] {
    const notes: LinkedNoteTime[] = []
    for (const path of index.sourcesFor(target.path, config)) {
        const file = app.vault.getFileByPath(path)
        if (!file) continue
        const cache = app.metadataCache.getFileCache(file)
        notes.push({
            path,
            minutes: linkedMinutes(frontmatterValue(cache, config.minutesProperty)),
            date: linkedDate(frontmatterValue(cache, config.dateProperty))
        })
    }
    return notes
}

/**
 * Whether an entry of `target` is a linked note's session: its description
 * is a wikilink that resolves (from the target's path) to a path in `linked`.
 */
export function linkedEntryMatcher(
    app: LinkedTimeApp,
    target: TFile,
    linked: ReadonlySet<string>
): (entry: TimeEntry) => boolean {
    if (linked.size === 0) return () => false
    return (entry) => {
        const linkpath = entryDescriptionLinkpath(entry.description)
        if (linkpath === null) return false
        const dest = app.metadataCache.getFirstLinkpathDest(linkpath, target.path)
        return dest !== null && linked.has(dest.path)
    }
}

/**
 * The tracked time of `target`: its entries (raw value of its entries
 * property) plus, when `config` is set, its linked notes.
 */
export function computeTrackedTimeOf(
    app: LinkedTimeApp,
    index: LinkedNotesIndex,
    target: TFile,
    rawEntries: unknown,
    config: LinkedTimeConfig | null
): TrackedTimeResult {
    const linked = config ? linkedNotesOf(app, index, target, config) : []
    const matcher = linkedEntryMatcher(app, target, new Set(linked.map((n) => n.path)))
    return combineTrackedTime(parseTimeEntries(rawEntries), linked, matcher)
}
