import type { AutomationRule, DoneConfig } from './note-type'
import type { SkResolvedStatus } from '../services/starter-kit.service'
import { splitStatusValue } from './status'

/**
 * Mirroring the Obsidian Starter Kit's status configuration (pure).
 *
 * When the Starter Kit declares a type's status explicitly, it is the source
 * of truth for done states and for which date each status stamps: the done
 * config becomes read-only (`mirrored: true`) and one automation rule per
 * stamping value is regenerated on every sync, identified by the
 * `MIRRORED_RULE_PREFIX` id prefix so user rules are never touched. A type
 * whose Starter Kit status is only heuristic keeps its plugin-owned config.
 */

export const MIRRORED_RULE_PREFIX = 'sk-stamp:'

/** The done config the Starter Kit status implies; `null` when not explicit. */
export function mirroredDoneConfig(status: SkResolvedStatus | null): DoneConfig | null {
    if (!status?.explicit) return null
    return {
        enabled: true,
        property: '',
        values: status.values.filter((v) => v.done).map((v) => v.value),
        mirrored: true
    }
}

/**
 * One stamping rule per value with a stamped date, in status order — unless
 * the Starter Kit executes its own rules (`executedByStarterKit`, its "Run
 * automation rules" setting): it then stamps from any edit source itself, and
 * mirroring here would make two plugins write the same date on the same
 * transition. Exactly one executor per rule: none here in that case (the
 * done-state mirror is unaffected).
 */
export function mirroredStampRules(
    status: SkResolvedStatus | null,
    executedByStarterKit = false
): AutomationRule[] {
    if (!status?.explicit || executedByStarterKit) return []
    return status.values
        .filter((v) => v.stampsDate !== null)
        .map((v) => ({
            id: `${MIRRORED_RULE_PREFIX}${v.value}`,
            name: `Stamp ${String(v.stampsDate)} on ${splitStatusValue(v.value).label}`,
            enabled: true,
            trigger: { kind: 'status-entered', statuses: [v.value] },
            actions: [
                {
                    kind: 'set-property',
                    property: String(v.stampsDate),
                    value: '{{date}}',
                    onlyIfEmpty: v.stampOnlyIfEmpty
                }
            ]
        }))
}

export function isMirroredRule(rule: Pick<AutomationRule, 'id'>): boolean {
    return rule.id.startsWith(MIRRORED_RULE_PREFIX)
}

/**
 * Whether a user rule already does what a mirrored stamp rule would: an
 * enabled `status-entered` rule on the same status with a `set-property`
 * action on the same property. Such a rule keeps precedence (it may carry
 * extra actions or a different value) and the mirror does not double it.
 */
export function userRuleCovers(rule: AutomationRule, mirrored: AutomationRule): boolean {
    if (isMirroredRule(rule) || !rule.enabled) return false
    if (rule.trigger.kind !== 'status-entered' || mirrored.trigger.kind !== 'status-entered') {
        return false
    }
    const status = mirrored.trigger.statuses[0]
    const stamp = mirrored.actions[0]
    if (status === undefined || stamp?.kind !== 'set-property') return false
    if (!rule.trigger.statuses.includes(status)) return false
    const property = stamp.property.toLowerCase()
    return rule.actions.some(
        (a) => a.kind === 'set-property' && a.property.trim().toLowerCase() === property
    )
}

/**
 * Merge: user rules stay (order kept), mirrored rules are replaced by the
 * fresh set — minus those a user rule already covers ({@link userRuleCovers})
 * — appended where the first mirrored rule used to be (end if none).
 */
export function mergeMirroredRules(
    existing: ReadonlyArray<AutomationRule>,
    mirrored: ReadonlyArray<AutomationRule>
): AutomationRule[] {
    const user = existing.filter((r) => !isMirroredRule(r))
    const fresh = mirrored.filter((m) => !user.some((u) => userRuleCovers(u, m)))
    const firstMirrored = existing.findIndex(isMirroredRule)
    if (firstMirrored === -1) return [...user, ...fresh]
    const before = existing.slice(0, firstMirrored).filter((r) => !isMirroredRule(r))
    const after = user.slice(before.length)
    return [...before, ...fresh, ...after]
}

/** Done config to store: the mirror when explicit, else the plugin-owned one un-flagged. */
export function reconcileDone(
    current: DoneConfig | undefined,
    status: SkResolvedStatus | null
): DoneConfig | undefined {
    const mirrored = mirroredDoneConfig(status)
    if (mirrored) return mirrored
    if (current?.mirrored) {
        // The Starter Kit stopped declaring it: hand the values back, editable.
        return { enabled: current.enabled, property: current.property, values: current.values }
    }
    return current
}

/**
 * The planning role per status value of an explicit Starter Kit status
 * (issue #172); `{}` when nothing is declared, so consumers fall back to
 * "every non-done status is active".
 */
export function mirroredStatusRoles(
    status: SkResolvedStatus | null
): Record<string, 'backlog' | 'scheduled' | 'active' | 'waiting'> {
    const roles: Record<string, 'backlog' | 'scheduled' | 'active' | 'waiting'> = {}
    if (!status?.explicit) return roles
    for (const value of status.values) if (value.role) roles[value.value] = value.role
    return roles
}

/**
 * The status values whose notes belong to the ideal week (issue #172): the
 * ones with the `active` role when roles are known, else every value not
 * declared done (older kits, local types) — never a literal.
 */
export function activeStatusValues(noteType: {
    columns: ReadonlyArray<{ statusValue: string }>
    statusRoles: Record<string, string>
    done?: { enabled: boolean; values: string[] } | undefined
}): string[] {
    const values = noteType.columns.map((c) => c.statusValue)
    const roled = Object.keys(noteType.statusRoles)
    if (roled.length > 0) return values.filter((v) => noteType.statusRoles[v] === 'active')
    const done = new Set(noteType.done?.enabled ? noteType.done.values : [])
    return values.filter((v) => !done.has(v))
}
