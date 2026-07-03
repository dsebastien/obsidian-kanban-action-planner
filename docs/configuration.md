---
title: Configuration
nav_order: 3
---

# Configuration

## Where settings live

Settings live in three places, by scope:

- **Plugin settings** (**Settings → Community plugins → Kanban Action Planner**) — vault-wide
  **defaults** (property names, default statuses, date format) **plus a central "Note types"
  list**. Each note type's shared config (statuses, colors, cards, relationships, archiving)
  is defined here once and applied by **every** board to its recognized notes — no need to
  reconfigure a type per board. When the Obsidian Starter Kit is present, its note types are
  synchronized into this list automatically; the **Default** entry covers notes with no
  recognized type. Click **Configure** next to a type to edit it.
- **Per-board configuration** (**Configure view** — the Bases view options for the Kanban view)
  — settings for **this board only**, grouped into **Columns**, **Cards**, **Swimlanes**,
  **Filters**, and **Calendar**. Pickers for properties the board **writes** (status, order,
  grouping) list only your notes' **frontmatter** properties; read-only pickers (card sort,
  panel sort, title) also offer `formula.*` and `file.*` columns. When the Obsidian Starter Kit
  is enabled, frontmatter pickers are further limited to your note types' known properties.

The **gear** in the board's top-right is a shortcut that opens the plugin's **Note types**
settings (note-type config — colors, cards, relationships, archiving, default swimlane grouping —
lives there, not on the board).

Precedence (most specific wins): a **view's** Configure-view setting → the **note type's** shared
config (Settings → Note types) → the **global** default. For example, swimlane grouping has a
shared default per note type, and any single view can override it in **Configure view →
Swimlanes** (which defaults to "Use note type default").

## Property names

The plugin reads and writes ordinary note properties (frontmatter). The defaults below are
used today; per-view overrides may arrive in later releases.

| Property     | Default        | What it does                                                                                                                                                                                                                                                                          |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | `status`       | Its value places a card in a column. Auto-detected: a property named `status`, else any property whose name contains `status`.                                                                                                                                                        |
| Manual order | `manual_order` | Stores a card's position within its column (a number). Written when you drag to reorder.                                                                                                                                                                                              |
| Estimate     | `estimate`     | A number of days: with a start date it gives a card its span on the timeline. Written when you resize a bar (right edge sets it directly; left edge adjusts it so the derived end stays anchored) or via **Set estimate…** in the card menu. Set globally with **Estimate property**. |
| Milestones   | `milestones`   | List of `<date> <label>` entries rendered as diamond markers on the timeline. Set globally with **Milestones property**.                                                                                                                                                              |

The status property is auto-detected, but the **columns are defined explicitly** (see below),
not inferred from your notes' values.

## Defining columns

Columns are **defined**, never guessed from the values present in notes (so a typo can't
create a stray column). A board takes its columns, in order of preference, from:

1. the per-view **Statuses (columns)** list (view settings), then
2. the **Obsidian Starter Kit** note type's allowed status values (if installed), then
3. the global **Default statuses** list (plugin settings, one per line).

A leading number sets order and is hidden in the header — e.g. `10 Todo`, `20 Doing`,
`30 Done`. Notes whose status isn't a defined column go to the **Unmapped** column (shown
first by default; a view option can move it last; hidden when empty). With no definition at
all, every card sits in Unmapped.

## Manual order

When you reorder cards, the plugin assigns a numeric `manual_order`. It uses fractional
midpoints so a single move usually rewrites only the card you moved; a column is renumbered
to whole numbers only when needed (e.g. when some cards have no order yet).

## Note types and the Obsidian Starter Kit

Board configuration (currently: colors) is grouped into a **note type**. When the Obsidian
Starter Kit plugin is installed and recognizes your notes as a note type, the board uses that
type as its note type — taking the status property and its allowed values from the Starter Kit
and building columns in the defined order, including empty ones. The Starter Kit remains the
source of truth for those facts; your color choices are stored locally in this plugin and
keep working even if the Starter Kit is disabled.

You can also **define your own note types** without the Starter Kit (**Settings → Note types →
Add note type**): give the type a name and **recognition rules** (by tag, folder, or path regex).
The plugin recognizes notes from those rules — Starter Kit recognition is tried first when it's
installed, then your local rules. A note that matches no type (and notes when nothing is defined)
uses the **Default** note type.

## Colors

Colors are saved per note type, so all boards of the same note type share them. Each status can
use an auto-assigned palette color, a chosen palette color, or a custom hex value. Column
backgrounds are a translucent blend of the card color over your theme background, so they look
right in both light and dark themes.

## Swimlanes

A board can be split into horizontal **lanes**. The grouping is saved per note type (and can be
overridden per view):

- **None** — one plain board.
- **By note type** — one lane per recognized Starter Kit note type.
- **By property** — one lane per distinct value of a chosen property; lanes order by a numeric
  prefix the same way columns do. Cards missing the value collect in an **Ungrouped** lane
  (hidden when empty).

Dragging a card to another lane rewrites the grouping property to the target lane's value (or
clears it for Ungrouped). Note-type lanes are read-only — a note's type comes from its
tags/folder — so cross-lane drags there are ignored.

## Relationships

Each relationship role reads a link-property (frontmatter wikilinks), configured per note type in
**Configure board → Relationships**:

| Role       | Default property | Meaning                          |
| ---------- | ---------------- | -------------------------------- |
| Parent     | `parent`         | Notes this note is a child of.   |
| Sibling    | `siblings`       | Peer notes (mutual).             |
| Child      | `children`       | Notes that are children of this. |
| Blocked by | `blocked_by`     | Notes blocking this one.         |

Inverse relations are derived automatically (a declared child gives the target a parent, and so
on). Setting a role's property to **None** turns that role **fully off**: its badge never
appears — no direct links, no inverse of an active opposite role, no heuristic. The **Detect
children by tag** option adds a heuristic: a note carrying one of the listed tags that links to
a card counts as that card's child (this also keeps the child role active).

Relationships are **read-only** — the plugin never writes them. A non-empty **blocked by** flags
the card (red badge + edge) and powers the **Blocked cards** view filter and badge navigation;
it never changes status on its own.

## Archiving

Archiving **moves** a note out of the board into a folder, saved per note type in **Configure
board → Archiving**:

- **Archive folder** — destination path. Supports placeholders resolved at archive time:

    | Placeholder    | Resolves to         | Example             |
    | -------------- | ------------------- | ------------------- |
    | `{{year}}`     | 4-digit year        | `2026`              |
    | `{{month}}`    | 2-digit month       | `06`                |
    | `{{day}}`      | 2-digit day         | `26`                |
    | `{{week}}`     | 2-digit ISO week    | `26`                |
    | `{{quarter}}`  | quarter (Q-prefix)  | `Q2`                |
    | `{{date}}`     | `YYYY-MM-DD`        | `2026-06-26`        |
    | `{{datetime}}` | `YYYY-MM-DD-HHmmss` | `2026-06-26-143015` |
    | `{{uuid}}`     | a fresh unique id   | `a1b2c3…`           |

    Placeholders are case-insensitive. Leaving the folder blank disables archiving. Missing
    folders are created; a name clash gets a numeric suffix so nothing is overwritten.

- **Auto-archive on status** — optional (off by default). Select **one or more** statuses; a
  card is archived the moment it **transitions into** any of them. Reordering within such a
  status does nothing.

Manual archiving is available from a card's right-click menu (**Archive**). Moves go through
Obsidian's file manager, so wikilinks to the note are updated and stay valid.

## Calendar mode

Calendar mode is toggled per view by the in-view **Board / Calendar** switch. It reads two date
properties (their names are set in plugin settings) and writes them when you drag-schedule:

| Property       | Default          | Role                                                  |
| -------------- | ---------------- | ----------------------------------------------------- |
| Scheduled date | `date_scheduled` | The **Unplanned** tab + the calendar's scheduled day. |
| Due date       | `date_due`       | The **No deadline** tab + the calendar's due day.     |

Dates are parsed leniently (a `YYYY-MM-DD` or full date string, or a real date value) and
written with the note type's momentjs **date format** (default `YYYY-MM-DD`). The calendar's
default **range** (week/month/quarter/year) and the **panel sort** (manual order / name /
a property) are view options. To narrow the calendar (grid and panel together), use the
toolbar **filter box** — see the usage guide's "Filtering" section.

The week the calendar grid starts on is set by **First day of the week** in the plugin settings
(default **Monday**). This only affects the calendar display; the `{{week}}` archive placeholder
stays ISO week numbering.

## Timeline mode

Timeline mode places each card by a **start date plus an estimate in days** — there is no
end-date property. The property names are **global plugin settings**: the start is your
scheduled-date property, the estimate defaults to `estimate` (**Estimate property**), and the
milestone list to `milestones` (**Milestones property**). Per view, **Configure view →
Timeline** only sets the **Default range** (Quarter by default). Estimates are written as
plain numbers; fractional values are rounded up to whole days, minimum 1. Old per-view
start/estimate/end/milestone keys in a `.base` file are simply ignored.

## Card title

The card heading is the **note name** by default. Per board, **Configure view → Cards →
Title property** picks a property (or base formula) to show as the heading instead — useful when
filenames are IDs or date-prefixed slugs and a `title`/`name` property carries the readable label.
Cards whose note is missing the property (or has it empty) fall back to the note name. The chosen
property is not repeated as a body field, and clicking the card still opens the note.

| Setting            | Scope     | Default   | What it does                                                            |
| ------------------ | --------- | --------- | ----------------------------------------------------------------------- |
| **Title property** | Per board | Note name | Shows this property's value as the card heading, in board and calendar. |

## Due countdown

A card can show a compact **countdown to its due date** (`today`, `in 3d`, `2d overdue`,
`in 2w`, `in 3mo` — the unit auto-scales from days to weeks to months), color-coded by urgency
(red overdue, amber today, orange soon, muted further out). It reuses the same **Due date**
property as the overdue emphasis — no extra property to configure.

| Setting                         | Scope     | Default   | What it does                                                                                                       |
| ------------------------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| **Show due countdown**          | Per board | Off       | Turns the badge on for this board (**Configure view → Cards**).                                                    |
| **Due countdown position**      | Global    | Title row | Where the badge sits: **Title row** (right-aligned pill), **Field chip**, **Top-right corner**, or **Footer row**. |
| **Due "soon" threshold (days)** | Global    | `7`       | Within how many days the badge turns warm (orange). Changes the **color**, not whether the badge shows.            |
