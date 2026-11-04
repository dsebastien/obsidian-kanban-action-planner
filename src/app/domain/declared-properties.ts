/**
 * Declared properties (issue #232): what a Starter Kit note type says its
 * notes carry, mirrored onto the stored note type as `declaredProperties`.
 *
 * Pure, unit-testable. Absent `declaredProperties` = unknown (a local type,
 * or a Starter Kit too old to tell): every check answers "allowed", so a
 * vault without the Starter Kit behaves exactly as before.
 */

/** One declared property: its name and Obsidian property type (`date`, `number`, `list`…). */
export interface DeclaredProperty {
    name: string
    type?: string
}

/** The answer for one property name on one note type. */
export type Declaration =
    { kind: 'unknown' } | { kind: 'declared'; type: string | null } | { kind: 'undeclared' }

/** The slice of a note type the checks read. */
export interface DeclaresProperties {
    declaredProperties?: ReadonlyArray<DeclaredProperty>
}

/**
 * Merge a type's own properties with the Starter Kit's global properties
 * (which apply to every type). The type's own definition wins on a name clash.
 * Names match case-insensitively; blank names are skipped.
 */
export function mergeDeclaredProperties(
    own: ReadonlyArray<{ name?: unknown; type?: unknown }>,
    global: ReadonlyArray<{ name?: unknown; type?: unknown }>
): DeclaredProperty[] {
    const out: DeclaredProperty[] = []
    const seen = new Set<string>()
    for (const entry of [...own, ...global]) {
        if (typeof entry.name !== 'string') continue
        const name = entry.name.trim()
        if (name === '' || seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        out.push(
            typeof entry.type === 'string' && entry.type !== ''
                ? { name, type: entry.type }
                : { name }
        )
    }
    return out
}

/** How `noteType` declares `name` (case-insensitive). */
export function declarationOf(noteType: DeclaresProperties | undefined, name: string): Declaration {
    const list = noteType?.declaredProperties
    if (!list) return { kind: 'unknown' }
    const lower = name.trim().toLowerCase()
    const found = list.find((p) => p.name.toLowerCase() === lower)
    return found ? { kind: 'declared', type: found.type ?? null } : { kind: 'undeclared' }
}

/**
 * True when the plugin may write `name` on a note of `noteType`: always,
 * unless the type's declarations are known and `name` is not among them.
 */
export function mayWrite(noteType: DeclaresProperties | undefined, name: string): boolean {
    return declarationOf(noteType, name).kind !== 'undeclared'
}

/** The declared Obsidian type of `name`, or null when unknown or undeclared. */
export function declaredTypeOf(
    noteType: DeclaresProperties | undefined,
    name: string
): string | null {
    const declaration = declarationOf(noteType, name)
    return declaration.kind === 'declared' ? declaration.type : null
}

/** Obsidian property types that hold a date (with or without a time). */
export const DATE_TYPES: ReadonlyArray<string> = ['date', 'datetime']
/** Obsidian property types that hold a list (`multitext` is the legacy alias). */
export const LIST_TYPES: ReadonlyArray<string> = ['list', 'multitext', 'tags']
export const NUMBER_TYPES: ReadonlyArray<string> = ['number']

/** One property the plugin reads or writes for a note type, with what it expects. */
export interface PlannedProperty {
    /** What the plugin uses it for ("Start date", "Estimate"…). */
    role: string
    name: string
    /** Acceptable declared types; empty = any type. */
    expected: ReadonlyArray<string>
}

/** One mismatch the check reports. */
export interface PropertyFinding {
    role: string
    name: string
    /**
     * `stamped`: a planning date that is a lifecycle fact the Starter Kit
     * stamps (issue #232); a drop would fill it early.
     */
    problem: 'undeclared' | 'wrong-type' | 'stamped'
    /** For `stamped`: the statuses (or triggers) that stamp it; empty = a known lifecycle date. */
    stampedWhen?: string[]
    /** For `stamped`: the planning property to use instead, when the type has one. */
    suggestion?: string
    /** The declared type, for `wrong-type`. */
    declaredType: string | null
    expected: ReadonlyArray<string>
}

/**
 * Compare the properties the plugin would use for a type against its
 * declarations. Unknown declarations yield nothing (there is nothing to
 * compare against). A property declared without a type is accepted.
 */
export function checkPlannedProperties(
    noteType: DeclaresProperties | undefined,
    planned: ReadonlyArray<PlannedProperty>
): PropertyFinding[] {
    if (!noteType?.declaredProperties) return []
    const findings: PropertyFinding[] = []
    const seen = new Set<string>()
    for (const property of planned) {
        const key = `${property.role}\u0000${property.name.toLowerCase()}`
        if (property.name.trim() === '' || seen.has(key)) continue
        seen.add(key)
        const declaration = declarationOf(noteType, property.name)
        if (declaration.kind === 'undeclared') {
            findings.push({
                role: property.role,
                name: property.name,
                problem: 'undeclared',
                declaredType: null,
                expected: property.expected
            })
        } else if (
            declaration.kind === 'declared' &&
            declaration.type !== null &&
            property.expected.length > 0 &&
            !property.expected.includes(declaration.type)
        ) {
            findings.push({
                role: property.role,
                name: property.name,
                problem: 'wrong-type',
                declaredType: declaration.type,
                expected: property.expected
            })
        }
    }
    return findings
}
