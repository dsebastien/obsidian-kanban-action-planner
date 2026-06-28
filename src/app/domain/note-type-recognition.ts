/**
 * Pure local note-type recognition (issue #31).
 *
 * Matches a file against a note type's `typeRecognition.mappings` so note types
 * work **without** the Obsidian Starter Kit (and so previously-Starter-Kit types
 * keep recognizing from their mirrored mappings once the Starter Kit is gone).
 *
 * No Obsidian/DOM deps — the service builds a {@link RecognitionFile} from the
 * metadata cache and evaluates these rules.
 */

export type RecognitionType = 'tag' | 'folder' | 'regex'

export interface RecognitionMapping {
    type: RecognitionType
    /** Tag (e.g. `type/task`), folder path, or a regular expression. */
    value: string
    enabled: boolean
}

export interface RecognitionFile {
    /** Full vault path, e.g. `Areas/Work/Task A.md`. */
    path: string
    /** The note's tags, normalized: lowercased, no leading `#`. */
    tags: string[]
}

/** Normalize a tag for comparison (lowercase, no leading `#`). */
function normalizeTag(tag: string): string {
    return tag.trim().toLowerCase().replace(/^#+/, '')
}

/** Whether a file satisfies a single (enabled, non-blank) mapping. */
export function matchesMapping(file: RecognitionFile, mapping: RecognitionMapping): boolean {
    const value = mapping.value.trim()
    if (!mapping.enabled || value.length === 0) return false

    switch (mapping.type) {
        case 'tag': {
            const want = normalizeTag(value)
            if (want.length === 0) return false
            // Exact tag, or a parent tag (`type` matches `type/task`).
            return file.tags.some((t) => t === want || t.startsWith(`${want}/`))
        }
        case 'folder': {
            const folder = value.replace(/\/+$/, '')
            if (folder.length === 0) return false
            return file.path.startsWith(`${folder}/`)
        }
        case 'regex': {
            try {
                return new RegExp(value).test(file.path)
            } catch {
                return false
            }
        }
    }
}

/** Whether any of a note type's mappings match the file. */
export function matchesAnyMapping(
    file: RecognitionFile,
    mappings: ReadonlyArray<RecognitionMapping>
): boolean {
    return mappings.some((m) => matchesMapping(file, m))
}

/**
 * The id of the first noteType whose recognition mappings match the file, or
 * null. Candidates are pre-filtered/ordered by the caller (Default excluded).
 */
export function recognizeLocalType(
    file: RecognitionFile,
    candidates: ReadonlyArray<{ id: string; mappings: ReadonlyArray<RecognitionMapping> }>
): string | null {
    for (const candidate of candidates) {
        if (matchesAnyMapping(file, candidate.mappings)) return candidate.id
    }
    return null
}
