import type { BasesAllOptions } from 'obsidian'
import type { PluginSettings } from '../../types/plugin-settings.intf'

/**
 * Per-view options shown in the Bases "Configure view" panel.
 *
 * These are the **per-board** settings — they live in `this.config` and affect
 * only this one view. They sit alongside two other surfaces (M7 settings model):
 *   - vault-wide **defaults** in the plugin settings tab (property names,
 *     default statuses, date format), used when a view/profile doesn't override;
 *   - **shared** note-type config in the gear → "Configure board" modal (colors,
 *     cards, relationships, archiving, the default swimlane grouping) — the rich
 *     controls Bases options can't render.
 *
 * Options are grouped purely for legibility (the `key`s are unchanged, so stored
 * config is unaffected). Where a per-view option overrides a shared/global
 * default, its placeholder/default makes that explicit (e.g. Swimlanes →
 * "Use board default").
 */
export function getKanbanViewOptions(settings: PluginSettings): BasesAllOptions[] {
    return [
        {
            type: 'group',
            displayName: 'Columns',
            items: [
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
                }
            ]
        },
        {
            type: 'group',
            displayName: 'Swimlanes',
            items: [
                {
                    type: 'dropdown',
                    key: 'laneGrouping',
                    displayName: 'Grouping',
                    // "Use board default" defers to the shared profile grouping
                    // (set in Configure board → Swimlanes); other values override it.
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
                    displayName: 'Grouping property',
                    placeholder: 'Property to group lanes by'
                }
            ]
        },
        {
            type: 'group',
            displayName: 'Filters',
            items: [
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
                }
            ]
        },
        {
            type: 'group',
            displayName: 'Calendar',
            items: [
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
                    displayName: 'Default range',
                    default: 'month',
                    options: {
                        week: 'Week',
                        month: 'Month',
                        quarter: 'Quarter',
                        year: 'Year'
                    }
                },
                {
                    type: 'dropdown',
                    key: 'calendarTabSort',
                    displayName: 'Scheduling panel sort',
                    default: 'order',
                    options: {
                        order: 'Manual order',
                        name: 'Name (A–Z)',
                        property: 'By property'
                    }
                },
                {
                    type: 'property',
                    key: 'calendarSortProperty',
                    displayName: 'Scheduling panel sort property',
                    placeholder: 'Used when sort is "By property"'
                },
                {
                    type: 'text',
                    key: 'calendarFilter',
                    displayName: 'Scheduling panel filter',
                    placeholder: 'Filter by name or #tag'
                }
            ]
        }
    ]
}
