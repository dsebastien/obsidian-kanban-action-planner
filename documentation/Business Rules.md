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
   explicitly — precedence: per-view `statuses` list (a **whole-board override** that forces one
   shared set on every lane) → the note type's allowed values → global `defaultStatuses`. On a
   **mixed board with note-type lanes**, the set is resolved **per lane**: each lane carries its
   own type's vocabulary, colors, and WIP limits (Ungrouped lane = the board set); column
   **drag-reorder is disabled** there (a Notice explains; order comes from each type). Columns
   are NEVER created from values observed in notes (avoids stale columns from typos/invalid
   data). With no definition, all notes sit in a single **Unmapped** column; notes with
   missing/undefined status also go there. **Unmapped is hidden when empty** and sits **first**
   (left) by default — flow Unmapped → … → Done; a per-view `unmappedPosition` option can move
   it last. "Show empty columns" controls visibility of defined-but-empty columns.
   **A card's own recognized note type is authoritative for every status write** (owner-approved):
   a card is never assigned a status outside its own type's vocabulary, and every status
   read/write uses the card's own type's status property (per-view `statusProperty` override
   still wins for all cards). Consequences: the card menu's Set status lists the card's own
   type's values; bulk multi-select Set status requires a single-type selection (mixed
   selections get a Notice); drops resolve the value from the target lane's own column set.
3. **No state machine (for now).** All status transitions are allowed (drag or right-click).
   The data model stays open to add an allowed-transitions layer later, but none is built.
4. **Order persisted to the note, not plugin data.** Manual order is written to a
   configurable property (default `manual_order`) using **fractional float midpoints**
   (one note write per move; silent per-column renumber only on float-precision exhaustion).
   Ordering scope is per-column.
5. **Note types + Starter Kit.** Config uses reusable note types. When the Obsidian
   Starter Kit plugin (`obsidian-starter-kit`) is present, its note-type config is the
   **read-only source of truth**, but always **mirrored into a local snapshot** so note types
   survive SK being disabled/removed and support local overrides. When SK is absent,
   note types are fully local read/write. SK is feature-detected (no API versioning).
6. **Kanban-owned presentation.** Colors (theme-aware palette + custom hex; column bg =
   translucent shade of card color), relationships, calendar mappings, and swimlane grouping
   are owned by this plugin (SK does not define them). Card _field_ content is **not** owned —
   it comes from the Bases view's own property selection (rule 8).
7. **Configurable swimlanes (issue #2).** Lanes are grouped by a configurable key: none /
   note type / an arbitrary property; an **Ungrouped** lane collects missing values and is
   hidden when empty. **Mixed-board auto-grouping** (owner-approved): with no per-view override
   and a `none` profile grouping, a board showing **more than one recognized note type**
   auto-groups lanes **by note type** (`resolveEffectiveLaneGrouping`, pure) — each type gets
   its own lane and, per rule 2, its own column set. An explicit per-view **None** keeps the
   flat board.
8. **Cards show the Bases view's properties (issue #50).** Each card renders the view's
   configured properties (`config.getOrder()` — the standard Bases **Properties** selection),
   one labelled field per property, in order, read per card via `BasesEntry.getValue` and
   labelled by `getDisplayName`. Works uniformly for `note.*` / `formula.*` / `file.*` columns,
   so a base **formula** (e.g. a `priority_score`) shows on the card with no special handling.
   The `file.name` property is the card **title** (never a field); empty/unset values
   (including `NullValue` → `"null"`) are skipped. Clicking a card opens the note. The note's
   **red due-date** still shows regardless of the property selection. Changing the view's
   properties re-renders cards through the normal Bases update. Relationships are rendered
   **separately** from `KanbanCard.relationships`, not as view-property fields. (The old
   per-note-type card-presentation config — title source, body fields, cover image, value
   wrapping — was removed with #50 part 3; no back-compat.)
   8c. **Scannable field rendering (`card-display.service.ts`, pure helpers).** Enum values are
   **heat-colored** by rank: `heatLevel(value, allowedValues)` ranks by the numeric `NN -` prefix
   (robust to allowed-list order; highest prefix = coolest, e.g. a `99 - TBD` sentinel) into
   buckets 0 (warm) … 4 (cool) → `kap-card-field-heat-N` (Obsidian `--color-*` tints, theme-aware).
   The `NN -` prefix is **stripped** for display (`stripEnumPrefix`, requires whitespace before the
   dash so ISO dates are untouched). A **numeric formula** value → a filled accent **badge**
   (`kap-card-field-badge`). Percentages → progress bar. Ranking scale: **note** props use the note
   type's allowed values; **formula** props use the distinct values observed on the board (so a
   formula enum isn't arbitrarily neutral) — resolved per card and cached per rebuild
   (`cardFieldAllowedCache`); no rankable scale ⇒ neutral. The field tone/heat is part of the card
   signature so reconciliation re-renders on change.
   8d. **Chip style is a global setting (`cardChipStyle`).** One look-and-feel preference for all
   boards: `minimal` (default — no fills, a faint label + heat-colored value as a vertical stat
   list), `tinted` (flat color-filled pills), or `rail` (neutral pills + a colored left edge). The
   data classes are identical; the view toggles a `.kap-chips-{style}` modifier on `.kap-root`
   (`applyChipStyle`) and the stylesheet does the rest. Set in the plugin settings tab; **not** a
   per-view option.
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
   **Blockers may be off-board; archived blockers drop (issue #13).** A `blocked_by` link counts
   even when the blocker is on **another board** (a task blocked by a project) — direct links are
   resolved against the whole vault, not the board. A blocker stops counting only when it is
   **archived**: the service drops any `blocked_by` target whose note lives under a configured
   archive folder (matched by the folder template's static prefix, before the first `{{` —
   `domain/archive-paths.ts`; prefixes gathered across all note types). Navigational roles
   (parent/child/sibling) are not archive-filtered. **Live refresh:** because relationships are
   read-only and resolved from the metadata cache, the view also rebuilds on
   `metadataCache.on('changed')` for any note currently on the board — so editing a `blocked_by`
   link (or any frontmatter) in place updates the card without a reload, even when the Base result
   set is unchanged (`onDataUpdated` alone would miss it).
   **Editable from the board (issue #14, supersedes the former read-only rule).** A card's
   right-click **Relationships** submenu can **add** (per role with a non-empty link-property — "None"
   roles are not addable) and **remove** a relationship. Writes manage **direct** links only — the
   wikilinks physically stored in _this note's own_ role link-property — using the **active note
   type's** `roleProperties` so writes and reads agree. Inverse-derived and heuristic relations stay
   read-only (they live on the other note / are computed). Adds store the canonical `[[wikilink]]`
   form and dedup by resolved path; removes delete the property when it empties. The metadata-cache
   refresh above re-renders badges/blocked state live after a write.
10. **Calendar mode.** A toggle adds a collapsible "Scheduling" panel (Unplanned /
    No-Deadline tabs; title always visible, vertical when collapsed; each tab's backlog is
    **grouped by note type → status** via `groupByTypeAndStatus`, type headers only on
    multi-type boards, all groups collapsed by default with collapse state on the controller
    instance) + a week/month/quarter/
    year calendar. Dragging a card to a day sets the relevant date property (momentjs format,
    default `YYYY-MM-DD`); dragging back clears it. **Multi-day spans (issue #86):** a
    scheduled card with an estimate also renders a dimmed, dashed-edge continuation chip on
    every covered day (offsets 1…estimate−1, tooltip `— day i of N`); continuation chips carry
    no `cardKey`/`dimension` dataset so the calendar DnD ignores them — only the start-day
    chip moves the span.
11. **Archiving (issue #7).** A card's note can be archived by **moving** it to a
    configurable archive folder that supports Starter-Kit-style placeholders (`{{year}}`,
    `{{month}}`, `{{week}}`, `{{quarter}}`, `{{day}}`, `{{date}}`, `{{datetime}}`,
    `{{uuid}}`). Archiving is manual (context menu) plus an **optional, opt-in** per-note type
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
    note type (`wipLimits`: status value → positive integer), edited in Configure board → **WIP
    limits**. A column with a limit shows `count / limit` in its header and turns the count red
    when over; the limit is **advisory only** and never blocks a drop. `columnsFromValues`
    attaches the limit to each `ColumnDef`. Per-view overrides are out of scope (Bases flat
    options can't express per-status limits).
18. **Overdue emphasis (issue #22).** The card display carries a pure `dueState`
    (`overdue`/`today`/`none`) computed from the configured due-date property vs. today. Overdue
    cards get a red background wash, due-today an amber wash. This uses the **background**
    channel so it stays distinct from a blocked card's red **left accent** — both can show at
    once (blocked owns the accent, overdue owns the wash). Recomputed on every rebuild.
19. **Command palette (issue #27).** Plugin commands act on the **active** Kanban view, found by
    reading the active Bases leaf's current sub-view (`controller.view`) and `instanceof`-checking
    — so background Kanban leaves never match. Each uses `checkCallback` (no-op + hidden when no
    Kanban view is focused) and is hotkey-bindable: toggle board/calendar, focus filter, clear
    filter, next/previous swimlane.
20. **Drag to reorder columns (issue #24).** Dragging a status column's header (pointer DnD,
    `ColumnDnd`) reorders the columns and persists the new order to the per-view `statuses`
    list (which overrides the Starter Kit / default order). The Unmapped column is not
    draggable — its side is the `unmappedPosition` option. Reordering writes only the column
    order, not the notes.
21. **Keyboard move & reorder (issue #20, a11y).** A focused card supports `Ctrl/Cmd+←/→` to
    move to the adjacent column (writes status), `Alt+↑/↓` to reorder within its column (writes
    manual order), and the menu key / `Shift+F10` to open its context menu — all via the same
    `applyMove` path as drag-and-drop. Focus follows the card after the rebuild
    (`refocusCardKey`). Honors reduced-motion (no new animation; the board's reduced-motion
    rules apply). The context menu also offers **Send to top / Send to bottom** (issue #78) —
    same `applyMove` path (index `0` / column length), no-op when the card is already at that
    edge, and hidden while a non-manual sort owns the order (rule 25).
22. **Multi-select + bulk actions (issue #18).** A toolbar **Select** toggle enters select mode:
    click toggles a card's selection, Shift-click selects a range (board order). An action bar
    (shown when ≥1 selected) offers bulk **Set status** (per-column menu, incl. clear),
    **Archive**, **Open** (new tabs), and **Clear**. Writes are sequential with a summary notice
    (no true cross-file atomicity is possible; failures are surfaced, never silent). Bulk
    set-status does **not** auto-archive (guards against accidental mass-archiving). Selections
    drop automatically when a card leaves the board (archived/filtered).
23. **Local note types (issue #31).** Note types can be **created without the Starter Kit**:
    Settings → Note types → **Add note type** makes a local note type; its **Note type** section
    edits the name + **recognition rules** (`typeRecognition.mappings`: tag [nested-aware],
    folder [incl. subfolders], or path regex — any match wins). Recognition is pure
    (`domain/note-type-recognition.ts`); the service prefers Starter Kit recognition (when
    present) then falls back to local rules (`recognizeNoteTypeFor` / `recognizeLocalNoteType`),
    so per-file type resolution (swimlanes, archive, card display) and the dominant-type note type
    work with or without the Starter Kit — and orphaned SK types keep recognizing from their
    mirrored mappings. Deleting a type removes only its config (notes untouched), via a themed
    confirm modal. Default note type is never a recognition candidate.
24. **Persisted view state (issue #19).** Durable per-view UI state is saved to `this.config`
    (the same flat-key mechanism as `filterQuery`/`calendarMode`; no options-schema change) and
    restored on reload/reopen: `calendarRangeOverride` (toolbar range, layered over the configured
    `calendarRange` default), `calendarTab`, `calendarPanelCollapsed`, `calendarShowScheduled`,
    `calendarShowDeadlines`, `collapsedLanes`, `collapsedColumns`, `compactMode`. **Transient** bits are
    deliberately NOT persisted (reset on reload): the calendar **anchor** (→ today) and **focused
    day** (→ none), plus the auto-collapse runtime memo. Reads default-on-missing (backward
    compatible: a view with no stored keys behaves as before). The `CalendarController` loads its
    durable fields lazily on first render (config is unavailable at construction) and writes on each
    change; lane/column collapse loads once in `rebuild()` and writes on toggle. **Compact mode**
    (`compactMode`, board toolbar toggle next to Select): off by default; when on, board cards show
    only the title (CSS `kap-compact` on the board host hides covers, fields, badges, relationship
    chips); board mode only (calendar panel and triage keep full cards).
25. **In-column sort (issue #17).** A per-view **Card sort** option orders each column's cards by
    `order` (manual, default) / `name` / `property`, with a `cardSortDirection` (`asc`/`desc`) and a
    `cardSortProperty`. The pure `compareTabCards` (shared with the calendar panel,
    `domain/calendar-tabs.ts`) does the comparison; direction flips only the value compare —
    **missing values always sort last** and the title tie-break stays ascending. `buildBoard` takes
    an optional `compare` comparator (default = manual `compareCards`), so the default board is
    byte-identical to before. While a non-manual sort is active, **`manual_order` writes are
    suppressed** — in-column drag and the keyboard reorder are no-ops (status changes via
    cross-column drag still work); switching back to Manual order restores `manual_order` ordering
    and re-enables reordering.
26. **Computed columns are read-only inputs (issue #50).** The view can **sort** and **group** by a
    base's computed columns (`formula.*` / `file.*`), not just frontmatter (`note.*`) — read per card
    via `BasesEntry.getValue` (the `BasesQueryResult` already has formulas evaluated; the plugin
    stores/maintains nothing). `views/kanban/property-access.ts` (`parsePropertyRef` note=writeable
    vs computed=read-only, `unwrapValue` `Value`→scalar) + a per-rebuild `entriesByPath` map back
    this. Computed columns are **read-only everywhere**: a `formula.*`/`file.*` swimlane grouping
    ignores cross-lane drag (no property to write), and **writeable** settings (status, manual order,
    drag-grouping) stay `note.*`-only — their pickers reject computed columns. The plugin depends on
    the Bases _formula feature_, never on any specific base's formulas (defined at base level). Card
    **display** of computed columns works the same way via the view's property selection (rule 8).
27. **Enum allowed-values + quick-set (issue #52).** Any property can have **known allowed values**,
    resolved per the card's note type with precedence **manual note-type `enumProperties` →
    Starter Kit `allowedValues` → none** (`services/enum.service.ts`). The card menu offers a
    generic **Set <property>** submenu (values, current checked, Clear) for every known enum,
    generalizing "Set status" (which keeps its own path and is excluded from the generic list).
    Writes go through `setProperty`/`deleteProperty`; the #13 metadata listener re-renders live.
    Manual values are defined per note type (Configure board → **Enums**) and are the only source
    for **local** types; a property with no known values is free-text (no quick-set). The plugin
    never hardcodes specific value conventions.
28. **Triage mode (issue #53).** A third view mode (Board / Calendar / **Triage**) renders a
    focused **one-card-at-a-time queue**. Config is **per-view** (the `.base`, via `this.config`) so
    it can reference note props **and** base formulas: **editable** props (writeable enums),
    **gating** props (decide "unclarified"; empty ⇒ defaults to editable), **context** props
    (read-only, formulas allowed; empty ⇒ the view's displayed properties), **needs-triage tokens**,
    and a **scope**. The property lists + tokens are edited in the **Configure triage** modal
    (`ui/triage/triage-config-modal.ts`; gear in the triage header or the `configure-triage` command)
    with real property pickers: **note** properties come from the **note types** on the board (Starter
    Kit `.properties` + local `enumProperties`, scoped to active + per-card types — no dataset
    fallback), **formulas** from the **base** (`formula.*`); file columns are not offered. Labels use
    the base display names. The scope also has a Bases-panel dropdown. A gating prop is **unset**
    (convention-agnostic) when empty/absent, OR its value
    contains a needs-triage token, OR — when allowed values are known — it isn't among them
    (`views/kanban/triage.ts`, pure). Queue order is **worst-first** (most unset props), tie-broken by
    the view's card comparator, held as a **stable per-session snapshot** (cursor by card key) so a
    write doesn't reshuffle it. **Scopes:** `clarify` (only unclarified cards; a card drops as it's
    completed), `all` (every card, re-prioritize), or `review` (#57; see rule 29). A write **re-renders
    in place** (recomputed score stays visible, body scroll preserved) **while the card still has
    unset gating props**; the moment the **last** one is filled the card is fully clarified, so it
    **celebrates and auto-advances** to the next card — or the **"All done" state** when it was the
    last in the queue. **Skip/Next** advance explicitly and **scroll the body back to the top** (a new
    card starts at its title). The empty state distinguishes **"All done"** (finished the whole queue,
    celebratory) from **"All clear"** (the scope had nothing to triage). Editing reuses the #52
    allowed-values + frontmatter writes. **Mixed-type** boards resolve props + allowed values **per
    card** via its recognized note type, and gating is **type-aware**: a `note.*` gating prop only
    counts against a card when that card's type **defines** it (so a task-only prop never flags goals,
    and vice-versa); the skip applies only when the type's properties are known, leaving single-type
    boards unchanged. **Left queue pane:** a collapsible panel (the shared
    `kap-scheduling-panel` shell) lists the whole queue snapshot grouped by note type → status
    (`groupByTypeAndStatus`; type headers only on multi-type boards); clicking a card moves the
    cursor to it (`onSelect` → index in the snapshot) and shows it on the right, the current
    card highlighted and any card no longer needing triage in the scope muted. Groups default
    **expanded** (it's a navigation list, unlike the calendar/timeline drag-backlogs); group
    collapse is in-memory, the whole-pane collapse persists per view (`triagePaneCollapsed`).
    The render-skip signature includes the pane, so a group/pane toggle re-renders. Command:
    `toggle-triage-mode`.
29. **Reviews / spaced repetition (issue #57).** The triage `review` scope queues cards **due for
    review**: due when `last_reviewed + review_interval` ≤ today, or **never reviewed** (sorts first);
    ordered **most-overdue first** (`reviewState` in `views/kanban/triage.ts`, pure). The card shows
    its review status (last reviewed / count / overdue) on top; **Reviewed** stamps `last_reviewed` =
    today (ISO) and **increments** `review_count`, then advances. The three property names are
    **global plugin settings** (`reviewedDateProperty` / `reviewIntervalProperty` /
    `reviewCountProperty`) defaulting to `last_reviewed` / `review_interval` / `review_count`, plus a
    `defaultReviewIntervalDays` (30) fallback for notes without their own interval. Review needs **no
    per-view config** — it works on any Kanban view via the scope switch.
30. **Due countdown (issue #62).** The card display carries an optional pure `countdown`
    (`{ text, tone, placement }`) from `formatCountdown(due, today, soonDays, placement)` (in
    `card-display.service.ts`, unit-tested): `today` / `in 3d` / `2d overdue` / `in 2w` / `in 3mo` —
    **auto granularity** (days under 2 weeks, then weeks under ~2 months, then months). `tone`
    extends the #22 `dueState` scale — `overdue` (red) / `today` (amber) / `soon` (orange, within the
    threshold) / `future` (muted) — and drives **color, not visibility**. Reuses the already-resolved
    `dueDateProperty` (no new property config). **Visibility is per-view** (`showDueCountdown`
    toggle, default **off**). **Position and color threshold are global plugin settings**:
    `dueCountdownStyle` (`title` right-aligned title-row pill [default] / `chip` field chip / `corner`
    absolute top-right / `footer` full-width row) and `dueSoonThresholdDays` (default **7**). Rendered
    in `card-renderer.ts` and part of the card signature (re-renders on change); the title-row
    placement is the only one kept out of the height-affecting bottom chips.
31. **Scoped settings refresh (issue #67).** `saveSettings(scope)` notifies open boards **before**
    the async disk write and passes a refresh **scope** so a cosmetic change applies at once instead
    of running the full (~seconds on large boards) re-derivation: `chrome` → toggle the chip-style
    class only (`applyChipStyle`, O(1)); `cards` → recompute just each card's **due countdown** and
    re-render (`refreshCardDisplay`), reusing relationships/search/note-type/order; `full` (default)
    → debounced `resolveAndRebuild` (property names, note types, statuses, swimlanes). The settings
    tab picks the scope: chip style = `chrome`, due-countdown position / soon-threshold = `cards`,
    everything else = `full`. `full` stays debounced so per-keystroke text edits coalesce.
32. **Optimistic UI updates (issue #64).** Board mutations apply to the in-memory model and
    re-render **before** the frontmatter write, so the card reflects the change at once (no
    snap-back / round-trip lag). The frontmatter write follows; the `onDataUpdated`→debounced
    rebuild it triggers re-derives the **same** state, so the reconciler no-ops (positions live in
    the board structure, not the card signature, so a reused node simply moves). Covered:
    **status + manual order** (`applyMove` — the single chokepoint for drag, keyboard move/reorder,
    and the menu set-status) mutates `card.statusValue`/`card.order` then `applyFilterAndRender()`;
    **relationship add/remove** mutates `card.relationships[role]` then re-renders. **Excluded:**
    status-triggered **auto-archive** transitions stay on the write-then-rebuild path (terminal —
    the note leaves the board and its file moves; the archived note must carry the new status).
    Property-chip / triage-value edits (derived from the Bases entry, not the in-memory model) are
    not yet optimistic.
33. **Card title source (issue #4).** The card heading is the **note name by default**, or a
    **per-view `titleProperty`** (Configure view → Cards; any `note.*`/`formula.*`/`file.*` id,
    read-only) when set. Resolution is `resolveCardTitle` in `card-display.service.ts`
    (unit-tested): the property's value when non-empty, else **always fall back to the note name**
    (a card never renders blank). The chosen property is **excluded from the body fields** (it's
    already the heading), like `file.name`. The title flows through `CardDisplay.title`, so board,
    calendar chips/panel, triage heading, search, and name-sort all use the same resolved value.
    Originally shipped in M2b (per note type), dropped by the #50 refactor, reintroduced per-view.
34. **Zoom into a card's children / descendants (issue #74).** "Focus on children" re-filters the
    board to the notes whose **parent** is the focused card; "Focus on all descendants" to its
    **whole subtree**. Zoom is **not separate state**: the action writes a `parent:="Title"`
    (children) or `ancestor:="Title"` (descendants) term into the per-view `filterQuery` and rides
    the normal filter path (AND-appended to whatever the user typed; an existing non-negated zoom
    term — of either field — is **swapped**, so repeated zooms drill down/re-scope instead of
    stacking; persistence comes free). The **`:=` exact operator** (all qualifiers; for `due:` the
    `=` maps to the existing same-day compare) matches the **whole** value case-insensitively —
    zoom emits it so "App" never captures children of "App Backend"; plain `:` keeps substring
    semantics. The **`ancestor:` reserved qualifier** matches a card's **transitive parents**
    (`CardSearchRecord.ancestors`, BFS via `ancestorPaths` over the resolved board relationships,
    cycle-safe; an off-board parent is included but not climbed through; deliberately NOT in the
    bare-term haystack). Zoom filters **within the Base's result set** (children excluded by the
    Base's own filters stay hidden — the empty state says so). Entry points: card context menu
    **Focus on children** / **Focus on all descendants** (only when the card has children), the
    ▼ children badge menu (both, on top), and — zooming up from a child — the ▲ parents badge menu
    **Focus on children of X** / **Focus on all descendants of X** (per parent). The ▼ and ▲
    badges therefore always open a menu, even for a single related note. A dismissible **chip**
    (`▼ Title ✕`) next to the filter box is **derived** from the query's zoom term: ✕ removes only
    that term, label click best-effort opens the focused note by title. The focused card itself is
    not shown. Breadcrumb history: out of scope (follow-up).
35. **Timeline mode (issues #77, #80 + estimate rework).** A fourth view mode (Board / Calendar /
    **Timeline** / Triage; `timelineMode` config flag, `toggle-timeline-mode` command): one row
    per card, placed by **start date + estimate** on a shared week/month/quarter/year axis (the
    calendar's range vocabulary; per-view `timelineRange` default + persisted
    `timelineRangeOverride`; the anchor is transient → today). The timeline's properties are **global plugin
    settings, not per-view options** (owner decision; stale per-view keys in old `.base` files
    are ignored): the start is the resolved **scheduled date property**, the estimate a
    **number of days** in `defaultEstimateProperty` (`estimate`), the milestones list in
    `defaultMilestonesProperty` (`milestones`). **There is no
    end-date property.** `parseEstimate` accepts numbers or numeric strings, `Math.ceil`s, and
    yields ≥ 1 or null; estimates are always **written as numbers**; derived end =
    start + estimate − 1 (inclusive). Start without estimate → **square**; start + estimate →
    **rectangle** (no title inside the bar — the row label names the card; only the duration
    tag renders, given ≥ 32px); **squares are never overdue**, rectangles get the overdue wash when the
    derived end < today. **Deadline line (issue #85):** each row also renders its resolved due-date property as a vertical red line in its own lane (`kap-tl-deadline`, pointer-inert, above the bar), omitted when the date is unset or outside the window; the row tooltip carries `· due <date>` either way. **Milestones** come from the global milestones **list property**; each entry is
    `"<date> [label…]"` (wikilink brackets tolerated, `parseFrontmatterDate` semantics,
    non-parseable entries skipped) → diamond markers on the row. Bars crossing the window edge
    are clamped with a dashed clipped edge; dates all outside the window → "out of view" hint;
    cards with an estimate but no start are **unplanned**. **Unplanned panel** (named like the
    calendar's Unplanned tab): a calendar-style
    **collapsible left side panel** (same shell/behavior as the calendar's Scheduling panel:
    **«** toggle in the header, collapses to a slim vertical bar, **auto-collapses on narrow
    panes** with manual choice taking precedence, collapse **persisted per view**) holding
    **uniform fixed-size cards** grouped by **note type, then status** (`groupByTypeAndStatus`:
    types alphabetical, no-type bucket last; statuses via `compareStatusValues`, no-status
    last; single-type boards skip the type level), **all groups collapsed by default**; group
    collapse state lives on the controller instance (survives rebuilds, not persisted); the
    panel scrolls itself so it never squeezes out the rows. **Scheduling from the
    timeline:** dragging an unplanned card anywhere over the chart writes the **start date** property for
    the day under the pointer (`dayOffsetAtPct`), plus **estimate = 1** (one transaction) ONLY
    when the estimate property is absent or empty — new entries land as resizable 1-day
    rectangles; any present value (even unparseable) is never touched. **Live feedback:** every drag, resize, and
    drop shows the **to-be-written date** (right resize: `Nd → ends <date>`) via a body-level
    floating label (in a `.kap-root` wrapper) plus a day guide line; drop targets highlight;
    scheduling from the panel shows a striped **New entry** lane stuck to the top of the row
    body (the drop creates a new row — never "into" an existing card's line; the guide renders
    inside the lane); the drag ghost's width is capped; while resizing, the date also renders inside the bar at the dragged edge (larger; only when the previewed width fits, else the floating label takes over); each gesture's label uses the same
    rounding as its commit path. **Milestone
    editing:** double-click a row's track → modal (pre-filled editable date + optional label) →
    appends `"<date> [label]"` to the milestone list property (`appendToListProperty`, dedup,
    scalar promoted to list); dragging a diamond shifts its date by the snapped whole-day delta — the entry is rewritten
    IN PLACE via `replaceInListProperty` (position + label kept; unparseable raw = no-op);
    right-click a diamond removes its entry (keyed by the raw list
    entry; property deleted when the list empties). **Drag a square/rectangle horizontally** to
    shift it by the snapped whole-day delta — the commit writes **only the start date** (the
    estimate is intrinsic, so the span follows). Rows sort by start (then milestone/title);
    the toolbar filter and #74 zoom apply as in every mode. Pure math in `domain/timeline.ts`
    (geometry in % of the window, inclusive days); DOM in `ui/timeline/timeline-renderer.ts`;
    state/writes in `views/kanban/timeline-controller.ts` (mirrors `CalendarController`).
    **Resize:** left handle changes the **start** while the derived end stays **anchored** —
    `resizeFromStart` clamps the **shared** delta once (`min(dayDelta, estimate − 1)`) and
    derives start-delta + estimate from it, committed as start + estimate in **one** frontmatter
    transaction (`setProperties`); right handle writes **only the estimate**
    (`resizeEstimate` = `max(1, estimate + dayDelta)`, never < 1 day); handles are not rendered
    on a clipped side or on bars rendered narrower than 24px — those use the context menu;
    squares get no handles. **Unschedule:** dragging a square/rectangle onto the Unplanned panel,
    or the menu item **Clear start date**, deletes **only** the start property — the **estimate
    and milestones are kept** (the row survives if milestones remain); by default that property
    is the shared scheduled date, so the card also leaves the calendar (the menu label says
    what it clears). **Wheel zoom (#80):** requires Ctrl/Cmd (plain wheel scrolls); steps one
    range kind (week↔month↔quarter↔year) per ±50 accumulated `deltaY`, anchors on the date
    under the cursor, persists via `timelineRangeOverride` exactly like the range buttons, and
    is **inert while a drag is in progress**. **Type grouping + visibility:** when the
    timeline's cards span more than one distinct note type (counted **before hiding**), rows are
    grouped by type — collapsible header rows (name + count, expanded by default, state on the
    controller instance), types alphabetical with the **No type** bucket (sentinel id
    `__none__`) last, the date sort applied within each group. A **Types** toolbar button
    (checkable menu, built from the **unfiltered** type set so hiding everything never strands
    the user) shows/hides types; hiding a type removes its rows **and** its unplanned cards;
    hidden types persist **by type id** in the dedicated `timelineHiddenTypes` config key
    (validated string[], not part of `TimelineViewState`). **Context-menu extras
    (**`kap-timeline` **section):** **Add milestone…**; **Set estimate…** (number input, days,
    min 1; Clear deletes the property); **Clear start date** (only when a start exists);
    **Set start date…** only when the resolved timeline property differs from the scheduled
    property (the standard Schedule items already cover the shared case). **Duration:**
    rectangles show the estimate as an inclusive day count (`5d`) — always in the tooltip, the
    in-bar span skipped on narrow bars. Out of scope (follow-ups):
    dependency arrows, hierarchy indentation, milestone notes.
36. **WBS mode (issue #76).** A fifth view mode (Board / Calendar / Timeline / Triage /
    **WBS**; `wbsMode` config flag, `toggle-wbs-mode` command) renders the resolved
    parent/child hierarchy as a collapsible tree: roots are notes with at least one in-set
    child and no in-set parent; leaf notes appear only nested (never as standalone rows);
    multi-parent notes appear under **each** parent (⧉ marker); cycles stop where a branch
    would re-enter itself; the tree respects the Base result set (rule 1) and renders the
    already-filtered cards, so the toolbar filter and #74 zoom apply for free. **One rollup
    model for estimates and progress (owner): a note's OWN value wins; a note without one
    derives its value from its direct children, recursively** — so plans work **top-down,
    bottom-up, or mixed**, and persisting a rollup to the parent never double-counts (an own
    value replaces its subtree's contribution, never adds to it). Estimates follow rule 35
    semantics (days, written as numbers); a node with an own estimate also shows the
    children's rollup (`Σ Nd`) when it differs. **Progress** is a **0–100 number** in the
    global `defaultProgressProperty` (`progress`): every row shows a progress bar; own > 0
    wins, else the weighted combination of the children's effective progress (weights =
    effective estimates when every child has one, equal otherwise); derived values render
    dimmed/italic, distinctly from own values. **Rollups are display-only by default and
    persisted on demand**: context-menu **Save rolled-up estimate/progress** writes the
    derived value, and the estimate/progress modals pre-fill it. **Distribute estimate to
    children** splits the own estimate's remainder equally over children whose subtree has no
    estimate (≥ 1 whole day each; existing values never touched). A parent without its own
    start date shows the **derived date span** its subtree covers. **Left "Needs planning"
    panel**: the shared `kap-scheduling-panel` shell listing cards missing a start date or an
    estimate, grouped note type → status (`groupByTypeAndStatus`, groups collapsed by
    default, group collapse in-memory, pane collapse persisted `wbsPanelCollapsed`,
    narrow-pane auto-collapse). **DnD re-parenting**: dragging a tree row onto another row
    re-parents it; dragging a pane card onto a row sets its parent — the #14 write path
    (child-owned `parent` link moves on the child; parent-owned `children` link moves across
    the parents; a heuristic edge only gains the new link, with a Notice), optimistic per
    rule 32 (in-memory relationship sets + badges mutate and re-render before the writes);
    guards reject self, existing parents, and the node's own subtree (live red highlight).
    Non-drag fallback: the Relationships submenu + **Set parent…** menu item. Row meta
    (progress bar / dates / estimate) sits in **fixed-width right-aligned columns** so values
    align across rows (scannability, owner priority). Node collapse persists per view under
    the dedicated `wbsCollapsedNodes` key (string[], `readIdArray`). Estimate/start/progress
    are editable per node (chip click → modal; menu items). The view never creates notes;
    status writes from the tree stay out of v1 (context menu still offers them).
