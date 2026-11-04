import { Notice } from 'obsidian'
import { mayWrite, type DeclaresProperties } from '../domain/declared-properties'

/**
 * Write guard for undeclared properties (issue #232). On a Starter Kit type
 * whose declarations are known, the plugin does not create a property the
 * type does not declare: the action is hidden where it can be, else skipped
 * with {@link refuseWrite}'s notice. Local and untyped notes are never
 * guarded (their declarations are unknown).
 */

/** The slice of a note type the guard reads. */
export type GuardedType = DeclaresProperties & { name: string }

/** The notice text for a skipped write. */
export function refusalMessage(noteType: GuardedType, property: string): string {
    return `${noteType.name} notes do not declare "${property}" in the Starter Kit, so nothing was written. Add the property to the note type to use this here.`
}

/** True when the write may go ahead; else shows the notice and returns false. */
export function guardWrite(noteType: GuardedType | undefined, property: string): boolean {
    if (!noteType || mayWrite(noteType, property)) return true
    new Notice(refusalMessage(noteType, property))
    return false
}

/** Every name in `properties` the type does not declare (empty when unknown). */
export function undeclaredOf(
    noteType: DeclaresProperties | undefined,
    properties: ReadonlyArray<string>
): string[] {
    if (!noteType) return []
    return [...new Set(properties.filter((name) => name !== '' && !mayWrite(noteType, name)))]
}
