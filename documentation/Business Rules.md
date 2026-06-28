# Business Rules

This document defines the core business rules. These rules MUST be respected in all implementations unless explicitly approved otherwise.

---

## Documentation Guidelines

When a new business rule is mentioned:

1. Add it to this document immediately
2. Use a concise format (single line or brief paragraph)
3. Maintain precision - do not lose important details for brevity
4. Include rationale where it adds clarity

---

## Product Invariants (Kanban Action Planner)

See `documentation/plans/kanban-action-planner-implementation-plan.md` for full detail.

1. **Bases-native view.** The plugin's core is a custom Obsidian Bases view registered via
   `registerBasesView`; a Base may host `0..n` Kanban views, and the Base's own filters
   select the notes. Notes are read from `this.data.data`; per-view state lives in
   `this.config`; frontmatter is written via `app.fileManager.processFrontMatter`.
2. **Status drives columns; columns come from a strong definition, never observed values.**
   The status property is auto-detected (prefer a field literally named `status`, else any
   field whose name contains `status`; configurable). The column **set** is defined
   explicitly — precedence: per-view `statuses` list → Starter Kit note type allowed values →
   global `defaultStatuses`. Columns are NEVER created from values observed in notes (avoids
   stale columns from typos/invalid data). With no definition, all notes sit in a single
   **Unmapped** column; notes with missing/undefined status also go there. **Unmapped is
   hidden when empty** and sits **first** (left) by default — flow Unmapped → … → Done; a
   per-view `unmappedPosition` option can move it last. "Show empty columns" controls
   visibility of defined-but-empty columns.
3. **No state machine (for now).** All status transitions are allowed (drag or right-click).
   The data model stays open to add an allowed-transitions layer later, but none is built.
4. **Order persisted to the note, not plugin data.** Manual order is written to a
   configurable property (default `manual_order`) using **fractional float midpoints**
   (one note write per move; silent per-column renumber only on float-precision exhaustion).
   Ordering scope is per-column.
5. **Profiles + Starter Kit.** Config uses reusable note-type profiles. When the Obsidian
   Starter Kit plugin (`obsidian-starter-kit`) is present, its note-type config is the
   **read-only source of truth**, but always **mirrored into a local snapshot** so profiles
   survive SK being disabled/removed and support local overrides. When SK is absent,
   profiles are fully local read/write. SK is feature-detected (no API versioning).
6. **Kanban-owned presentation.** Colors (theme-aware palette + custom hex; column bg =
   translucent shade of card color), relationships, calendar mappings, swimlane grouping,
   and card presentation are owned by this plugin (SK does not define them).
7. **Configurable swimlanes (issue #2).** Lanes are grouped by a configurable key: none /
   note type / an arbitrary property; an **Ungrouped** lane collects missing values and is
   hidden when empty.
8. **Config-driven cards (issues #3–#6).** Card title source, displayed body fields, optional
   cover image, and property text-wrapping are all configurable; note name + red due-date are
   defaults. Clicking a card opens the note.
   8b. **Per-note-type card display, live.** A card's displayed fields come from its **note
   type's** profile (a mixed board shows each type's own config; untyped cards fall back to the
   board's active profile). Display fields are toggled either in settings or by **right-clicking
   a card → "Show fields"** (a checked list of candidate properties for that note type). Any
   change to a profile's card config — from the menu or the settings tab — **immediately
   re-renders every open board** (all profile/settings writes flow through `saveSettings`, which
   notifies live views). New display fields default to no label.
   8a. **Uniform card size.** All cards are the same height board-wide, sized to the
   content-tallest card's natural height (recomputed on every rebuild and on container
   resize; published as the `--kap-card-height` CSS var, applied as `min-height`). No card
   content is ever clipped — cards keep their natural height (`flex: none` so the
   height-constrained column scrolls instead of shrinking cards); sparser cards get matching
   whitespace.
9. **Relationships.** Roles parent/sibling/child/`blocked_by` detected via explicit
   link-properties (primary) and a tag+link heuristic (secondary); inverses via reverse
   lookup. Non-empty `blocked_by` flags the card and enables navigate-to-blockers + filter;
   no auto-transition. **A role configured as "None"** (empty link-property and no heuristic)
   is fully off: it gets **no** related notes from any source — not direct, not inverse of an
   active opposite role, not heuristic — so its badge never appears for that note type.
10. **Calendar mode.** A toggle adds a collapsible "Scheduling" panel (Unplanned /
    No-Deadline tabs; title always visible, vertical when collapsed) + a week/month/quarter/
    year calendar. Dragging a card to a day sets the relevant date property (momentjs format,
    default `YYYY-MM-DD`); dragging back clears it.
11. **Archiving (issue #7).** A card's note can be archived by **moving** it to a
    configurable archive folder that supports Starter-Kit-style placeholders (`{{year}}`,
    `{{month}}`, `{{week}}`, `{{quarter}}`, `{{day}}`, `{{date}}`, `{{datetime}}`,
    `{{uuid}}`). Archiving is manual (context menu) plus an **optional, opt-in** per-profile
    status trigger (auto-archive when a card transitions into **any of one or more** chosen
    statuses — issue #32; stored as `triggerStatuses`, migrated from the legacy single
    `triggerStatus`). File moves preserve links; auto-archiving is guarded against accidental
    mass-archiving and logged.
12. **Responsiveness (hard invariant).** Every UI works on large desktop, small/narrow
    desktop, and mobile; layouts adapt and never break/overflow. One Pointer-event DnD path
    serves mouse/trackpad/touch, with a non-drag fallback. `isDesktopOnly` stays `false`.
    Deliberate mobile **graceful degradation** is allowed but must be intentional and
    documented per feature ("mobile posture"). Respect `prefers-reduced-motion` everywhere.
13. **Documentation is a first-class, per-milestone deliverable.** Every user-visible change
    updates end-user docs in `docs/` and technical docs in `documentation/` (Architecture,
    Domain Model, Configuration, Business Rules) — not as a follow-up.
14. **Tech baseline.** Vanilla DOM + native Pointer events + CSS grid; **zero UI
    dependencies**; Tailwind v4 for styling, **hardened for plugin isolation like
    `../obsidian-journal-base`**: no preflight, **plugin-prefixed cascade layers**
    (`kap-theme/base/components/utilities`), `@import 'tailwindcss/theme' … theme(reference)`
    so **no global `:root` theme block is emitted**, and **all styles scoped** under
    `.kap-root` with a `kap-` prefix inside `@layer kap-components` (colors via Obsidian CSS
    vars only). Edit only `src/styles.src.css`. Immer for state; Zod for validating stored
    config. (Full how-to: plan's "Styling: Tailwind + isolation" hard rule.)
15. **Big-bang delivery.** No public release between milestones; a single `1.0.0` cut after
    all milestones pass (version stays `0.0.0` until then). UI behavior is never claimed from
    a green build alone — it is flagged for manual verification in Obsidian.
16. **Filter bar (issue #34).** A toolbar search box (after the Board/Calendar switch) narrows
    the visible cards in **both** modes via a "JQL-lite" query: whitespace = AND, `OR`/`|`
    between groups (AND binds tighter, no parentheses), `-`/`NOT` negation, `property:value`
    qualifiers with comma-as-OR and quoting, all case-insensitive substring. Reserved names
    (`title`, `status` [value or column label], `parent`/`child`/`sibling`/`blocked`, `tag`,
    `due`) win over same-named frontmatter; any other name is a frontmatter property. `due:`
    alone has operators (`< > <= >=`, exact day) and keywords (`today`, `overdue`, `none`,
    `week`/`month`/`quarter`/`year` = the calendar period containing today). Bare words search
    title + relationship names + tags + all frontmatter values (never note body). The query
    persists per-view in `this.config.filterQuery`; it ANDs with the blocked filter and keeps
    existing column/lane visibility rules. Parsing is best-effort (never throws). This subsumes
    and replaces the old per-view `calendarFilter` option.
17. **WIP limits (issue #16).** Soft per-status work-in-progress limits live on the note-type
    profile (`wipLimits`: status value → positive integer), edited in Configure board → **WIP
    limits**. A column with a limit shows `count / limit` in its header and turns the count red
    when over; the limit is **advisory only** and never blocks a drop. `columnsFromValues`
    attaches the limit to each `ColumnDef`. Per-view overrides are out of scope (Bases flat
    options can't express per-status limits).
18. **Overdue emphasis (issue #22).** The card display carries a pure `dueState`
    (`overdue`/`today`/`none`) computed from the configured due-date property vs. today. Overdue
    cards get a red background wash, due-today an amber wash. This uses the **background**
    channel so it stays distinct from a blocked card's red **left accent** — both can show at
    once (blocked owns the accent, overdue owns the wash). Recomputed on every rebuild.
