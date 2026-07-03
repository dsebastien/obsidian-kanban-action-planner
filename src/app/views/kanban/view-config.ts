import type { TabSortMode } from '../../domain/calendar-tabs'
import type { LaneGrouping } from '../../domain/note-type'
import { parsePropertyRef } from './property-access'
import type { TriageScope } from './triage'

/** A read-only view onto the per-view Bases config (`this.config`). */
interface ConfigReader {
    get(key: string): unknown
}

/** Read the scheduling-panel sort mode, defaulting to manual order. */
export function readSortMode(value: unknown): TabSortMode {
    return value === 'name' || value === 'property' ? value : 'order'
}

/**
 * Read a stored array of ids verbatim (only keeps non-empty strings). Unlike
 * {@link readStringArray} it never splits on commas/newlines, so an id that
 * contains a comma (a lane value, a status id) survives a save/restore round-trip.
 */
export function readIdArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

/** Read a stored multitext option into a clean string array. */
export function readStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return value
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
    }
    return []
}

/**
 * Read the per-view swimlane grouping override. `__profile__` (or unset) means
 * "defer to the note type"; a `property` choice with no property picked also
 * defers (so the view never silently groups by nothing).
 */
export function readLaneGroupingOverride(config: ConfigReader): LaneGrouping | null {
    const kind = config.get('laneGrouping')
    if (kind === 'none') return { kind: 'none' }
    if (kind === 'note-type') return { kind: 'note-type' }
    if (kind === 'property') {
        // Keep the raw Bases property id (`note.*` / `formula.*` / `file.*`); the
        // view parses it (parsePropertyRef) — a `formula.*`/`file.*` grouping is
        // read-only (no cross-lane drag). Issue #50 / #8.
        const stored = config.get('laneGroupingProperty')
        return parsePropertyRef(stored) ? { kind: 'property', property: String(stored) } : null
    }
    return null
}

/** Resolved per-view triage config (issue #53), with the smart defaults applied. */
export interface TriageConfig {
    scope: TriageScope
    /** Editable enum property ids (`note.*` bare names). */
    updateProps: string[]
    /** Gating property ids — defaults to {@link updateProps} when none configured. */
    gateProps: string[]
    /** Context property ids (formulas allowed); empty ⇒ caller uses the view's properties. */
    seeProps: string[]
    /** Needs-triage tokens (values that count as unset). */
    tokens: string[]
}

/**
 * Read the per-view triage config (issue #53). Gating defaults to the editable
 * set when unset; context is left empty so the view can default it to its
 * displayed properties (`getOrder()`); scope defaults to "needs clarification".
 */
export function readTriageConfig(config: ConfigReader): TriageConfig {
    const updateProps = readIdArray(config.get('triageUpdateProps'))
    const gate = readIdArray(config.get('triageGateProps'))
    const rawScope = config.get('triageScope')
    return {
        scope: rawScope === 'all' || rawScope === 'review' ? rawScope : 'clarify',
        updateProps,
        gateProps: gate.length > 0 ? gate : updateProps,
        seeProps: readIdArray(config.get('triageSeeProps')),
        tokens: readStringArray(config.get('triageTokens'))
    }
}

/**
 * Read the persisted compact-cards toggle (board toolbar). Off by default and
 * default-on-missing, so views saved before the option existed are unaffected.
 */
export function readCompactMode(config: ConfigReader): boolean {
    return config.get('compactMode') === true
}

/** Normalize a raw frontmatter value into a swimlane key, or `null` (→ Ungrouped). */
export function normalizeLaneValue(raw: unknown): string | null {
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        return trimmed.length > 0 ? trimmed : null
    }
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
    return null
}

/** Extract a frontmatter property name from a stored Bases property id. */
export function basesPropToName(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) return null
    const dot = value.indexOf('.')
    if (dot === -1) return value
    const prefix = value.slice(0, dot)
    // Only note (frontmatter) properties are read/written by name.
    return prefix === 'note' ? value.slice(dot + 1) : null
}
