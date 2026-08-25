# GTD Contexts

Status: design (not started), reconciled with an adversarial review. Owner: maintainer decisions in §9 gate the build order in §7.

Add GTD-style contexts (`@work` / `@home` / `@errands`) as a **multi-value frontmatter list property**, surfaced across every view. The guiding constraint (from the maintainer): **reuse existing patterns, do not invent new machinery.** This design honours that — the MVP is one global setting + a zoom-term-modelled managed filter term + a filter chip + a toolbar switcher, with zero filter-engine changes. Where genuinely new code is unavoidable (the multi-value `getContextTerms` round-trip, the reserved-name guard, the card-menu list-toggle) it is flagged and justified. The core serialization was corrected after review: all selected values live in ONE comma-separated token so they OR (two tokens would AND — the original bug).

---

## 1. Concept & data model

-   **Contexts are a multi-value list frontmatter property.** The default property name is `contexts` (plural → the convention that it is a YAML list). A note carries `contexts: [@work, @home]`.
-   **The property name is a single GLOBAL setting**, `defaultContextsProperty` (default `'contexts'`), following the fixed pattern of `defaultProgressProperty` / `defaultMilestonesProperty` / `defaultBlockedByProperty` (§4). It is **intentionally global, NOT per-type** — GTD contexts are cross-cutting (`@errands` spans projects, tasks, any note type), so a per-type override contradicts the domain and would drag in mixed-board per-type resolution for no benefit. This is a deliberate, documented deviation from the per-type property pattern used by status/estimate/done/relationships.
-   **Multi-value is carried implicitly, not by a schema flag:** the plural default name signals a list, and writes route through the existing list add/remove helpers rather than a scalar `setProperty`. There is **no** `isMultiValue` boolean to add. The plugin degrades gracefully if a user points the setting at a scalar property (a bare value flattens to a one-element list for filtering and reads as one context).
-   **Filtering is already supported with zero engine changes.** `card-search.service.ts` indexes every frontmatter key into `rec.props`, and `stringifyForSearch` flattens arrays into separate lowercased entries. `matchQualifier` falls through to `rec.props.get(name)` for any non-reserved name (`filter-query.ts:313-315`). So `contexts:work` already filters, `contexts:work,home` is already comma-OR within the field, and list membership matches on ANY element, case-insensitively. **Contexts must ride this generic path and must NOT get a reserved qualifier name** — reserving it (like `status`/`parent`/`due`) would break user renames and duplicate engine logic.

### Active-context state model — PER-VIEW, embedded in `filterQuery` (recommended)

**Recommendation: strictly per-view; there is no separate "active context" state anywhere.** The active context lives as a managed `<contextsProp>:<values>` term inside each view's raw `filterQuery` string — exactly the zoom-term model. Justification:

-   **Per-view is free.** `filterQuery` already persists per-view to the `.base` file and stays ephemeral inside embeds via the `EmbedAwareConfig` funnel. No new persistence surface, no cross-view state, no refresh fan-out.
-   **It composes correctly.** A context term ANDs with any typed query and with the zoom (`parent:`/`ancestor:`) term because they are space-separated clauses in one group (`group.every`). Two embedded views on one dashboard can pin different contexts. An embed's `context=` pin never leaks into a global mode.
-   **It survives mode switches for free.** `filterQuery` is mode-independent, so `setViewMode` carries the context across board/WBS/calendar/timeline/triage untouched (unlike zoom, which is board-tree-specific).
-   **Perspectives (#114) capture it for free** — the context is already one qualifier inside the saved query (§6).

A global "sync all views to @work" gesture, if ever wanted, is layered later as a **command** that writes the context term into each open view's `filterQuery` — an action, not persistent global state.

---

## 2. The core mechanism — managed `contexts:` term + switcher + chip

This is the backbone. Three pieces, all clones of the zoom machinery.

### 2a. Context-term string helpers (NEW module block — justified clone)

Add a `// ── Context term helpers ──` block to `src/app/domain/filter-query.ts` (after the zoom helpers at `:337-399`), a **direct structural clone** of `setZoomTerm`/`getZoomTerm`/`removeZoomTerm`. This is new code, but it is the smallest possible new surface and mirrors an established, tested pattern verbatim.

Signatures (property name is a **parameter**, never hardcoded — so a renamed setting keeps working):

```ts
// token predicate: the managed context token for `prop` (case-insensitive name match),
// mirroring isZoomToken's /^(parent|ancestor):/i approach.
function isContextToken(token: string, prop: string): boolean

// serialize ALL selected values into ONE token with comma-separated quoted values, so the
// whitespace tokenizer keeps them in a single clause and matchQualifier ORs them via
// splitValues' comma-OR. Quote each value so spaces / leading '@' survive; strip embedded
// quotes like zoomToken (the tokenizer has no escapes).
function contextToken(prop: string, values: string[]): string // e.g.  contexts:="@work","@home"  (exact op)

export function setContextTerms(query: string, prop: string, values: string[]): string // empty → removeContextTerms
export function removeContextTerms(query: string, prop: string): string
export function getContextTerms(query: string, prop: string): string[] // original casing, from raw token
```

**CRITICAL serialization rule (the review caught the original design ANDing here):** all selected values go into **ONE token**, comma-separated: `contexts:="@work","@home"`. This is the ONLY form that ORs. Two separate tokens — `contexts:="@work" contexts:="@home"` — become two clauses in the same AND-group (`group.every`), so the switcher would show only cards tagged with BOTH, the opposite of the intended semantics. The `splitValues` guard (`filter-query.ts:131`) returns one value only when the whole remainder is a _single_ quoted string; `"@work","@home"` has an interior `","` so it correctly splits to `['@work','@home']` → OR. Every `.spec.ts` case MUST assert the single-token form and assert that no two same-name clauses are ever emitted.

Critical details (carried over from the zoom helpers, plus the multi-value additions):

-   **`getContextTerms` is NOT a verbatim clone of `getZoomTerm` — it is genuinely new (if small) code.** `getZoomTerm` returns ONE title from one single-value token; `getContextTerms` must return `string[]` by comma-splitting + per-value unquoting the ONE raw token, preserving original casing (the parsed `FilterClause.values` are already lowercased at `filter-query.ts:136`, so display casing must come from the raw string). Budget for it and test hard: quoted values containing commas, mixed quoted/unquoted, leading `@`, casing preservation, empty-value drops.
-   `getContextTerms` **reads the raw query token**, not the parsed `FilterClause` — the parser lowercases values, which would destroy chip label casing like `@Work`. Matching stays case-insensitive because `rec.props` values are lowercased on both sides; only the DISPLAY casing comes from the raw token.
-   `setContextTerms` filters out only the `<prop>:` token and appends the new one, so a coexisting zoom term and typed query survive untouched.
-   **Exact (`:=`) matching — DECIDED: switcher emits exact.** The switcher/`context=`/chip serialize `contextToken` with the exact operator per single token: `contexts:="@work","@home"` — precise (`work` ≠ `homework`), which is what a discrete GTD context set wants. Typed `contexts:` in the raw filter box stays **substring** for discovery (unchanged generic path). This exact multi-value shape is **new** (zoom only ever emitted one single quoted value), so it must be tested exhaustively — it is not a free clone. Verify against the parser: `contexts:="@work","@home"` → `toClause` peels the leading `=` → `exact=true`, then `splitValues('"@work","@home"')` is not a single quoted value (interior `","`), so it splits to `['@work','@home']`, both exact → OR-of-exacts. That interaction with the `splitValues` single-quoted guard (`filter-query.ts:131`) is the highest-risk edge and needs a dedicated spec.

Coverage: new `filter-query.spec.ts` cases — set/get/remove round-trips, **single-token comma-OR-of-exacts (assert no double-clause AND, assert `exact=true` on each value)**, the `splitValues` single-vs-multi quoted-value guard, quoting spaces and `@`, casing round-trip, coexistence with a typed substring query and with a zoom term.

### 2b. Toolbar context switcher (NEW control — justified; uses Obsidian `Menu`)

A new icon button in the toolbar-right slot (`view-toolbar.ts` `rightEl`, board-mode-adjacent, after the mode switch — the filter bar stays the persistent middle slot and is never re-rendered). Icon e.g. `at-sign`/`tags`, with the `kap-nav-btn-active` active-state + count when any context is selected. Clicking opens an Obsidian **`Menu` of checkboxes** (never a hand-rolled dropdown — AGENTS.md forbids it; `card-menu.ts` uses `Menu` already).

-   **Available values are discovered dynamically** from the current board: union of `rec.props.get(contextsProp)` across the built card set, de-duped case-insensitively, original casing preserved for display. Built lazily on menu-open from the already-built `searchByKey`/`allCards` — **do not** trigger a full refresh to repopulate.
-   Checking/unchecking calls `setContextTerms`/`removeContextTerms` → **`setFilterQuery`** (`kanban-view.ts:3433`) — the single funnel that parses, syncs the bar, persists per-view, and re-renders. Identical to how zoom set/swap/dismiss already flows.
-   **Empty state:** hide/disable the button when no card on the board has the property (mirror how lane nav only shows with >1 lane).

Files: `view-toolbar.ts` (add button + callback), `kanban-view.ts` (enumerate available contexts; toggle handler through `setFilterQuery`; recompute chip state in `applyFilterAndRender` at `:1021` next to the zoom chip).

### 2c. Dismissible context chips in the filter bar (clone `setZoomChip`)

Add `setContextChips(labels: string[])` alongside `setZoomChip` (`filter-bar.ts:137`): render one `kap-filter-context` chip per selected value with an ✕ that removes just that value (`setContextTerms(query, prop, remaining)`). Chips are **pure derived state** — recomputed each `applyFilterAndRender` from `getContextTerms(this.filterQuery, prop)` (`kanban-view.ts:1021`, right where the zoom chip is derived). No separate context state anywhere. New `FilterBarCallbacks.onContextDismiss(value)` mirrors `onZoomDismiss`. Labels use original casing. CSS: `kap-filter-context` under `.kap-root`, `@layer kap-components`, reuse `kap-filter-zoom` rules (`src/styles.src.css`).

### 2d. Filter help / placeholder (nice-tier)

One `HELP_ROWS` entry + `PROPERTY_HINT` mention, built with the **resolved** property name (template it, don't hardcode `contexts:`) so typed and switcher paths stay consistent. Example row: `contexts:work,home` → "GTD contexts (comma = OR)".

### Refresh scope

A switcher/chip toggle is a **filter change → `cards` scope** (`applyFilterAndRender` re-filters the already-built set). Never a full rebuild. A `defaultContextsProperty` **name** change is a property-name resolution change → **`full`** (§4).

---

## 3. Per-mode leverage

The context term filters every mode for free (all controllers receive the already-filtered card set). Below, the mode-specific _display_ leverage and its cost.

### 3a. Board (Kanban)

-   **Filter chip + switcher** (§2) — core, the whole of board filtering. Cost: S/M, pure clone.
-   **Card-menu quick-toggle** (§5) — a distinct toggle submenu (checked-per-value), NOT the scalar `Set <property>` enum path.
-   **Cross-lane drag = list add/remove** when contexts is the swimlane property (§5) — needs a "grouping property is a list" branch in `applyLaneChange` (`kanban-view.ts:2020`).
-   **Per-context lane accent** (stretch): lanes render chrome-free today; tint `.kap-lane-header` with `autoAssignColor(contextValue)` (deterministic). Net-new lane-level CSS var, not a reuse. Do **not** recolor status columns by context — columns are per-status, shared across lanes (a category error).

### 3b. Contexts as swimlanes — the multi-value-in-swimlane problem (RESOLVED)

**This is the central hard problem.** `buildBoard` buckets each card into **exactly one** lane on a scalar `laneValue` (`board-model.ts:191`). Grouping-by-`property:contexts` is _partially reachable today_ but **broken for a real list**: `computeLaneValues` (`kanban-view.ts:859`) passes the raw frontmatter value to `normalizeLaneValue` (`view-config.ts:158`), which returns `null` for anything not string/number/boolean — so an array yields `null` and every multi-context card falls into the single `Ungrouped` lane.

**Recommended for v1: ship WITHOUT contexts-as-swimlanes.** Contexts filter every mode already; swimlane grouping is a separate, expensive capability that the review flags as the single most under-specified part of the design. Two options, neither in MVP:

-   **first-value-wins (cheap, S–M):** `computeLaneValues` maps a list value to its first element (one lane per card). Reachable-ish today, no fan-out, no selection/reconciliation hazards. This is the **recommended** approach IF swimlane-by-context is wanted at all.
-   **multi-lane fan-out (L, stretch, needs its own spec):** duplicate the card ref once per matching lane so a `[work, home]` card appears in both lanes. This interacts with three subsystems that each need a dedicated spec before it can ship:
    1. **Selection (rule 22):** fanned-out duplicates share a file-path key in `cardsByKey`; does selecting one instance select both? Unresolved.
    2. **Reconciliation (rule 41):** `planReconcile` keys card nodes by `data-card-key` within a column — no cross-column collision, but `flatCardKeys`/`equalizeCardHeights` must be proven to see one logical card.
    3. **List-aware optimistic lane write (IC-2):** the existing `laneValueForLaneId`/`normalizeLaneValue` return `null` for arrays (`view-config.ts:164`) — they are scalar-only and **cannot** be reused. Cross-lane drag on a list grouping needs a NEW list-aware optimistic lane helper whose output exactly matches the fan-out re-derivation, or the render-signature gate won't absorb the drag. This is genuinely new machinery the fan-out approach must own.

Do not attempt fan-out until items 1–3 above each have a spec. §9 decision gates whether swimlane-by-context happens at all.

### 3c. WBS tree

-   **NAMING COLLISION (critical):** WBS code already uses "context" for _off-view ancestor rows_ (`collectContextAncestors`, `ContextAncestors`, `.kap-wbs-row-context`, `WbsRowModel.card===null`). GTD contexts are a _different_ concept. New code MUST use `gtdContext`/`contexts` (plural) consistently — never the bare word `context` — or the two are unreadable together. Single biggest risk on this surface.
-   **Contexts meta chip (display-only, core-S):** a read-only chip in the fixed-width meta column of each row, next to `renderDueChip`/`renderEstimateChip`. Add `contexts` to `WbsRowModel`, a `contextsProperty()` host closure (like `progressProperty()`), a `contextsCache` per-render read, and **extend both `rowSignature` AND `wbsRenderSignature`** or the render gate (rule 41) swallows context edits and the chip won't refresh live. Context rows (card===null) render a slot-aligned placeholder so the fixed meta columns don't drift.
-   **Filter by context keeps ancestors for free (core-S):** `contexts:work` narrows `byKey`, and the existing `collectContextAncestors` (rule-36 exception) already grafts a filtered-out parent back as a muted "outside view" row. **Do not build a second "keep ancestors" path.** Verify the empty-state copy when the whole filtered set is context-empty.
-   **Rollups have NO context meaning:** estimates/progress/dates roll up via the owner rule; contexts do NOT aggregate — a parent does not inherit children's contexts. Keep contexts strictly own-value display; do not touch `createWbsRollups`/`subtreeSpan`.
-   **Card-menu add/remove (nice-M)** and **inherit-parent-contexts-on-new-child (stretch, ties to #117):** creation-time only, best-effort; a drag re-parent (`handleDrop`) MUST NOT rewrite contexts.

### 3d. Calendar

-   **Filtering (core-S):** cards arrive pre-filtered; the context term scopes the grid chips, and the unplanned/no-deadline panels for free (both derive from the same `cards`). No renderer/controller change.
-   **Color-code chips by context + legend toggle (core-M):** extend `CalendarEntry` with a context token; in the placement loop read the context property (already reads frontmatter there), resolve via `autoAssignColor`/`resolveColor`; render a swatch/`kap-cal-card-ctx-*` class in `renderChip`. Reuse `renderLegend`/`addLegendItem`/`onToggleDimension` for a per-context legend (one item per distinct value in the window). **Every new toggle field MUST be added to `persist()`, `restoreState`, and `renderStateSignature`** or the render gate swallows it.
-   **Multi-value decision:** a card with >1 context needs a color rule (first-context color vs multi-swatch). Span continuation chips carry no `cardKey`/dimension — a swatch there is cosmetic only, must not imply draggability.

### 3e. Timeline

-   **Filtering (core-S):** identical to calendar — free via the pre-filtered set, covers the Unplanned panel too.
-   **Color-code bars + legend (core-M):** timeline has NO legend today; add one to `renderHeader`, **borrowing the calendar's `kap-cal-legend` classes** (renderHeader already reuses calendar toolbar classes) rather than inventing chrome. Add a context token to `TimelineRowModel`; `renderRow` composes a class / color-mix accent onto `kap-tl-bar`/`kap-tl-square`. Persist legend state via the timeline controller's own `persist`/`renderStateSignature`.
-   **Group rows by context (nice-L):** generalize `groupRows`/`TimelineTypeGroupModel` (currently type-only, 1:1) to key by context. A card appears in EACH of its context groups (or a "No context" bucket), inflating counts — the one genuinely new wrinkle vs type grouping. **Check overlap with swimlane `property:<name>` grouping first** — avoid two mechanisms for the same result.

### List add/remove write semantics (applies wherever a mode writes contexts)

Any write (card menu, cross-lane drag, triage assign, bulk) MUST use `appendToListProperty`/`removeFromListProperty` (`frontmatter.service.ts:91/139`) — never scalar `setProperty` (which clobbers the whole list). These already promote scalar→list, dedupe (pass a case-insensitive `matches` override for contexts, like tags), and **delete the key when the list empties** (never leave `[]`/`[null]`). Detailed in §5.

---

## 4. Settings additions

The **only strictly-required schema change** for MVP filtering.

-   **Constant:** `export const DEFAULT_CONTEXTS_PROPERTY = 'contexts'` in `src/app/constants.ts`, next to the other `DEFAULT_*_PROPERTY` consts.
-   **Schema field:** `defaultContextsProperty: z.string()` in `pluginSettingsSchema` (`plugin-settings.intf.ts`), next to `defaultBlockedByProperty`, and an entry in `DEFAULT_SETTINGS`. **Give it `.default(DEFAULT_CONTEXTS_PROPERTY)`** (or confirm the load-time `Object.assign(DEFAULT_SETTINGS, loadData())` merge runs before `.parse`) — adding a field does NOT backfill existing `data.json`, and a `.default()`-less `z.string()` would fail-parse older data and reset all settings. Resolve **default-on-missing** to the constant at read time regardless.
-   **Tab UI:** one `text('Contexts property', 'Multi-value property listing a note\'s GTD contexts (e.g. @work, @home).', 'defaultContextsProperty', 'contexts')` row in the "Default property names" section (`settings-tab.ts`). `defaultContextsProperty` is automatically a valid `StringSettingKey`, so **no custom updater is needed.**
-   **Refresh scope — already correct, no work:** the generic `text()`+`updateSetting` path calls `saveSettings()` with no arg, and `saveSettings` defaults to `scope='full'` (`plugin.ts:190`). A property-name change therefore already triggers full re-derivation. Do **not** add a dedicated `updateContextsProperty` — it would be redundant. (This was an open question in the original design; verified and closed.)
-   **Reserved-name guard (required — prevents zoom corruption):** `defaultContextsProperty` is free text, and `isContextToken`/`isZoomToken` both match `/^<name>:/i`. If a user sets the contexts property to `parent`/`ancestor` (or any reserved qualifier: `status`/`due`/`title`/`tag`/`child`/`sibling`/`blocked`), `setContextTerms` and `removeZoomTerm` fight over the same tokens and silently corrupt zoom/filtering. Reject or normalize such a value at settings-write time with a `Notice` (same guard class the plan wants for lane-grouping writability). Reserved set lives in `filter-query.ts` (grammar doc `:22`); export it so the guard and the parser can't drift.
-   Do NOT extend `noteTypeSchema` with a per-type `contextsProperty` (global-only, §1).

### Optional (nice-tier, deferred)

-   **Known context values:** reuse the existing per-type `enumProperties` map + `enum.service` (`listEnumProperties`/`resolveAllowedValues`). For a _global_ property, UNION `enumProperties['contexts']` across all note types (dedup, case-insensitive). Only if that union proves awkward would a global `contextValues: z.array(z.string())` be justified — flag, don't build.
-   **Per-context colors:** reuse `colors.service` `resolveColor` + `autoAssignColor` + `PALETTE` unchanged — `autoAssignColor(value)` gives stable, zero-config per-value colors for v1, so **no color config UI at launch**. A global `contextColors` map is a later follow-up (the per-type `colors.overrides` mismatches the global-property model — a context could look different per type; `autoAssignColor` sidesteps it entirely).

---

## 5. Write semantics

All context writes are **list add/remove toggles**, never scalar overwrite.

-   **Primitives (reuse verbatim, zero new write code):** `appendToListProperty` (add: scalar→list promotion + dedupe) and `removeFromListProperty` (remove: filters the entry, deletes the key on empty) in `frontmatter.service.ts`. `toggleCardContext(card, value, present)` = `present ? removeFromListProperty(...) : appendToListProperty(...)`.
-   **Case-insensitive dedupe (required):** pass `matches = (item) => typeof item === 'string' && item.toLowerCase() === value.toLowerCase()` to BOTH append and remove, or `Work`/`work` both land and a differently-cased entry fails to remove.
-   **Card-menu toggle submenu (NEW builder — justified):** the generic `Set <property>` enum path (`addEnumSetMenuItems`, `card-menu.ts:212`) is a scalar OVERWRITE and would collapse the list to one string — **do not reuse it for contexts.** Build a distinct submenu mirroring its _shape_ but with `.setChecked(present)` per value (multiple checks possible, not a radio) and toggle onClick; no "Clear" item (optionally a "Remove all contexts" convenience `deleteProperty`). New host contract: `contextValuesFor(card) -> { values: string[]; current: Set<string> }` and `toggleCardContext(card, value, present)`. Vocabulary source: union of on-board values + optional free-text "Add context…".
-   **Optimistic update + rollback (rule 32 — mandatory, clone the relationship path):** `addRelationship`/`removeRelationship` (`kanban-view.ts:2315/2346`) is the model. Re-resolve `this.liveCard(cardRef)` **at commit time** (a rebuild between menu-open and click orphans the captured object — applies equally to any async free-text modal), mutate the in-model list immutably, call `applyFilterAndRender` **only when the list changed**, THEN await the write. Route the display re-derive through the same `applyCardWrite` hook the enum quick-set uses so the chip appears/disappears immediately instead of on the metadata-cache echo. On a thrown write, restore the captured previous list on the re-resolved live card and re-render. Because contexts primarily drive filtering (not layout), a failed write mostly needs a display re-derive, not a full rebuild. **Optimistic state never outlives a write failure** (Business Rules).
-   **Cross-lane drag (when contexts is the swimlane property):** `applyLaneChange` (`kanban-view.ts:2020`) currently does scalar `setProperty`/`deleteProperty`. For a LIST grouping property, add a "grouping property is a list" branch: cross-lane drop = **remove source-lane value + add target-lane value**; drop-to-Ungrouped = **remove source-lane value only** (deleting the whole property would wipe every other context — almost certainly wrong). The optimistic model mutates just the one membership (`card.laneValues` add/remove one element); the revert restores the exact prior membership; the value must match what the echo re-derives or the render-signature gate won't absorb it. Contexts grouping must be `kind:'property'` with a writable `note.*` ref (formula/file/type lanes are read-only for drag).
-   **Triage assign (nice-L):** `triageSetProperty → setCardProperty → setProperty` is a scalar replace — wrong for a list. Route through append/remove; render the triage editable-prop options as **multi-select toggles** (`aria-pressed` per value, membership-based) instead of the single-`current` radio model; extend the `TriageValueOverride` shape to be list-aware so pre-echo completion detection (`wasComplete`/`nowComplete`) doesn't lag. Biggest single divergence from existing triage machinery.
-   **Bulk (nice-M):** clone `bulkSetStatus` (`board-selection.ts:235`): capture per-card `previous` (present?) → apply optimistic once (one render) → `runExclusiveWrites` sequential loop → per-card precise rollback (revert only failed cards, never a full rebuild) → Notice → `clear()`. **DROP the single-type vocabulary guard** — contexts is a global property with no per-type vocabulary, so mixed-type selections are fine (a divergence from status bulk). "Add context X" = idempotent `appendToListProperty` per card; "Remove context X" = `removeFromListProperty` per card.
-   **Per-type resolution on mixed boards:** the contexts property name is a single GLOBAL read of `settings.defaultContextsProperty` — **no per-type resolution branch** (unlike status/blocked). This sidesteps the mixed-board resolution complexity entirely; document that types storing contexts under a different key are out of scope for v1.

### Triage — filter only, NOT a gate (maintainer decision)

Triage-gating by context is **explicitly out of scope** (maintainer: not a wanted workflow). Triage still benefits from contexts for free — the managed context term rides `filterQuery`, so a triage session is naturally scoped by the active context like every other mode. No triage-specific code, and importantly **no engine touch**: the `coerceSortValue`-returns-null-for-arrays problem (which would have been the one genuine engine change) is avoided entirely by not gating on a list property. Assigning a context _during_ triage remains a possible stretch (§7 item 16) but is unrelated to gating.

---

## 6. Relationship to #114 perspectives and embeds

-   **`context=` embed param (core-S):** add a `context` key to `EmbedParams` + `parseEmbedParams`, mirroring `mode=`/`filter=`/`height=`. `context=work` (comma-OR `context=work,home`) parses like `mode=`. It gets **no own filter machinery** — it is folded into the SAME raw `filterQuery` via `setContextTerms`.
-   **Rule 42 compliance is load-bearing — route the seed through the config funnel, NEVER `this.config.set`:** rule 42 (`BR:677–685`) requires all view-config writes go through `EmbedAwareConfig` so an embed's writes land in the in-memory overlay and never touch the shared `.base`. The `context=` seed must ride the SAME `filterInitialized`/`loadFilterQuery` path that `filter=` uses (rule 42's approved exception, `BR:684`) — seed the composed query there, do **not** bolt a direct `this.config.set` onto `applyEmbedParams`. Add a spec/live check that an embedded `context=` pin never mutates the shared base file (the "never `this.config.set`" invariant at `BR:681` is easy to violate when adding a new seed).
-   **`context=` + `filter=` compose:** parse `filter=` as the base query, then `setContextTerms(base, prop, values)` on top (the context term replaces any context term the author also typed into `filter=`). Neither clobbers the other. Because both flow through `loadFilterQuery`, an edited alias re-applies live via the MutationObserver.
-   **Contexts as a lightweight perspective:** because the active context lives INSIDE `filterQuery`, a saved perspective (#114 — a named bundle of `filterQuery`/sort/grouping/statuses/mode/collapse) **captures the context automatically**. **Do NOT add a dedicated `perspective.context` field.** A pinned context (embed or switcher) is a single-dimension, unnamed perspective on the same substrate. One representation shared by switcher, embed, and perspective — the strongest "reuse, don't invent" win in the whole design.

---

## 7. Build sequence (ordered: MVP → fast-follow → stretch)

Each item sized S/M/L. MVP is genuinely minimal and independently shippable.

### MVP — setting + switcher + filter term + chip (ships alone)

1. `DEFAULT_CONTEXTS_PROPERTY` + `defaultContextsProperty` schema field + `DEFAULT_SETTINGS` (with `.default()`), default-on-missing read. **S**
2. Settings-tab text row (generic `text()`; refresh scope is already `full`, no custom updater) + **reserved-name guard** on the value with a `Notice`. **S**
3. Context-term helpers `setContextTerms`/`getContextTerms`/`removeContextTerms` in `filter-query.ts` + `.spec.ts`. Single-token comma-OR serialization; `getContextTerms` is new multi-value round-trip code (not a verbatim zoom clone) — test hard. **M**
4. Filter-bar context chips (`setContextChips`, `onContextDismiss`) + `kap-filter-context` CSS + derive in `applyFilterAndRender`. **M**
5. Toolbar context switcher (`Menu` of checkboxes, dynamic discovery, `setFilterQuery` funnel, empty-state hide). **M**

Result: a fully working, per-view, persisted, embed-safe context filter across ALL modes (board/WBS/calendar/timeline/triage all filter for free). Zero engine changes.

### Fast-follow

6. Filter help row + placeholder mention (templated with resolved prop name). **S**
7. `context=` embed param folded into `filterQuery`. **S**
8. Card-menu context toggle submenu (`toggleCardContext`, `.setChecked` per value) + optimistic/rollback via `applyCardWrite`. **M**
9. WBS contexts meta chip (display-only) — extend both signatures. **S**
10. Calendar chip coloring + per-context legend (persist + signature). **M**
11. Timeline bar coloring + borrowed legend (persist + signature). **M**

### Stretch

13. Bulk add/remove context on N selected (clone `bulkSetStatus`, drop single-type guard). **M**
14. Contexts-as-swimlanes — **first-value-wins only** for v1 (§3b). Multi-lane fan-out is deferred until selection/reconciliation/list-aware-optimistic-lane specs exist; not scheduled here. **M** (fan-out: **L**, separate)
15. Timeline group-by-context (generalize `groupRows`). **L**
16. Triage assign-during-triage (multi-select toggle editable prop + list-aware override). **L**
17. Per-context lane/chip accent colors; optional global `contextColors` / `contextValues` config. **M**
18. WBS inherit-parent-contexts-on-new-child (creation-time only; ties to #117). **M**

---

## 8. New / updated Business Rules

Add to `documentation/Business Rules.md`:

-   **Contexts are a global, multi-value list frontmatter property.** The property name is a single global setting `defaultContextsProperty` (default `contexts`), NOT per-type — a deliberate deviation from per-type property resolution, because GTD contexts are cross-cutting. A mixed board reads the same key for every card; types storing contexts elsewhere are unsupported in v1.
-   **The active context is not separate state.** It is a managed `<contextsProp>:<values>` term embedded in each view's raw `filterQuery` (zoom-term model), per-view, persisted to the `.base` outside embeds and ephemeral inside them. Switcher, `context=` embed param, and saved perspectives share this one representation. All selected values serialize into ONE comma-separated token using the exact operator (`contexts:="@work","@home"`) so they OR-of-exacts; emitting two same-name tokens would AND and is a bug. Typed `contexts:` in the raw filter box stays substring. The contexts property name must not be a reserved qualifier (`parent`/`ancestor`/`status`/`due`/`title`/`tag`/`child`/`sibling`/`blocked`) — guarded at settings-write time.
-   **Contexts must ride the generic frontmatter-qualifier path** and must never be given a reserved qualifier name (would break renames and duplicate engine logic).
-   **Context writes are list add/remove toggles**, via `appendToListProperty`/`removeFromListProperty` with case-insensitive dedupe — never scalar `setProperty`. Removing the last context deletes the property (no `[]`/`[null]`). All context writes honor optimistic-update + rollback (rule 32): re-resolve the live card at commit, mutate immutably, render-on-change, revert only failed cards on failure.
-   **Contexts do not roll up** (unlike estimates/progress/dates) — a parent never derives its children's contexts.
-   **Cross-lane drag on a list swimlane property** removes the source-lane value and adds the target-lane value; drop-to-Ungrouped removes only the source-lane value (never clears the whole list).
-   **Bulk context edits apply to mixed-type selections** (no single-type vocabulary guard — contexts has no per-type vocabulary).
-   **Contexts are not a triage gate** (maintainer decision) — triage is scoped by the context filter term like any mode, but a missing context never marks a card "needs triage". Avoids a list-property engine touch.
-   **Render-signature gates must include the contexts value** wherever a mode displays it: board `boardRenderSignature` / card signature (rule 41, `BR:642` — the card context chip on the board is swallowed otherwise, exactly as in WBS), WBS `rowSignature` + `wbsRenderSignature`, and calendar/timeline `renderStateSignature` + `persist`/`restoreState` for legend/toggle state. Verify the board card chip live (item 8).
-   **WBS "context"/GTD "contexts" are distinct concepts** — new GTD code uses `gtdContext`/`contexts` (plural), never the bare word `context`.

---

## 9. Open questions (maintainer decisions)

1. **Multi-value color rule** for calendar chips / timeline bars when a card has >1 context: first-context color, or a multi-swatch? Recommendation: first-context color for v1.
2. **Contexts-as-swimlanes semantics:** ship MVP without swimlane grouping. If wanted later, **first-value-wins** (one lane/card, no hazards) is recommended; multi-lane fan-out is deferred until its selection/reconciliation/optimistic-lane specs exist (§3b). Decide before item 14.
3. **Known-values vocabulary source** for the switcher/menu: dynamic board-discovery only (v1 recommendation), or a configured global `contextValues` list? Recommendation: dynamic + free-text "Add context…", defer configured list.
4. **`@` prefix convention:** enforce/normalize a leading `@` on context values, or treat them as free-form strings? Recommendation: free-form, display raw casing.

_(Resolved & removed: "exact vs substring" — DECIDED, switcher emits exact `:=`, typed stays substring (§2a). "Contexts as a triage gate" — DECIDED no (§5). "Does `updateSetting` default to `full` refresh?" — yes, `saveSettings` defaults to `'full'` at `plugin.ts:190` (§4).)_
