---
title: Usage
nav_order: 2
---

# Usage

## Add a Kanban view to a Base

1. Open a **Base** (or create one).
2. Add a new view and choose **Kanban** from the view-type picker.
3. The Base's filters decide which notes appear; each note becomes a card.

You can add several Kanban views to the same Base — each is independent.

## Columns from status

Cards are placed by a **status property** (the plugin looks for a property named `status`
first, then any property whose name contains `status`; you can override it per view).

The **columns themselves are defined explicitly** — they are not guessed from the values in
your notes (so a typo never creates a stray column). A board takes its columns, in order of
preference, from:

1. the **Statuses (columns)** list in the view settings, or
2. the note type's allowed status values from the **Obsidian Starter Kit** (if installed), or
3. the **Default statuses** list in the plugin settings.

If none are defined, every card sits in the **Unmapped** column — that's the starting point
until you define your statuses.

- Values can carry a numeric prefix to control order: `10 Todo`, `20 Doing`, `30 Done` show
  in that order, and the number is hidden on the column header.
- Notes whose status isn't one of the defined columns gather in **Unmapped** (shown first by
  default; hidden when empty).
- **Collapse a column** with the chevron in its header: it shrinks to a slim labelled bar so you
  can focus on the rest. Collapsing applies to that status across **every** swimlane; click the
  chevron again to expand.

## Moving and reordering cards

- **Drag a card to another column** to change its status (the status property is rewritten).
- **Drag a card within a column** to reorder it; the new position is saved to a
  `manual_order` property on the note.
- **Drag a card to the Unmapped column** to clear its status.
- **Drag a column header left/right** to reorder the columns. The new order is saved to _this
  board_ (the per-view status list) and takes precedence over the default order. The Unmapped
  column stays put (its side is set by the **Unmapped column position** option).

Manual ordering is stored in your notes (not in plugin data), so it travels with the vault.

**Auto-sort a column by a property.** Instead of hand-curated manual order, a board can sort the
cards inside every column by **name** or by any **property** (priority, due date, created, …),
ascending or descending — set **Card sort**, **Card sort property**, and **Card sort direction** in
**Configure view → Columns**. Missing values sort last. While a non-manual sort is active, dragging
a card within a column (and the keyboard reorder) is turned off — sorting owns the order — but you
can still drag between columns to change status. Switch **Card sort** back to **Manual order** to
restore your saved `manual_order` and re-enable reordering.

## Filtering (search bar)

The **filter box** in the toolbar (right after the **Board / Calendar** buttons) narrows the
visible cards as you type — in **both** board and calendar mode. It supports a compact,
Jira-like query language; the count of matches shows next to the box, and the **×** (or **Esc**)
clears it. Your filter is **saved with the view**, so it persists when you reopen the board.
Click the **?** for an in-app cheat-sheet.

**Basics**

- **Words = AND.** `book project` matches cards containing both.
- **`OR` (or `|`) between groups.** `book OR plan`. AND binds tighter than OR, so
  `book project OR goal` means `(book AND project) OR goal`.
- **`-` or `NOT` excludes.** `project -status:done`.
- A plain word searches the **title, related note names, tags, and every frontmatter
  property value** (not the note body).

**`property:value` qualifiers**

- Quote values with spaces: `parent:"PKM Library"`.
- **Comma = OR** within one property: `status:active,done`.
- Recognized names: `title`, `status` (matches the value or its column label), `parent`,
  `child`, `sibling`, `blocked`, `tag`, `due`, **or any frontmatter property** (e.g.
  `urgency:now`, `effort:large`) — even properties not shown on the card.

**`due:` dates**

- Keywords: `due:today`, `due:overdue`, `due:none`, and `due:week` / `due:month` /
  `due:quarter` / `due:year` (the calendar period containing today).
- Comparisons: `due:>2026-01-01`, `due:<2026-01-01`, `due:>=…`, `due:<=…`, or an exact day
  `due:2026-01-15`.

Example: `book parent:"PKM" status:active OR due:overdue`.

## Triage mode

When a backlog feels overwhelming, **Triage** mode replaces the board with a **focused, one-card-
at-a-time queue** so you clarify items in short passes instead of facing the whole wall at once.
Switch to it with the **Triage** button next to **Board** / **Calendar** (or the **Toggle triage
mode** command).

Each card shows:

- **Read-only context** on top — the properties you chose to see, **including base formulas** (e.g.
  a `priority_score` or a horizon formula), so you decide with the computed values in view.
- **One-click editable controls** — each editable enum property (priority, urgency, effort, …)
  as a row of its allowed values; click one to set it. The **selected value is highlighted**, and a
  property that's been **handled** (a real value, no longer needing triage) gets a **✓ check** by its
  name so you can see at a glance what's left; properties that still need a value are flagged
  **• needs value**. (Allowed values come from the **Enums** config / Starter Kit — see
  Card content → enums.)
- **Skip** / **Next** to move through the queue, with a **remaining count**. Setting a value does
  **not** auto-advance, so you can see the recomputed score before moving on.

**Three scopes**, switched in the header (the active one is highlighted):

- **Needs clarification** — only cards with an **unset** gating property; a card leaves the queue
  once it's complete. A property counts as unset when it's **empty/absent**, matches one of your
  **needs-triage values** (e.g. `TBD`, `No Target`), or — when its allowed values are known — holds
  a value that **isn't one of them** (stale/invalid).
- **All cards** — every card, **worst-first** (most unset properties first), for a re-prioritization
  pass even when nothing is strictly missing.
- **Due for review** — cards whose **review is overdue**, most-overdue first (see **Reviews** below).
  Here the action button is **Reviewed**, which stamps the review fields and advances.

Configure triage with the **gear** in the triage header (or the **Configure triage** command),
which opens a dialog with proper **property pickers** — type to search, click to add, and each
selection shows as a removable chip:

- **Editable properties** — the enum props triage lets you set, picked from your **note types'**
  properties (the Starter Kit definitions, or the properties you've given allowed values).
- **Gating properties** — what decides "unclarified"; leave empty to use the editable set.
- **Context properties** — read-only info to show; here you can also pick the base's **formulas**
  (e.g. `priority_score`); leave empty to use the view's displayed properties.
- **Needs-triage values** — values that count as unset (e.g. `TBD`), added as free-text chips.
- **Scope** — the default scope (also switchable live in the header).

Everything is saved **per view** (in the `.base`), so each board has its own triage setup. (The
**Triage scope** also appears in the standard **Configure view** panel for quick access.)

On a **mixed-type** board (e.g. an "All actions" board of goals + plans + projects + tasks) triage
and review keep working, resolving each card against **its own note type**:

- Editable controls and their values come from the card's type — a control only appears for a card
  whose type defines that property.
- **Gating is type-aware**: a gating property only flags a card when that card's type actually
  defines it. So a task-only property (e.g. `time_estimate`) never marks goals/plans/projects as
  needing a value, and vice-versa. (This is why a board of _shared_ planning properties like
  priority/urgency/effort triages cleanly across every type.)
- Review uses the global review properties, so it's the same on every card regardless of type.

### Reviews (spaced repetition)

The **Due for review** triage scope turns the queue into a periodic review ritual so the backlog
never silently rots. It uses three note properties:

- **last reviewed** (a date) — when you last reviewed the note,
- **review interval** (a number of days) — how often it should be reviewed,
- **review count** (a number) — how many times it's been reviewed.

A card is **due** when `last reviewed + review interval` is on or before today, or when it was
**never reviewed** (which sorts first). The queue is ordered **most-overdue first**, and each card
shows its review status (last reviewed, count, how overdue) on top. Clicking **Reviewed** sets
**last reviewed = today** and **increments review count**, then advances — so the card drops out
until it's next due. You can still adjust the enum values while reviewing.

The property names are **configurable** in **Settings → Community plugins → Kanban Action Planner**
under **Review (triage)** — they default to `last_reviewed`, `review_interval`, and `review_count`.
A **Default review interval (days)** (default **30**) is used for notes that don't set their own
interval. Review works on **any** Kanban view via the scope switch — no per-view setup needed.

## Swimlanes (grouping)

Split the board into horizontal **lanes**, each with its own columns. Choose how to group in the
note type's **Swimlanes** section (**Settings → Note types**), or override it per view — see View
options:

- **None** — a single plain board (the default).
- **By note type** — one lane per note type (requires the Obsidian Starter Kit to recognize
  types; without it, everything stays in one plain board).
- **By property** — one lane per distinct value of a property you choose (e.g. a `project` or
  `area`). Lanes order by a numeric prefix just like columns (`10 Alpha`, `20 Beta`).

Cards with no value for the grouping property collect in an **Ungrouped** lane, which is
hidden when empty. Each lane header has a **chevron toggle** to collapse it, plus its card count.

Each lane is **as tall as it needs to be, up to one screen**: a lane with a few cards stays
short, while a full lane stops at the screen height and its columns scroll inside it (so the
lanes don't push each other off-screen). When there's more than one lane, **up/down buttons**
appear next to the gear to jump to the previous/next lane.

- **Drag a card to another lane** to reassign it: for property grouping, the grouping property
  is rewritten to the target lane's value (or cleared when dropping into Ungrouped). You can
  cross lanes and columns in one drag — both the lane property and the status update.
- Note-type lanes can't be reassigned by dragging (a note's type comes from its tags/folder),
  so a cross-lane drop there is ignored; moving within the lane still works.

On small screens lanes stack and collapse, so you can focus on one lane at a time.

## Relationships

Cards can show how notes relate. The plugin reads link-properties (frontmatter holding
wikilinks) for four roles — **parent**, **sibling**, **child**, and **blocked by** — and
detects the **inverse** automatically (if A lists B as a child, B shows A as a parent; siblings
are mutual). Configure which property feeds each role in the note type's **Relationships** section
(**Settings → Note types**).
You can also detect children by tag: a note carrying one of the chosen tags that links back to
a card is treated as its child.

On each card:

- A small badge row shows one **counted** badge per role (**▲** parents, **▼** children, **↔**
  siblings) — so a note with three children shows **▼ 3**, and hovering lists the names.
  **Click a badge** to open the related note; when there are several, you get a menu to pick
  one. **Ctrl/Cmd-click** (on the badge or a menu item) opens in a new tab.
- A note with a non-empty **blocked by** gets a red **⛔** badge (counted the same way — **⛔ 2**
  when blocked by two) and a red edge. Click it to jump to the blocker, or pick from the menu
  when there are several (Ctrl/Cmd-click for a new tab). Blocking never changes a card's status
  automatically.
- The card's right-click menu also lists related notes to open.
- **Edit relationships from the board.** The right-click menu's **Relationships** submenu lets you
  **Add** a parent/sibling/child/blocked-by (pick a note from the fuzzy list) or **Remove** one. This
  writes the link to the note's frontmatter property for that role — so it shows up everywhere, and
  the blocked badge/filter update live. You can only add a role that has a property configured (a
  role set to **None** has nowhere to store the link), and you can only remove links stored **on this
  note** (a relationship the plugin _infers_ — e.g. a child shown because the other note names this
  one as its parent — is edited from that other note).

**Blockers can live on another board; archiving a blocker clears it.** A blocker counts wherever it
lives — a **task** blocked by a **project** stays blocked even though the project sits on a different
board. A blocker stops counting only when it's **archived** (moved into a note type's archive
folder): the **⛔** count drops, and the card unblocks once its last non-archived blocker is gone.
(Parent/sibling/child badges aren't affected by archiving.) Edits apply **live** — change or remove a
`blocked by` link, or archive a blocker, and the board updates without a reload.

Use the **Blocked cards** view option to **show all**, show **only blocked**, or **hide
blocked** cards.

## Archiving

When you're done with a card, you can **archive** its note — move it out of the board into a
dedicated folder while keeping all links intact.

**Archiving is per note type.** Each note type has its own archive folder, set in its
**Archiving** section under **Settings → Note types** — so on a board mixing e.g. Tasks and
Projects, each card is archived to the folder that belongs to _its_ type (`Archive/Tasks/{{year}}`
vs `Archive/Projects/{{year}}`). A card whose type has no folder set simply can't be archived (the
menu item is hidden).

Set this up in each type's **Archiving** section:

- **Archive folder** — where archived notes go. Start typing and **existing folders
  autocomplete**; any `{{…}}` placeholder you've added is kept. The path supports placeholders
  that resolve at archive time: `{{year}}`, `{{month}}`, `{{week}}`, `{{quarter}}`, `{{day}}`,
  `{{date}}`, `{{datetime}}`, `{{uuid}}` — e.g. `Archive/{{year}}` files into `Archive/2026`.
  Leave it blank to disable archiving. Intermediate folders are created automatically, and a name
  clash is resolved with a numeric suffix (`Task 1.md`) so nothing is ever overwritten.
- **Auto-archive on status** — optional and off by default. Tick **one or more** statuses and a
  card is archived automatically the moment it **transitions into** any of them (by drag or
  menu). Reordering a card that's already in such a status does nothing — only the transition
  triggers it.

To archive manually, **right-click a card → Archive** (only shown when an archive folder is
set). If the note still has active children or blockers you get a non-blocking heads-up — the
move proceeds and the wikilinks are preserved. Archived notes leave the board because they no
longer match the Base's filter.

## Calendar mode

Turn the board into a **scheduling calendar**. Use the **Board / Calendar** switch at the
top-left of the view to flip between the two modes (it persists per view). The view splits into a
left **Scheduling** panel and a calendar on the right.

**The calendar shows both dimensions at once.** Every card is plotted on **both** its
**scheduled date** (`date_scheduled` by default) and its **deadline** (`date_due`), so you can
see what's planned _and_ what's due in one view. Chips are color-coded by their left edge:

- **Blue** — a scheduled date (when you plan to work on it).
- **Orange** — a deadline.
- **Split blue/orange** — both fall on the same day.
- **Red** — an overdue deadline (its day is already in the past).

A card with a scheduled date _and_ a deadline therefore appears twice — once on each day — so a
task planned for Monday and due Friday shows up on both. Use the **legend** in the calendar
toolbar (`◼ Scheduled  ◼ Deadlines`) as a filter: click either swatch to hide/show that
dimension (both on by default).

The panel's two tabs are **backlogs** — cards still missing a date — and they decide which date
a _panel drag_ sets:

- **Unplanned** — cards with no scheduled date.
- **No deadline** — cards with no deadline.

Each tab count is the size of that backlog. Collapse the panel with the **«** toggle (the
"Scheduling" title stays visible, turned vertical). When the calendar gets too narrow — for
example in a split pane — the panel **collapses automatically** and re-opens when there's room
again; your own manual collapse/expand always takes precedence.

The calendar toolbar switches range — **Day**, **Week**, **Month**, **Quarter**, **Year** — and
navigates with **‹ / › / Today**. Quarter and year show compact month grids with a per-day
count. Click any card to open its note. Weeks start on the day set by **First day of the week**
in the plugin settings (default Monday).

**Day view / zoom into a day:** click **Day** in the range switcher to open today as a focused
single-day view, or click any **day number** (or empty cell space) to zoom into that specific
day — grid days show a pointer (hand) cursor to signal they're clickable. The day view lists all of that day's cards and has its own **‹ / Today / ›** day navigation
(plus **‹ Back** to return to the previous range). This is especially handy from Quarter/Year,
where days only show a count: click one to see what's on it. You can still drag a card from the
panel onto the focused day to schedule it, or drag one out to the panel to clear its date.

**Schedule by dragging:**

- **Drag a chip on the calendar onto another day** to move _its own_ date — a blue chip
  reschedules, an orange chip moves the deadline, a split chip moves both together (written in
  your configured date format, `YYYY-MM-DD` by default).
- **Drag a card from the panel onto a day** to set the date for the active backlog tab
  (Unplanned → scheduled date, No deadline → deadline).
- **Drag a chip back onto the panel** to clear the date it represents.

**Schedule from the right-click menu (any card, board or calendar).** Right-click a card for
**Schedule for today / tomorrow / on a date… / Clear scheduled date** and the same for
**Set deadline**. "On a date…" opens a small date picker. This is the quickest way to set or
change a date without dragging — and it works on the board too, not just the calendar.

**Sort the panel** (view options): order the cards by **Manual order**, **Name**, or **a
property** (e.g. a priority or estimate). To narrow the panel, use the toolbar
[filter box](#filtering-search-bar) — it applies to the calendar and its panel together.

## Keyboard

Cards are fully keyboard-operable. **Tab** to a card, then:

- **Enter / Space** — open the note (**Ctrl/Cmd** for a new tab).
- **Ctrl/Cmd + ← / →** — move the card to the previous/next column (changes its status).
- **Alt + ↑ / ↓** — reorder the card up/down within its column.
- **Menu key** (or **Shift + F10**) — open the card's context menu.

Focus follows the card after it moves, so you can keep going. (See also the command palette
commands above, which are hotkey-bindable.)

## Multi-select & bulk actions

Press the **Select** button (the checklist icon next to the gear) to enter **select mode**:

- **Click** cards to select/deselect them; **Shift-click** selects a range.
- An action bar shows how many are selected, with bulk actions: **Set status** (pick a column,
  or clear), **Archive**, **Open** (each in a new tab), and **Clear**.
- Press **Select** again to leave select mode.

Bulk writes are applied to each note and a summary notice reports how many succeeded (and any
that were skipped or failed). Bulk **Set status** changes only the status — it doesn't trigger
auto-archive, so you never mass-archive by accident.

## Other interactions

- **Hover a card to preview its note** — Obsidian's native page-preview popover, the same as
  hovering a link. By default it's **Ctrl/Cmd-gated** (hold the key while hovering); change that
  under **Settings → Core plugins → Page preview** (the source is listed as "Kanban Action Planner").
- **Click** a card to open the note; **Ctrl/Cmd-click** opens it in a new tab.
- **Right-click** (or long-press on touch) a card for a menu: open the note (or in a new
  tab), set its status, clear the status, **set an enum property** (see below), schedule it /
  set a deadline, **archive** the note, open or edit a related note.
- **Set a property in one click.** For any property with known allowed values, the card menu
  shows a **Set <property>** submenu (e.g. **Set priority → 10 - Top**) with the current value
  checked and a **Clear** option — just like **Set status**, but for `priority`, `urgency`,
  `effort`, and any other enum. Allowed values are detected from the **Obsidian Starter Kit**
  when present, or defined per note type under **Configure board → Enums** (see below). The note
  is written and the board updates immediately.

## Remembered view state

Each Kanban view remembers how you left it, **per view**, across reloads and reopening Obsidian:

- Board vs **Calendar** mode, and the calendar **range** (Week/Month/Quarter/Year), **active
  tab**, **panel collapsed** state, and the **Scheduled/Deadlines** legend toggles.
- **Collapsed swimlanes** and **collapsed columns**.
- The toolbar **filter** query.

Two calendar bits are deliberately **not** remembered — they reset every time you reopen the
view: the **anchor** (the calendar jumps back to today) and the **focused day** zoom (cleared).

## View options (Configure view)

Open the view's options (the Bases **Configure view** panel) to tune **this board** without
changing your notes. They're grouped:

**Columns**

- **Status property** — choose which property drives the columns (overrides auto-detection).
- **Statuses (columns)** — the list of status values to show as columns, in order (one per
  entry). This is the per-view column definition.
- **Manual order property** — choose where card order is stored.
- **Card sort** — how cards are ordered inside each column: **Manual order** (default, drag to
  arrange), **Name (A–Z)**, or **By property**. **Card sort property** picks the property for the
  last option, and **Card sort direction** sets ascending/descending. A non-manual sort disables
  in-column drag/keyboard reorder (missing values sort last). The sort property can be a **base
  formula** (e.g. a `priority_score` you define in the base's formulas) — pick a `formula.…` (or
  `file.…`) entry to sort by a computed value. Same for **Grouping property** below.
- **Show empty columns** — keep columns with no cards visible (useful when columns come from a
  note type's defined statuses).
- **Unmapped column position** — show the Unmapped column first (left, the default) or last
  (right). It still only appears when something is unmapped.

**Swimlanes**

- **Grouping** — override lane grouping for this view: **Use note type default**, **None**,
  **By note type**, or **By property**. (The default is set per note type in Settings.)
- **Grouping property** — when grouping **By property**, the property whose values become lanes.
  This can also be a **base formula** (`formula.…`) or `file.…` column — grouping by a computed
  column is **read-only**, so cross-lane drag is disabled for those lanes (there's no property to
  write back).

**Filters**

- **Blocked cards** — show all cards, only blocked ones, or hide blocked ones.

**Calendar**

- **Default range** — Week, Month, Quarter, or Year.
- **Scheduling panel sort / sort property** — order the panel's tab cards (narrowing is done
  with the toolbar filter box).

(Calendar mode itself is toggled by the in-view **Board / Calendar** switch; the scheduled/due
date **property names** are set globally in plugin settings.)

## Note type configuration (colors, enums, relationships, archiving)

A note type's shared config lives **centrally** in **Settings → Community plugins → Kanban
Action Planner → Note types**. Pick a type and click **Configure** to open a dialog with sections
on the left — **Colors**, **Enums**, **WIP limits**, **Swimlanes**, **Relationships**,
**Archiving** — that apply to **every** board showing that type. The **gear** in the board's
top-right is a shortcut that jumps straight to these settings. (What each card _shows_ is set per
view via the Bases **Properties** selection — see **Card content** above.)

**Define your own note types — no Starter Kit needed.** Click **Add note type** to create a
**local** type. Its **Note type** section lets you name it and add **recognition rules**: a note
is recognized as this type when **any** rule matches — by **tag** (including nested tags, so
`type` matches `type/task`), by **folder** (the note is in that folder or a subfolder), or by a
**regex** on the note path. Recognized notes then pick up that type's colors,
relationships, and archiving, and can drive **By note type** swimlanes — all without the Obsidian
Starter Kit. Delete a local type with the trash icon (your notes are untouched). When the Starter
Kit _is_ installed, its recognition is tried first and your local rules act as a fallback.

In the **WIP limits** section, set a soft per-column limit for any status (leave blank for no
limit). The column header then shows **`count / limit`**, and a column over its limit turns its
count **red** — a gentle nudge toward classic Kanban flow. Limits are a warning only: they
**never block** moving a card into a full column.

In the **Colors** section:

- Toggle **Auto-assign colors** to give each status a palette color automatically.
- Per status, pick a palette color, choose **Custom…** and use the color picker, or pick
  **Auto** to reset.

Card accents and column shades follow the status color and adapt to your light/dark theme.

In the **Enums** section, define the **allowed values** for any property (e.g. `priority`,
`urgency`, `effort`) — one per line, in order. These power the card menu's **Set <property>**
quick-set and the triage flow. When the **Obsidian Starter Kit** is installed, a type's enum
properties are detected automatically and listed as a hint; entries here **override** them and
are the only source for **local** note types. Leave a property out to fall back to the Starter
Kit (or to a free-text value when neither knows it).

## Card content

Cards show **the properties you've added to the view** — the same **Properties** selection you
set with the Bases toolbar (the **Properties** menu / "Configure view"). Each property in that
list (other than the note name, which is the card heading) renders as a labelled field on the
card, in the order you arranged them. This works for ordinary note properties **and base
formulas** (a `formula.…` column like a `priority_score`) and file columns (`file.…`), so a
computed value shows on the card with no extra setup. The field label is the property's display
name from the base. Empty/unset values are skipped. Add, remove, or reorder card fields the same
way you would for any Bases view — change the view's properties and every card updates.

Field rendering is tuned for **scanning the whole board at a glance**:

- **Enum values are color-coded** by where they rank — a warm (red/orange) signal for the
  top/most-urgent values down to cool (blue/muted) for the bottom ones — so the board reads at a
  glance. Ranking uses the numeric `NN -` prefix, so it doesn't matter what order the allowed
  values come in; a `99 - …` "not decided" value lands coolest. Note properties rank against their
  allowed values; **base-formula** values rank against the distinct values present on the board.
  A value with no rankable scale stays neutral.
- The **`NN -` sort prefix is stripped** from display — `30 - High` shows as **High**,
  `99 - ⏰ No Target` as **⏰ No Target**. (Dates like `2026-01-15` are never touched.)
- A **numeric formula** value (e.g. a `priority_score`) is the standout **score**.
- A **percentage** field (display name contains `%` or "progress", numeric value) renders as a
  small **progress bar** with a `%` caption.
- Labels stay legible (different properties can share a value set, e.g. priority vs priority
  override both reading `High`), so the label still tells them apart.

**Choose the chip style** in **Settings → Community plugins → Kanban Action Planner → Card chip
style** (applies to every board):

- **Minimal** _(default)_ — no fills: a faint label + a heat-colored value, laid out as a clean
  vertical stat list. The calmest, most consistent look.
- **Tinted** — each value is a flat color-filled pill, so the board reads like a heatmap.
- **Rail** — uniform neutral pills, each with a colored left edge for the heat signal.

A note's **due date** is always shown in red when set, regardless of which properties you've
added.

**Overdue emphasis.** Cards with a past due date get a red background wash so overdue work pops
at a glance, and cards due **today** get a softer amber wash. This uses the card background, so
it stays distinct from a blocked card's red **left edge** — a card that is both blocked and
overdue shows both signals. The state updates whenever the board refreshes (e.g. as the date
rolls over).

**Due countdown.** Turn on **Show due countdown** in a board's view options (**Configure view →
Cards**) to add a compact badge that says **how soon** a card is due — `today`, `in 3d`,
`2d overdue`, `in 2w`, `in 3mo` (the unit scales automatically: days, then weeks, then months).
The badge is color-coded by urgency: **red** overdue, **amber** today, **orange** soon, and a
**muted** tone further out. The toggle is **per board** (off by default), reusing the same due
date the red emphasis uses.

Two global settings (**Settings → Community plugins → Kanban Action Planner**) tune it for every
board:

- **Due countdown position** — where the badge sits: **Title row** _(default)_ a right-aligned
  pill on the title, **Field chip** among the bottom chips, **Top-right corner** a pill in the
  card corner, or **Footer row** a strip at the bottom.
- **Due "soon" threshold (days)** — within how many days the badge turns warm (orange). Default
  **7**. This changes the **color**, not whether the badge shows.

The dialog also has **Swimlanes** (group the board into lanes) and **Archiving** (move
finished cards into a folder) sections — see Swimlanes and Archiving above.

## Obsidian Starter Kit integration

The [Obsidian Starter Kit](https://www.store.dsebastien.net/product/obsidian-starter-kit) is
**completely optional** — the plugin works fully without it; the two simply combine well. If
the Starter Kit plugin is installed, the board recognizes a note's type and uses that type's
**status property and allowed values** to build its columns — including empty columns in the
type's defined order. The Starter Kit stays the source of truth for that; your color choices
are saved locally and survive the Starter Kit being disabled. Without the Starter Kit, columns
come from the status values found in your notes.

## Command palette

A few commands act on the **currently focused** Kanban view (they do nothing when another view
is active, and each can be given a hotkey in **Settings → Hotkeys**):

- **Toggle board / calendar mode**
- **Focus filter** — jump to the filter box
- **Clear filter**
- **Go to next swimlane** / **Go to previous swimlane**

## Where it lives

Most of the experience is inside the Bases Kanban view itself. The plugin's settings tab holds
the global default property names used when a note or board doesn't override them.
