/**
 * Extract the facts a NEW note must satisfy to match a Base's filters (issue #46).
 *
 * Bases stores filters in the serialized `BasesConfigFile` shape: a string
 * expression, or a `{ and | or | not: [...] }` node. Only expressions reachable
 * through **`and`** conjunctions are facts a created note must satisfy — an
 * `or` branch is satisfiable in several ways (picking one arbitrarily would be a
 * guess) and `not` states what the note must NOT be. Both are therefore ignored:
 * a missed fact means the card may not appear (visible, reported), while a wrong
 * fact would silently write bogus frontmatter.
 *
 * Pure and defensive: the input is `unknown` because it comes from a private
 * runtime accessor, so every shape is validated rather than trusted.
 */

/** Facts a new note must carry to pass a Base's filters. */
export interface BaseFilterFacts {
    /** Folders the note must live in (`file.inFolder("…")`); see {@link narrowestFolder}. */
    folders: string[]
    /** Tags the note must carry (`file.hasTag("…")`), without the leading `#`. */
    tags: string[]
    /** Frontmatter equalities the note must satisfy (`note.prop == "…"`). */
    properties: Record<string, string | number | boolean>
    /** List properties that must contain a value (`note.prop.contains("…")`). */
    listProperties: Record<string, string[]>
}

export function emptyFilterFacts(): BaseFilterFacts {
    return { folders: [], tags: [], properties: {}, listProperties: {} }
}

/**
 * Every pattern below is FULLY ANCHORED and forbids quote characters inside a
 * literal, so only a single atomic expression can match. That strictness is the
 * point: `file.hasTag("draft") == false` and `note.kind == "a" || note.kind == "b"`
 * must NOT be read as `hasTag draft` / `kind: 'a" || note.kind == "b'`. A missed
 * fact costs a visible, reported miss; a wrong one writes junk into the user's note.
 */

/**
 * `file.inFolder("Some/Folder")` — also matches `inFolder('…')` and the
 * `file.folder == "…"` form Bases writes for the folder picker.
 */
const IN_FOLDER_RE = /^file\.inFolder\(\s*(['"])([^'"]*)\1\s*\)$/
const FOLDER_EQ_RE = /^file\.folder\s*==\s*(['"])([^'"]*)\1$/
/**
 * `file.hasTag("a")` only. A multi-argument `hasTag("a", "b")` means "has ANY of
 * these", which no single tag satisfies unambiguously — so it is not a fact.
 */
const HAS_TAG_RE = /^file\.hasTag\(\s*(['"])([^'"]*)\1\s*\)$/
/** `note.prop == "value"` / `prop == "value"` / `note["prop"] == "value"`. */
const PROP_EQ_RE = /^(?:note\.)?([A-Za-z_][\w-]*)\s*==\s*(.+)$/
const PROP_BRACKET_EQ_RE = /^note\[\s*(['"])([^'"]*)\1\s*\]\s*==\s*(.+)$/
/** `note.prop.contains("value")` — a list property that must include a value. */
const PROP_CONTAINS_RE = /^(?:note\.)?([A-Za-z_][\w-]*)\.contains\(\s*(['"])([^'"]*)\2\s*\)$/
/**
 * Boolean/negation operators anywhere in an expression disqualify it outright —
 * a belt-and-braces guard in case a future Bases spelling slips past the
 * anchored patterns above.
 */
const COMPOUND_RE = /(\|\||&&|(^|[^!=<>])!(?!=))/

/**
 * Collect the facts implied by a Base's global filters and the active view's own
 * filters. Later sources refine earlier ones (a view filter is ANDed on top of
 * the global one), so both are folded into the same fact set.
 */
export function collectFilterFacts(...filterTrees: unknown[]): BaseFilterFacts {
    const facts = emptyFilterFacts()
    for (const tree of filterTrees) visitFilter(tree, facts)
    return facts
}

/**
 * The folder a new note should be created in to satisfy the collected folder
 * facts, or `null` when they name none. ANDed folder filters must ALL hold, so
 * the DEEPEST folder is the only candidate that can satisfy the others (a global
 * `inFolder("Projects")` plus a view's `inFolder("Projects/Active")` means
 * `Projects/Active`). Incompatible siblings are unsatisfiable either way; the
 * caller reports the mismatch after creating.
 */
export function narrowestFolder(facts: BaseFilterFacts): string | null {
    let deepest: string | null = null
    for (const folder of facts.folders) {
        if (deepest === null || folder.length > deepest.length) deepest = folder
    }
    return deepest
}

function visitFilter(node: unknown, facts: BaseFilterFacts): void {
    if (typeof node === 'string') {
        applyExpression(node.trim(), facts)
        return
    }
    if (node === null || typeof node !== 'object') return
    const and = (node as { and?: unknown }).and
    if (Array.isArray(and)) {
        for (const child of and) visitFilter(child, facts)
    }
    // `or` / `not` branches deliberately contribute nothing (see the module doc).
}

function applyExpression(expr: string, facts: BaseFilterFacts): void {
    if (expr.length === 0 || COMPOUND_RE.test(expr)) return

    const folder = IN_FOLDER_RE.exec(expr) ?? FOLDER_EQ_RE.exec(expr)
    if (folder?.[2] !== undefined) {
        pushUnique(facts.folders, folder[2].trim())
        return
    }

    const tag = HAS_TAG_RE.exec(expr)
    if (tag?.[2] !== undefined) {
        const normalized = tag[2].trim().replace(/^#+/, '')
        if (normalized.length > 0) pushUnique(facts.tags, normalized)
        return
    }

    const contains = PROP_CONTAINS_RE.exec(expr)
    if (contains?.[1] !== undefined && contains[3] !== undefined) {
        const name = contains[1]
        const value = contains[3].trim()
        if (value.length > 0) {
            const list = (facts.listProperties[name] ??= [])
            pushUnique(list, value)
        }
        return
    }

    const bracket = PROP_BRACKET_EQ_RE.exec(expr)
    if (bracket?.[2] !== undefined && bracket[3] !== undefined) {
        assignProperty(facts, bracket[2], bracket[3])
        return
    }

    const equality = PROP_EQ_RE.exec(expr)
    if (equality?.[1] !== undefined && equality[2] !== undefined) {
        assignProperty(facts, equality[1], equality[2])
    }
}

/** Record `name == literal`, dropping anything that isn't a plain literal. */
function assignProperty(facts: BaseFilterFacts, name: string, rawValue: string): void {
    const value = parseLiteral(rawValue.trim())
    if (value === null) return
    // A property already claimed as a list (`contains`) stays a list.
    if (name in facts.listProperties) return
    facts.properties[name] = value
}

/** Parse a Bases literal; `null` for anything dynamic (identifiers, calls, …). */
function parseLiteral(raw: string): string | number | boolean | null {
    if (raw.length === 0) return null
    // No quote characters INSIDE the literal — `"a" || x == "b"` must not parse
    // as the string `a" || x == "b`.
    const quoted = /^(['"])([^'"]*)\1$/.exec(raw)
    if (quoted?.[2] !== undefined) return quoted[2]
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
    return null
}

function pushUnique(list: string[], value: string): void {
    if (value.length > 0 && !list.includes(value)) list.push(value)
}
