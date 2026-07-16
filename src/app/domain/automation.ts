import type { AutomationRule, PropertyOperator } from './note-type'
import { isDoneValue } from './done'
import type { ResolvedDoneConfig } from './done'

/**
 * Automation trigger matching + action value coercion (pure).
 *
 * Status triggers fire on STATUS transitions: a rule matches when the note
 * ENTERS a trigger status (or the done set) it was not in before — or LEAVES
 * one — so re-dropping a card on its own column never fires. `done-entered`
 * needs a status-based done definition (the default, rule 39) — a done state
 * on another property never transitions on a status write, so it can't match
 * here. `property-condition` triggers are edge-triggered on property-value
 * diffs (see `rulesForPropertyChange`); `archived` triggers match at archive
 * time (`rulesForArchive`).
 */

/** A status transition: `null` = no/cleared status. */
export interface StatusTransition {
    from: string | null
    to: string | null
}

/**
 * The enabled rules matching a transition, in configured order. `done` is the
 * type's resolved done config (`null` = none configured); it only feeds
 * `done-entered` triggers, and only when it targets the status property
 * (`doneIsStatusBased`).
 */
export function rulesForTransition(
    rules: ReadonlyArray<AutomationRule>,
    transition: StatusTransition,
    done: ResolvedDoneConfig | null,
    statusProperty: string
): AutomationRule[] {
    if (transition.from === transition.to) return []
    return rules.filter((rule) => {
        if (!rule.enabled) return false
        switch (rule.trigger.kind) {
            case 'status-entered':
                return transition.to !== null && rule.trigger.statuses.includes(transition.to)
            case 'status-left':
                return transition.from !== null && rule.trigger.statuses.includes(transition.from)
            case 'done-entered':
                // The new status is done, the old one was not.
                if (!done || !doneIsStatusBased(done, statusProperty)) return false
                return (
                    isDoneValue(transition.to, done.values) &&
                    !isDoneValue(transition.from, done.values)
                )
            case 'archived':
            case 'property-condition':
                return false
        }
    })
}

/** The enabled `archived`-trigger rules, in configured order. */
export function rulesForArchive(rules: ReadonlyArray<AutomationRule>): AutomationRule[] {
    return rules.filter((rule) => rule.enabled && rule.trigger.kind === 'archived')
}

/**
 * The enabled `property-condition` rules that BECOME satisfied when
 * `property` changes from `oldValue` to `newValue` (edge-triggered: already
 * satisfied before the change ⇒ no fire). Property names match
 * case-insensitively.
 */
export function rulesForPropertyChange(
    rules: ReadonlyArray<AutomationRule>,
    property: string,
    oldValue: unknown,
    newValue: unknown
): AutomationRule[] {
    const name = property.toLowerCase()
    return rules.filter((rule) => {
        if (!rule.enabled || rule.trigger.kind !== 'property-condition') return false
        const trigger = rule.trigger
        if (trigger.property.trim().toLowerCase() !== name) return false
        return (
            propertyConditionMet(newValue, trigger.operator, trigger.value) &&
            !propertyConditionMet(oldValue, trigger.operator, trigger.value)
        )
    })
}

/**
 * The lowercase property names any enabled `property-condition` rule watches
 * (drives the view's per-note value snapshot).
 */
export function watchedProperties(rules: ReadonlyArray<AutomationRule>): string[] {
    const names = new Set<string>()
    for (const rule of rules) {
        if (!rule.enabled || rule.trigger.kind !== 'property-condition') continue
        const name = rule.trigger.property.trim().toLowerCase()
        if (name) names.add(name)
    }
    return [...names]
}

/**
 * Whether a raw frontmatter value satisfies `<operator> <expected>`. Missing
 * = `undefined`/`null`/'' (only `unset` matches; `not-equals` deliberately
 * does NOT — "progress ≠ 100" firing on notes without a progress property
 * would be noise). Both sides numeric → numeric comparison; otherwise
 * trimmed, case-insensitive string comparison (ISO dates order correctly).
 * List properties: `equals`/`set` match ANY element; ordering operators use
 * the first element.
 */
export function propertyConditionMet(
    raw: unknown,
    operator: PropertyOperator,
    expected: string
): boolean {
    const missing =
        raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
    if (operator === 'unset') return missing
    if (operator === 'set') return !missing
    if (missing) return false
    if (Array.isArray(raw)) {
        if (operator === 'equals')
            return raw.some((item) => propertyConditionMet(item, 'equals', expected))
        if (operator === 'not-equals') {
            return raw.every((item) => propertyConditionMet(item, 'not-equals', expected))
        }
        const first: unknown = raw[0]
        return first === undefined ? false : propertyConditionMet(first, operator, expected)
    }
    const actual = String(raw as string | number | boolean).trim()
    const expectedTrimmed = expected.trim()
    const actualNum = Number(actual)
    const expectedNum = Number(expectedTrimmed)
    const numeric =
        actual !== '' &&
        expectedTrimmed !== '' &&
        Number.isFinite(actualNum) &&
        Number.isFinite(expectedNum)
    switch (operator) {
        case 'equals':
            return numeric
                ? actualNum === expectedNum
                : actual.toLowerCase() === expectedTrimmed.toLowerCase()
        case 'not-equals':
            return numeric
                ? actualNum !== expectedNum
                : actual.toLowerCase() !== expectedTrimmed.toLowerCase()
        case 'gt':
            return numeric
                ? actualNum > expectedNum
                : actual.toLowerCase() > expectedTrimmed.toLowerCase()
        case 'gte':
            return numeric
                ? actualNum >= expectedNum
                : actual.toLowerCase() >= expectedTrimmed.toLowerCase()
        case 'lt':
            return numeric
                ? actualNum < expectedNum
                : actual.toLowerCase() < expectedTrimmed.toLowerCase()
        case 'lte':
            return numeric
                ? actualNum <= expectedNum
                : actual.toLowerCase() <= expectedTrimmed.toLowerCase()
    }
}

/** Dedupe rules by id, keeping first occurrence (configured order). */
export function dedupeRules(rules: ReadonlyArray<AutomationRule>): AutomationRule[] {
    const seen = new Set<string>()
    return rules.filter((rule) => {
        if (seen.has(rule.id)) return false
        seen.add(rule.id)
        return true
    })
}

/**
 * Structural equality for raw frontmatter values (the snapshot diff);
 * `undefined` and `null` both mean "missing" and compare equal.
 */
export function rawValuesEqual(a: unknown, b: unknown): boolean {
    const left = a === undefined ? null : a
    const right = b === undefined ? null : b
    if (left === right) return true
    return JSON.stringify(left) === JSON.stringify(right)
}

/** Whether a done definition reads the status property (case-insensitive). */
export function doneIsStatusBased(done: ResolvedDoneConfig, statusProperty: string): boolean {
    return done.property.toLowerCase() === statusProperty.toLowerCase()
}

/**
 * Coerce an expanded action value to what frontmatter should store: plain
 * finite numbers become numbers ('100' → 100), 'true'/'false' become
 * booleans, everything else stays a string (dates like '2026-07-16' included).
 */
export function coerceActionValue(value: string): string | number | boolean {
    const trimmed = value.trim()
    if (trimmed.length === 0) return trimmed
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    // Only CANONICAL numeric strings coerce ('100', '42.5', '-3') — '080',
    // '1e5' and precision-losing digit strings stay strings.
    const n = Number(trimmed)
    if (Number.isFinite(n) && String(n) === trimmed) return n
    // Trimmed, so an accidentally padded ' 80 - Done ' still matches columns.
    return trimmed
}

/** Normalize a configured tag: trim + strip leading `#`s ('' if nothing left). */
export function normalizeTag(tag: string): string {
    return tag.trim().replace(/^#+/, '')
}

/** Whether a stored `tags` entry matches a configured tag (case-insensitive, `#`-agnostic). */
export function tagMatches(stored: unknown, tag: string): boolean {
    return (
        typeof stored === 'string' &&
        normalizeTag(stored).toLowerCase() === normalizeTag(tag).toLowerCase()
    )
}
