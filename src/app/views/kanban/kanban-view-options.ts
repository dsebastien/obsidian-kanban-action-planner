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
            type: 'multitext',
            key: 'statuses',
            displayName: 'Statuses (columns)',
            default: []
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
        },
        {
            type: 'dropdown',
            key: 'unmappedPosition',
            displayName: 'Unmapped column position',
            default: 'first',
            options: { first: 'First (left)', last: 'Last (right)' }
        },
        {
            type: 'dropdown',
            key: 'laneGrouping',
            displayName: 'Swimlanes (grouping)',
            default: '__profile__',
            options: {
                '__profile__': 'Use board default',
                'none': 'None',
                'note-type': 'By note type',
                'property': 'By property'
            }
        },
        {
            type: 'property',
            key: 'laneGroupingProperty',
            displayName: 'Swimlane property',
            placeholder: 'Property to group lanes by'
        },
        {
            type: 'dropdown',
            key: 'blockedFilter',
            displayName: 'Blocked cards',
            default: 'all',
            options: {
                all: 'Show all',
                only: 'Only blocked',
                hide: 'Hide blocked'
            }
        },
        {
            type: 'toggle',
            key: 'calendarMode',
            displayName: 'Calendar mode',
            default: false
        },
        {
            type: 'property',
            key: 'scheduledDateProperty',
            displayName: 'Scheduled date property',
            placeholder: settings.defaultScheduledDateProperty
        },
        {
            type: 'property',
            key: 'dueDateProperty',
            displayName: 'Due date property',
            placeholder: settings.defaultDueDateProperty
        },
        {
            type: 'dropdown',
            key: 'calendarRange',
            displayName: 'Calendar default range',
            default: 'month',
            options: {
                week: 'Week',
                month: 'Month',
                quarter: 'Quarter',
                year: 'Year'
            }
        }
    ]
}
