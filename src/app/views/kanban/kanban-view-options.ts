import type { App, BasesAllOptions, BasesPropertyId } from 'obsidian'
import type { PluginSettings } from '../../types/plugin-settings.intf'
import { isStarterKitAvailable, listNoteTypes } from '../../services/starter-kit.service'

/**
 * Keep the Bases property dropdowns clean (issue #8): only real frontmatter
 * (`note.*`) properties are offered — `file.*`/`formula.*` are both noise and
 * non-functional here (the plugin reads/writes status, order, grouping and sort
 * via frontmatter). When the Obsidian Starter Kit is enabled, the list is further
 * limited to its note types' known property names (union across types, since the
 * options panel has no single-note-type context); an empty known set falls back
 * to all `note.*` so the dropdowns never go blank.
 */
export function isSelectableProperty(prop: string, known: ReadonlySet<string> | null): boolean {
    const dot = prop.indexOf('.')
    if (dot < 0 || prop.slice(0, dot) !== 'note') return false
    return known ? known.has(prop.slice(dot + 1).toLowerCase()) : true
}

function buildPropertyFilter(app: App): (prop: BasesPropertyId) => boolean {
    let known: Set<string> | null = null
    if (isStarterKitAvailable(app)) {
        const set = new Set<string>()
        for (const type of listNoteTypes(app)) {
            for (const prop of type.properties ?? []) set.add(prop.name.toLowerCase())
        }
        known = set.size > 0 ? set : null
    }
    return (prop) => isSelectableProperty(prop, known)
}

/**
 * Per-view options shown in the Bases "Configure view" panel.
 *
 * These are the **per-board** presentation/filter settings — they live in
 * `this.config` and affect only this one view. They sit alongside two other
 * surfaces:
 *   - vault-wide **defaults** in the plugin settings tab (property names,
 *     default statuses, date format), used when a view/noteType doesn't override;
 *   - **shared note-type config** in the plugin settings → Note types (colors,
 *     cards, relationships, archiving, the default swimlane grouping) — the rich
 *     controls Bases options can't render. The board's gear jumps there.
 *
 * Deliberately NOT here: calendar mode (the in-view Board/Calendar switch owns
 * it) and the scheduled/due date *property names* (conventions, set globally).
 *
 * Options are grouped purely for legibility (the `key`s are unchanged, so stored
 * config is unaffected). Where a per-view option overrides a shared/global
 * default, its placeholder/default makes that explicit (e.g. Swimlanes →
 * "Use note type default").
 */
export function getKanbanViewOptions(app: App, settings: PluginSettings): BasesAllOptions[] {
    const propertyFilter = buildPropertyFilter(app)
    return [
        {
            type: 'group',
            displayName: 'Columns',
            items: [
                {
                    type: 'property',
                    key: 'statusProperty',
                    displayName: 'Status property',
                    placeholder: settings.defaultStatusProperty,
                    filter: propertyFilter
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
                    placeholder: settings.defaultOrderProperty,
                    filter: propertyFilter
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
                    // "Use note type default" defers to the note type's grouping
                    // (Settings → Note types → Swimlanes); other values override it
                    // for this view only.
                    default: '__profile__',
                    options: {
                        '__profile__': 'Use note type default',
                        'none': 'None',
                        'note-type': 'By note type',
                        'property': 'By property'
                    }
                },
                {
                    type: 'property',
                    key: 'laneGroupingProperty',
                    displayName: 'Grouping property',
                    placeholder: 'Property to group lanes by',
                    filter: propertyFilter
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
                // Calendar mode is toggled by the in-view Board/Calendar switch
                // (persisted to `calendarMode`); the scheduled/due date *property
                // names* are conventions set in plugin settings, not per board.
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
                    placeholder: 'Used when sort is "By property"',
                    filter: propertyFilter
                }
            ]
        }
    ]
}
