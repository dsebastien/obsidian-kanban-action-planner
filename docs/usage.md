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

## Moving and reordering cards

- **Drag a card to another column** to change its status (the status property is rewritten).
- **Drag a card within a column** to reorder it; the new position is saved to a
  `manual_order` property on the note.
- **Drag a card to the Unmapped column** to clear its status.

Ordering is stored in your notes (not in plugin data), so it travels with the vault.

## Swimlanes (grouping)

Split the board into horizontal **lanes**, each with its own columns. Choose how to group in
**Configure board → Swimlanes** (or override it per view — see View options):

- **None** — a single plain board (the default).
- **By note type** — one lane per note type (requires the Obsidian Starter Kit to recognize
  types; without it, everything stays in one plain board).
- **By property** — one lane per distinct value of a property you choose (e.g. a `project` or
  `area`). Lanes order by a numeric prefix just like columns (`10 Alpha`, `20 Beta`).

Cards with no value for the grouping property collect in an **Ungrouped** lane, which is
hidden when empty. Each lane header has a **▾/▸ toggle** to collapse it, plus its card count.

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
are mutual). Configure which property feeds each role in **Configure board → Relationships**.
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

Use the **Blocked cards** view option to **show all**, show **only blocked**, or **hide
blocked** cards.

## Archiving

When you're done with a card, you can **archive** its note — move it out of the board into a
dedicated folder while keeping all links intact.

Set this up in **Configure board → Archiving**:

- **Archive folder** — where archived notes go. The path supports placeholders that resolve at
  archive time: `{{year}}`, `{{month}}`, `{{week}}`, `{{quarter}}`, `{{day}}`, `{{date}}`,
  `{{datetime}}`, `{{uuid}}` — e.g. `Archive/{{year}}` files into `Archive/2026`. Leave it
  blank to disable archiving. Intermediate folders are created automatically, and a name clash
  is resolved with a numeric suffix (`Task 1.md`) so nothing is ever overwritten.
- **Auto-archive on status** — optional and off by default. Pick a status and a card is
  archived automatically the moment it **transitions into** that status (by drag or menu).
  Reordering a card that's already in that status does nothing — only the transition triggers
  it.

To archive manually, **right-click a card → Archive** (only shown when an archive folder is
set). If the note still has active children or blockers you get a non-blocking heads-up — the
move proceeds and the wikilinks are preserved. Archived notes leave the board because they no
longer match the Base's filter.

## Calendar mode

Turn the board into a **scheduling calendar**. Enable **Calendar mode** in the view options.
The view splits into a left **Scheduling** panel and a calendar on the right.

The panel has two tabs, and the active tab decides which date the calendar works with:

- **Unplanned** — cards with no **scheduled date** (`date_scheduled` by default). The calendar
  then shows cards on their scheduled date.
- **No deadline** — cards with no **due date** (`date_due` by default). The calendar shows
  cards on their due date.

Each tab count is the size of that backlog. Collapse the panel with the **«** toggle (the
"Scheduling" title stays visible, turned vertical).

The calendar toolbar switches range — **Day**, **Week**, **Month**, **Quarter**, **Year** — and
navigates with **‹ / › / Today**. Quarter and year show compact month grids with a per-day
count. Click any card to open its note. Weeks start on the day set by **First day of the week**
in the plugin settings (default Monday).

**Day view / zoom into a day:** click **Day** in the range switcher to open today as a focused
single-day view, or click any **day number** (or empty cell space) to zoom into that specific
day. The day view lists all of that day's cards and has its own **‹ / Today / ›** day navigation
(plus **‹ Back** to return to the previous range). This is especially handy from Quarter/Year,
where days only show a count: click one to see what's on it. You can still drag a card from the
panel onto the focused day to schedule it, or drag one out to the panel to clear its date.

**Schedule by dragging:**

- **Drag a card from the panel onto a day** to set the active tab's date (written in your
  configured date format, `YYYY-MM-DD` by default). The card moves onto that day.
- **Drag a card from a day back onto the panel** to clear that date. The card returns to the
  panel.

**Sort and filter the panel** (view options): order the cards by **Manual order**, **Name**,
or **a property** (e.g. a priority or estimate), and **filter** the list by name or `#tag`.

## Other interactions

- **Click** a card to open the note; **Ctrl/Cmd-click** opens it in a new tab.
- **Right-click** (or long-press on touch) a card for a menu: open the note (or in a new
  tab), set its status, clear the status, **archive** the note, or open a related note.

## View options (Configure view)

Open the view's options (the Bases **Configure view** panel) to tune **this board** without
changing your notes. They're grouped:

**Columns**

- **Status property** — choose which property drives the columns (overrides auto-detection).
- **Statuses (columns)** — the list of status values to show as columns, in order (one per
  entry). This is the per-view column definition.
- **Manual order property** — choose where card order is stored.
- **Show empty columns** — keep columns with no cards visible (useful when columns come from a
  note type's defined statuses).
- **Unmapped column position** — show the Unmapped column first (left, the default) or last
  (right). It still only appears when something is unmapped.

**Swimlanes**

- **Grouping** — override the board's lane grouping for this view: **Use board default**,
  **None**, **By note type**, or **By property**. (The default is set in Configure board.)
- **Grouping property** — when grouping **By property**, the property whose values become lanes.

**Filters**

- **Blocked cards** — show all cards, only blocked ones, or hide blocked ones.

**Calendar**

- **Calendar mode** — turn the board into a scheduling calendar (see Calendar mode above).
- **Scheduled / Due date property** — which properties hold the scheduled and due dates.
- **Default range** — Week, Month, Quarter, or Year.
- **Scheduling panel sort / sort property / filter** — order and filter the panel's tab cards.

## Colors

Click the **gear** in the top-right of the board to open **Configure board** — these are
**shared** settings that apply to every board of the same note type (colors, cards,
relationships, archiving, and the default swimlane grouping):

- Toggle **Auto-assign colors** to give each status a palette color automatically.
- Per status, pick a palette color, choose **Custom…** and use the color picker, or pick
  **Auto** to reset.

Card accents and column shades follow the status color and adapt to your light/dark theme.

## Card content

The Configure board dialog also controls what each card shows:

- **Title** — use the note name (default) or any property as the card heading. Clicking the
  card still opens the note.
- **Displayed fields** — add properties to show on the card, reorder them, and toggle a label
  for each. Values render by type (dates, numbers, lists, links).
- **Cover image** — pick a property holding an image link, vault path, or URL to show a cover
  at the top of the card.
- **Wrap long values** — wrap field values onto multiple lines instead of truncating them.

A note's **due date** is always shown in red when set, even without configuring fields.

The dialog also has **Swimlanes** (group the board into lanes) and **Archiving** (move
finished cards into a folder) sections — see Swimlanes and Archiving above.

## Obsidian Starter Kit integration

If the [Obsidian Starter Kit](https://store.dsebastien.net/) plugin is installed, the board
recognizes a note's type and uses that type's **status property and allowed values** to build
its columns — including empty columns in the type's defined order. The Starter Kit stays the
source of truth for that; your color choices are saved locally and survive the Starter Kit
being disabled. Without the Starter Kit, columns come from the status values found in your
notes.

## Where it lives

Everything happens inside the Bases Kanban view — there are no separate commands to run. The
plugin's settings tab holds the global default property names used when a note or board
doesn't override them.
