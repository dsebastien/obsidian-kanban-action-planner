import type { App, TFile } from 'obsidian'
import type { AutomationAction, AutomationRule } from '../domain/note-type'
import { coerceActionValue, normalizeTag, tagMatches } from '../domain/automation'
import {
    appendToListProperty,
    deleteProperty,
    removeFromListProperty,
    setProperty
} from './frontmatter.service'
import { liveExpressionContext, moveNoteToFolder } from './archive.service'
import { resolvePlaceholders } from '../utils/expressions'
import type { ExpressionContext } from '../utils/expressions'
import { log } from '../../utils/log'

/**
 * Automation rule execution. Trigger matching is pure (`domain/automation.ts`);
 * this service runs the matched rules' actions against a note, in order.
 * Property values and folder templates expand `{{year}}`/`{{date}}`/… via
 * {@link resolvePlaceholders}; tags target the frontmatter `tags` list.
 * Every action is guarded — one failing action logs and the rest still run.
 */

export interface AutomationRunResult {
    /** The note left its folder (a `move-to-folder` action ran). */
    movedTo: string | null
    /** A `move-to-folder` action failed (surfaced as a Notice by the view). */
    moveError: string | null
    /**
     * Lowercased names of every frontmatter property written or removed
     * (`tags` included). The view refreshes its property-condition snapshot
     * for exactly these, so automation writes never re-trigger rules.
     */
    writtenProperties: Set<string>
}

/** Run every action of the matched rules, in rule + action order. */
export async function runAutomationRules(
    app: App,
    file: TFile,
    rules: ReadonlyArray<AutomationRule>,
    ctx: ExpressionContext = liveExpressionContext()
): Promise<AutomationRunResult> {
    const result: AutomationRunResult = {
        movedTo: null,
        moveError: null,
        writtenProperties: new Set()
    }
    for (const rule of rules) {
        for (const action of rule.actions) {
            try {
                await runAction(app, file, action, ctx, result)
            } catch (error: unknown) {
                log(
                    `Automation "${rule.name || rule.id}": ${action.kind} failed for "${
                        file.path
                    }".`,
                    'error',
                    error
                )
            }
        }
    }
    return result
}

async function runAction(
    app: App,
    file: TFile,
    action: AutomationAction,
    ctx: ExpressionContext,
    result: AutomationRunResult
): Promise<void> {
    switch (action.kind) {
        case 'set-property': {
            const property = action.property.trim()
            if (!property) return
            const value = coerceActionValue(resolvePlaceholders(action.value, ctx))
            await setProperty(app, file, property, value)
            result.writtenProperties.add(property.toLowerCase())
            return
        }
        case 'remove-property': {
            const property = action.property.trim()
            if (!property) return
            await deleteProperty(app, file, property)
            result.writtenProperties.add(property.toLowerCase())
            return
        }
        case 'add-tag': {
            const tag = normalizeTag(action.tag)
            if (!tag) return
            await appendToListProperty(app, file, 'tags', tag, (item) => tagMatches(item, tag))
            result.writtenProperties.add('tags')
            return
        }
        case 'remove-tag': {
            const tag = normalizeTag(action.tag)
            if (!tag) return
            await removeFromListProperty(app, file, 'tags', tag, (item) => tagMatches(item, tag))
            result.writtenProperties.add('tags')
            return
        }
        case 'move-to-folder': {
            // renameFile mutates file.path in place — compare against the
            // pre-move path to detect an actual move.
            const before = file.path
            const moved = await moveNoteToFolder(app, file, action.folder, ctx)
            if (moved.ok && moved.destPath !== before) result.movedTo = moved.destPath
            if (!moved.ok) {
                result.moveError =
                    moved.reason === 'no-folder'
                        ? 'no destination folder configured'
                        : (moved.message ?? 'unknown error')
            }
            return
        }
    }
}
