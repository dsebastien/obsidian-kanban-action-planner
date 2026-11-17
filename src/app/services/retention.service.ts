import { Notice } from 'obsidian'
import type { App, TFile } from 'obsidian'
import type { KanbanActionPlannerPlugin } from '../plugin'
import type { AutomationRule, NoteType } from '../domain/note-type'
import { isoDate, ruleStampProperty } from '../domain/archive-grace'
import { isDoneValue, resolveDoneConfig } from '../domain/done'
import type { ResolvedDoneConfig } from '../domain/done'
import { mayWrite } from '../domain/declared-properties'
import {
    parseRetentionDays,
    retentionDateProperties,
    retentionDecision,
    retentionGuard
} from '../domain/retention'
import type { RetentionGuard } from '../domain/retention'
import { RETENTION_SWEEP_INTERVAL_MS, RETENTION_UNATTENDED_LIMIT } from '../constants'
import { isNamesake } from './archive.service'
import { readFrontmatterKey, updateFrontmatter, writeFrontmatterKey } from './frontmatter.service'
import { DEFAULT_NOTE_TYPE_ID, findNoteType, recognizeNoteTypeFor } from './note-type.service'
import { isStarterKitAvailable } from './starter-kit.service'
import { RetentionReviewModal } from '../ui/retention-review-modal'
import { log } from '../../utils/log'

/**
 * Retention (issue #241): delete done notes once their completion date is
 * older than their retention period. Off unless `retentionEnabled`.
 *
 * Unlike the archive sweep, this one is not tied to a board: it reads the
 * whole vault, so a note archived out of every board is still found. It reads
 * the metadata cache only (no file is opened), and asks a note's type only
 * for the few notes that can be due. The decision is `domain/retention.ts`;
 * this file gathers the facts, applies the guards and deletes.
 *
 * Safety rules that live here (business rule 83): a type's default period
 * reaches only notes RECOGNIZED as that type, never the fallback Default
 * type's "every other note"; nothing runs while Starter Kit types are stored
 * but the Starter Kit is not loaded (types would resolve wrongly); an
 * unattended sweep deletes or stamps a note only on its second sighting, and
 * never more than a few notes at once.
 *
 * Deleting goes through `fileManager.trashFile`, so a note goes where
 * Obsidian's "Deleted files" setting sends it.
 */

/** A done note past its retention period that may be deleted. */
export interface RetentionDue {
    file: TFile
    /** The retention period that applied (days). */
    days: number
    /** The completion date, `YYYY-MM-DD`. */
    completed: string
    ageDays: number
    /** How many other notes link to it. */
    backlinks: number
}

/** Why a note that asks for retention is not in the due list. */
export type RetentionKeptReason = RetentionGuard | 'invalid' | 'no-done-state'

export interface RetentionKept {
    file: TFile
    reason: RetentionKeptReason
    /** A sentence fragment for the review dialog. */
    detail: string
}

export interface RetentionStamp {
    file: TFile
    property: string
}

export interface RetentionScan {
    due: RetentionDue[]
    kept: RetentionKept[]
    /** Done notes with no completion date: stamping one starts their clock. */
    stamp: RetentionStamp[]
}

type Evaluation =
    | { kind: 'skip' }
    | { kind: 'due'; due: RetentionDue }
    | { kind: 'kept'; kept: RetentionKept }
    | { kind: 'stamp'; stamp: RetentionStamp }

/** What one sweep shares across the notes it looks at. */
interface SweepContext {
    today: Date
    /** Done definitions of the types whose default period is above 0. */
    defaultDone: ResolvedDoneConfig[]
    /** Notes linking to each note, built on first use. */
    backlinks: () => Map<string, number>
}

function sweepContext(plugin: KanbanActionPlannerPlugin, today: Date): SweepContext {
    let counts: Map<string, number> | null = null
    return {
        today,
        // The Default type is "every note no type recognizes": its default
        // period is never applied, so it is not part of the prefilter either.
        defaultDone: plugin.settings.noteTypes
            .filter((type) => type.id !== DEFAULT_NOTE_TYPE_ID)
            .filter((type) => (type.retention?.defaultDays ?? 0) > 0)
            .map((type) => resolveDoneConfig(type))
            .filter((done): done is ResolvedDoneConfig => done !== null),
        backlinks: () => {
            counts ??= backlinkCounts(plugin.app)
            return counts
        }
    }
}

/**
 * True while note types mirrored from the Starter Kit are stored but the
 * Starter Kit is not loaded (a device without it, a load order, a crash):
 * notes would then resolve to another type, or to none, and take the wrong
 * done state or default period. Retention does nothing until it is back.
 */
export function retentionPaused(plugin: KanbanActionPlannerPlugin): boolean {
    return (
        plugin.settings.noteTypes.some((type) => type.source === 'starter-kit') &&
        !isStarterKitAvailable(plugin.app)
    )
}

/** How many OTHER notes link to each note (resolved links only). */
export function backlinkCounts(app: {
    metadataCache: Pick<App['metadataCache'], 'resolvedLinks'>
}): Map<string, number> {
    const counts = new Map<string, number>()
    for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
        for (const target of Object.keys(targets)) {
            if (target === source) continue
            counts.set(target, (counts.get(target) ?? 0) + 1)
        }
    }
    return counts
}

/**
 * Whether a note can be due at all, from its cached frontmatter alone. Only
 * such notes have their type resolved (an async call per note), so a vault
 * of plain notes costs one cache read per note and nothing more.
 */
function mayBeDue(
    frontmatter: Record<string, unknown>,
    retentionProperty: string,
    defaultDone: ReadonlyArray<ResolvedDoneConfig>
): boolean {
    const own = parseRetentionDays(readFrontmatterKey(frontmatter, retentionProperty))
    if (own.kind === 'days') return own.days > 0
    if (own.kind === 'invalid') return true
    return defaultDone.some((done) =>
        isDoneValue(readFrontmatterKey(frontmatter, done.property), done.values)
    )
}

/**
 * The stored note type that applies to `file`: its own when one recognizes
 * it, else the Default type (for the done state only: `recognized` false
 * means no type default may apply).
 */
async function noteTypeOf(
    plugin: KanbanActionPlannerPlugin,
    file: TFile
): Promise<{ noteType: NoteType | undefined; recognized: boolean }> {
    const recognized = await recognizeNoteTypeFor(plugin.app, plugin, file)
    if (recognized) return { noteType: findNoteType(plugin, recognized.id), recognized: true }
    return { noteType: findNoteType(plugin, DEFAULT_NOTE_TYPE_ID), recognized: false }
}

/**
 * The property to stamp on a done note without a completion date: the one a
 * rule of the type writes for the note's status, else the only one listed.
 * With several listed and no rule to choose (a mirrored type lists one date
 * per end state), nothing is stamped: a wrong date kind is worse than a note
 * that waits.
 */
function stampTarget(
    dateProperties: ReadonlyArray<string>,
    status: string | null,
    rules: ReadonlyArray<AutomationRule>,
    done: ResolvedDoneConfig | null
): string | null {
    const byRule = ruleStampProperty(
        { archiveFolder: '', triggerStatuses: [], doneDateProperties: [...dateProperties] },
        status,
        rules,
        done
    )
    if (byRule !== null) return byRule
    return dateProperties.length === 1 ? (dateProperties[0] ?? null) : null
}

/**
 * Whether `file` is a folder note with something to orphan: the namesake of
 * its own folder when that folder holds other files (`Foo/Foo.md`), or a note
 * with a folder of its name beside it (`Foo.md` + `Foo/`).
 */
function isFolderNoteWithContent(app: App, file: TFile): boolean {
    const parent = file.parent
    if (parent === null) return false
    if (!parent.isRoot() && isNamesake(file.basename, parent.name) && parent.children.length > 1) {
        return true
    }
    const beside = parent.isRoot() ? file.basename : `${parent.path}/${file.basename}`
    return app.vault.getFolderByPath(beside) !== null
}

function guardDetail(guard: RetentionGuard, backlinks: number): string {
    switch (guard) {
        case 'tracking':
            return 'time tracking is running on it'
        case 'folder-note':
            return 'it is a folder note and its folder holds other files'
        case 'linked':
            return backlinks === 1
                ? 'another note links to it'
                : `${String(backlinks)} other notes link to it`
    }
}

async function evaluate(
    plugin: KanbanActionPlannerPlugin,
    file: TFile,
    context: SweepContext
): Promise<Evaluation> {
    const settings = plugin.settings
    const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter
    if (!frontmatter) return { kind: 'skip' }
    if (!mayBeDue(frontmatter, settings.retentionProperty, context.defaultDone)) {
        return { kind: 'skip' }
    }
    const read = (name: string): unknown => readFrontmatterKey(frontmatter, name)
    const { noteType, recognized } = await noteTypeOf(plugin, file)
    const done = resolveDoneConfig(noteType)
    const dateProperties = retentionDateProperties(
        noteType?.archive.doneDateProperties ?? [],
        settings.retentionDateProperty
    )
    const decision = retentionDecision({
        retention: read(settings.retentionProperty),
        defaultDays: recognized ? (noteType?.retention?.defaultDays ?? 0) : 0,
        done,
        dateProperties,
        read,
        today: context.today,
        modified: new Date(file.stat.mtime)
    })
    switch (decision.kind) {
        case 'none':
        case 'wait':
            return { kind: 'skip' }
        case 'no-done-state':
            return {
                kind: 'kept',
                kept: {
                    file,
                    reason: 'no-done-state',
                    detail: 'its note type has no done state (Configure → Done state)'
                }
            }
        case 'invalid':
            return {
                kind: 'kept',
                kept: {
                    file,
                    reason: 'invalid',
                    detail: `"${decision.raw}" in ${settings.retentionProperty} is not a whole number of days`
                }
            }
        case 'stamp': {
            const status = done ? read(done.property) : null
            const property = stampTarget(
                dateProperties,
                typeof status === 'string' ? status : null,
                noteType?.automations ?? [],
                done
            )
            // A Starter Kit type that does not declare the property is never
            // given it (business rule 81); the note then simply waits.
            if (property === null || !mayWrite(noteType, property)) return { kind: 'skip' }
            return { kind: 'stamp', stamp: { file, property } }
        }
        case 'expired': {
            const backlinks = context.backlinks().get(file.path) ?? 0
            const guard = retentionGuard({
                tracking: settings.activeTimeSession?.path === file.path,
                folderNoteWithSiblings: isFolderNoteWithContent(plugin.app, file),
                backlinks,
                keepLinked: settings.retentionKeepLinked
            })
            if (guard !== null) {
                return {
                    kind: 'kept',
                    kept: { file, reason: guard, detail: guardDetail(guard, backlinks) }
                }
            }
            return {
                kind: 'due',
                due: {
                    file,
                    days: decision.days,
                    completed: isoDate(decision.completed),
                    ageDays: decision.ageDays,
                    backlinks
                }
            }
        }
    }
}

/** Read the vault and sort the notes that ask for retention. Writes nothing. */
export async function scanRetention(
    plugin: KanbanActionPlannerPlugin,
    today: Date = new Date()
): Promise<RetentionScan> {
    const context = sweepContext(plugin, today)
    const scan: RetentionScan = { due: [], kept: [], stamp: [] }
    for (const file of plugin.app.vault.getMarkdownFiles()) {
        const result = await evaluate(plugin, file, context)
        if (result.kind === 'due') scan.due.push(result.due)
        else if (result.kind === 'kept') scan.kept.push(result.kept)
        else if (result.kind === 'stamp') scan.stamp.push(result.stamp)
    }
    const byPath = (a: { file: TFile }, b: { file: TFile }): number =>
        a.file.path.localeCompare(b.file.path)
    scan.due.sort(byPath)
    scan.kept.sort(byPath)
    return scan
}

const isBlank = (value: unknown): boolean =>
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

/**
 * Stamp today's date on the done notes that have no completion date. Each
 * note is evaluated again first, and the write itself only fills a property
 * that is still empty on disk, so a date another writer set is never replaced.
 */
export async function stampCompletionDates(
    plugin: KanbanActionPlannerPlugin,
    stamps: ReadonlyArray<RetentionStamp>,
    today: Date = new Date(),
    stop: () => boolean = () => false
): Promise<number> {
    const context = sweepContext(plugin, today)
    let stamped = 0
    for (const { file } of stamps) {
        if (stop()) break
        if (plugin.app.vault.getAbstractFileByPath(file.path) !== file) continue
        const check = await evaluate(plugin, file, context)
        if (check.kind !== 'stamp') continue
        const property = check.stamp.property
        try {
            await updateFrontmatter(plugin.app, file, (frontmatter) => {
                if (!isBlank(readFrontmatterKey(frontmatter, property))) return
                writeFrontmatterKey(frontmatter, property, isoDate(today))
                stamped++
            })
        } catch (error: unknown) {
            log(`Retention: stamping ${property} failed for "${file.path}".`, 'error', error)
        }
    }
    return stamped
}

/**
 * Delete the given notes. Each one is evaluated again right before it goes:
 * a note reopened, edited, linked or deleted since the scan is left alone.
 */
export async function deleteExpiredNotes(
    plugin: KanbanActionPlannerPlugin,
    files: ReadonlyArray<TFile>,
    today: Date = new Date(),
    stop: () => boolean = () => false
): Promise<{ deleted: number; skipped: number; failed: number }> {
    const context = sweepContext(plugin, today)
    const result = { deleted: 0, skipped: 0, failed: 0 }
    for (const file of files) {
        if (stop()) break
        if (plugin.app.vault.getAbstractFileByPath(file.path) !== file) {
            result.skipped++
            continue
        }
        const check = await evaluate(plugin, file, context)
        if (check.kind !== 'due') {
            result.skipped++
            continue
        }
        try {
            await plugin.app.fileManager.trashFile(file)
            result.deleted++
            log(
                `Retention: deleted "${file.path}" (done ${check.due.completed}, kept ${String(check.due.days)} day(s)).`,
                'info'
            )
        } catch (error: unknown) {
            result.failed++
            log(`Retention: deleting "${file.path}" failed.`, 'error', error)
        }
    }
    return result
}

const plural = (n: number, one: string, many: string): string =>
    `${String(n)} ${n === 1 ? one : many}`

/** What an automatic sweep may do on its own, given what the last one saw. */
export function unattendedPlan(input: {
    due: ReadonlyArray<string>
    seenBefore: ReadonlySet<string>
    confirm: boolean
    limit: number
}): { kind: 'nothing' } | { kind: 'announce' } | { kind: 'delete'; paths: string[] } {
    if (input.due.length === 0) return { kind: 'nothing' }
    if (input.confirm) return { kind: 'announce' }
    const ready = input.due.filter((path) => input.seenBefore.has(path))
    if (ready.length === 0) return { kind: 'nothing' }
    if (ready.length > input.limit) return { kind: 'announce' }
    return { kind: 'delete', paths: ready }
}

/**
 * Runs the sweeps: on its own (once the vault is ready, then every hour) and
 * from the command. Sweeps run one at a time.
 *
 * An automatic sweep is careful in three ways. With "Ask before deleting"
 * on, it only tells the user that notes are due (once per set of due notes,
 * not every hour) and the review dialog does the rest. With it off, a note
 * is deleted only when the PREVIOUS automatic sweep of this session already
 * found it due: the first sweep after a start works on a vault that sync may
 * not have updated yet, so it only takes note. And above
 * `RETENTION_UNATTENDED_LIMIT` notes it asks instead of deleting. Stamping a
 * completion date follows the same second-sighting rule.
 */
export class RetentionSweeper {
    private chain: Promise<void> = Promise.resolve()
    private notice: Notice | null = null
    private disposed = false
    private readonly announced = new Set<string>()
    private seenDue = new Set<string>()
    private seenStamp = new Set<string>()

    constructor(private readonly plugin: KanbanActionPlannerPlugin) {}

    /** The startup and hourly sweep. Does nothing while retention is off. */
    runAutomatic(): Promise<void> {
        return this.enqueue(async () => {
            if (!this.plugin.settings.retentionEnabled || retentionPaused(this.plugin)) return
            const today = new Date()
            const scan = await scanRetention(this.plugin, today)
            const stampNow = scan.stamp.filter((stamp) => this.seenStamp.has(stamp.file.path))
            this.seenStamp = new Set(scan.stamp.map((stamp) => stamp.file.path))
            if (stampNow.length > 0) {
                await stampCompletionDates(this.plugin, stampNow, today, () => this.disposed)
            }
            const plan = unattendedPlan({
                due: scan.due.map((due) => due.file.path),
                seenBefore: this.seenDue,
                confirm: this.plugin.settings.retentionConfirm,
                limit: RETENTION_UNATTENDED_LIMIT
            })
            this.seenDue = new Set(scan.due.map((due) => due.file.path))
            if (plan.kind === 'announce') this.announce(scan)
            else if (plan.kind === 'delete') {
                const paths = new Set(plan.paths)
                await this.delete(
                    scan.due.filter((due) => paths.has(due.file.path)).map((due) => due.file)
                )
            }
        })
    }

    /** The command: always shows what is due (and what is kept) first. */
    runManual(): Promise<void> {
        return this.enqueue(async () => {
            if (!this.plugin.settings.retentionEnabled) {
                new Notice('Retention is off. Turn it on in the plugin settings first.')
                return
            }
            if (retentionPaused(this.plugin)) {
                new Notice(
                    'Retention is paused: some note types come from the Starter Kit, which is not loaded.'
                )
                return
            }
            const today = new Date()
            const scan = await scanRetention(this.plugin, today)
            if (scan.stamp.length > 0) {
                await stampCompletionDates(this.plugin, scan.stamp, today, () => this.disposed)
            }
            if (scan.due.length === 0 && scan.kept.length === 0) {
                new Notice('No done note is past its retention period.')
                return
            }
            this.review(scan)
        })
    }

    /** Stop: no new sweep starts, a running one ends after its current note. */
    dispose(): void {
        this.disposed = true
        this.notice?.hide()
        this.notice = null
    }

    private enqueue(run: () => Promise<void>): Promise<void> {
        // A failed sweep must not poison the chain for every later one.
        this.chain = this.chain.then(() =>
            this.disposed
                ? undefined
                : run().catch((error: unknown) => log('Retention sweep failed.', 'error', error))
        )
        return this.chain
    }

    private announce(scan: RetentionScan): void {
        if (scan.due.every((due) => this.announced.has(due.file.path))) return
        for (const due of scan.due) this.announced.add(due.file.path)
        this.notice?.hide()
        const notice = new Notice(
            `${plural(scan.due.length, 'done note is', 'done notes are')} past the retention period. Select this message to review.`,
            0
        )
        notice.messageEl.addEventListener('click', () => {
            // Scan again: the vault may have changed since the notice appeared.
            void this.runManual()
        })
        this.notice = notice
    }

    private review(scan: RetentionScan): void {
        new RetentionReviewModal(this.plugin.app, scan, (files) => {
            void this.enqueue(() => this.delete(files))
        }).open()
    }

    private async delete(files: ReadonlyArray<TFile>): Promise<void> {
        if (files.length === 0) return
        const result = await deleteExpiredNotes(this.plugin, files, new Date(), () => this.disposed)
        for (const file of files) this.announced.delete(file.path)
        const parts: string[] = []
        if (result.deleted > 0) parts.push(`deleted ${plural(result.deleted, 'note', 'notes')}`)
        if (result.skipped > 0) parts.push(`${String(result.skipped)} no longer due`)
        if (result.failed > 0) parts.push(`${String(result.failed)} failed`)
        if (parts.length === 0) return
        const summary = parts.join(', ')
        new Notice(`Retention: ${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`)
    }
}

/**
 * Start the automatic sweeps: the first on the first `resolved` of the
 * metadata cache once the layout is up (the "other notes link to it" guard
 * reads the resolved links, so the cache must have settled), then one per
 * hour. No timer stands in for a `resolved` that does not come: on a cold
 * cache a timer could fire mid-index. The hourly tick covers that case (a
 * plugin switched on in a running session also gets `resolved` on the next
 * file change).
 */
export function registerRetentionSweeps(
    plugin: KanbanActionPlannerPlugin,
    sweeper: RetentionSweeper
): void {
    let layoutReady = false
    let started = false
    plugin.app.workspace.onLayoutReady(() => {
        layoutReady = true
    })
    plugin.registerEvent(
        plugin.app.metadataCache.on('resolved', () => {
            if (!layoutReady || started) return
            started = true
            void sweeper.runAutomatic()
        })
    )
    plugin.registerInterval(
        window.setInterval(() => {
            if (!layoutReady) return
            started = true
            void sweeper.runAutomatic()
        }, RETENTION_SWEEP_INTERVAL_MS)
    )
    plugin.register(() => sweeper.dispose())
}
