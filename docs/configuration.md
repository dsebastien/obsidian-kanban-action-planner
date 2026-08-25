---
title: Configuration
nav_order: 3
---

# Configuration

## Where settings live

Settings live in three places, by scope:

- **Plugin settings** (**Settings → Community plugins → Kanban Action Planner**) — vault-wide
  **defaults** (property names, default statuses, date format) **plus a central "Note types"
  list**. Each note type's shared config (statuses, colors, cards, relationships, estimate
  property + unit, archiving)
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
settings (note-type config — colors, cards, relationships, estimate, archiving, default swimlane
grouping — lives there, not on the board).

Precedence (most specific wins): a **view's** Configure-view setting → the **note type's** shared
config (Settings → Note types) → the **global** default. For example, swimlane grouping has a
shared default per note type, and any single view can override it in **Configure view →
Swimlanes** (which defaults to "Use note type default").

## Property names

The plugin reads and writes ordinary note properties (frontmatter). The defaults below are
used today; per-view overrides may arrive in later releases.

| Property     | Default        | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | `status`       | Its value places a card in a column. Auto-detected: a property named `status`, else any property whose name contains `status`.                                                                                                                                                                                                                                                                                                                                                         |
| Manual order | `manual_order` | Stores a card's position within its column (a number). Written when you drag to reorder.                                                                                                                                                                                                                                                                                                                                                                                               |
| Estimate     | `estimate`     | The time a note is expected to take — a number of **days** by default. A note type can associate its **own property and unit** (days or **minutes**, e.g. a tasknotes-compatible `time_estimate`) in **Configure → Estimate**; minute values convert to days everywhere via **Minutes per day** (default 480 = an 8-hour workday). With a start date it gives a card its span on the timeline. Written when you resize a bar or via **Set estimate…** — always in the note's own unit. |
| Milestones   | `milestones`   | List of `<date> <label>` entries rendered as diamond markers on the timeline. Set globally with **Milestones property**.                                                                                                                                                                                                                                                                                                                                                               |
| Contexts     | `contexts`     | Optional list of GTD-style contexts (`@work`, `@home`, …). Powers the **@** context switcher in the toolbar (filter only — the plugin never writes it). Set globally with **Contexts property**; must not be a reserved filter word (`parent`, `status`, `due`, …).                                                                                                                                                                                                                    |

The status property is auto-detected, but the **columns are defined explicitly** (see below),
not inferred from your notes' values.

One related global setting is not a property name: **Minutes per day** (default 480 = an
8-hour workday) defines how many minutes one day of work represents — it converts
minute-based estimates into days for rollups, timeline bars, and calendar spans, and sizes
the day component of every displayed duration (`1d 2h`).

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

> The [**Obsidian Starter Kit**](https://store.dsebastien.net/product/obsidian-starter-kit) is optional. If you use it, everything below configures
> itself — see [Using this plugin with the Obsidian Starter Kit]({{ '/usage.html#using-this-plugin-with-the-obsidian-starter-kit' | relative_url }}).

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

**Every note resolves with its own type's properties.** On a mixed board, a task can name its
parent in `related_projects` while a project names its goal in `related_goals`, and the whole
chain resolves — badges, WBS tree, zoom, and filters included. Notes without a recognized type
fall back to the board's active note type.

Relationships are **editable from the board**: the card menu's **Relationships** submenu adds
and removes direct links, and the WBS re-parents by drag — every write lands in the owning
note's own role property. Inverse-derived and heuristic relations stay read-only (they live on
the other note). A non-empty **blocked by** flags the card (red badge + edge) and powers the
**Blocked cards** view filter and badge navigation; it never changes status on its own.

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

Timeline mode places each card by a **start date plus an estimate** — there is no
end-date property. The start is your scheduled-date property and the milestone list defaults
to `milestones` (**Milestones property**), both global settings. The estimate defaults to the
global **Estimate property** (`estimate`, days), and each note type can override the
**property and unit** (days or minutes) in its **Configure → Estimate** section; minute
estimates convert to days via the global **Minutes per day** setting and always span at least
one whole day on the chart. Per view, **Configure view → Timeline** only sets the **Default
range** (Quarter by default). Estimates are written as plain numbers in the note's own unit;
fractional day values round up to whole days, minimum 1. Old per-view
start/estimate/end/milestone keys in a `.base` file are simply ignored.

## WBS mode

The WBS reuses the properties you already have: the **start date** is your scheduled-date
property, the **estimate** the same per-type estimate configuration the timeline uses (global
days-based default, or the note type's own property + unit), and the tree comes from
your **parent/children** relationship link properties (each note resolved with its **own**
type's properties, so cross-type chains work on mixed boards). One new global setting: **Progress
property** (default `progress`) — a **number from 0 to 100** driving the per-node progress
bars and their rollups. Progress and estimates are always written as plain numbers. There are
no per-view WBS options; the collapsed nodes and panel state are remembered per view
automatically.

### Done state

Per note type, **Configure board → Done state** defines what "done" means: turn on **Has a
done state**, then pick the property and value(s) that mark a note of that type as done. By
default the property is the type's **status property**, and you toggle the statuses that count
(e.g. **Completed** and **Done**). Point it at another property to match its values instead
(one per line, case-insensitive); with no values listed, a checkbox `true` counts as done. A
done note reads as **100% complete** in the WBS progress rollups — even without a `progress`
number — so parents show real momentum as their children complete.

## Creating notes (quick capture)

**Configure board → Creating notes**, per note type. Drives the **Add card** button in each
column (see the [usage guide]({{ '/usage.html#creating-cards-from-the-board-quick-capture' | relative_url }})).

Every field is **empty = inherit**, so a Starter Kit note type usually needs nothing here:

| Setting                             | Empty falls back to                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Target folder**                   | The Starter Kit type's associated folder → the folder the Base filters on → Obsidian's default new-note folder |
| **Template**                        | The Starter Kit type's template → the template your Templater folder/file rules resolve → none                 |
| **Name prefix** / **Name suffix**   | The Starter Kit type's note name prefix / suffix                                                               |
| **Open the note after creating it** | On                                                                                                             |

The folder and the name prefix/suffix accept `{{year}}`, `{{month}}`, `{{week}}`, `{{quarter}}`,
`{{day}}`, `{{date}}`, `{{datetime}}`, `{{uuid}}`.

Prefixes and suffixes keep their spaces (` (Task)` is not the same as `(Task)`) — the Starter
Kit recognizes note types by exactly that spelling — and are never added twice.

The template is applied **before** the card's status, swimlane value, tags, and order are
written, so the column you clicked always wins over a status a template asks for.

## Automation rules

Per note type, **Configure board → Automations** defines rules of the form "when this
happens to a note, do that". Each rule has a trigger, and a list of actions that run in
order:

**Triggers**

- **Enters a status** / **Leaves a status** — toggle any of the type's status values; the
  rule fires when a note transitions into (or out of) one of them, whether by drag, the
  card menu, the WBS status dot, a pane drop, a bulk edit, or triage. It fires once per
  actual transition — dropping a card back on its own column does nothing.
- **Enters a done state** — fires when the note enters any of the type's done values (see
  [Done state](#done-state)) from a non-done one. Completed, Abandoned, Superseded — one
  rule covers them all, and moving between two done states does not re-fire it.
- **Is archived** — fires just before the note moves to its archive folder (manual, bulk,
  or status-triggered), so property changes land on the archived note.
- **Property matches a condition** — `property = / ≠ / > / ≥ / < / ≤ value`, or `is set` /
  `is unset`. Numbers compare numerically, everything else as case-insensitive text (ISO
  dates order correctly). The rule fires when the condition **becomes** true — editing
  `progress` from 40 to 100 fires a `progress ≥ 100` rule once; nudging it from 100 to 110
  doesn't. Any edit source counts, including typing in the editor — as long as a board
  showing the note is open.

**Actions**

- **Set property** — the value supports the archive placeholders (`{{date}}`,
  `{{year}}`, `{{month}}`, `{{day}}`, `{{week}}`, `{{quarter}}`, `{{datetime}}`,
  `{{uuid}}`); plain numbers and `true`/`false` are written as numbers and booleans.
- **Remove property** — deletes the property (e.g. clear `date_due` when a task is done).
- **Add tag / Remove tag** — edits the frontmatter `tags` list (case-insensitive, `#`
  optional).
- **Move to folder** — the same placeholder-driven move archiving uses: folders are
  created on demand, name collisions get a numeric suffix, links are preserved.

Automation writes never trigger other automation rules (no cascades). If a transition
both auto-archives the note and matches rules, the property/tag actions run first and the
archive decides the final folder — move actions on that rule are skipped.

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

A card can show a compact **countdown to its due date** (`Today`, `In 3d`, `2d overdue`,
`in 2w`, `in 3mo` — the unit auto-scales from days to weeks to months), color-coded by urgency
(red overdue, amber today, orange soon, muted further out). It reuses the same **Due date**
property as the overdue emphasis — no extra property to configure.

| Setting                         | Scope     | Default   | What it does                                                                                                       |
| ------------------------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| **Show due countdown**          | Per board | Off       | Turns the badge on for this board (**Configure view → Cards**).                                                    |
| **Due countdown position**      | Global    | Title row | Where the badge sits: **Title row** (right-aligned pill), **Field chip**, **Top-right corner**, or **Footer row**. |
| **Due "soon" threshold (days)** | Global    | `7`       | Within how many days the badge turns warm (orange). Changes the **color**, not whether the badge shows.            |
