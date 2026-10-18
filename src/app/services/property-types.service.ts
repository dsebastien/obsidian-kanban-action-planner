import type { App } from 'obsidian'
import type { PropertyTypeLookup } from '../domain/relationship-rules'

/**
 * The Obsidian property types the vault assigns (`text`, `multitext`, ...): the
 * widget name from `getAssignedWidget`, else `getPropertyInfo(name).widget`.
 *
 * Obsidian does not type its metadata type manager publicly, so the lookup
 * narrows it structurally and answers `undefined` for every property when the
 * manager is missing or shaped differently (the caller then falls back to its
 * default). Used to infer whether a local relationship rule is single-link
 * (business rule 73).
 */
export function propertyTypeLookup(app: App): PropertyTypeLookup {
    const manager: unknown = 'metadataTypeManager' in app ? app.metadataTypeManager : undefined
    if (typeof manager !== 'object' || manager === null) return () => undefined
    const call = (method: string, name: string): unknown => {
        const fn: unknown = Reflect.get(manager, method)
        return typeof fn === 'function' ? Reflect.apply(fn, manager, [name]) : undefined
    }
    return (property) => {
        const name = property.toLowerCase()
        try {
            const widget = call('getAssignedWidget', name)
            if (typeof widget === 'string') return widget
            const info = call('getPropertyInfo', name)
            if (typeof info !== 'object' || info === null) return undefined
            const assigned: unknown = Reflect.get(info, 'widget')
            return typeof assigned === 'string' ? assigned : undefined
        } catch {
            return undefined
        }
    }
}
