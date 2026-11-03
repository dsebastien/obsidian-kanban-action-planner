import { parseFrontMatterTags } from 'obsidian'
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
    skippedEntryPaths,
    tagsInclude
} from '../domain/linked-time'
import type { TimeEntry } from '../domain/time-entries'
import { parseTimeEntries } from '../domain/time-entries'
import { findKeyCaseInsensitive } from './frontmatter.service'

/**
 * Time from linked notes: the vault side (see `domain/linked-time.ts` for the
 * rule). A reverse index — target path → the notes counted for it, each with
 * its minutes and date — built lazily per config (link property, required
 * tag, minutes and date properties) on the first query, by one pass over the
 * markdown files' metadata cache, then kept current one file at a time from
 * metadata events (wired by the plugin through {@link linkedNotesEventHandlers}).
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
 * required tag (Obsidian's `parseFrontMatterTags`: `tags` / `tag`, a list or
 * a comma / space separated string; hierarchical, case-insensitive match);
 * else every target its link property (a list or a single value) links to,
 * resolved from the note's own path. The note itself is never its own target.
 */
export function linkedTargetsOf(
    app: LinkedTimeApp,
    file: TFile,
    config: Pick<LinkedTimeConfig, 'linkProperty' | 'requiredTag'>
): Set<string> {
    const targets = new Set<string>()
    const cache = app.metadataCache.getFileCache(file)
    if (!cache?.frontmatter) return targets
    if (!tagsInclude(parseFrontMatterTags(cache.frontmatter) ?? [], config.requiredTag)) {
        return targets
    }
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

/** What the index keeps per source note. */
interface SourceRecord {
    targets: Set<string>
    /** Rounded minutes (0 = none). */
    minutes: number
    date: string | null
}

/** One index, for one config. */
interface IndexState {
    config: LinkedTimeConfig
    sources: Map<string, SourceRecord>
    targetToSources: Map<string, Set<string>>
}

function indexKey(config: LinkedTimeConfig): string {
    return [
        config.linkProperty.trim().toLowerCase(),
        normalizeTag(config.requiredTag),
        config.minutesProperty.trim().toLowerCase(),
        config.dateProperty.trim().toLowerCase()
    ].join('\u0000')
}

/** A source's record under `config`, or null when it counts for no target. */
function recordOf(app: LinkedTimeApp, file: TFile, config: LinkedTimeConfig): SourceRecord | null {
    const targets = linkedTargetsOf(app, file, config)
    if (targets.size === 0) return null
    const cache = app.metadataCache.getFileCache(file)
    return {
        targets,
        minutes: linkedMinutes(frontmatterValue(cache, config.minutesProperty)),
        date: linkedDate(frontmatterValue(cache, config.dateProperty))
    }
}

/** The reverse index of linked notes, shared by every view and the public API. */
export class LinkedNotesIndex {
    private readonly states = new Map<string, IndexState>()

    constructor(private readonly app: LinkedTimeApp) {}

    /** Paths of the notes counted for `targetPath` under `config`, sorted. */
    sourcesFor(targetPath: string, config: LinkedTimeConfig): string[] {
        const sources = this.state(config).targetToSources.get(targetPath)
        return sources ? [...sources].sort() : []
    }

    /** The notes counted for `targetPath` under `config`, with minutes and date, sorted by path. */
    linkedFor(targetPath: string, config: LinkedTimeConfig): LinkedNoteTime[] {
        const state = this.state(config)
        const out: LinkedNoteTime[] = []
        for (const path of [...(state.targetToSources.get(targetPath) ?? [])].sort()) {
            const record = state.sources.get(path)
            if (record) out.push({ path, minutes: record.minutes, date: record.date })
        }
        return out
    }

    /** Whether any built index is current (events only matter then). */
    get isBuilt(): boolean {
        return this.states.size > 0
    }

    /**
     * Re-index one note (its metadata changed or its links re-resolved).
     * Returns the targets whose linked notes changed: every old and new
     * target when the note's minutes or date changed, else only the targets
     * it joined or left (a body-only edit returns none).
     */
    update(file: TFile): Set<string> {
        const touched = new Set<string>()
        for (const state of this.states.values()) {
            const before = state.sources.get(file.path)
            const after = recordOf(this.app, file, state.config)
            const beforeTargets = before?.targets ?? new Set<string>()
            const afterTargets = after?.targets ?? new Set<string>()
            const valuesChanged =
                before !== undefined &&
                after !== null &&
                (before.minutes !== after.minutes || before.date !== after.date)
            for (const target of beforeTargets) {
                if (valuesChanged || !afterTargets.has(target)) touched.add(target)
            }
            for (const target of afterTargets) {
                if (valuesChanged || !beforeTargets.has(target)) touched.add(target)
            }
            this.setRecord(state, file.path, after)
        }
        return touched
    }

    /** Drop a deleted note. Returns the targets it counted for. */
    remove(path: string): Set<string> {
        const touched = new Set<string>()
        for (const state of this.states.values()) {
            for (const target of state.sources.get(path)?.targets ?? []) touched.add(target)
            this.setRecord(state, path, null)
        }
        return touched
    }

    /**
     * A note moved from `oldPath` to `file.path`: re-key it as a source and
     * as a target, then re-index it (its links resolve from the new folder).
     * Returns the targets touched (both paths when it was a target).
     */
    rename(file: TFile, oldPath: string): Set<string> {
        const touched = new Set<string>()
        const newPath = file.path
        for (const state of this.states.values()) {
            const record = state.sources.get(oldPath)
            if (record) {
                this.setRecord(state, oldPath, null)
                this.setRecord(state, newPath, record)
            }
            const sources = state.targetToSources.get(oldPath)
            if (sources) {
                state.targetToSources.delete(oldPath)
                state.targetToSources.set(newPath, sources)
                for (const source of sources) {
                    const targets = state.sources.get(source)?.targets
                    targets?.delete(oldPath)
                    targets?.add(newPath)
                }
                touched.add(oldPath)
                touched.add(newPath)
            }
        }
        for (const target of this.update(file)) touched.add(target)
        return touched
    }

    /**
     * Keep only the indexes of the configs still in use (settings changed);
     * none left = not built, so metadata events are ignored again.
     */
    retain(configs: readonly LinkedTimeConfig[]): void {
        const keep = new Set(configs.map(indexKey))
        for (const key of [...this.states.keys()]) {
            if (!keep.has(key)) this.states.delete(key)
        }
    }

    /** Forget everything; the next query rebuilds. */
    invalidate(): void {
        this.states.clear()
    }

    private state(config: LinkedTimeConfig): IndexState {
        const key = indexKey(config)
        let state = this.states.get(key)
        if (state) return state
        state = {
            config: { ...config },
            sources: new Map(),
            targetToSources: new Map()
        }
        for (const file of this.app.vault.getMarkdownFiles()) {
            this.setRecord(state, file.path, recordOf(this.app, file, state.config))
        }
        this.states.set(key, state)
        return state
    }

    private setRecord(state: IndexState, source: string, record: SourceRecord | null): void {
        for (const target of state.sources.get(source)?.targets ?? []) {
            const sources = state.targetToSources.get(target)
            sources?.delete(source)
            if (sources?.size === 0) state.targetToSources.delete(target)
        }
        if (record === null) {
            state.sources.delete(source)
            return
        }
        state.sources.set(source, record)
        for (const target of record.targets) {
            let sources = state.targetToSources.get(target)
            if (!sources) {
                sources = new Set()
                state.targetToSources.set(target, sources)
            }
            sources.add(source)
        }
    }
}

/**
 * The metadata / vault event handlers keeping `index()` current, each
 * reporting the touched targets to `notify` (skipped when none). They do
 * nothing until an index is built. The plugin registers them.
 */
export function linkedNotesEventHandlers(
    index: () => LinkedNotesIndex | null,
    notify: (targets: ReadonlySet<string>) => void
): {
    changed(file: TFile): void
    resolve(file: TFile): void
    deleted(path: string): void
    rename(file: TFile, oldPath: string): void
} {
    const report = (targets: ReadonlySet<string>): void => {
        if (targets.size > 0) notify(targets)
    }
    const built = (): LinkedNotesIndex | null => {
        const current = index()
        return current?.isBuilt ? current : null
    }
    return {
        changed: (file) => {
            const current = built()
            if (current) report(current.update(file))
        },
        // A link can start (or stop) resolving without its note changing.
        resolve: (file) => {
            const current = built()
            if (current) report(current.update(file))
        },
        deleted: (path) => {
            const current = built()
            if (current) report(current.remove(path))
        },
        rename: (file, oldPath) => {
            const current = built()
            if (current) report(current.rename(file, oldPath))
        }
    }
}

/** The linked notes counted for `target`, with their minutes and dates. */
export function linkedNotesOf(
    index: LinkedNotesIndex,
    target: TFile,
    config: LinkedTimeConfig
): LinkedNoteTime[] {
    return index.linkedFor(target.path, config)
}

/**
 * Whether an entry is a linked note's session: its description is a
 * wikilink that resolves (from `source`, the note holding the entry) to a
 * path in `skipped` (see `skippedEntryPaths`).
 */
export function linkedEntryMatcher(
    app: LinkedTimeApp,
    source: TFile,
    skipped: ReadonlySet<string>
): (entry: TimeEntry) => boolean {
    if (skipped.size === 0) return () => false
    return (entry) => {
        const linkpath = entryDescriptionLinkpath(entry.description)
        if (linkpath === null) return false
        const dest = app.metadataCache.getFirstLinkpathDest(linkpath, source.path)
        return dest !== null && skipped.has(dest.path)
    }
}

/**
 * The tracked time of `target`: its entries (raw value of its entries
 * property) plus, when `config` is set, its linked notes. An entry linking
 * to a linked note with minutes > 0 is skipped.
 */
export function computeTrackedTimeOf(
    app: LinkedTimeApp,
    index: LinkedNotesIndex,
    target: TFile,
    rawEntries: unknown,
    config: LinkedTimeConfig | null
): TrackedTimeResult {
    const linked = config ? linkedNotesOf(index, target, config) : []
    const matcher = linkedEntryMatcher(app, target, skippedEntryPaths(linked))
    return combineTrackedTime(parseTimeEntries(rawEntries), linked, matcher)
}
