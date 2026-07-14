# WBS view (issue #76)

Fifth view mode (Board / Calendar / Timeline / Triage / **WBS**): renders the parent/child
hierarchy as a collapsible work-breakdown tree. Board answers "what state is everything in";
WBS answers "how does the work decompose".

## Decisions (owner input + resolved open questions)

- **Scope: decomposable items.** Trees are rooted at notes that have children (within the
  filtered result set) and no on-set parent. Leaf notes appear only as children, never as
  standalone rows.
- **Result-set boundary (Business Rule 1).** v1 stays inside the Base's result set.
  Out-of-base reach (owner comment "to evaluate"): **deferred**. Pros: complete tree even when
  the Base filters out intermediate nodes. Cons: breaks rule 1 (every other feature, incl. #74
  zoom, respects it), requires vault-wide relationship resolution per rebuild (perf), and
  produces rows that can't be opened from the board's own data (no BasesEntry → no fields,
  no formulas). Off-set parents behave like #74: visible as an un-climbable boundary (child
  simply roots its own tree).
- **Multi-parent notes: shown under each parent** (duplicated). Rollups dedup descendants by
  path so a shared subtree never double-counts. Re-parent drag on a duplicated instance
  replaces only the edge to that instance's context parent.
- **Sorting within a level: the view's card sort** (same comparator as board columns/panel).
- **Filter + zoom: free.** WBS renders the already-filtered `cards` from
  `applyFilterAndRender()`; non-matching notes are absent (hidden, not dimmed).
- **One rollup model for estimates AND progress (owner, 2026-07-14): own value wins, else
  derive from children.** Top-down, bottom-up, and mixed planning all work. A node's
  **effective estimate** is its own value when set; otherwise the recursive sum of its
  direct children's effective estimates (`effectiveEstimate`/`childrenEstimate`). Because an
  own value _replaces_ its subtree's contribution (never adds to it), **persisting a rollup
  to the parent can never double-count**. A node with an own value also shows the children's
  rollup as a coverage signal (`Σ Nd`) when they differ. (This supersedes the earlier
  own + descendants formula from the issue comment — that formula breaks the moment a rollup
  is saved to the parent.)
- **Rollups are displayed by default, persisted on demand (owner, 2026-07-14):** context-menu
  **Save rolled-up estimate (Nd)** / **Save rolled-up progress (N%)** write the derived value
  to the note (numbers); the estimate/progress modals pre-fill the derived value when the
  node has no own value, so persisting is open→Set.
- **Progress (owner, 2026-07-14):** a **global setting `defaultProgressProperty`**, default
  `progress`, number **0–100**. Every WBS row shows a progress bar. Effective progress: the
  node's own value when set and > 0; otherwise, when any descendant has progress > 0, the
  **weighted combination of its direct children's effective progress** (weights = each
  child's effective estimate; equal weights when any child lacks one). Derived values are
  styled distinctly from own values.
- **Derived date spans:** a parent without its own start date shows the span its subtree
  covers (earliest start → latest own end, `subtreeSpan`), styled as derived.
- **Alignment (owner, 2026-07-14):** the per-row meta (progress bar / dates / estimate) uses
  fixed-width right-aligned columns so bars and chips sit at the same x on every row.
- **Left pane (owner comment):** same shell as calendar/timeline (`kap-scheduling-panel`),
  listing cards **missing a start date or an estimate** ("not fully estimated"), grouped by
  **note type → status** (`groupByTypeAndStatus`), all groups collapsed by default (drag
  backlog convention), group collapse in-memory on the controller, whole-pane collapse
  persisted (`wbsPanelCollapsed`) with narrow-pane auto-collapse.
- **DnD re-parenting** (in scope): drag a tree row onto another row → re-parent; drag a pane
  card onto a row → set parent. Non-drag fallback (rule 12): the existing Relationships
  submenu + `kap-wbs` menu items. Guards: never onto self, own descendant (cycle), or the
  current context parent (no-op).
- **Top-down estimates (owner comment):** context-menu **Distribute estimate to children**:
  splits the node's own estimate minus the children's effective estimates equally across
  direct children whose subtree has **no estimate at all** (min 1 day each, numbers).
  Existing values are never overwritten.
- **No entry creation.** The view never creates notes.
- **Status writes from the tree (owner, round 2):** supported via the standard context-menu
  Set-status items (rule 2 semantics; optimistic dot update). No inline status control yet.
- **Round 2 (owner, 2026-07-14):** due dates visible + editable per row (countdown chip,
  #62 tone ramp); planned (start) dates order siblings first (chronological), then the card
  sort; the panel sorts its groups by the card sort; un-parent by dropping a row on the
  panel; expand all / collapse all; drag ergonomics (edge auto-scroll, linger-to-expand,
  drag survives re-renders); reconciled rendering (panel signature + `planReconcile` over
  `parentKey::path` row keys — the post-write echo no-ops, nothing tears down).

## Re-parenting write semantics (rule 9/#14)

`props = roleProperties(activeNoteType)`. The resolved edge may be stored on either side —
detect with `directLinkTargets`:

1. Child-owned (`child.file[props.parent]` contains old parent) → `removeRelationshipLink`
   on the child + `addRelationshipLink(child, props.parent, newParent)`.
2. Parent-owned (`oldParent.file[props.child]` contains child) → remove on old parent +
   `addRelationshipLink(newParent, props.child, child)`.
3. **Both sides** (redundant storage) → remove **both** old links and recreate both on the
   new edge — leaving either survivor would resurrect the old parent via the inverse pass on
   the echo rebuild.
4. Heuristic edge (no property on either side) → add `props.parent` link on the child
   (removal impossible; Notice explains the old heuristic edge remains).
5. Pane drop (no old parent) → add `props.parent` link on the child.

Menu-time math (save-rollup, distribution, modal prefills) runs over the **unfiltered** Base
result set — a transient toolbar filter must never skew a persisted number.

Optimistic (rule 32): mutate `card.relationships` in memory + re-render **before** awaiting
the writes; the echo rebuild re-derives identical state.

## Architecture (timeline-style 3-way split)

- `src/app/domain/wbs.ts` (+ `wbs.spec.ts`) — pure: `buildWbsForest`/`buildWbsNode` (roots,
  duplication, per-branch cycle guard), `effectiveEstimate`/`childrenEstimate` (own wins,
  else children rollup; contributors deduped by path so diamonds never double-count),
  `effectiveProgress` (weighted), `parseProgress` (0–100 clamp), `subtreeSpan`,
  `distributeEstimate`, `descendantPaths`.
- `src/app/ui/wbs/wbs-renderer.ts` — DOM only, callbacks report intent; `root.empty()` →
  `.kap-wbs` (pane + tree). Rows carry `data-card-key` (+ context-parent key). Progress bar,
  estimate/date/status chips reuse existing class conventions.
- `src/app/ui/wbs/wbs-dnd.ts` — sibling of `CalendarDnd` (5px threshold, body-level ghost in
  a `.kap-root` wrapper, click swallow, pointercancel aborts): sources `.kap-wbs-row` /
  pane cards; targets rows.
- `src/app/ui/wbs/progress-modal.ts` — number prompt 0–100 (Set progress…).
- `src/app/views/kanban/wbs-controller.ts` — Host-closure pattern (mirrors
  `TimelineController`): builds the view model, owns group-collapse map + node-collapse set,
  commits writes via `frontmatter.service` / `relationships.service`, extends the card menu
  (`.setSection('kap-wbs')`: Set estimate… / Set start date… / Set progress… / Distribute
  estimate to children / Set parent…).

## Wiring checklist (seams)

- `view-toolbar.ts`: `ViewMode` + 'WBS' button.
- `kanban-view.ts`: `wbsMode()` predicate, `viewMode()`/`setViewMode()` (new `wbsMode` flag in
  both), `toggleWbs()`, branch in `applyFilterAndRender()`, controller construction in
  `onload` + `WbsDnd`, restore/persist (`wbsPanelCollapsed`, dedicated `wbsCollapsedNodes`
  string[] via `readIdArray`), property resolvers (start = scheduled, estimate =
  `defaultEstimateProperty`, progress = `defaultProgressProperty`), `onResize()` hook.
- `plugin.ts`: `toggle-wbs-mode` command (checkCallback, active view).
- Settings: `defaultProgressProperty` (Zod default `'progress'`, constant
  `DEFAULT_PROGRESS_PROPERTY`), settings-tab field, refresh scope `full`. No schemaVersion
  bump (additive, default-on-missing).
- `styles.src.css`: new `.kap-wbs*` section (`@layer kap-components`, under `.kap-root`,
  Obsidian vars only).

## Persistence

- Durable per view: `wbsMode`, `wbsPanelCollapsed`, `wbsCollapsedNodes` (collapsed node
  paths; a path collapses all duplicate instances).
- In-memory (controller instance): pane group collapse, narrow-pane auto-collapse memo.

## Mobile posture

Same pointer DnD path; all writes reachable without drag (menu). Rows are full-width touch
targets; indentation capped so deep trees stay usable on narrow panes.

## Docs (rule 13, same milestone)

Business Rules rule 36; Architecture "WBS mode" section; Configuration global-defaults row
(`defaultProgressProperty`); Domain Model (WBS forest/rollup); docs/usage.md "## WBS mode";
docs/configuration.md; README highlight.

## Out of scope (follow-ups)

- Out-of-base tree reach (evaluated above, deferred).
- Status writes from the tree; note creation from the view.
- Breadcrumb / cross-board hierarchies.
