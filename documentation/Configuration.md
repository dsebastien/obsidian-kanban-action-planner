# Configuration

How the plugin is configured, and where each setting lives. (User-facing how-to docs live
in `docs/`; this file is the technical reference.)

## Layers and precedence

Effective value for any setting resolves in this order (first match wins):

1. **Per-view** — `BasesViewConfig` (`this.config`) on the individual Kanban view in a
   `.base` file: selected status/order/date properties, the **Properties** selection that
   drives card fields (`getOrder()`, #50), calendar toggle, range, sort, relational filters,
   panel state.
2. **Local note types** — the `noteTypes` store in plugin settings, edited via the
   Configure-board modal: colors, swimlane grouping, relationships, archiving, calendar
   mappings, estimate property/unit, done-state definition (rule 39: `done` config —
   property + values marking a note done; WBS rollups read done cards as 100%), plus local
   overrides of mirrored fields.
3. **Starter Kit mirror** — when `obsidian-starter-kit` is installed and enabled, its
   note-type config (status `allowedValues` → columns, property names, recognition mappings)
   is the read-only source of truth, mirrored into the local snapshot.
4. **Built-in defaults** — `DEFAULT_SETTINGS` and the constants below.

## Configuration surfaces (where you edit each layer)

Three places, by scope:

1. **Plugin settings tab** (`settings/settings-tab.ts`) — vault-wide **defaults** (property
   names, default statuses, date format) **plus a central "Note types" list** (issue #30): every
   note type's shared config (statuses, colors, cards, relationships, archiving) lives in
   `plugin.settings.noteTypes`, keyed by note-type id, and is editable here once — boards apply it
   by recognition (no per-board duplication). The tab merges Starter Kit types (`listNoteTypes`)
   with stored local note types and a Default; **Configure** opens `ui/configure-board-modal.ts` for
   that type's note type (status values from the type, property names from the SK type +
   note-type-referenced props, a single archive section). Starter Kit types stay synced via
   `resolveActiveProfile`/`mirrorNoteType`.
2. **Bases "Configure view"** (`views/kanban/kanban-view-options.ts`) — **per-view**
   (`this.config`) board-only settings (Bases option types can't render rich controls), grouped
   into **Columns / Cards / Swimlanes / Filters / Calendar / Triage**. Affects only that one view.
   The **Cards** group holds `titleProperty` (card heading source, issue #4; falls back to the
   note name) and `showDueCountdown`.

The note-type editor (`ui/configure-board-modal.ts`) — a two-pane dialog (Cards / Colors /
Swimlanes / Relationships / Archiving; Archive-folder field has folder autocomplete via
`ui/folder-suggest.ts`) — is opened **from the settings tab** for a chosen type. The board's
**gear** no longer opens an in-board config modal; it calls `app.setting.openTabById(...)` to jump
to the Note types settings (`view-toolbar` → `KanbanActionPlannerView.openSettings`), so note-type
config has a single home. Per-card archiving still resolves by note type at runtime (issue #29).

The grouping in "Configure view" is display-only — option `key`s are unchanged, so stored
config round-trips. **Swimlanes** is intentionally settable in both: the modal sets the shared
default, a view overrides it (the per-view dropdown defaults to "Use note type default"); this is
the precedence below made visible, not a duplicated control.

## Global defaults (plugin settings)

Defined in `src/app/types/plugin-settings.intf.ts`, seeded from `src/app/constants.ts`:

| Setting                        | Default          | Purpose                                                                 |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------- |
| `defaultStatusProperty`        | `status`         | Status property used to build columns                                   |
| `defaultOrderProperty`         | `manual_order`   | Property storing per-column manual order                                |
| `defaultBlockedByProperty`     | `blocked_by`     | Property listing blockers                                               |
| `defaultScheduledDateProperty` | `date_scheduled` | "Unplanned" tab / scheduling date                                       |
| `defaultDueDateProperty`       | `date_due`       | "No Deadline" tab / due date                                            |
| `defaultEstimateProperty`      | `estimate`       | Estimate property in days — the per-type default (rule 38 overrides)    |
| `minutesPerDay`                | `480`            | Minutes one work day represents (minute-estimate → days conversion)     |
| `defaultMilestonesProperty`    | `milestones`     | Milestone list property (`<date> [label]` entries → timeline diamonds). |
| `defaultProgressProperty`      | `progress`       | Completion percentage 0–100 (WBS progress bars + rollups)               |
| `defaultDateFormat`            | `YYYY-MM-DD`     | momentjs format for dates written to notes                              |
| `firstDayOfWeek`               | `1` (Monday)     | Day calendar weeks start on (0 = Sunday … 6 = Saturday)                 |

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
shared note-type modal. Starter Kit mirroring, colors, cards, swimlanes, relationships, archiving,
and calendar are all wired and persist through these surfaces.
