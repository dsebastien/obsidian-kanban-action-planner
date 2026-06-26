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

## Global defaults (plugin settings)

Defined in `src/app/types/plugin-settings.intf.ts`, seeded from `src/app/constants.ts`:

| Setting                        | Default          | Purpose                                    |
| ------------------------------ | ---------------- | ------------------------------------------ |
| `defaultStatusProperty`        | `status`         | Status property used to build columns      |
| `defaultOrderProperty`         | `manual_order`   | Property storing per-column manual order   |
| `defaultBlockedByProperty`     | `blocked_by`     | Property listing blockers                  |
| `defaultScheduledDateProperty` | `date_scheduled` | "Unplanned" tab / scheduling date          |
| `defaultDueDateProperty`       | `date_due`       | "No Deadline" tab / due date               |
| `defaultDateFormat`            | `YYYY-MM-DD`     | momentjs format for dates written to notes |

`schemaVersion` tracks the settings shape for migrations. On load, stored data is
shallow-merged onto the defaults and validated with Zod; invalid data falls back to defaults
(logged) rather than throwing.

## Starter Kit detection

The plugin feature-detects `app.plugins.plugins['obsidian-starter-kit']?.api` and degrades
gracefully when it is absent, disabled, or its API shape differs (no API versioning). The
mirror is always re-derived rather than trusted blindly.

## Current state

Milestone 0: the settings schema, defaults, and constants exist and round-trip. The
Configure-board modal, per-view options, and Starter Kit mirroring are wired up in later
milestones.
