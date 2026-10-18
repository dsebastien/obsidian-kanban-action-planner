import { describe, expect, it } from 'bun:test'
import { App } from 'obsidian'
import { propertyTypeLookup } from './property-types.service'

describe('propertyTypeLookup', () => {
    it('reads the assigned widget, case-insensitively', () => {
        const app = Object.assign(new App(), {
            metadataTypeManager: {
                getPropertyInfo: (name: string) =>
                    name === 'show' ? { name: 'show', widget: 'text' } : undefined
            }
        })
        const lookup = propertyTypeLookup(app)
        expect(lookup('Show')).toBe('text')
        expect(lookup('other')).toBeUndefined()
    })

    it('prefers getAssignedWidget', () => {
        const app = Object.assign(new App(), {
            metadataTypeManager: {
                getAssignedWidget: (name: string) => (name === 'tags' ? 'multitext' : null)
            }
        })
        const lookup = propertyTypeLookup(app)
        expect(lookup('tags')).toBe('multitext')
        expect(lookup('show')).toBeUndefined()
    })

    it('answers undefined when Obsidian exposes no manager, or it throws', () => {
        expect(propertyTypeLookup(new App())('show')).toBeUndefined()
        const throwing = Object.assign(new App(), {
            metadataTypeManager: {
                getPropertyInfo: (): never => {
                    throw new Error('boom')
                }
            }
        })
        expect(propertyTypeLookup(throwing)('show')).toBeUndefined()
    })
})
