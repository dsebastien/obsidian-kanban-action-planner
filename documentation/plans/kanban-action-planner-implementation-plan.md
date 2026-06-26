# Kanban Action Planner — Implementation Plan (1.0)

Authoritative implementation plan for the **Kanban Action Planner** Obsidian plugin
(`id: kanban-action-planner`). This document describes WHAT to build and in WHAT ORDER.
It contains no timing estimates. It is the working reference for all milestones up to the
single 1.0 release.

---

## 1. Overview & Goals

### What 1.0 delivers

A custom **Bases view** that renders the notes selected by a Base (its filters) as an
interactive **Kanban board**, plus a **calendar/scheduling mode** on the same view. The
feature set delivered at 1.0:

- Register a custom Bases view via `registerBasesView`. A Base may host `0..n` Kanban
  views; each view renders `this.data.data` (the filtered note set).
- **Columns from a status property; column set from a STRONG definition only.** The status
  property is auto-detected (a field literally named `status`, else any field whose name
  contains `status`) and overridable per view. The column **values** are never inferred from
  observed note values (which would create stale columns from typos); they come, in
  precedence order, from: the per-view `statuses` list → the Starter Kit note type's allowed
  values → the global `defaultStatuses` setting. With no definition, the board has no columns
  and **all notes sit in Unmapped** (the pre-configuration state). Notes whose status isn't a
  defined column also go to Unmapped. The Unmapped column leads the left-to-right flow by
  default (Unmapped → … → Done); a per-view option (`unmappedPosition`) can move it last.
  "Show empty columns" governs whether defined-but-empty columns are visible.
- **Column set** derived from the status property's supported values, ordered by a
  numeric/lexical prefix default (e.g. `10 Todo`, `20 Doing`, `30 Done`).
- **No state machine.** Every transition is allowed (drag or right-click). Architecture
  stays open to add transition rules later, but none are built.
- **Manual per-column ordering** persisted to the note (not plugin data) via a
  configurable property (default `manual_order`), using **fractional float midpoints**;
  a single note write per move; silent per-column renumber only on float-precision
  exhaustion.
- **Reusable note-type profiles** as the config model. When the Starter Kit (SK) plugin
  is present, its note-type config is the read-only source of truth, **mirrored** into a
  local snapshot that survives SK being disabled/removed and supports local overrides.
  When SK is absent, profiles are fully read/write locally. Rich config (colors,
  relationships, calendar mappings) is kanban-owned and authored in a **Configure board**
  modal opened from a gear in the view.
- **Lane-capable board.** A single recognized note type renders one chrome-free lane
  (looks like a plain board); multiple types render swimlanes (one lane per type with its
  own columns/colors).
- **Kanban-owned colors.** Curated theme-aware palette (resolved via Obsidian CSS vars)
  plus optional custom-hex override. Column background is an auto-derived translucent
  shade of its card color. Colors auto-assign by default so the board is usable
  pre-config. Card color reflects status.
- **Status change UX:** drag/drop between columns and a right-click context menu (change
  status / open note / copy wikilink), with smooth, reduced-motion-aware animations.
- **Relationships:** per-profile roles `parent` / `sibling` / `child` plus `blocked_by`.
  Detection by explicit link-properties (primary) and tag+link heuristic (secondary),
  with inverse relations via reverse lookup. `blocked_by` non-empty → visual flag,
  navigate-to-blockers, and filter. No auto-transition.
- **Relational filtering** layered on top of Bases' own filters (e.g. only tasks for
  project X; only goals that have projects; only projects with tasks; by tag/name).
- **Calendar mode:** a toggle on the view. A collapsible left **Scheduling** panel with
  two tab sub-columns (`Unplanned` = no scheduled-date prop, default `date_scheduled`;
  `No Deadline` = no due-date prop, default `date_due`) and a right-side calendar
  (week/month/quarter/year). Drag a card to a day sets the relevant date property
  (momentjs-formatted, default `YYYY-MM-DD`); drag back to the tab clears it. Cards show
  minimal info (name + due date in red); click opens the note.
- **Configurable swimlane grouping** ([#2]): lanes are driven by a configurable grouping
  key — the recognized note type **or** an arbitrary property (e.g. `priority`, parent
  link, `area`). Columns stay `status`-driven; rows become the chosen property's distinct
  values. An **Ungrouped** lane collects cards missing the grouping value (hidden when
  empty). Dragging a card between lanes sets the grouping property to the target lane's
  value.
- **Configurable card presentation** ([#3]–[#6]): the card renderer is driven by config,
  not hardcoded fields — a configurable **title source** (note name or a property, [#4]),
  an ordered list of **body properties to display** (type-aware chips, [#3]), an optional
  **cover image** from a chosen property ([#5]), and a **property text-wrapping** toggle
  (truncate-with-tooltip vs wrap, [#6]). Note name + red due-date remain sensible defaults.
- **Archiving** ([#7]): move a card's note to a configurable **archive folder** that
  supports Starter-Kit-style placeholders (`{{year}}`, `{{month}}`, `{{week}}`,
  `{{quarter}}`, `{{day}}`, `{{date}}`, `{{datetime}}`, `{{uuid}}`), via a manual action
  and an **optional status-trigger** (archive automatically when a card reaches a chosen
  status). Moves the file (links update); strictly opt-in for the auto behavior.
- **Responsive across large desktop, small desktop, and mobile** — a project-wide
  invariant (see Ground Rules), with deliberate, documented graceful degradation on mobile
  for space-hungry interactions.

### Big-bang delivery note

**Single 1.0 release** after everything above is complete. There is **no public release
between milestones**. The work is nonetheless structured as internal,
independently-verifiable milestones so each can be sanity-checked in Obsidian and
course-corrected. Version stays `0.0.0` until the 1.0 cut.

### Tech baseline

Vanilla DOM + native Pointer events for drag-and-drop + CSS grid for the calendar. **Zero
UI dependencies.** Tailwind v4 for styling, all styles scoped under a plugin namespace.
Immer for state, Zod for runtime validation of stored config. Performance target:
~1–2k cards/board smoothly; virtualize later only if needed.

### Styling: Tailwind + isolation (HARD RULE)

**This project styles with Tailwind v4, hardened for Obsidian plugin isolation exactly like
the sibling `../obsidian-journal-base` plugin. Future agents MUST follow this — do not
hand-roll CSS resets, do not import preflight, do not use generic Tailwind layer names.**

All styling lives in `src/styles.src.css` (the only CSS source; the root `styles.css` is
generated — never edit it). The isolation rests on **four** mechanisms, the first three copied
from `obsidian-journal-base`:

1. **No preflight.** Preflight is a global reset; in Obsidian it clobbers core + other
   plugins. We never `@import 'tailwindcss'` (which includes it) — only the theme and
   utilities sub-imports.
2. **Plugin-prefixed cascade layers.** Generic layer names (`theme`, `base`, `components`,
   `utilities`) are _shared_ across every Tailwind-using plugin, so their declared order can
   reorder ours. We declare `@layer kap-theme, kap-base, kap-components, kap-utilities;` and
   import into those private layers. (`journal-base` uses `jb-…`; pick the plugin’s own
   prefix — here `kap-`.)
3. **`theme(reference)` on the theme import.** `@import 'tailwindcss/theme' layer(kap-theme)
theme(reference);` makes Tailwind _reference_ its design tokens to build utilities **without
   emitting** the `:root { --color-…; --spacing-…; }` block — so the plugin never pollutes the
   global scope or fights the active Obsidian theme. (Verify after a build: `grep ':root'
dist/styles.css` should find none.)
4. **`.kap-root` + `kap-` scoping.** Every rendered node lives under `.kap-root` and every
   class is `kap-`-prefixed (`constants.ts`); every custom rule sits inside
   `@layer kap-components`; **colors/backgrounds/interactive states use Obsidian CSS variables
   only via `var(--…)`** — never Tailwind color utilities (they won’t match the theme).

Canonical header for `src/styles.src.css`:

```css
@layer kap-theme, kap-base, kap-components, kap-utilities;
@import 'tailwindcss/theme' layer(kap-theme) theme(reference);
@import 'tailwindcss/utilities' layer(kap-utilities);

@layer kap-components {
    /* all plugin rules here, scoped under .kap-root with the kap- prefix */
}
```

Use Tailwind utilities (via `@apply` or inline classes) for layout/spacing/sizing/typography/
borders/effects; reach for raw CSS only when an Obsidian `var(--…)` is required.

### Live testing harness (Obsidian CLI) — validate EVERY step

A real Obsidian vault is wired for live validation; **every milestone/step MUST be verified
here, not just by a green build** (Business Rule #15 — UI is never claimed from a build alone).

- **Deploy:** `bun run dev` (watch) builds and copies `main.js`/`manifest.json`/`styles.css`
  (+ `.hotreload`) into `$OBSIDIAN_VAULT_LOCATION/.obsidian/plugins/<plugin-id>/` (the vault is
  taken from the `OBSIDIAN_VAULT_LOCATION` env var — see `scripts/build.ts`). Keep it running
  while iterating. The same vault is the default target of the `obsidian` CLI.
- **Vault fixtures:** `KanbanTest/` (Task A–F with `status`/`manual_order`; B/F have `date_due`;
  a `project` property — A/C = `10 Alpha`, B/D = `20 Beta` — drives swimlane testing) and
  `KANBANTESTBASE.base` at the vault root.
- **`obsidian` CLI** (key=value args; not `--flags`). Useful commands: - `obsidian plugin:reload id=kanban-action-planner` — reload plugin code. **Gotcha:** an
  already-open Bases leaf keeps its old sub-view; after reloading, **detach and reopen the
  base** to force a fresh render: `obsidian eval code='for(const l of
app.workspace.getLeavesOfType("bases"))l.detach()'` then `obsidian open
path="KANBANTESTBASE.base"`. - `obsidian property:set name=<k> value=<v> path="<file>"` / `property:read` /
  `property:remove` — edit fixture frontmatter. - `obsidian dev:dom selector="<css>" [total|text]` and `obsidian eval code='<js>'` —
  assert on the rendered DOM (lane/column/card counts, `dataset`, `getComputedStyle`). - `obsidian dev:errors` / `dev:console` — assert **zero** console errors after each action. - `obsidian dev:screenshot path="/tmp/x.png"` — capture for visual review. - `obsidian dev:mobile on` — toggle mobile emulation to check the responsive/accordion
  posture.
- **Per-step validation rule:** after implementing a step, (1) reload + reopen the base,
  (2) assert the expected DOM with `dev:dom`/`eval`, (3) exercise the new interaction (drag,
  toggle, menu) via dispatched `PointerEvent`s or `.click()` and re-assert the resulting
  frontmatter + re-render, (4) confirm `dev:errors` is clean, (5) screenshot for the record,
  (6) restore any mutated fixtures. Record what was checked in the day’s history file.

### Efficiency notes / learned gotchas

The durable, always-applicable gotchas now live in **`AGENTS.md`** (see "Live testing in a real
vault" and "Core Coding Rules") — read them before iterating. In short: `tsc:watch` output lags
(trust a one-off `bun run tsc`); `plugin:reload` doesn't refresh an open Bases view (detach all
bases leaves + reopen); `obsidian open` reuses the active leaf; the CLI is `key=value` and
`property:set` is scalar-only (edit files for list/wikilink frontmatter); resolve frontmatter
links via `frontmatterLinks` + `getFirstLinkpathDest`; schema/profile additions don't backfill
stored `data.json` (degrade on missing); commitlint `scope-enum` allows only
`all|build|deps|docs|plugin`.

---

## 2. Ground Rules (template conventions — non-negotiable)

These come from `AGENTS.md` and the template ground rules and apply to every milestone.

- **Definition of done** (all must hold before a change is "done"):
    - `bun run tsc` passes (zero errors).
    - `bun run lint` passes with **zero** warnings (`--max-warnings 0`).
    - `bun test` passes; new logic has co-located `.spec.ts` coverage.
    - `bun run build` completes.
    - The day's `documentation/history/yyyy-mm-dd.md` file is updated.
    - Active plans under `documentation/plans/` are updated/closed.
    - **User docs in `docs/`** updated for any user-visible change (see Documentation
      deliverables below).
    - **Technical docs in `documentation/`** (`Architecture.md`, `Domain Model.md`,
      `Configuration.md`, `Business Rules.md`) kept in sync with the data model / config.
    - **Responsive on large desktop, small desktop, and mobile** verified (see
      Responsiveness below); any intentional mobile degradation is documented.
- **Docs workflow:** Read `documentation/Business Rules.md`, the latest history file, and
  active plans at session start. New business rules go into `Business Rules.md`
  immediately. Maintain `documentation/history/yyyy-mm-dd.md` daily. Plans live in
  `documentation/plans/` and contain **no timing information**.
- **Styling:** Edit only `src/styles.src.css` (Tailwind source). **Never** edit the
  generated root `styles.css`. Use Tailwind utilities (via `@apply` or inline classes)
  for layout/spacing/sizing/typography/borders/effects. Use **Obsidian CSS variables only
  via `var(--…)`** for colors/backgrounds/interactive states — never Tailwind color
  utilities. Import Tailwind theme + utilities without preflight (no base reset).
- **File structure:** Keep `main.ts` minimal (lifecycle only). Feature logic lives under
  `src/app`. Test files use the **`.spec.ts`** extension, co-located next to the file
  they test.
- **Bun:** All scripts via `bun run <script>`. Run `bun run tsc:watch` before editing
  code. Run `bun run format && bun run lint` after every code change. Use `bun test`,
  `bun install`, `bun <file>`. Commit with `bun run cm` (Conventional Commits; never
  bypass hooks).
- **TypeScript strict mode:** `strict`, `noUnusedLocals/Parameters`, `noImplicitReturns`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`. Always null-check, verify indexed
  access, and declare explicit return types.
- **No UI self-verification:** Agents cannot self-verify UI behavior. Every milestone
  with UI impact must explicitly flag what requires **manual runtime verification in
  Obsidian** and what to check. A passing build never counts as UI verification.
- **Responsiveness (project-wide invariant):** Every UI must work on **large desktop,
  small/narrow desktop, and mobile**. Layouts adapt to width (horizontal scroll /
  collapse / reflow — never broken overflow). Because DnD is built on **Pointer events**,
  mouse/trackpad/touch share one code path; touch targets are adequately sized and every
  drag interaction has a non-drag fallback (long-press / context menu). `isDesktopOnly`
  stays `false`. **Graceful mobile degradation is allowed**: space-hungry features
  (calendar drag-to-day, dense 2-D swimlanes, heavy card chrome) may be reduced to a
  simpler interaction or made desktop-only — but each such choice is **intentional and
  documented** as a per-milestone "mobile posture" note (full / degraded-how /
  desktop-only). Respect `prefers-reduced-motion` at all breakpoints.
- **Documentation deliverables (first-class, per milestone):** Every milestone that adds
  user-visible behavior ships matching **`docs/`** pages (Jekyll/GitHub Pages end-user
  docs: setup, creating a Kanban view in a Base, status→columns, profiles & Starter Kit
  auto-detection, colors, reordering, card customization, swimlanes, relationships/blocked,
  calendar) **and** updates **`documentation/`** technical docs to match the evolving data
  model/config. Docs are part of the milestone, not a follow-up.
- **Ignore list (never read/modify unless told):** `TODO.md`,
  `documentation/archived/`, root `main.js`, root `styles.css`, `dist/`,
  `node_modules/`, release zips.

---

## 3. Verified Technical Foundation

### 3.1 Bases View API (Obsidian 1.13.0) — exact surface we rely on

Registration entry point:

- `Plugin.registerBasesView(viewId: string, registration: BasesViewRegistration): boolean`
  — `obsidian.d.ts:4967`.
- `BasesViewRegistration`: `name: string`, `icon: IconName`, `factory: BasesViewFactory`,
  `options?: (config: BasesViewConfig) => BasesAllOptions[]` — `obsidian.d.ts:1254-1277`.
- `BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView`
  — `obsidian.d.ts:1247`. The `controller` is write-only (only passed to the constructor;
  no API to retrieve it later). `containerEl` is our mount point — we own all rendering
  and scrolling inside it.

The view base class:

- `abstract class BasesView` — `obsidian.d.ts:1105-1158`. Members: `type: string`,
  `app: App`, `config: BasesViewConfig`, `allProperties: BasesPropertyId[]`,
  `data: BasesQueryResult`, `protected constructor(controller: QueryController)`.
- Lifecycle: `abstract onDataUpdated(): void` (`:1149`); inherited `onload()` / `onunload()`
  from `Component`.
- `createFileForView(baseFileName?, frontmatterProcessor?): Promise<void>` (`:1156`).

Data access (re-read every update; **do not cache** — `data` is replaced each update):

- `BasesQueryResult.data: BasesEntry[]` (ungrouped, `:980`).
- `BasesQueryResult.groupedData: BasesEntryGroup[]` (`:988`).
- `BasesQueryResult.properties: BasesPropertyId[]` (visible props, `:994`).
- `BasesEntry.file: TFile` (`:691`); `BasesEntry.getValue(propertyId): Value | null`
  (`:699`). `getValue` returns `null` for missing props (`null !== NullValue` — check for
  `null` explicitly).
- `BasesEntryGroup`: `key?: Value`, `entries: BasesEntry[]`, `hasKey(): boolean`
  (`:710-729`).
- `BasesPropertyId = '${BasesPropertyType}.${string}'` where
  `BasesPropertyType = 'note' | 'formula' | 'file'` (`:919`, `:961`). `getValue` works
  with `note.<name>` format; treat the ID as opaque and use `getDisplayName()` for labels.

Per-view config (read/write persistence):

- `BasesViewConfig`: `name: string` (`:1173`), `get(key): unknown` (`:1180`),
  `getAsPropertyId(key): BasesPropertyId | null` (`:1187`),
  `getEvaluatedFormula(view, key): Value` (`:1198`), `set(key, value | null): void`
  (`:1205`), `getOrder(): BasesPropertyId[]` (`:1213`), `getSort(): BasesSortConfig[]`
  (`:1225`), `getDisplayName(propertyId): string` (`:1236`).

View options (the `options()` callback returns `BasesAllOptions[]`):

- `BasesAllOptions = BasesOptions | BasesOptionGroup<BasesOptions>` (`:523`).
- Base fields on every option (`BasesOption`, `:831-854`): `key`, `type`, `displayName`,
  `shouldHide?: () => boolean`.
- `BasesPropertyOption` (`:926-949`): `type: 'property'`, `default?`, `placeholder?`,
  `filter?: (prop: BasesPropertyId) => boolean` — **use this for status/order property
  pickers**.
- `BasesToggleOption` (`:1084-1095`): `type: 'toggle'`, `default?: boolean` — calendar
  mode toggle, panel collapse, etc.
- `BasesDropdownOption` (`:662-678`): `type: 'dropdown'`, `default?`,
  `options: Record<string,string>` — calendar range, sort key.
- `BasesTextOption` (`:1062-1078`), `BasesMultitextOption` (`:814-825`),
  `BasesSliderOption` (`:1008-1039`), `BasesFileOption` / `BasesFolderOption` /
  `BasesFormulaOption` available as needed.
- `BasesOptionGroup<T>` (`:861-885`): `type: 'group'`, `displayName`, `items: T[]`,
  `shouldHide?` — collapsible grouping of options.
- `BasesSortConfig`: `property: BasesPropertyId`, `direction: 'ASC' | 'DESC'` (`:1045-1056`).

`QueryController extends Component {}` is an empty marker (`:5273`) — no usable members.

**Known API risks / gaps to design around:**

- `view.data` is replaced each `onDataUpdated` — re-read, never cache the reference.
- `Value` is abstract; the concrete subclass depends on property type/source. Build a
  single `extractValue()` helper that handles every `Value` variant + `null`.
- No `ErrorValue` class exists; error states arrive as other `Value` subclasses — handle
  defensively.
- `controller` cannot be retrieved after construction; capture anything needed in the
  factory closure / constructor.

### 3.2 Starter Kit (SK) integration contract

- Access at runtime: `app.plugins.plugins['obsidian-starter-kit']?.api` (a `PluginApi`
  instance). Plugin id is `obsidian-starter-kit`. **No API versioning** — feature-detect
  every method before calling and degrade gracefully.
- Reads are synchronous and return **deep copies**; recognition + all writes are async and
  return `ApiResult<T> = { success, data?, error? }` (no exceptions thrown).
- Relevant reads:
    - `listNoteTypes(): ApiResult<NoteType[]>` (sync).
    - `getNoteType(id)` / `getNoteTypeByName(name)` (sync; name is case-insensitive).
    - `recognizeNoteType(path): Promise<ApiResult<NoteType | null>>` (async;
      tag-priority > folder/regex; results cached and invalidated on rename/delete/metadata
      change).
    - `getSettings(): ApiResult<PluginSettings>` (sync).
- `NoteType`: `id`, `name`, `description`, `icon`, `mappings[]`, `properties[]`, `tags[]`,
  `associatedFolder`, `templatePath`, `noteNamePrefix`, `noteNameSuffix`.
- `PropertyDefinition`: `name`, `displayName`, `type` (`text|select|list|number|checkbox|
date|datetime|tags|url|time`), `allowedValues`, `numberRange`, `defaultValue`,
  `required`, `description`. **Status property = property named `status` with type
  `select`, OR any property with a non-empty `allowedValues`.** Its `allowedValues`
  become our column set.
- `Mapping`: `type` (`tag|folder|regex|formula`), `value`, `enabled` — drives type
  recognition (formula not implemented in SK yet).

**SK is the read-only source of truth when present**, but we always **mirror it into a
local snapshot** so profiles survive SK being disabled/removed and so local overrides are
possible. When SK is absent, profiles are fully local read/write.

**SK risks:** must be enabled and fully loaded; `recognizeNoteType` is async with reload
timing edge cases; no semantic versioning; cache may be stale if settings are mutated
outside the API; deep copies add memory overhead at scale.

### 3.3 Prior-art patterns to reuse

From `graph-explorer-base-view` and `obsidian-life-tracker-base-view`:

- **Register pattern:** `registerBasesView(VIEW_TYPE, { factory, icon, name, options })`
  with an `options()` builder returning typed option objects.
- **Debounced rebuild:** `debounce(() => rebuild(), 250)` called from `onDataUpdated()` to
  coalesce indexing storms. Save debounce ~500ms with a ~1000ms cooldown to skip
  self-triggered re-renders.
- **Frontmatter:** read synchronously from `metadataCache.getFileCache(file)?.frontmatter`;
  **write** via `app.fileManager.processFrontMatter(file, fm => …)` (await it; deleting a
  key clears a property — used for "clear date"). Case-insensitive key lookup helper.
- **Per-view state:** persist as JSON strings via `this.config.set(key, JSON.stringify(x))`
  and read back with `JSON.parse`.
- **Open note:** resolve `TFile`, `app.workspace.getLeaf().openFile(file)`.
- **Pointer-event DnD:** `pointerdown/move/up/cancel`, a `DRAG_START_THRESHOLD` (~5px),
  `setPointerCapture`, DOM mutation on drop, full cleanup on `pointercancel`.
- **Context menu:** positioned overlay; defer the click-outside listener with
  `setTimeout(0)`; clamp position to viewport via `requestAnimationFrame`.
- **Modals:** overlay + inner modal, Escape handler, cleanup on close.
- **Settings broadcast:** Immer `produce()` updates → `saveSettings()` → notify; views
  subscribe via an `onSettingsChange` callback returning an unsubscribe fn, cleaned up in
  `onunload`.
- **Value extraction:** `extractValue()` switching on `instanceof` for each `Value` type.
- **CSS isolation:** `@layer` ordering, import Tailwind theme + utilities **without
  preflight**, prefix all classes with the plugin prefix, style with Obsidian CSS vars.

---

## 4. Architecture

### 4.1 Proposed `src/app` file structure

```
src/
  main.ts                         # lifecycle only: load settings, register view, add settings tab
  styles.src.css                  # Tailwind source; scoped @layer kap-components
  app/
    plugin.ts                     # KanbanActionPlannerPlugin: settings load/save, Immer updates, onSettingsChange
    constants.ts                  # VIEW_TYPE = 'kanban-action-planner', CSS prefix 'kap-', defaults

    views/
      kanban/
        kanban-view.ts            # extends BasesView; lifecycle, debounced rebuild, mode switch (board/calendar)
        kanban-view-options.ts    # options() builder -> BasesAllOptions[] (status/order props, calendar toggle, date props, sort)
        kanban-view.spec.ts

    domain/
      profile.ts                  # Profile, ColumnDef, RelationshipRule, CalendarConfig, ColorConfig interfaces + Zod schemas
      board-model.ts              # BoardModel, Lane, CardModel (pure, derived)
      status.ts                   # status detection + column derivation (pure)
      status.spec.ts
      ordering.ts                 # fractional-midpoint math + renumber (pure)
      ordering.spec.ts
      relationships.ts            # relationship resolution + inverse lookup + blocked_by (pure)
      relationships.spec.ts
      filtering.ts                # relational filter predicates (pure)
      filtering.spec.ts
      calendar.ts                 # range computation (week/month/quarter/year), date bucketing (pure)
      calendar.spec.ts

    services/
      profile-service.ts          # resolve/merge profiles: SK mirror + local snapshot + overrides
      profile-service.spec.ts
      starter-kit.service.ts      # feature-detected SK API adapter; recognizeNoteType; settings read; mirror snapshot
      starter-kit.service.spec.ts
      frontmatter.service.ts      # read (metadataCache) + write (processFrontMatter), case-insensitive key lookup
      frontmatter.service.spec.ts
      value-extract.ts            # extractValue() over Bases Value union + null
      value-extract.spec.ts
      colors.service.ts           # palette assignment, theme-var resolution, translucent column shade, contrast
      colors.service.spec.ts

    ui/
      board/
        board-renderer.ts         # render lanes/columns/cards into containerEl
        column-renderer.ts
        card-renderer.ts
        dnd-controller.ts         # pointer-event drag/drop between columns + (later) cross-lane
      calendar/
        scheduling-panel.ts       # collapsible left panel, Unplanned/No-Deadline tabs
        calendar-grid.ts          # CSS-grid week/month/quarter/year + range switcher
        calendar-dnd.ts           # tab<->day drag to set/clear date props
      context-menu.ts             # right-click menu (change status / open note / copy wikilink)
      configure-board-modal.ts    # gear -> rich config (colors, relationships, calendar mappings, profile overrides)
      gear-button.ts

    settings/
      plugin-settings.intf.ts     # PluginSettings interface (extended)
      settings-tab.ts             # KanbanActionPlannerSettingTab
      defaults.ts                 # DEFAULT_SETTINGS

    utils/
      log.ts (existing)
      momentjs.ts                 # date formatting wrappers (default YYYY-MM-DD, configurable)
      dom.ts                      # small scoped DOM helpers
```

`main.ts` stays tiny: instantiate the plugin, load settings, `registerBasesView`, add the
settings tab. All board logic lives under `src/app`.

### 4.2 Core data model (TypeScript-ish)

```ts
// Curated palette key or explicit hex override.
type ColorSpec =
    | { kind: 'palette'; token: string } // resolved via Obsidian CSS var + curated map
    | { kind: 'hex'; value: string } // custom override

interface ColumnDef {
    id: string // stable key (often the status value)
    statusValue: string // raw status value mapped to this column
    label: string // display label (prefix stripped for display, kept for sort)
    sortKey: string // numeric/lexical prefix used for ordering columns
    color: ColorSpec // card color for this column; column bg = derived translucent shade
}

type RelationshipRole = 'parent' | 'sibling' | 'child' | 'blocked_by'

interface RelationshipRule {
    role: RelationshipRole
    // PRIMARY: explicit frontmatter property holding wikilink(s).
    linkProperty: string // e.g. 'parent', 'blocked_by'
    // SECONDARY heuristic: a note is a child if it is of an allowed type (by tag) AND links to source.
    heuristic?: {
        allowedTypeTags: string[] // tags identifying the related note type
        requiresLinkToSource: boolean
    }
}

interface CalendarConfig {
    enabled: boolean
    scheduledDateProperty: string // default 'date_scheduled' -> Unplanned tab
    dueDateProperty: string // default 'date_due'       -> No Deadline tab
    dateFormat: string // momentjs, default 'YYYY-MM-DD'
    defaultRange: 'week' | 'month' | 'quarter' | 'year'
    tabSort: 'manual_order' | 'time_estimate' | 'priority' | string
}

// How the board is grouped into horizontal swimlanes (issue #2).
type LaneGrouping =
    | { kind: 'none' } // single chrome-free lane
    | { kind: 'note-type' } // lane per recognized note type
    | { kind: 'property'; property: string } // lane per distinct value of a property

// Configurable card presentation (issues #3–#6).
interface CardFieldDisplay {
    property: string // property to show
    showLabel: boolean
    dateFormat?: string // momentjs, for date/datetime props
    emphasis?: 'normal' | 'due-red' // due date shown in red, etc.
}
interface CardPresentation {
    titleSource: { kind: 'note-name' } | { kind: 'property'; property: string } // #4 (fallback to note name)
    fields: CardFieldDisplay[] // #3 ordered body fields (default: due date in red)
    coverImageProperty: string | null // #5 wikilink/embed | vault path | URL; null = no cover
    wrapPropertyValues: boolean // #6 false = truncate+tooltip, true = wrap
}

// Archiving (issue #7).
interface ArchiveConfig {
    archiveFolder: string // supports placeholders: {{year}} {{month}} {{week}} {{quarter}} {{day}} {{date}} {{datetime}} {{uuid}}
    triggerStatus: string | null // status value that auto-archives on entry; null = manual only
}

interface Profile {
    id: string // stable profile id (mirrors SK note type id when sourced from SK)
    name: string // note-type name
    source: 'starter-kit' | 'local' // provenance
    typeRecognition: {
        // how a note is recognized as this type
        mappings: Array<{ type: 'tag' | 'folder' | 'regex'; value: string; enabled: boolean }>
    }
    statusProperty: string // resolved/overridden status property name
    orderProperty: string // default 'manual_order'
    columns: ColumnDef[] // derived from status allowedValues, prefix-ordered
    laneGrouping: LaneGrouping // #2 swimlane grouping dimension
    colors: { autoAssign: boolean; overrides: Record<string /*statusValue*/, ColorSpec> }
    card: CardPresentation // #3–#6 card rendering config
    archive: ArchiveConfig // #7 archive folder + optional status trigger
    relationships: RelationshipRule[]
    calendar: CalendarConfig
    // Local override layer applied on top of an SK-sourced snapshot.
    overrides?: Partial<
        Pick<
            Profile,
            | 'statusProperty'
            | 'orderProperty'
            | 'columns'
            | 'laneGrouping'
            | 'colors'
            | 'card'
            | 'archive'
            | 'relationships'
            | 'calendar'
        >
    >
}

interface CardModel {
    file: TFile
    entry: BasesEntry // re-read each update; not persisted
    statusValue: string | null // null -> Unmapped
    columnId: string // resolved target column ('unmapped' sentinel if null/invalid)
    order: number | null // from orderProperty
    blockedBy: string[] // resolved blocker note paths/links
    scheduledDate: string | null
    dueDate: string | null
}

interface Lane {
    profileId: string // the note type this lane represents
    label: string
    columns: ColumnDef[]
    cardsByColumn: Map<string /*columnId*/, CardModel[]> // 'unmapped' bucket included, hidden when empty
}

interface BoardModel {
    lanes: Lane[] // single recognized type => one chrome-free lane
    isMultiLane: boolean
}
```

All of these except `entry`/`file` are pure-derivable and unit-testable. Stored config
(`Profile`, its sub-objects, persisted per-view JSON) is validated with **Zod** on load.

### 4.3 Config flow

Three layers, resolved by `profile-service`:

1. **SK mirror (source of truth when present).** `starter-kit.service` feature-detects the
   API, reads `listNoteTypes()` / `getSettings()`, and writes a **read-only snapshot** into
   plugin data. Re-mirrored on SK settings changes / view rebuild. Provides: status
   `allowedValues` → columns, property names, type-recognition mappings. When SK is
   absent, this layer is empty and profiles are authored locally.
2. **Local profile store (plugin settings).** Persisted via Immer `produce()` +
   `saveSettings()`. Holds: the mirrored snapshot copy (survives SK removal), fully-local
   profiles when SK is absent, and the **kanban-owned rich config** (colors,
   relationships, calendar mappings) plus local overrides of SK-sourced fields. Authored
   through the **Configure board** modal.
3. **Per-view `this.config`** (`BasesViewConfig.get/set`). Holds view-scoped choices:
   selected status/order properties (via `BasesPropertyOption`), calendar mode toggle and
   its date props, active range, sort key, relational filters, panel collapse state.
   Stored as primitives or JSON strings.

Resolution order for any effective value: **per-view `this.config` override → local
profile/overrides → SK mirror → built-in defaults.** Views subscribe to settings changes
and re-render selectively; per-view changes call `this.config.set` then trigger a rebuild.

---

## 5. Milestones (internal, ordered, independently verifiable)

Each milestone is a valuable functional lockstep. No public release between them. Each
must satisfy the Definition of Done. Where a milestone touches UI, the implementer must
**flag the manual-verification checklist** and must not claim UI behavior works from a
green build alone.

### Milestone 0 — Remaining scaffolding / adaptation follow-ups — ✅ done (2026-06-26)

**Goal:** Finish project setup so feature work has a clean foundation. (Scaffold identity,
class renames, template-init removal, and green tsc/lint/test/build are already done.)

**Outcome:** Business Rules + Architecture/Domain Model/Configuration docs written; settings
model (Zod schema + defaults + profile store) and the `domain/profile.ts` config schemas in
place; `constants.ts`, the `KanbanActionPlannerView` placeholder + empty options builder, and
`registerBasesView` wiring done; Tailwind imported without preflight with scoped `.kap-root`
styles. `tsc`/`lint`/`bun test`/`build` green. Pending manual check in Obsidian: the "Kanban"
view appears in a Base's view picker and mounts the placeholder without errors.

**Tasks:**

- Flesh out `documentation/Business Rules.md` with the resolved design invariants from
  this plan (status-driven columns, no state machine, order persisted to note,
  SK-as-source-of-truth-mirrored-locally, kanban-owned colors/relationships/calendar,
  configurable swimlane grouping, config-driven card presentation, **responsiveness across
  desktop/mobile with documented graceful degradation**, **docs as first-class per-milestone
  deliverables**, big-bang delivery, no UI self-verification). (Initial pass already written.)
- Establish documentation structure: ensure `documentation/plans/` (this file),
  `documentation/history/yyyy-mm-dd.md`, and fill `Architecture.md` / `Domain Model.md` /
  `Configuration.md` stubs with the model from §4.
- Add the **settings model skeleton**: extend `plugin-settings.intf.ts` with profile store
    - defaults shapes (types only, empty defaults); add `defaults.ts`.
- Add the **view registration skeleton**: `constants.ts` (`VIEW_TYPE`, CSS prefix),
  `views/kanban/kanban-view.ts` (empty `BasesView` subclass that renders a placeholder),
  `kanban-view-options.ts` (returns `[]`), wire `registerBasesView` in `main.ts`.
- Add **style-scoping setup** in `styles.src.css`: `@layer` order, Tailwind theme +
  utilities import without preflight, root container class `.kap-root` + `kap-` prefix
  convention, a sample scoped rule.
- Add Zod as a dependency; create `domain/profile.ts` with interfaces + empty/placeholder
  Zod schemas. Add Immer wiring in `plugin.ts` if not already present.

**Files:** as listed in §4.1 (skeletons only).
**Data persisted:** empty/default `PluginSettings` (profile store present but empty).
**Manual verification in Obsidian:** the custom view type appears in a Base's view picker
and mounts a placeholder without console errors.
**Exit criteria:** view registers and mounts; settings load/save round-trips; DoD green;
docs updated.

---

### Milestone 1 — Core board: columns, Unmapped, drag/drop, order persistence — ✅ done (2026-06-26)

**Goal:** A working single-lane Kanban board driven by an auto-detected status property,
with manual ordering persisted to notes. No profiles/SK/colors-config yet (auto colors
only).

**Outcome:** Pure, unit-tested domain modules — `status.ts` (detection + column derivation +
prefix ordering + Unmapped resolution), `ordering.ts` (midpoint math + `planInsertion`
single-write-vs-renumber + precision-exhaustion guard), `board-model.ts` (single-lane
bucketing, sort, hide-empty-Unmapped) — plus `frontmatter.service.ts` (cached reads,
`processFrontMatter` writes/deletes, case-insensitive keys). UI: `board-renderer.ts`,
`card-renderer.ts`, and a pointer-event `dnd-controller.ts` (mouse/touch, threshold,
placeholder, post-drag click suppression, reduced-motion). `kanban-view.ts` assembles it,
writes status + order on drop, and offers a right-click `Menu` (open / set status / clear).
Reads raw frontmatter rather than Bases `Value` (lossless, testable) — noted as a deliberate
deviation from the plan's `value-extract` module; a Bases-`Value` adapter will be added when
formula/computed properties are needed. `docs/` (Overview/Usage/Configuration) updated.
`tsc`/`lint`/`bun test` (79)/`build` green. **Pending manual check in Obsidian.**

**Tasks:**

- `value-extract.ts`: `extractValue()` over the `Value` union + `null`.
- `status.ts`: status-property auto-detection (prefer field literally `status`, else any
  name containing `status`) and **column derivation** from observed/allowed values,
  ordered by numeric/lexical prefix; `Unmapped` bucket for null/invalid/missing; hide
  `Unmapped` when empty.
- `frontmatter.service.ts`: read via `metadataCache`, write via `processFrontMatter`
  (await), case-insensitive key lookup.
- `ordering.ts`: fractional float-midpoint placement (between two cards → midpoint;
  before first / after last → offset), and a **silent per-column renumber** on
  float-precision exhaustion. Single note write per move.
- `board-model.ts`: build `BoardModel`/`Lane`/`CardModel` from `this.data.data`.
- `ui/board/*`: render columns + cards into `containerEl`; `dnd-controller.ts` with
  pointer events (threshold, `setPointerCapture`, cleanup on cancel) for intra-board moves
  across columns and reordering within a column.
- On drop: set status property (cross-column) and/or `manual_order` (reorder) via a single
  frontmatter write; reduced-motion-aware transition.
- `kanban-view.ts`: debounced (`250ms`) rebuild on `onDataUpdated`; save cooldown to skip
  self-triggered re-renders.
- `kanban-view-options.ts`: `BasesPropertyOption` for status property and order property
  (with `filter`), defaulting to auto-detection.
- Auto color assignment (temporary, palette only) so columns/cards are visually distinct
  pre-config.

**Files:** create `value-extract.ts`, `status.ts`, `ordering.ts`, `board-model.ts`,
`frontmatter.service.ts`, `ui/board/*`; modify `kanban-view.ts`, `kanban-view-options.ts`,
`styles.src.css`. Co-located `.spec.ts` for each pure module.
**Data persisted:** `manual_order` and status value on the **note** (frontmatter);
selected status/order properties in per-view `this.config`.
**Manual verification in Obsidian:** notes appear as cards in correct columns; pre-config
everything sits in `Unmapped`; `Unmapped` hides once mapped; drag between columns changes
status in frontmatter; reorder within a column persists `manual_order`; dropping between
two cards yields a midpoint value; rapid moves don't corrupt order; precision-exhaustion
renumber is silent and correct.
**Exit criteria:** single-lane board fully usable with auto-detected status + manual order;
pure logic unit-tested; DoD green; manual checklist flagged.

---

### Milestone 2 — Profiles, SK auto-detect, Configure-board modal, colors — ✅ done (2026-06-26)

**Goal:** Introduce reusable note-type profiles, SK mirroring, the Configure-board modal,
and the full kanban-owned color system.

**Outcome:** `starter-kit.service.ts` (feature-detected, shape-defensive: list/recognize note
types, derive status property + allowed values, recognition mappings — pure parts tested).
`profile-service.ts` (complete default profiles, get-or-create + persist via Immer, SK
mirroring that preserves local color overrides, dominant-note-type recognition, column build
preserving SK order, color resolution — pure parts tested). `colors.service.ts` (curated
theme-aware palette, deterministic auto-assign, `color-mix` column shades, hex validation —
tested). UI: `configure-board-modal.ts` (auto-assign toggle + per-status palette/custom-color
pickers, persisted live), `gear-button.ts`, colors applied in the board/card renderers. Real
Bases view options (status/order `BasesPropertyOption`, show-empty toggle); the view reads
per-view property overrides. Settings tab exposes the global default property names. Per the
"no stubs" rule, the modal exposes only working controls (no relationship/calendar skeletons).
`tsc`/`lint`/`bun test` (100)/`build` green; `docs/` + technical docs updated. **Pending manual
check in Obsidian.**

**Tasks:**

- `starter-kit.service.ts`: feature-detect `app.plugins.plugins['obsidian-starter-kit']
?.api`; read `listNoteTypes()`, `getSettings()`, `recognizeNoteType(path)`; **mirror**
  into a local snapshot; degrade gracefully when absent. Map SK status `allowedValues` →
  `ColumnDef[]`, property names, recognition mappings.
- `profile-service.ts`: resolve effective profile via the layer order (per-view → local
  overrides → SK mirror → defaults); merge local rich config; persist via Immer.
- Extend `profile.ts` Zod schemas to fully validate stored profiles; add migration hook
  (schema version field).
- `colors.service.ts`: curated theme-aware palette resolved via Obsidian CSS vars;
  optional custom-hex override; auto-derive translucent column background from card color;
  default auto-assignment; contrast + reduced-motion checks.
- `ui/gear-button.ts` + `ui/configure-board-modal.ts`: gear in the view opens a modal to
  author colors (palette/hex per status), relationship rules (skeleton; wired in M4),
  calendar mappings (skeleton; wired in M5), and local overrides of SK-sourced fields.
  Persist to plugin data and/or per-view `this.config`.
- Settings tab: surface global defaults (default status/order/date property names, default
  palette).

**Files:** create `starter-kit.service.ts`, `profile-service.ts`, `colors.service.ts`,
`ui/gear-button.ts`, `ui/configure-board-modal.ts`; modify `profile.ts`, `settings-tab.ts`,
`plugin.ts`, `kanban-view.ts`. Co-located `.spec.ts`.
**Data persisted:** mirrored SK snapshot + local profiles + rich config in plugin settings;
view-scoped overrides in `this.config`.
**Manual verification in Obsidian:** with SK present, columns/properties auto-populate from
the recognized note type; disabling/removing SK keeps the board working from the mirror;
the Configure-board modal edits colors and they apply live; custom hex works; column
background is a translucent shade of the card color; palette is theme-aware (switch
light/dark).
**Exit criteria:** profile resolution + SK mirror + modal + colors all working; Zod
validation + migration hook in place; DoD green; manual checklist flagged.

---

### Milestone 2b — Card presentation (title, fields, cover, wrapping) — ✅ done (2026-06-26) — tracks [#3]–[#6]

**Outcome:** `utils/format.ts` (pure wikilink/scalar formatting — tested). `services/card-display.service.ts`
builds a `CardDisplay` per card: title (note name or property, [#4]), ordered type-aware body
fields ([#3]), an optional cover image resolved from a wikilink/path/URL ([#5]), wrap flag
([#6]), and an automatic red due-date chip when the due-date property is set. `card-renderer.ts`
renders cover + title + field chips + wrap class. The Configure-board modal gains a Cards
section (title source, cover property, wrap toggle, and an add/reorder/remove fields editor)
persisted via `setCardPresentation`. `tsc`/`lint`/`bun test` (108)/`build` green; verified live
(plugin reloads, board renders, red due dates show for notes with `date_due`). `docs/` updated.

**Goal:** Make the card renderer fully config-driven instead of hardcoded fields, authored
in the Configure-board modal and persisted per profile (with per-view override).

**Tasks:**

- `card-renderer.ts`: drive rendering from `CardPresentation`.
    - **Title source ([#4]):** note name (default) or a chosen property, falling back to the
      note name when empty. Click still opens the note. Applies in board and calendar modes.
    - **Body fields ([#3]):** an ordered, type-aware field list (date/number/text/list/tags/
      checkbox/link rendered appropriately); note name always present; due date in red as a
      default-on field.
    - **Cover image ([#5]):** optional, from a chosen property; resolve vault wikilink/embed
      or path via vault APIs, render external URLs directly; lazy-load; graceful fallback
      (no broken-image placeholder); `alt` from the card title. Reduced/optional in calendar.
    - **Wrapping ([#6]):** toggle — off = single-line truncate with full value in a `title`
      tooltip; on = wrap and grow card height.
- `configure-board-modal.ts`: add a **Card** section to choose title source, pick/reorder
  body fields, set cover-image property, and toggle wrapping; field/property choosers
  pre-populated from SK `PropertyDefinition`s when present, fully editable locally.
- Extend `profile.ts` Zod schemas for `CardPresentation`; migration-safe defaults.

**Files:** modify `card-renderer.ts`, `configure-board-modal.ts`, `domain/profile.ts`;
co-located `.spec.ts` for any pure formatting/selection logic.
**Data persisted:** `CardPresentation` in profile; per-view overrides in `this.config`.
**Mobile posture:** on mobile, default to a compact card (title + due date), collapse cover
height and limit visible fields to keep cards scannable — documented.
**Manual verification in Obsidian:** title property renders and falls back to note name;
body fields render type-aware in chosen order; cover image resolves for vault and URL
sources and fails gracefully; wrapping toggle truncates-with-tooltip vs wraps; all consistent
in board and (reduced) calendar cards; responsive on small/mobile.
**Exit criteria:** config-driven card renderer working for [#3]–[#6]; docs (`docs/` card
customization page + `documentation/` model) updated; DoD green; manual checklist flagged.

---

### Milestone 3 — Swimlanes (configurable grouping) — ✅ done (2026-06-26) — tracks [#2]

**Outcome:** Multi-lane board model in `domain/board-model.ts`: `buildBoard(cards, columns,
{ grouped, unmappedPosition, ungroupedPosition })` returns a `Board<T>` with `lanes:
BoardLane[]` and an `isMultiLane` flag. Cards carry an optional `laneValue`; grouping splits
them into one lane per distinct value (ordered by numeric/lexical prefix via
`compareStatusValues`), plus an `Ungrouped` lane (`UNGROUPED_LANE_ID`) for missing values —
included only when non-empty, placed last by default. Grouping that yields a single lane stays
chrome-free (`isMultiLane: false`), mirroring the Unmapped-column rule.
`board-renderer.ts` renders a chrome-free `.kap-board` for single-lane boards and a stack of
collapsible `.kap-lane` swimlanes (header = ▾/▸ toggle + label + count; each lane owns its
column row) otherwise; columns carry both `data-column-id` and `data-lane-id`.
`dnd-controller.ts`’s `DropTarget` gained `laneId`. The view resolves grouping per-view
(`laneGrouping` / `laneGroupingProperty` view options, with a `__profile__` sentinel deferring
to the profile) else from `profile.laneGrouping`; computes each file’s lane value
(note-type name via `recognizeNoteType`, or the chosen property’s scalar) in the async
`resolveAndRebuild`; and on **cross-lane drag** writes the grouping property to the target
lane’s value (or clears it for Ungrouped). Note-type lanes can’t be safely reassigned, so a
cross-lane drop there is ignored and logged (intra-lane drag unchanged). Collapsed-lane state
is in-memory (per session). The Configure-board modal gained a **Swimlanes** section
(`setLaneGrouping`). Lane grouping is unit-tested (`buildBoard`, 6 cases; 113 tests total);
`tsc`/`lint`/`build` green. **Verified live in Obsidian** (see harness below): property
grouping → Alpha/Beta/Ungrouped lanes with correct counts and per-lane columns; collapse
toggle hides a lane body; cross-lane drag of Task E set `project: 10 Alpha` + `status: 20
Doing` and re-rendered; `none` and (SK-less) `note-type` both degrade to a chrome-free single
board; no console errors.

**Goal:** Lane-capable rendering with a **configurable grouping key**. Grouping by note
type is one mode; grouping by an **arbitrary property** is the generalized mode. Single
implicit lane stays chrome-free; multiple lanes render swimlane chrome with per-lane
columns/colors. (Cross-lane drag is the later internal step within this milestone.)

**Tasks:**

- `board-model.ts`: introduce a **`laneGrouping`** dimension — `'none'` (single chrome-free
  lane), `'note-type'` (via SK `recognizeNoteType` / local recognition mappings), or
  `'property:<name>'` (group by the distinct values of a chosen property). Build lanes
  accordingly; an **`Ungrouped`** lane collects cards missing the grouping value, hidden
  when empty (mirrors the `Unmapped` column rule). `isMultiLane` flag.
- Lane ordering by numeric/lexical prefix or a configurable order (consistent with column
  ordering); collapsible lanes with header value + card count.
- `kanban-view-options.ts`: a control to choose the grouping key — `'none'` / `'by note
type'` / a `BasesPropertyOption` to pick the grouping property; also surfaced in the
  Configure-board modal / profile.
- `ui/board/board-renderer.ts`: render one chrome-free lane when grouping is `'none'` or
  resolves to a single lane; render swimlane chrome (lane header, per-lane columns/colors)
  otherwise.
- **Cross-lane drag** (internal sub-step): dragging a card to another lane sets the
  **grouping property** to the target lane's value (for `property:` grouping) or changes
  the type-relevant status / recognized type (for `note-type` grouping), and recomputes
  `manual_order` in the destination cell — guarded and clearly flagged for manual
  verification; intra-lane behavior unchanged.

**Files:** modify `board-model.ts`, `ui/board/*`, `dnd-controller.ts`,
`kanban-view-options.ts`, `domain/profile.ts` (add `laneGrouping`). Co-located `.spec.ts`
for lane grouping logic.
**Data persisted:** `laneGrouping` choice in profile / `this.config`; status/order on notes
unchanged; grouping-property value (or type/status) written via frontmatter on cross-lane
drag.
**Mobile posture:** dense 2-D swimlanes are desktop/large-screen first; on mobile, degrade
to a lane switcher/accordion (one lane expanded at a time) rather than a full grid — documented.
**Manual verification in Obsidian:** `none` grouping looks like a plain board (no lane
chrome); `by note type` shows one lane per type; `by property X` shows one lane per distinct
value with an `Ungrouped` lane that hides when empty; intra-lane drag behaves as in M1;
cross-lane drag updates the right property; lane collapse/reorder work; usable on mobile via
the degraded layout.
**Exit criteria:** all three grouping modes render correctly; lane grouping unit-tested;
docs (`docs/` swimlanes page + `documentation/` model) updated; DoD green; manual checklist
flagged (especially cross-lane semantics).

---

### Milestone 4 — Relationships, blocked_by, relational filtering — ✅ done (2026-06-26)

**Outcome:** Pure `domain/relationships.ts` resolves `parent`/`sibling`/`child`/`blocked_by`
from per-note records combining **direct** role link-properties, **inverse** reverse lookup
(`parent`↔`child`, `sibling` symmetric), and a **link-scoped tag heuristic** (a note carrying
an allowed type tag and linking to a source counts as that role); direct links may leave the
board set, inverse/heuristic only form between known notes. `domain/filtering.ts` adds the
blocked filter (`all`/`only`/`hide`). `services/relationships.service.ts` bridges the metadata
cache (tags via `getAllTags`, role links via `frontmatterLinks` + `getFirstLinkpathDest`,
outgoing links via `metadataCache.resolvedLinks`), with per-role link-property names from the
profile's rules (missing → per-role default; explicit empty → disabled). Cards gained a
relationship badge row (`▲`/`▼`/`↔` + count, red `⛔` blocked badge); a non-empty `blocked_by`
also gives the card a red left accent. **Each role collapses into one counted badge** — a card
blocked by N notes shows `⛔ N` (tooltip lists them). Clicking a badge opens the single related
note, or a picker menu when there are several; **Ctrl/Cmd-click opens in a new tab** (badge and
menu items). The card context menu lists related notes too. The view applies the
blocked filter before building the board, exposes it as a `blockedFilter` view option, and the
Configure-board modal gained a **Relationships** section (per-role link-property pickers + a
"detect children by tag" heuristic input). Default profiles seed the four role rules. Domain
is unit-tested (relationships 12 cases + filtering, 129 tests total); `tsc`/`lint`/`build`
green. **Verified live in Obsidian:** with link-properties on the fixtures, A→children C/D, C/D
inverse-parent A, C↔D siblings, B/F blocked (red accent + badge) all resolved; the blocked
badge navigated to the blocker; a multi-child badge opened a C/D menu; `blockedFilter: only`
narrowed the board to B/F; zero console errors. (Tag heuristic covered by unit tests; flag for
live check with tagged notes.)

**Goal:** Per-profile relationships with detection, inverse lookup, blocked-by handling,
and relational filters layered on Bases filters.

**Tasks:**

- `relationships.ts`: resolve `parent`/`sibling`/`child`/`blocked_by`. **Primary:** explicit
  link-property frontmatter holding wikilinks (per role, configurable). **Secondary:**
  tag+link heuristic (note is a child if it is of an allowed child type by tag AND links to
  the source). **Inverse** relations via reverse lookup over the entry set.
- `blocked_by`: non-empty → visual flag on the card, a "navigate to blockers" affordance,
  and a filter toggle. No auto-transition.
- `filtering.ts`: relational filter predicates (only tasks for project X; only goals that
  have projects; only projects with tasks; by tag/name) applied on top of `this.data.data`.
- Wire relationship rules + filters into the Configure-board modal and per-view options
  (e.g. `BasesPropertyOption` for each role's link property; toggles/text for filters).
- Card renderer: render blocked flag + relationship affordances.

**Files:** create `relationships.ts`, `filtering.ts`; modify `card-renderer.ts`,
`configure-board-modal.ts`, `kanban-view-options.ts`, `profile.ts`. Co-located `.spec.ts`.
**Data persisted:** relationship rules + filter selections in profile / `this.config`;
relationships themselves read from note frontmatter (not written by this milestone).
**Manual verification in Obsidian:** relationships resolve from link properties; the tag+
link heuristic finds implicit children; inverse relations show on both ends; a card with
non-empty `blocked_by` shows the flag and can navigate to blockers; relational filters
narrow the board correctly while respecting the Base's own filters.
**Exit criteria:** resolution + inverse + filtering unit-tested; blocked-by UX present; DoD
green; manual checklist flagged.

---

### Milestone 4b — Archiving — ✅ done (2026-06-26) — tracks [#7]

**Goal:** Move a card's note to a configurable, placeholder-driven archive folder, manually
or via an optional status trigger.

**Delivered:** `utils/expressions.ts` (pure placeholder resolution: `{{year}}` `{{month}}`
`{{week}}` `{{quarter}}` `{{day}}` `{{date}}` `{{datetime}}` `{{uuid}}`, case-insensitive,
unit-tested) + `services/archive.service.ts` (resolve folder, create intermediate folders,
collision-safe `uniqueDestPath`, move via `fileManager.renameFile`; guarded + logged + tested
pure parts). View wires a context-menu **Archive** action (shown only when configured; warns
non-blockingly about active children/blockers, then moves) and opt-in **status-triggered**
auto-archive in `applyMove` (fires only on a _transition into_ `triggerStatus`, never on a
reorder within it; skips the order write since the note leaves the board). Configure-board
**Archiving** section (folder template + trigger-status dropdown; folder edits persist without
re-rendering to keep input focus, both edits read freshest config to avoid clobbering).
`setArchiveConfig` service. Live-verified in Obsidian (see history 2026-06-26). 147 tests green.

**Tasks:**

- `utils/expressions.ts` (or extend `momentjs.ts`): resolve placeholders `{{year}}`,
  `{{month}}`, `{{week}}`, `{{quarter}}`, `{{day}}`, `{{date}}`, `{{datetime}}`, `{{uuid}}`
  (+ case variants) in a folder path. Reuse Starter Kit's expression resolution when present;
  otherwise resolve locally with the same token set. Pure + unit-tested.
- `services/archive.service.ts`: resolve the archive folder, create intermediate folders,
  and **move the note** via `app.fileManager.renameFile` (links update). Guarded, logged.
- Manual archive: context-menu "Archive" action (and optional per-column action). Archived
  notes leave the board (excluded / no longer match the Base filter once moved).
- Optional **status-triggered archiving**: per-profile `triggerStatus`; when a card
  transitions into it (drag/menu), auto-archive. Strictly opt-in; guard against accidental
  mass-archiving; log each action.
- Relationship awareness: if the note still has active children/blockers, surface a
  non-blocking warning (default: move anyway, links intact) — refine per [#7].
- Wire `ArchiveConfig` into the Configure-board modal + Zod schema + migration defaults.

**Files:** create `services/archive.service.ts`, `utils/expressions.ts`; modify
`context-menu.ts`, `configure-board-modal.ts`, `domain/profile.ts`, `kanban-view.ts`.
Co-located `.spec.ts` for placeholder resolution.
**Data persisted:** `ArchiveConfig` in profile; the note is **moved** on archive (vault
filesystem change).
**Mobile posture:** archive action reachable via context menu / long-press on mobile.
**Manual verification in Obsidian:** manual archive moves the note to the resolved folder
(placeholders correct, folders created, links preserved); status-triggered archive fires
only for the configured status and only when enabled; warning shows for notes with active
relationships; card leaves the board.
**Exit criteria:** placeholder resolution unit-tested; manual + optional auto archiving work;
docs (`docs/` archiving page + `documentation/` model) updated; DoD green; manual checklist
flagged (file moves are destructive-ish — verify carefully).

---

### Milestone 5 — Calendar mode

**Goal:** The calendar/scheduling experience. Built in independently-verifiable sub-steps.

**5a — Scheduling panel + tabs**

- `scheduling-panel.ts`: collapsible left panel; title `Scheduling` always visible
  (vertical text when collapsed); two tab sub-columns — `Unplanned` (notes lacking the
  scheduled-date prop, default `date_scheduled`) and `No Deadline` (notes lacking the
  due-date prop, default `date_due`).
- `kanban-view-options.ts`: `BasesToggleOption` to enable calendar mode; `BasesPropertyOption`
  for the scheduled/due date props.
- Verify: toggling calendar mode shows the panel; tabs bucket cards by missing date prop;
  collapse/expand works and keeps the vertical title.

**5b — Calendar grid + range switching**

- `calendar.ts`: compute week/month/quarter/year ranges and bucket cards by date.
- `calendar-grid.ts`: CSS-grid calendar with easy week/month/quarter/year switching
  (`BasesDropdownOption` for default range). Calendar shows cards by **scheduled OR due**
  date depending on the active tab. Cards show minimal info (note name + due date in red
  if set); click opens the note.
- Verify: range switching re-lays-out the grid; cards land on correct days for the active
  tab's date dimension; click opens the note.

**5c — Drag tab → day sets date**

- `calendar-dnd.ts`: drag a card from a tab onto a day → write the relevant date property
  (`date_scheduled` or `date_due` per active tab) as a momentjs-formatted string (default
  `YYYY-MM-DD`, configurable via `momentjs.ts` + option).
- Verify: dropping on a day writes the correct property/format; the card moves out of the
  tab onto the calendar.

**5d — Drag day → tab clears date**

- `calendar-dnd.ts`: drag a card from the calendar back to the tab → **clear** the relevant
  date property (delete the frontmatter key).
- Verify: dropping back onto the tab removes the property and returns the card to the tab.

**5e — Sorting + filtering in tabs**

- Card sort in tabs configurable (`manual_order` / time estimate / priority / …) via
  `BasesDropdownOption`; filter by tags/name.
- Verify: changing sort reorders tab cards; tag/name filter narrows tab contents.

**Files:** create `calendar.ts`, `ui/calendar/*`; modify `kanban-view.ts`,
`kanban-view-options.ts`, `utils/momentjs.ts`. Co-located `.spec.ts` for range/bucketing/
date-format logic.
**Data persisted:** scheduled/due date properties on notes; calendar config in profile;
mode/range/sort/filter in `this.config`.
**Manual verification in Obsidian:** full drag-to-schedule and drag-to-clear round trips;
correct date format; red due-date styling; reduced-motion-aware animations.
**Exit criteria:** all five sub-steps working and individually verifiable; date logic
unit-tested; DoD green; manual checklist flagged.

---

### Milestone 6 — Visual stability & consistency (polish pass)

**Goal:** The board should feel solid and predictable — uniform card/column sizing and
**stable, minimal, smooth** updates when the underlying note set changes. No layout jumps,
no full-board flicker on every edit.

**Tasks:**

- **Uniform card size within a lane.** Cards in the same lane (and ideally the whole board)
  share a consistent size regardless of how much content they hold: a card with more fields
  must not become taller/wider than its neighbours in a disruptive way. Approaches to weigh
  (pick per the responsiveness invariant, document the choice): a fixed/min card height per
  lane with internal overflow handling (clamp/ellipsis, consistent with the existing
  wrap/truncate option), or a measured max-height applied uniformly. Cover images, field
  chips, and titles must all fit the chosen envelope without breaking the grid. Must respect
  the per-card **wrap** option (M2b) — reconcile "wrap = grow" with "uniform size" (e.g. wrap
  grows up to the shared cap, then scrolls/clamps).
- **Equal column widths.** All columns render at the same width (already fixed-width today;
  make it an explicit invariant and verify it holds across lanes, with show-empty columns,
  and on narrow/mobile). Lane column rows should align so columns line up visually across
  lanes where layout allows.
- **Stable, incremental refresh.** Today `onDataUpdated` triggers a debounced **full**
  `rebuild()` + `renderBoard()` that calls `rootEl.empty()` and recreates every node. Replace
  this with a **diffing/reconciliation** pass that touches only what changed: add/remove/move
  only the affected cards, update only changed fields, and leave untouched columns/lanes (and
  scroll position, collapsed-lane state, focus, in-flight drag) intact. When a note is
  created/updated/removed the board must update in place — no scroll reset, no flash, no
  re-layout of unaffected cards. Keep it dependency-free (no UI framework); a small keyed
  reconciler over `data-card-key` / `data-column-id` / `data-lane-id` is enough.
- Preserve **scroll position** (board horizontal scroll + each column's vertical scroll +
  the `.kap-lanes` vertical scroll) and **collapsed-lane state** across updates.
- Respect `prefers-reduced-motion`: transitions for card moves are opt-in and disabled under
  reduced motion (consistent with the existing DnD policy).

**Files:** likely a new `ui/board/reconcile.ts` (pure-ish keyed diff) + changes to
`board-renderer.ts` (render vs patch paths), `kanban-view.ts` (call patch instead of full
re-render on `onDataUpdated`), and CSS for the uniform-size envelope. Co-located `.spec.ts`
for the diff logic.
**Data persisted:** none (pure presentation/rendering concern).
**Mobile posture:** uniform sizing must not overflow on narrow screens; the accordion/lane
collapse still applies. Document any mobile-specific card-size envelope.
**Validation (live harness — mandatory):** with the board open, create/edit/delete a note in
`KanbanTest/` via the `obsidian` CLI and assert (via `eval`/`dev:dom`) that only the affected
card node changed (others keep identity/scroll), the board didn't scroll-reset, and
`dev:errors` stays clean; screenshot before/after to confirm no layout shift. Verify all cards
in a lane report equal heights and all columns equal widths with `getBoundingClientRect`.
**Exit criteria:** uniform card/column sizing verified; incremental refresh leaves unaffected
DOM untouched (proven in the harness); scroll/collapse/focus/drag preserved across updates;
diff logic unit-tested; docs updated; DoD green; manual checklist flagged.

---

### Milestone 7 — Settings harmonization & simplification

**Goal:** Collapse the current **three** configuration surfaces into a clear, non-overlapping
model. Today there are: (1) **global plugin settings** (settings tab), (2) **Bases "Configure
view"** options (`kanban-view-options.ts`), and (3) the **top-right cog → Configure board**
modal. (2) and (3) overlap and confuse which layer owns a setting.

**Target model:**

- **(1) Global plugin settings** — only true vault-wide defaults (default property names,
  default statuses, default date format). Unchanged in spirit; audited for scope creep.
- **(2) Per-view / board settings** — a **single** surface. **"Configure view" is the standard
  for Obsidian Bases views**, so prefer consolidating everything board/profile-level there;
  the top-right cog should either be **removed** in favour of "Configure view", or become a
  thin shortcut that opens the _same_ settings (no second, divergent UI). Decide one of:
    - **a.** Fold the Configure-board modal's controls (colors, cards, swimlanes) into the
      Bases "Configure view" options panel and drop the cog; or
    - **b.** Keep the cog/modal as the rich editor but make "Configure view" options a strict
      subset that delegates to it, so there's a single source of truth and no duplicated
      controls.
      (Recommendation to validate with the user: **a** — one Obsidian-native surface — unless the
      Bases options panel can't host the richer controls, then **b**.)
- Make the **per-view vs profile** resolution legible in the UI (the §4.3 precedence): show
  which layer a value comes from and whether it's an override (addresses the §8 "per-view vs
  profile config overlap" risk).

**Tasks:**

- Inventory every setting across the three surfaces; mark each as global / per-view / profile,
  and flag duplicates and orphans.
- Pick model (a) or (b) **with the user**, then unify: remove the duplicate surface, route all
  board/profile edits through one place, keep global settings minimal.
- Update `settings-tab.ts`, `kanban-view-options.ts`, `configure-board-modal.ts` (+
  `gear-button.ts`) accordingly; preserve stored data (no settings migration that drops
  profiles/overrides).
- Update `docs/` (usage/configuration) and `documentation/` to describe the final two-surface
  model.

**Files:** `settings/settings-tab.ts`, `views/kanban/kanban-view-options.ts`,
`ui/configure-board-modal.ts`, `ui/gear-button.ts`, `views/kanban/kanban-view.ts`.
**Data persisted:** unchanged shapes; only _where the UI lives_ changes. Any consolidation
must be backward-compatible with existing `this.config` / profile data.
**Validation (live harness — mandatory):** confirm every previously-working control still
works from its new home (status/order/statuses, colors, cards, swimlanes), per-view overrides
still take effect, and existing boards/profiles load unchanged; `dev:errors` clean.
**Exit criteria:** exactly two configuration surfaces (global settings + one per-view/board
surface, "Configure view"-first); no duplicated controls; layer provenance legible; docs
updated; DoD green; manual checklist flagged.

> **Note:** this is a UX-direction milestone — **confirm the (a)/(b) decision with the user
> before implementing**, since it removes a currently-shipping surface.

---

### 1.0 cut

After all milestones exit green and all manual checklists are confirmed in Obsidian, bump the
version from `0.0.0` to `1.0.0`, finalize README/docs, and cut the **single big-bang
release**.

---

## 6. Cross-Cutting Concerns

- **Style scoping:** All markup mounts under a single root container class `.kap-root`.
  Every class is `kap-`-prefixed. `styles.src.css` imports Tailwind theme + utilities
  **without preflight** and uses `@layer kap-components`. Colors/backgrounds/interactive
  states use Obsidian CSS vars via `var(--…)`; layout/spacing/typography use Tailwind
  utilities. Never edit the generated root `styles.css`.
- **Accessibility:** Keyboard support for card actions (move/reorder, open, context menu)
  alongside pointer DnD. Respect `prefers-reduced-motion` (disable/limit transitions and
  drag animations). Ensure card/column color contrast against derived backgrounds; verify
  curated palette tokens meet contrast in both light and dark themes. Context menu and
  modal are focus-trapped and Escape-dismissible.
- **Responsiveness (invariant):** Every surface works on large desktop, small/narrow
  desktop, and mobile. Board/lanes/columns scroll horizontally and reflow; the Scheduling
  panel and calendar grid adapt or collapse; cards stay scannable at narrow widths. One
  Pointer-event DnD path serves mouse/trackpad/touch; touch targets ≥ ~40px; every drag has
  a non-drag fallback (long-press / context menu). Deliberate mobile degradation is allowed
  and **documented per milestone** as a "mobile posture" note (full / degraded-how /
  desktop-only); broken/overflowing layouts are never acceptable. CSS uses fluid layout
  (flex/grid, container/media queries) over fixed pixel widths.
- **Performance / virtualization:** Target ~1–2k cards/board smoothly with plain DOM.
  Re-read `this.data` each update; debounce rebuilds (~250ms); coalesce saves
  (~500ms debounce, ~1000ms cooldown). Keep `BoardModel` derivation pure and cheap.
  Virtualize columns/lanes (visible-range rendering + spacers) **only if** profiling shows
  jank — designed for, not built now.
- **Error handling:** All SK calls feature-detected and guarded (`ApiResult` checked, no
  exceptions assumed). `getValue` null-checked before render. `extractValue()` handles
  every `Value` variant defensively. Frontmatter writes awaited; failures logged via
  `log.ts` and surfaced non-destructively (no silent data loss; no partial multi-writes —
  one write per move).
- **Zod validation:** All stored config (profiles, color/relationship/calendar config, and
  per-view JSON blobs) validated with Zod on load; invalid data falls back to defaults with
  a logged warning rather than throwing.
- **Migration / versioning:** Profile/settings schema carries a `schemaVersion`. A
  migration step runs on load to upgrade older shapes before Zod validation. SK has no API
  versioning, so the SK adapter feature-detects each method and tolerates shape drift,
  always re-deriving the mirror snapshot rather than trusting a cached one blindly.

---

## 7. Testing Strategy

**Unit-testable pure logic (co-located `.spec.ts`, `bun test`):**

- `ordering.ts` — midpoint math, before-first/after-last placement, precision-exhaustion
  renumber, stability under repeated moves.
- `status.ts` — auto-detection precedence (literal `status` vs name-contains-`status`),
  column derivation + prefix ordering, Unmapped bucketing, hide-when-empty.
- `value-extract.ts` — every `Value` variant + `null`.
- `relationships.ts` — primary link-property resolution, tag+link heuristic, inverse
  lookup, blocked_by extraction.
- `filtering.ts` — each relational predicate, composition with Base-provided sets.
- `calendar.ts` — week/month/quarter/year range computation, date bucketing per active tab.
- `momentjs.ts` — date formatting/parsing with configurable format.
- `colors.service.ts` — palette assignment determinism, translucent-shade derivation,
  contrast checks (logic only).
- `profile-service.ts` — layer resolution order and override merging.

**Must be manually verified in Obsidian (flag in each milestone's final message):**

- View registration and mounting; placeholder/board rendering.
- Drag/drop (intra-column reorder, cross-column status change, cross-lane moves,
  tab↔calendar date set/clear) and resulting frontmatter writes.
- Live color application, theme awareness, contrast, reduced-motion behavior.
- SK presence/absence behavior and mirror survival when SK is disabled/removed.
- Configure-board modal and context-menu interactions.
- Calendar layout, range switching, red due-date styling, click-to-open.

The implementer must never claim UI behavior works based on a green build alone.

### Live testing harness (set up 2026-06-26)

The plugin can be exercised in the real vault at `OBSIDIAN_VAULT_LOCATION`
(`/home/dsebastien/notesSeb`) via the `obsidian` CLI:

- **Watch/deploy:** `bun run dev` rebuilds on change and copies the plugin into
  `<vault>/.obsidian/plugins/obsidian-kanban-action-planner/` with a `.hotreload` marker.
  (Folder is the package name; Obsidian registers the plugin by its manifest `id`,
  `kanban-action-planner`.)
- **Enable / reload:** `obsidian plugin:enable id=kanban-action-planner`;
  `obsidian reload` to reindex; `obsidian plugin:reload id=kanban-action-planner` after a build.
- **Test fixtures (committed to the vault, not this repo):** `KanbanTest/` holds Task A–F
  notes (statuses `10 Todo` / `20 Doing` / `30 Done`, one with no status → Unmapped, varied
  `manual_order`). `KANBANTESTBASE.base` at the vault root filters `file.inFolder("KanbanTest")`
  and declares a `kanban-action-planner` view named "Kanban".
- **Inspect:** `obsidian base:query path=KANBANTESTBASE.base`, `obsidian base:views` (with the
  base active), `obsidian open path=KANBANTESTBASE.base`, `obsidian plugins:enabled`.
- **Verified 2026-06-26:** plugin loads without throwing; the base opens; `base:views` reports
  `Kanban → kanban-action-planner`. Visual confirmation of board rendering/drag/colors is done
  by the user watching Obsidian (still not agent-self-verifiable).

---

## 8. Open Questions / Risks / Future

- **State machine (future).** No transition enforcement now; all transitions allowed.
  Architecture (profile + columns, no allowed-transitions model) is left open to add an
  allowed-transitions layer + validation later without reshaping the data model.
- **SK API stability.** No semantic versioning; methods are feature-detected. Risk of shape
  drift across SK versions — mitigated by re-deriving the mirror and Zod-validating.
- **`recognizeNoteType` async timing.** May be unavailable during SK reload; views must
  tolerate transient `null`/unavailable results and re-derive on next `onDataUpdated`.
- **Bases `Value` variants.** Abstract `Value` with no `ErrorValue` class; defensive
  extraction required and may need expansion as new variants appear.
- **Performance ceiling.** ~1–2k cards target without virtualization; if real vaults exceed
  this smoothly-renderable size, add visible-range virtualization (designed for in §6).
- **Cross-lane drag semantics.** Changing a note's recognized type via drag is powerful and
  potentially surprising; needs careful UX and explicit manual verification.
- **Heuristic relationship detection** (tag+link) may produce false positives in messy
  vaults; explicit link-properties remain primary and recommended.
- **momentjs dependency.** Use Obsidian's bundled moment for formatting; confirm the
  configurable format covers user locales without extra deps.
- **Per-view vs profile config overlap.** Resolution order is defined (§4.3), but UX must
  make clear which layer a given setting comes from to avoid confusion in the
  Configure-board modal vs Bases options.

### Tracked GitHub issues

These enhancements are folded into the milestones above and tracked as issues:

- [#2] Swimlanes: group the board into horizontal lanes by a configurable second property
  → Milestone 3.
- [#3] Cards: configurable property display → Milestone 2b.
- [#4] Cards: configurable card title property → Milestone 2b.
- [#5] Cards: optional cover image → Milestone 2b.
- [#6] Cards: toggle property text wrapping → Milestone 2b.
- [#7] Archiving: configurable archive folder + optional status-triggered archiving →
  Milestone 4b.

[#2]: https://github.com/dsebastien/obsidian-kanban-action-planner/issues/2
[#3]: https://github.com/dsebastien/obsidian-kanban-action-planner/issues/3
[#4]: https://github.com/dsebastien/obsidian-kanban-action-planner/issues/4
[#5]: https://github.com/dsebastien/obsidian-kanban-action-planner/issues/5
[#6]: https://github.com/dsebastien/obsidian-kanban-action-planner/issues/6
[#7]: https://github.com/dsebastien/obsidian-kanban-action-planner/issues/7
