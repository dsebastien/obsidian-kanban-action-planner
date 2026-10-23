---
title: Configuration
nav_order: 3
---

# Configuration

## Where settings live

Settings live at three levels: vault-wide defaults and note types (both in the plugin settings),
and per-board configuration.

- **Plugin settings** (**Settings → Community plugins → Kanban Action Planner**). Vault-wide
  **defaults** (property names, default statuses, date format) **plus a central "Note types"
  list**. You define each note type's shared config here once (statuses, colors, enums, WIP
  limits, swimlanes, relationships, dates, estimate, time tracking, ideal week, done state,
  automations, creating notes, card titles, archiving), and **every** board applies it to the
  notes it recognizes. No reconfiguring a type board by board. When the Obsidian Starter Kit is
  present, its note types sync into this list automatically; the **Default** entry covers notes
  with no recognized type. Click **Configure** next to a type to edit it.
- **Per-board configuration** (**Configure view**, the Bases view options for the Kanban Action
  Planner view). Settings for **this board only**, grouped into **Columns**, **Cards**,
  **Swimlanes**, **Filters**, **Calendar**, **Timeline**, and **Triage**. Pickers for properties
  the board **writes** (status, order) list only your notes' **frontmatter** properties.
  Read-only pickers (card sort, panel sort, title, cover, card color, accent, column aggregate,
  lane grouping) also offer `formula.*` and `file.*` columns. With the Obsidian Starter Kit
  enabled, frontmatter pickers only list your note types' known properties.

The **gear** in the board's top-right corner is a shortcut to the plugin's **Note types** settings.
Note-type config lives there, not on the board: colors, card titles, relationships,
estimate, archiving, default swimlane grouping, and the other note type sections.

When levels disagree, the most specific one wins: a **view's** Configure-view setting → the
**note type's** shared config (Settings → Note types) → the **global** default. Take swimlane
grouping. It has a shared default per note type, and any single view can override it in **Configure view →
Swimlanes** (which defaults to "Use note type default (auto by type on mixed boards)").

## Property names

The plugin reads and writes ordinary note properties (frontmatter). Nothing exotic, nothing
hidden. These are the global defaults. A board can override the status and manual order
properties in **Configure view → Columns** (**Column property**, **Manual order property**).

| Property        | Default                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status          | `status`                   | Its value places a card in a column. Auto-detected: this name, else a property named `status`; never guessed from another property. Text or List: a List property uses its first value, and moves keep it a List. Set globally with **Default column property**.                                                                                                                                                                                                                 |
| Manual order    | `manual_order`             | Stores a card's position within its column (a number). Written when you drag to reorder.                                                                                                                                                                                                                                                                                                                                                                                         |
| Blocked by      | `blocked_by`               | Notes blocking this one. Set globally with **Blocked-by property**; per type in **Configure → Relationships**.                                                                                                                                                                                                                                                                                                                                                                   |
| Defer date      | `date_defer`               | Date before which a note can't start. Deferred cards look muted, and `is:available` leaves them out. Set globally with **Defer date property**, per type in **Configure → Dates**.                                                                                                                                                                                                                                                                                               |
| Estimate        | `estimate`                 | How long you expect a note to take, as a number of **days** by default. A note type can map its **own property and unit** (days or **minutes**, e.g. a tasknotes-compatible `time_estimate`) in **Configure → Estimate**; minute values convert to days everywhere via **Minutes per day** (default 480 = an 8-hour workday). With a start date, it sets the card's span on the timeline. Written when you resize a bar or use **Set estimate…**, always in the note's own unit. |
| Milestones      | `milestones`               | List of `<date> <label>` entries, shown as diamond markers on the timeline. Set globally with **Milestones property**.                                                                                                                                                                                                                                                                                                                                                           |
| Contexts        | `contexts`                 | Optional list of GTD-style contexts (`@work`, `@home`, …). Drives the **@** context switcher in the toolbar. It's for filtering only; the plugin never writes it. Set globally with **Contexts property**. It must not be a reserved filter word (`parent`, `status`, `due`, …).                                                                                                                                                                                                 |
| Duration        | `duration`                 | The note's own tracked time in **minutes**. Stopping a session **adds** its minutes, so minutes you add by hand or with another tool are kept. When it's empty or not a number, it's set to the sum of the time-entries list. Set globally with **Duration property**; a note type can map its own in **Configure → Time tracking**. A legacy number left by an older version is still read when neither the entries list nor this property is set.                              |
| Total duration  | `total_duration`           | The saved tracked-time rollup (minutes): **Save total tracked time** in the WBS row menu writes the subtree total (own + descendants) here. Set globally with **Total duration property**, per type in **Configure → Time tracking**.                                                                                                                                                                                                                                            |
| Time entries    | `time_entries`             | List of `{startTime, endTime, description}` objects (local ISO datetimes), one per tracked session, in TaskNotes' format, never compacted. It's the ledger of tracked sessions; the duration falls back to its sum when empty. Set globally with **Time entries property**, per type in **Configure → Time tracking**.                                                                                                                                                           |
| Last session    | `date_last_session`        | Date of the latest time entry, stamped on every stop. Set globally with **Last session property**, per type in **Configure → Time tracking**.                                                                                                                                                                                                                                                                                                                                    |
| Pomodoros       | `pomodoros`                | **Daily-note** list property that gets one record per pomodoro (`{id, taskPath, startTime, endTime, plannedDuration, type, completed, activePeriods}`, TaskNotes' shape). The daily note is found through Periodic Notes, else the core Daily Notes plugin, else the **Daily note folder / format (fallback)** settings. Pomodoro lengths and the long-break interval are settings too.                                                                                          |
| Time blocks     | `time_blocks`              | The ideal week: a list of `<days> HH:MM-HH:MM` entries on a 15-minute grid (`mon-fri 09:00-12:00`; a day list or range repeats, an end before the start crosses midnight). Read and written by **Ideal week** mode. Set globally with **Time blocks property**.                                                                                                                                                                                                                  |
| Planned minutes | `minutes_planned_per_week` | Minutes per week reserved by the note's time blocks. The plugin recomputes it on every block edit, so don't edit it by hand. Set globally with **Planned minutes property**.                                                                                                                                                                                                                                                                                                     |
| Target minutes  | `minutes_per_week`         | The weekly time budget you intend to give a note, in minutes. The ideal week's rail shows it against the planned minutes. For a note without one, you're asked for it the first time a block is planned for that note. Set globally with **Target minutes property**.                                                                                                                                                                                                            |
| Alarm minutes   | `minutes_alarm_per_week`   | Optional weekly alarm, in minutes. When the minutes tracked this ISO week (the note's own entries plus its linked tasks') go over it, the budget ring turns red and one notice fires per note per week. Set globally with **Alarm minutes property**. The four ideal-week properties can be mapped per note type in **Configure → Ideal week**.                                                                                                                                  |
| Committed date  | `date_committed`           | When you committed to the note. The WBS lifecycle chip shows the **lead** (started − committed) next to the **cycle** (done − started) and the **lateness** (done − due) of done items, or the days **active** for open ones; a missing date leaves its slot blank. Set globally with **Committed date property**.                                                                                                                                                               |
| Areas           | `areas`                    | List of the areas (life domains) a note belongs to: Health, Exercise, Work… Read only: the ideal week's rail and targets table can **group by area** (a note files under its first value). Set globally with **Areas property**, per type in **Configure → Ideal week**.                                                                                                                                                                                                         |

The status property is auto-detected, but the **columns are defined explicitly** (see below).
They're never inferred from the values your notes happen to carry.

One related global setting isn't a property name: **Minutes per day** (default 480 = an 8-hour
workday), the number of minutes one day of work represents. It converts minute-based estimates
into days for rollups, timeline bars, and calendar spans, and it sizes the day part of every
displayed duration (`1d 2h`).

### Time tracking and pomodoro settings

| Setting                                                                            | Default | What it does                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ask for a description when a session stops**                                     | Off     | Prompt for the entry's `description` after a stop. The entry is written first, so skipping loses nothing. The note's last description is prefilled.                                 |
| **Idle detection (minutes)**                                                       | 30      | Minutes without activity in Obsidian before a running session asks what to do: end when the activity stopped, keep running, or discard. 0 = off.                                    |
| **Session cap (minutes)**                                                          | 480     | Longest session written without asking. Past it (and for a suspicious session found after a restart), you're asked to end at the cap, keep running, or discard. 0 = no cap.         |
| **Chain phases automatically**                                                     | On      | A completed phase starts the next one: work → break (short, or long every Nth) → work on the same note. A phase stopped early never chains; **Skip to the next phase** always does. |
| **Sound at phase boundaries**                                                      | Off     | A short two-tone cue when a phase completes.                                                                                                                                        |
| **System notification at phase boundaries**                                        | Off     | A desktop notification when a phase completes (permission is requested once).                                                                                                       |
| **Work pomodoro (minutes)** / **Short break (minutes)** / **Long break (minutes)** | 25/5/15 | Phase lengths.                                                                                                                                                                      |
| **Long break interval**                                                            | 4       | Every Nth completed work pomodoro is followed by a long break.                                                                                                                      |

### Filter and review settings

| Setting                      | Default                  | What it does                                                                                                                                                                                                 |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Date-window chips**        | `today, next7d, next30d` | The one-click chips next to the filter box, in order. Each keeps the cards due or scheduled in its window: `today`, `overdue`, `week`, `month`, `quarter`, `year`, or `next7d` / `next2w`. Empty = no chips. |
| **Last-reviewed property**   | `last_reviewed`          | Date of a note's last review. Stamped by **Reviewed** in triage.                                                                                                                                             |
| **Review-interval property** | `review_interval`        | Days between reviews of a note; the **Default review interval (days)** (30) applies when unset.                                                                                                              |
| **Review-count property**    | `review_count`           | How many times a note was reviewed; incremented by **Reviewed**.                                                                                                                                             |
| **Show the review badge**    | On                       | A **Review** badge on cards due for review. On a board, a note takes part once it has a last reviewed date or its own interval. `review:due` filters the same cards.                                         |

## Defining columns

Columns are **defined**, never guessed from the values in your notes, so a typo in a note can
never create a stray column. A board takes its columns, in order of preference, from:

1. the per-view **Column values** list (**Configure view → Columns**), then
2. the **Obsidian Starter Kit** note type's allowed status values (if installed), then
3. the global **Default column values** list (plugin settings, one per line).

A leading number sets the order and is hidden in the header: `10 Todo`, `20 Doing`,
`30 Done`. Notes whose status isn't a defined column go to the **Unmapped** column. It's shown
first by default (a view option can move it last) and hidden when empty. With no columns
defined at all, every card sits in Unmapped.

## Manual order

When you reorder cards, the plugin assigns a numeric `manual_order`. It uses fractional
midpoints, so a single move usually rewrites only the card you moved. When cards share the
same order or have none, it rewrites only the few cards around the drop point, never the whole
column. Drop a card below many cards that have no order yet, and it lands at the top of that
unordered group.

The plugin hands out orders 1024 apart, so later moves fit in between. The numbers in between
are midpoints (for example `1536` or `7.5`), and they stay short.

**Tidy card order automatically** (plugin settings, on by default): when a board opens, cards
without a `manual_order` get one, and after a drop, duplicate values in that column get spread
out. It runs in the background, a few notes at a time, never changes what you see, and only on
boards sorted by **Manual order**. Switch it off to leave your notes untouched until you run the
**Normalize card order on this board** command yourself.

## Note types and the Obsidian Starter Kit

> The [**Obsidian Starter Kit**](https://store.dsebastien.net/product/obsidian-starter-kit) is optional. If you use it, everything below configures
> itself. See [Using this plugin with the Obsidian Starter Kit]({{ '/usage.html#using-this-plugin-with-the-obsidian-starter-kit' | relative_url }}).

Board configuration (statuses, colors, relationships, archiving and the other Configure
sections) is grouped into a **note type**. When the Obsidian Starter Kit plugin is installed and
recognizes your notes as a note type, the board uses that type. It takes the status property and
its allowed values from the Starter Kit and builds the columns in the defined order, empty ones
included. The Starter Kit stays the source of truth for those; your color choices are stored
locally in this plugin and keep working even if the Starter Kit is disabled.

You can also **define your own note types** without the Starter Kit (**Settings → Note types →
Add note type**): give the type a name and **recognition rules** (by tag, folder, or path regex),
and the plugin recognizes notes from those rules. When the Starter Kit is installed, its
recognition is tried first, then your local rules. A note that matches no type (and every note,
when no type is defined) uses the **Default** note type.

## Colors

Colors are saved per note type, so every board of the same note type shares them. Each status
can use an auto-assigned palette color, a palette color you pick, or a custom hex value. Column
backgrounds are a translucent blend of the card color over your theme background, so they look
right in both light and dark themes.

Every note type gets its per-status rows in **Settings → Note types → Configure → Colors**,
whether you just created it or configured it months ago. The listed statuses are the ones the
board itself uses: the Obsidian Starter Kit's declared status values when it owns the
type, else the type's own columns, else the global default statuses.

## Swimlanes

A board can be split into horizontal **lanes**. The grouping is saved per note type (and a view
can override it):

- **None**: a plain board, no lanes.
- **By note type**: a lane for each recognized Starter Kit note type.
- **By property**: one lane per distinct value of a chosen property, ordered by a numeric prefix
  the same way columns are. Cards missing the value collect in an **Ungrouped** lane (hidden
  when empty).

Dragging a card to another lane rewrites the grouping property to the target lane's value (or
clears it for Ungrouped). Note-type lanes are read-only: a note's type comes from its tags or
folder, so cross-lane drags there are ignored.

## Relationships

Each relationship role reads a link property (frontmatter wikilinks), configured per note type in
**Configure board → Relationships**:

| Role       | Default property | Meaning                        |
| ---------- | ---------------- | ------------------------------ |
| Parent     | `parent`         | Notes this note is a child of. |
| Sibling    | `siblings`       | Peer notes (mutual).           |
| Child      | `children`       | This note's children.          |
| Blocked by | `blocked_by`     | Notes blocking this one.       |

A role can have **several properties**, each limited to the note types it links to (a task's
parents: `related_projects` for projects, `related_goals` for goals). Add rows with the
**Add … property** button, then pick the property and, in the note types menu, the types it
links to (none selected = any type). Reads merge every property of the role. A new link goes to
the one property whose types include the linked note's type, else to the one property with no
types. When none or several fit, nothing is written and a notice says why. When the Obsidian
Starter Kit declares a type's relationships, they're mirrored read-only and re-synced on every
board load; **Detect children by tag** stays editable.

A property can hold **a single link** instead of a list (a season's `show: "[[My Show]]"`).
The Starter Kit says so when it declares the relationship. For relationships you configure
here, a property that Obsidian types as **Text** is treated as single-link. Writing to it
replaces the current value and never turns it into a list.

Inverse relations are derived automatically (a declared child gives the target a parent, and so
on). Setting a role's property to **None** turns that role **fully off**: no badge, no direct
links, no inverse of an active opposite role, no heuristic. The **Detect
children by tag** option adds a heuristic: a note carrying one of the listed tags that links to
a card counts as that card's child (this also keeps the child role active).

**Every note resolves with its own type's properties.** On a mixed board, a task can name its
parent in `related_projects` while a project names its goal in `related_goals`, and the whole
chain still resolves: badges, WBS tree, zoom, and filters included. Notes without a recognized
type fall back to the board's active note type.

Relationships are **editable from the board**: the card menu's **Relationships** submenu adds
and removes direct links, and in the WBS you re-parent by dragging. Every write lands in the
owning note's own role property. Inverse-derived and heuristic relations stay read-only (they
live on the other note). A non-empty **blocked by** flags the card (red badge + edge) and drives
the **Blocked cards** view filter and badge navigation. It never changes the status on its own.

## Archiving

Archiving **moves** a note off the board into a folder, set per note type in **Configure
board → Archiving**:

- **Archive folder**: the destination path. It supports placeholders, resolved at archive time:

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

    Placeholders are case-insensitive. Leave the folder blank to disable archiving. Missing
    folders are created. A name clash is refused and logged, so nothing gets overwritten or
    silently renamed.

- **Auto-archive on status**: optional (off by default). Select **one or more** statuses, and a
  card is archived the moment it **transitions into** any of them. Reordering within such a
  status does nothing.

- **Done-date properties**: comma-separated frontmatter properties, **first present wins**
  (e.g. `date_completed, date_abandoned`). Only used with a grace period (below); leave it blank
  and the type archives on the transition itself.

**Mirrored from the Obsidian Starter Kit.** When the Starter Kit (1.19+) declares a type's
archive (Settings → Obsidian Starter Kit → Note types → Edit → Archive), this panel shows that
declaration read-only instead: its folder, its archiving statuses, the dates they stamp (used as
the done-date properties), and its per-type delay, which replaces the global grace period below
for that type. Edit it there; boards re-sync on every load. Both plugins may keep archiving the
same type: neither one ever moves a note that's already under the archive folder.

You can also archive by hand from a card's right-click menu (**Archive**). Moves go through
Obsidian's file manager, so wikilinks to the note get updated and stay valid.

**Folder notes move whole.** When a note is its folder's namesake (`Projects/Foo/Foo.md`, or
with a parenthesized type suffix: `Projects/Foo/Foo (Project).md`), archiving moves the
**folder**. Every sibling file goes along, and links keep resolving. On a name clash, the move
is refused and logged. The same goes for automation **Move to folder** actions.

### Archive grace period

By default, an auto-archive status archives on the transition. **Settings → Archiving → Archive
grace period (days)** keeps the card on the board instead, until its **done date** (the type's
first present done-date property) is that many days old:

- Aged notes get archived when a board **loads** (once per open board), or on demand with the
  **Archive aged done notes (open boards)** command. A notice sums up what moved.
- A note sitting in an auto-archive status with **no** done date gets a done-date property
  **stamped with today**, which starts its clock. The plugin picks the property an automation
  rule of that type would write on that transition (so Abandoned stamps `date_abandoned`), else
  the first one listed. This happens whether the note got there through the board (and no
  automation rule stamped a date on that transition) or was marked done in the editor or by a
  script. An unparseable date is left alone, and the note waits.
- Types without done-date properties ignore the grace period and archive right away.
- Notes that another board or an external tool archived in the meantime are skipped.

## Date properties

Three dates drive every mode: the **scheduled** date (when work is planned to start), the
**due** date (the deadline), and the optional **defer** date (when it may start). Each is a
frontmatter property name, resolved at three levels; the most specific wins:

1. **Per board**: a `scheduledDateProperty`, `dueDateProperty` or `deferDateProperty` key in the
   view's `.base` config, for a board that reads different properties than the rest. Configure
   view has no picker for these.
2. **Per note type**: _Settings → Note types → Configure →_ **Dates**, which also holds the date
   **format** used when writing.
3. **Global default**: _Settings → Kanban Action Planner_.

Every per-type field is **empty = inherit**, and shows the inherited value as its placeholder.
Blank one out to follow the global setting again.

> Before 1.29, a note type silently copied the global defaults when it was first created, and
> there was no UI to change them. So editing the global **Scheduled date property** or **Due
> date property** seemed to do nothing: the frozen copy won, and the timeline showed
> everything as _Unplanned_. Upgrading clears those copies automatically.

## Calendar mode

You toggle Calendar mode per view with the **Calendar** button in the mode switch. It reads two date
properties (resolved as described in [Date properties](#date-properties)) and writes them when
you drag a card to schedule it:

| Property       | Default          | Role                                                  |
| -------------- | ---------------- | ----------------------------------------------------- |
| Scheduled date | `date_scheduled` | The **Unplanned** tab + the calendar's scheduled day. |
| Due date       | `date_due`       | The **No deadline** tab + the calendar's due day.     |

Dates are parsed leniently (a `YYYY-MM-DD` or full date string, or a real date value) and
written with the note type's momentjs **date format** (default `YYYY-MM-DD`). The calendar's
default **range** (week/month/quarter/year) and the **panel sort** (manual order / name /
a property) are view options. To narrow the calendar (grid and panel together), use the
toolbar **filter box**; see the usage guide's "Filtering" section.

**First day of the week** in the plugin settings sets the day the calendar grid starts on
(default **Monday**). It only affects the calendar display; the `{{week}}` archive placeholder
keeps ISO week numbering.

## Timeline mode

Timeline mode places each card by a **start date plus an estimate**; there's no end-date
property. The start is your scheduled-date property, which follows
[Date properties](#date-properties). The milestone list defaults to `milestones`
(**Milestones property**), a global setting. The estimate defaults to the global **Estimate
property** (`estimate`, days), and each note type can override the **property and unit** (days
or minutes) in its **Configure → Estimate** section. Minute estimates convert to days via the
global **Minutes per day** setting and always span at least one whole day on the chart. Per
view, **Configure view → Timeline** only sets the **Default range** (Quarter by default).
Estimates are written as plain numbers in the note's own unit; fractional day values round up
to whole days, minimum 1. Old per-view start/estimate/end/milestone keys in a `.base` file are
ignored.

## WBS mode

The WBS reuses the properties you already have. The **start date** is your scheduled-date
property. The **estimate** uses the same per-type configuration as the timeline (the global
days-based default, or the note type's own property + unit). The tree comes from your
**parent/children** relationship link properties, each note resolved with its **own** type's
properties, so cross-type chains work on mixed boards. The WBS adds one global setting:
**Progress property** (default `progress`), a **number from 0 to 100** that drives the per-node
progress bars and their rollups. Progress and estimates are always written as plain numbers.
There are no per-view WBS options; each view remembers its collapsed nodes and panel state
automatically.

## Ideal week mode

Ideal week mode draws the recurring **time blocks** of the board's **active** notes. It shows how
you want to spend a week, not a plan for one particular week. Which statuses count as active
comes from the note type's status configuration mirrored from the Obsidian Starter Kit (the
per-value planning **role**); without roles, every status not declared done counts. A note also
needs the time blocks property to appear (tasks don't have it). A dated note (a project with a
start and a due date, as configured for its type in **Dates**) only appears while today falls
between them.

The global settings under **Ideal week** start with the property names: **Time blocks
property**, **Planned minutes property**, **Target minutes property**, **Alarm minutes
property**, **Areas property** and **Committed date property** (see the property table; the
five ideal-week properties can be overridden per note type in **Configure board → Ideal week**).

Two settings decide how targets behave. **Target follows planned** is on by default: when an
edit plans more than a note's weekly target, the target rises to the planned minutes, and a
note without a target gets one from its planned minutes (with a notice) instead of a prompt.
The target is never lowered. **Available hours per week** is the base of every share in the
targets table (empty = the visible grid hours × 7, the whole week by default).

The rest shape the grid: **Grid starts at (hour)** / **Grid ends at (hour)** (the full day by
default), **Work hours** (`09:00-17:00` by default; empty = no band), **Work days** (`mon-fri`
by default; the band's days), **New block length (minutes)** (60), **Day window**
(`06:00-22:00` by default: the hours that fill the pane, with the scale following the pane
height; empty = the whole grid) and **Minimum pixels per hour** (the grid never gets denser
than this and scrolls instead). There are no per-view options. Each view remembers its panel
state, the grid / targets face and the two grouping choices.

## View modes

Under **View modes** in the plugin settings, switch off the modes you don't use (Calendar,
Timeline, WBS, Triage, Agenda, Ideal week; the board itself always stays). A switched-off mode
disappears from every board's mode switch, and its commands only show a notice. An embed that
asks for it (`mode=triage`), or a view last left in it, opens the board instead. Nothing is
lost: switch it back on and the views come back where they were.

### Done state

Per note type, **Configure board → Done state** defines what "done" means. Turn on **Has a
done state**, then pick the property and value(s) that mark a note of that type as done. By
default the property is the type's **status property**, and you toggle the statuses that count
(e.g. **Completed** and **Done**). Point it at another property to match its values instead
(one per line, case-insensitive); with no values listed, a checkbox `true` counts as done. A
done note counts as **100% complete** in the WBS progress rollups, even without a `progress`
number, so parents show real momentum as their children complete.

**With the Obsidian Starter Kit (1.13+)**: when a note type's **Status** section there
declares its status property and done states, this plugin **mirrors** them. The done state
becomes read-only here ("Mirrored from the Obsidian Starter Kit"), and the status property and
columns follow the declaration. For each status that stamps a date (Planned → `date_committed`,
Completed → `date_completed`, …), one **stamping rule** appears under Automations
(`Stamp … on …`, mirrored, re-synced on every board load, and **only if empty**, so a date you
set by hand is never overwritten). Edit all of it in the Starter Kit. A type whose Starter Kit
status isn't configured keeps its plugin-owned done state exactly as before.

**Starter Kit 1.15+ with its own automation engine**: when **Run automation rules** is on in the
Starter Kit, the Starter Kit stamps those dates itself, from the editor, scripts and other
plugins, not only from this board. This plugin then stops generating its mirrored stamping rules
(existing `sk-stamp:*` rules are dropped on the next sync). Each rule has one executor, so no
date is written twice. Your own rules here keep running on board writes as before.

## Creating notes (quick capture)

**Configure board → Creating notes**, per note type. It drives the **Add card** button in each
column (see the [usage guide]({{ '/usage.html#creating-cards-from-the-board-quick-capture' | relative_url }})).

Every field is **empty = inherit**, so a Starter Kit note type usually needs nothing here:

| Setting                             | Empty falls back to                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Target folder**                   | The Starter Kit type's associated folder → the folder the Base filters on → Obsidian's default new-note folder |
| **Template**                        | The Starter Kit type's template → the template your Templater folder/file rules resolve → none                 |
| **Name prefix** / **Name suffix**   | The Starter Kit type's note name prefix / suffix, unless the Starter Kit marks it optional                     |
| **Open the note after creating it** | On                                                                                                             |

The folder and the name prefix/suffix accept `{{year}}`, `{{month}}`, `{{week}}`, `{{quarter}}`,
`{{day}}`, `{{date}}`, `{{datetime}}`, `{{uuid}}`.

When the Starter Kit (1.22 and later) marks a type's name prefix or suffix as **optional**, it
isn't inherited: notes created from the board get the bare name, and the field shows
**None (optional in the Starter Kit)**. Type a value here if you still want this board to
decorate the notes it creates; your value always wins. Cards keep
[stripping](#filtering-the-note-types-name-decoration) an optional affix from notes that carry it.

Prefixes and suffixes keep their spaces (` (Task)` isn't the same as `(Task)`), because the
Starter Kit recognizes note types by that exact spelling. They're never added twice.

The template is applied **before** the card's status, swimlane value, tags, and order are
written, so the column you clicked always wins over a status the template asks for.

## Automation rules

Per note type, **Configure board → Automations** defines rules of the form "when this
happens to a note, do that". Each rule has a trigger and a list of actions that run in order:

**Triggers**

- **Enters a status** / **Leaves a status**: toggle any of the type's status values. The rule
  fires when a note moves into (or out of) one of them, whether by drag, the card menu, the WBS
  status dot, a pane drop, a bulk edit, or triage. It fires once per actual transition, so
  dropping a card back on its own column does nothing.
- **Enters a done state**: fires when the note moves from a non-done value into any of the
  type's done values (see [Done state](#done-state)). Completed, Abandoned, Superseded: one rule
  covers them all, and moving between two done states doesn't fire it again.
- **Is archived**: fires just before the note moves to its archive folder (manual, bulk,
  or status-triggered), so property changes land on the archived note.
- **Property matches a condition**: `property = / ≠ / > / ≥ / < / ≤ value`, or `is set` /
  `is unset`. Numbers compare numerically, everything else as case-insensitive text (ISO
  dates sort correctly). The rule fires when the condition **becomes** true: editing
  `progress` from 40 to 100 fires a `progress ≥ 100` rule once, and nudging it from 100 to 110
  doesn't. Any edit source counts, typing in the editor included, as long as a board showing
  the note is open.

**Actions**

- **Set property**: the value supports the archive placeholders (`{{date}}`,
  `{{year}}`, `{{month}}`, `{{day}}`, `{{week}}`, `{{quarter}}`, `{{datetime}}`,
  `{{uuid}}`); plain numbers and `true`/`false` are written as numbers and booleans. The
  **only if empty** toggle skips the write when the property already has a value. Use it for
  date stamps (`date_completed` = `{{date}}`), so a date set by hand wins.
- **Remove property**: deletes the property (e.g. clear `date_due` when a task is done).
- **Add tag / Remove tag**: edits the frontmatter `tags` list (case-insensitive, `#`
  optional).
- **Move to folder**: the same placeholder-driven move archiving uses. Folders are
  created on demand, a name collision refuses the move (logged), and links are preserved.

Automation writes never trigger other automation rules (no cascades). When a transition both
auto-archives the note and matches rules, the property and tag actions run first and the
archive decides the final folder; move actions on that rule are skipped. With an
[archive grace period](#archive-grace-period), the transition doesn't archive. A rule that
stamps a done-date property (e.g. `date_completed` = `{{date}}`) gives the later sweep its
date, and the plugin stamps one itself when no rule did.

## Card title

The card heading is the **note name** by default. Per board, **Configure view → Cards →
Title property** picks a property (or base formula) to show as the heading instead. Handy when
file names are IDs or date-prefixed slugs and a `title`/`name` property holds the readable
label. A card whose note is missing the property (or has it empty) falls back to the note name.
The chosen property isn't repeated as a body field, and clicking the card still opens the note.

| Setting            | Scope     | Default   | What it does                                                            |
| ------------------ | --------- | --------- | ----------------------------------------------------------------------- |
| **Title property** | Per board | Note name | Shows this property's value as the card heading, in board and calendar. |

## Card cover

Per board, **Configure view → Cards → Cover property** picks a property (or base formula) whose
value shows as an image at the top of each card. Empty (the default) means no covers. The
value can be:

- an `http(s)` URL, shown as is;
- a `[[wikilink]]` or `![[embed]]` to an image in your vault, resolved like any link from the
  card's note;
- a Markdown image (`![](https://…)`);
- a plain vault path (`Attachments/Cover.jpg`), or a bare file name;
- a base formula built with `image()`, `link()` or `file()`, e.g. `image(cover)`.

Anything else, or a link that doesn't resolve, shows no cover. A list property (or a formula that
returns a list) uses its first usable item. A base formula is the easiest way to prefer a local
file and fall back to a URL, e.g. `if(local_cover && file(local_cover), file(local_cover).path, cover)`.
In compact mode (titles only), the cover shrinks to a small thumbnail before the title, with the
same aspect ratio and fit.

Two more options shape the cover, as in the core Cards view:

- **Cover fit**: **Crop to fill** (the default) fills the box and trims the edges. **Show the
  whole image** fits the entire image in the box, with bars on the sides or top and bottom.
- **Cover aspect ratio**: **Banner** (the default) is a fixed-height strip across the top of the
  card. **16:9**, **3:2**, **4:3**, **1:1**, **3:4** and **2:3 (poster)** give the box that
  shape, scaled to the column width. Pick **2:3** for movie posters, book covers and comics,
  **3:4** for game box art, **1:1** for album art.

![A movie board with whole 2:3 posters as covers]({{ '/images/card-covers.png' | relative_url }})

![A compact board game board: each cover becomes a thumbnail before the title]({{ '/images/card-cover-thumbnails.png' | relative_url }})

The box gets its size before the image loads, so cards don't jump around while images come in,
and images of different sizes all get the same box. Images load as you scroll: only the covers
near the visible part of each column are fetched, and the box pulses softly until its image
arrives. A board with thousands of covers opens without loading all of them. On very wide
columns, the box stops growing at about half the screen height.

![Cover boxes keep their size and pulse while their posters load]({{ '/images/cover-placeholders.png' | relative_url }})

| Setting                | Scope     | Default      | What it does                                                           |
| ---------------------- | --------- | ------------ | ---------------------------------------------------------------------- |
| **Cover property**     | Per board | None         | Shows this property's image at the top of cards.                       |
| **Cover fit**          | Per board | Crop to fill | Crop the image to fill the box, or show the whole image.               |
| **Cover aspect ratio** | Per board | Banner       | Shape of the cover box: a fixed-height banner or a width:height ratio. |

## Card color

Per board, **Configure view → Cards → Card color property** colors each card by a property (or
base formula), separately from the column colors. For example, color the cards by priority while
the columns stay statuses. Empty (the default) means no card colors.

The color comes from the card's value:

1. A value that is a color is used as is: `#e5484d`, `rgb(…)`, `hsl(…)` or a color name such as
   `red` or `teal`. `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple` and `pink`
   use your theme's shade of that color. This lets a base formula pick the color, e.g.
   `if(priority == "10 - High", "red", "blue")`.
2. A ranked value such as `10 - High` / `20 - Medium` / `30 - Low` gets the same warm-to-cool
   color as its field on the card (red for the top rank, gray for the bottom).
3. Any other value gets a color from your theme's palette. A given value always gets the same
   color, so all cards of one project or context match. `[[Project A]]` and
   `[[Project A|A]]` count as the same value.

A list property uses its first value. A card without a value keeps the normal look.

![A task board tinted by priority, with a stripe per project]({{ '/images/card-colors.png' | relative_url }})

**Card color style** sets how the color shows:

- **Tinted background** (the default): a light wash of the color behind the card. The text
  stays readable in light and dark themes.
- **Colored border**: the card's top, right and bottom edges take the color.

The card color never hides the other signals. The left edge stays the column color, or red
for a blocked card. Overdue and due-today cards keep their red or amber background; with a
tinted background, their card color moves to the border instead. Deferred cards stay faded, and
the selection highlight still wins. Card colors only show on board cards, not in calendar,
timeline or triage.

| Setting                 | Scope     | Default           | What it does                                             |
| ----------------------- | --------- | ----------------- | -------------------------------------------------------- |
| **Card color property** | Per board | None              | Colors each card by this property's value.               |
| **Card color style**    | Per board | Tinted background | Show the color as a background tint or as a card border. |

## Card accent

A lighter marker than the card color. Per board, **Configure view → Cards → Accent property**
marks each card with a colored stripe or dot from a property (or base formula). It's separate
from the card color, so a board can tint cards by priority and mark them by project. Empty (the
default) means no accents.

The color is picked exactly like the [card color](#card-color): a color value as is, a ranked
value like its field, any other value a stable palette color. A list property uses its first
value, and a card without a value has no accent.

**Accent style** sets the shape:

- **Stripe on the left edge** (the default): a thin bar just inside the card's left edge.
- **Dot before the title**: a small colored dot in front of the card title.

Both stay visible in compact mode. The stripe sits just inside the card's left edge, not on
it: the edge itself keeps the column color, or red for a blocked card, so a blocked card is
still easy to spot on a board striped by project.

| Setting             | Scope     | Default                 | What it does                                          |
| ------------------- | --------- | ----------------------- | ----------------------------------------------------- |
| **Accent property** | Per board | None                    | Marks each card with this property's color.           |
| **Accent style**    | Per board | Stripe on the left edge | Show the accent as a stripe or as a dot by the title. |

### Filtering the note type's name decoration

Note types decorate file names so recognition rules can key off them: the Obsidian Starter
Kit writes ` (Task)`, ` (Project)`, `AI Wiki - `. On a board where every card is already the
same type, that decoration is noise, so cards show **Ship the plugin**, not
**Ship the plugin (Task)**.

**Configure board → Card titles**, per note type:

| Setting                   | Default | What it does                                                        |
| ------------------------- | ------- | ------------------------------------------------------------------- |
| **Strip the name prefix** | On      | Removes the type's name prefix from card titles, optional or not.   |
| **Strip the name suffix** | On      | Removes the type's name suffix from card titles, optional or not.   |
| **Extra prefixes**        | Empty   | More prefixes to remove, one per line (a `Draft - ` convention, …). |
| **Extra suffixes**        | Empty   | More suffixes to remove, one per line.                              |

Both toggles are **on by default for every note type**, including types configured before
this setting existed. Turn one off to see the full file name on cards again.

What gets stripped is the type's **Name prefix / Name suffix**
([Creating notes](#creating-notes-quick-capture)) when you set one there, otherwise the
Starter Kit type's own prefix/suffix. Each side is stripped at most once, and only at the very
start or end of the title. Leading and trailing spaces count, so list ` (Draft)`, not
`(Draft)`. Extras accept the same `{{year}}`, `{{date}}`, … placeholders as note creation, and
match any value they can produce (`{{date}} - ` strips `2026-09-22 - `).

An affix the Starter Kit marks as **optional** is still stripped, and the setting shows
`(optional in the Starter Kit)` next to it. Optional only decides what note
[creation](#creating-notes-quick-capture) ADDS, so older notes that carry the affix and newer
ones without it look the same on the board.

This is **presentational only**, and it applies in every view mode (board, calendar, timeline,
triage, WBS, agenda, ideal week). File names, search, links, and every write path keep the
full name. A note whose entire name is decoration keeps its name instead of showing a blank
card.

## Due countdown

A card can show a compact **countdown to its due date** (`Today`, `In 3d`, `2d overdue`,
`in 2w`, `in 3mo`; the unit scales automatically from days to weeks to months), color-coded by urgency
(red overdue, amber today, orange soon, muted further out). By default it counts down to the
**Due date** property, the same one the overdue emphasis uses; **Countdown counts down to** can
switch a board to the scheduled date.

| Setting                         | Scope     | Default             | What it does                                                                                                       |
| ------------------------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Show due countdown**          | Per board | Off                 | Turns the badge on for this board (**Configure view → Cards**).                                                    |
| **Countdown counts down to**    | Per board | Deadline (due date) | Count down to the due date or to the scheduled date (**Configure view → Cards**).                                  |
| **Due countdown position**      | Global    | Title row           | Where the badge sits: **Title row** (right-aligned pill), **Field chip**, **Top-right corner**, or **Footer row**. |
| **Due "soon" threshold (days)** | Global    | `7`                 | Within how many days the badge turns warm (orange). Changes the **color**, not whether the badge shows.            |
