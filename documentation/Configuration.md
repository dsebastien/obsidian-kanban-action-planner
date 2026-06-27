# Configuration

How the plugin is configured, and where each setting lives. (User-facing how-to docs live
in `docs/`; this file is the technical reference.)

## Layers and precedence

Effective value for any setting resolves in this order (first match wins):

1. **Per-view** — `BasesViewConfig` (`this.config`) on the individual Kanban view in a
   `.base` file: selected status/order/date properties, calendar toggle, range, sort,
   relational filters, panel state.
2. **Local profile / overrides** — the `profiles` store in plugin settings, edited via the
   Configure-board modal: colors, card presentation, swimlane grouping, relationships,
   archiving, calendar mappings, plus local overrides of mirrored fields.
3. **Starter Kit mirror** — when `obsidian-starter-kit` is installed and enabled, its
   note-type config (status `allowedValues` → columns, property names, recognition mappings)
   is the read-only source of truth, mirrored into the local snapshot.
4. **Built-in defaults** — `DEFAULT_SETTINGS` and the constants below.

## Configuration surfaces (where you edit each layer)

Two places, by scope (M7 settings model):

1. **Plugin settings tab** — vault-wide **defaults** only: property names, default statuses,
   date format (`settings/settings-tab.ts`). Used when nothing more specific applies.
2. **Per-board configuration**, which legitimately spans two scopes because Bases option types
   can't render rich controls (no color picker, no dynamic list editor):
    - **Bases "Configure view"** (`views/kanban/kanban-view-options.ts`) — **per-view**
      (`this.config`) settings, grouped for legibility into **Columns / Swimlanes / Filters /
      Calendar**. Affects only that one view.
    - **Gear → "Configure board"** (`ui/configure-board-modal.ts`) — **shared** note-type/profile
      settings: colors, card presentation, relationships, archiving, and the **default**
      swimlane grouping. Applies to every board of that type.

The grouping in "Configure view" is display-only — option `key`s are unchanged, so stored
config round-trips. **Swimlanes** is intentionally settable in both: the modal sets the shared
default, a view overrides it (the per-view dropdown defaults to "Use board default"); this is
the precedence below made visible, not a duplicated control.

## Global defaults (plugin settings)

Defined in `src/app/types/plugin-settings.intf.ts`, seeded from `src/app/constants.ts`:

| Setting                        | Default          | Purpose                                                 |
| ------------------------------ | ---------------- | ------------------------------------------------------- |
| `defaultStatusProperty`        | `status`         | Status property used to build columns                   |
| `defaultOrderProperty`         | `manual_order`   | Property storing per-column manual order                |
| `defaultBlockedByProperty`     | `blocked_by`     | Property listing blockers                               |
| `defaultScheduledDateProperty` | `date_scheduled` | "Unplanned" tab / scheduling date                       |
| `defaultDueDateProperty`       | `date_due`       | "No Deadline" tab / due date                            |
| `defaultDateFormat`            | `YYYY-MM-DD`     | momentjs format for dates written to notes              |
| `firstDayOfWeek`               | `1` (Monday)     | Day calendar weeks start on (0 = Sunday … 6 = Saturday) |

`schemaVersion` tracks the settings shape for migrations. On load, stored data is
shallow-merged onto the defaults and validated with Zod; invalid data falls back to defaults
(logged) rather than throwing.

## Starter Kit detection

The plugin feature-detects `app.plugins.plugins['obsidian-starter-kit']?.api` and degrades
gracefully when it is absent, disabled, or its API shape differs (no API versioning). The
mirror is always re-derived rather than trusted blindly.

## Current state

All configuration surfaces are implemented and harmonized (M7): the global settings tab
(defaults), the grouped Bases "Configure view" per-view options, and the gear "Configure board"
shared-profile modal. Starter Kit mirroring, colors, cards, swimlanes, relationships, archiving,
and calendar are all wired and persist through these surfaces.
