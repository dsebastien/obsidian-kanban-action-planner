import type { BasesAllOptions } from 'obsidian'
import type { PluginSettings } from '../../types/plugin-settings.intf'

/**
 * Per-view options shown in the Bases view-options panel.
 *
 * Property pickers let a view override the status and order properties; a toggle
 * controls whether columns with no cards stay visible (useful when columns come
 * from a Starter Kit note type's allowed values).
 */
export function getKanbanViewOptions(settings: PluginSettings): BasesAllOptions[] {
    return [
        {
            type: 'property',
            key: 'statusProperty',
            displayName: 'Status property',
            placeholder: settings.defaultStatusProperty
        },
        {
            type: 'property',
            key: 'orderProperty',
            displayName: 'Manual order property',
            placeholder: settings.defaultOrderProperty
        },
        {
            type: 'toggle',
            key: 'showEmptyColumns',
            displayName: 'Show empty columns',
            default: true
        }
    ]
}
