import type { App, BasesAllOptions, BasesPropertyId } from 'obsidian'
import type { PluginSettings } from '../../types/plugin-settings.intf'
import { isStarterKitAvailable, listNoteTypes } from '../../services/starter-kit.service'

/**
 * Keep the Bases property dropdowns clean (issue #8): for **writeable** settings
 * (status, order, drag-grouping) only real frontmatter (`note.*`) properties are
 * offered — `file.*`/`formula.*` can't be written. When the Obsidian Starter Kit
 * is enabled, the list is further limited to its note types' known property names
 * (union across types); an empty known set falls back to all `note.*` so the
 * dropdowns never go blank.
 */
export function isSelectableProperty(prop: string, known: ReadonlySet<string> | null): boolean {
    const dot = prop.indexOf('.')
    if (dot < 0 || prop.slice(0, dot) !== 'note') return false
    return known ? known.has(prop.slice(dot + 1).toLowerCase()) : true
}

/**
 * For **read-only** settings (card sort, panel sort — issue #50): also offer
 * `formula.*` and `file.*` columns, so a view can sort by a base's computed
 * values (e.g. a `priority_score` formula). `note.*` is still narrowed to the
 * Starter Kit's known props; computed columns are always allowed.
 */
export function isSelectableReadOnlyProperty(
    prop: string,
    known: ReadonlySet<string> | null
): boolean {
    const dot = prop.indexOf('.')
    const prefix = dot < 0 ? '' : prop.slice(0, dot)
    if (prefix === 'formula' || prefix === 'file') return true
    return isSelectableProperty(prop, known)
}

function knownNoteProps(app: App): Set<string> | null {
    if (!isStarterKitAvailable(app)) return null
    const set = new Set<string>()
    for (const type of listNoteTypes(app)) {
        for (const prop of type.properties ?? []) set.add(prop.name.toLowerCase())
    }
    return set.size > 0 ? set : null
}

function buildPropertyFilter(app: App): (prop: BasesPropertyId) => boolean {
    const known = knownNoteProps(app)
    return (prop) => isSelectableProperty(prop, known)
}

function buildReadOnlyPropertyFilter(app: App): (prop: BasesPropertyId) => boolean {
    const known = knownNoteProps(app)
    return (prop) => isSelectableReadOnlyProperty(prop, known)
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
    const readOnlyPropertyFilter = buildReadOnlyPropertyFilter(app)
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
                    type: 'dropdown',
                    key: 'cardSort',
                    displayName: 'Card sort',
                    default: 'order',
                    options: {
                        order: 'Manual order',
                        name: 'Name (A–Z)',
                        property: 'By property'
                    }
                },
                {
                    type: 'property',
                    key: 'cardSortProperty',
                    displayName: 'Card sort property',
                    placeholder: 'Used when card sort is "By property" (formulas allowed)',
                    filter: readOnlyPropertyFilter
                },
                {
                    type: 'dropdown',
                    key: 'cardSortDirection',
                    displayName: 'Card sort direction',
                    default: 'asc',
                    options: { asc: 'Ascending', desc: 'Descending' }
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
            displayName: 'Cards',
            items: [
                {
                    type: 'property',
                    // Card-title source (issue #4): a property shown as the card
                    // heading instead of the note name (falls back to the note
                    // name when missing/empty). Read-only, so formulas work too.
                    key: 'titleProperty',
                    displayName: 'Title property',
                    placeholder: 'Note name (default)',
                    filter: readOnlyPropertyFilter
                },
                {
                    type: 'toggle',
                    // Visibility is per-view (issue #62); the badge position and the
                    // "soon" color threshold are global (plugin settings).
                    key: 'showDueCountdown',
                    displayName: 'Show due countdown',
                    default: false
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
                        // The default auto-groups by note type when the board
                        // mixes types (each type gets its own lane + columns);
                        // an explicit 'None' keeps a flat board.
                        '__profile__': 'Use note type default (auto by type on mixed boards)',
                        'none': 'None',
                        'note-type': 'By note type',
                        'property': 'By property'
                    }
                },
                {
                    type: 'property',
                    key: 'laneGroupingProperty',
                    displayName: 'Grouping property',
                    placeholder: 'Property to group lanes by (formulas allowed; read-only)',
                    filter: readOnlyPropertyFilter
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
                    placeholder: 'Used when sort is "By property" (formulas allowed)',
                    filter: readOnlyPropertyFilter
                }
            ]
        },
        {
            type: 'group',
            displayName: 'Timeline',
            items: [
                // Timeline mode is toggled by the in-view mode switch (persisted
                // to `timelineMode`). The start defaults to the resolved
                // scheduled date property and the estimate (days) to the global
                // default, so an already-configured board gets a working
                // timeline with zero setup (issue #77 / #80 rework).
                {
                    type: 'property',
                    key: 'timelineStartProperty',
                    displayName: 'Start date property',
                    placeholder: 'Scheduled date property (default)',
                    filter: propertyFilter
                },
                {
                    type: 'property',
                    key: 'timelineEstimateProperty',
                    displayName: 'Estimate property (days)',
                    placeholder: settings.defaultEstimateProperty,
                    filter: propertyFilter
                },
                {
                    type: 'property',
                    key: 'timelineMilestoneProperty',
                    displayName: 'Milestones list property',
                    placeholder: 'milestones (default)',
                    filter: propertyFilter
                },
                {
                    type: 'dropdown',
                    key: 'timelineRange',
                    displayName: 'Default range',
                    default: 'quarter',
                    options: {
                        week: 'Week',
                        month: 'Month',
                        quarter: 'Quarter',
                        year: 'Year'
                    }
                }
            ]
        },
        {
            type: 'group',
            // Triage mode is entered via the in-view Board / Calendar / Triage
            // switch. The property lists (editable / gating / context) and
            // needs-triage tokens are edited in the **Configure triage** modal (the
            // gear in the triage header, or the "Configure triage" command), which
            // offers real property pickers. Only the default scope lives here.
            displayName: 'Triage',
            items: [
                {
                    type: 'dropdown',
                    key: 'triageScope',
                    displayName: 'Triage scope',
                    default: 'clarify',
                    options: {
                        clarify: 'Needs clarification',
                        all: 'All cards (re-prioritize)',
                        review: 'Due for review'
                    }
                }
            ]
        }
    ]
}
