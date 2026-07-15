# Kanban scroll/reflow audit — analysis

Analysis only. No implementation was done. Each finding ends with a candidate fix direction.
All confirmed findings were verified against the code by three independent review lenses and revalidated against the current working tree; most were also reproduced live in a real vault (verdicts noted per finding). Line numbers were spot-checked against the working tree at write time.

## Design goals (fixed constraints — every fix direction respects these)

1. **Optimistic updates are intentional and stay.** Never remove an optimistic DOM update or wait for the Bases echo instead. The problem is the redundant echo rebuild AFTER the optimistic update — fix by suppressing/diffing the echo, not by dropping the optimistic path.
2. **Visual stability is a top priority.** Content must not move, resize, or lose scroll position without a user-visible reason.
3. **Snappiness is equally important.** No fixes that trade latency for stability: no added debounce delays on user-initiated actions, no deferring visible feedback. Stability comes from doing LESS redundant work (diffing, scoped updates, reserved space), not from doing the same work later.

## Implementation status

- **Theme 1 (render-signature gate) — IMPLEMENTED** for findings **1.1, 1.2, 1.3** (live-verified):
  `skipUnchangedRenderPass`/`renderPassSignature` in `kanban-view.ts` gate the board, calendar and
  timeline funnels before `applyFilterAndRender`'s side effects; pure `boardRenderSignature` +
  `renderPassSignature` live in `ui/board/signatures.ts` (unit-tested), and the calendar/timeline
  controllers expose `renderStateSignature()` covering their render-time state (range, anchor,
  tab, collapse maps, hidden types, resolved properties, today, track width). Calendar/timeline
  signatures also hash per-card raw frontmatter + tags (those renderers read the note at render
  time). Triage keeps its own `lastTriageSignature` guard; WBS stays ungated. Side effects of the
  gate also absorb 1.6's duplicate `commitFilter` render and 1.7's irrelevant settings fan-out
  for the gated modes. Optimistic renders are unaffected (mutations change the signature; a
  pending keyboard refocus forces a render).
- **Theme 2 (scroll capture/restore across genuine teardowns) — IMPLEMENTED** for findings
  **3.1, 3.2, 3.3** and the **scroll legs of 2.1/2.2**: shared helper `ui/scroll-preservation.ts`
  (pure clamp/restore/keying, unit-tested) with DOM adapters. 3.1: `captureColumnAnchors`/
  `restoreColumnAnchors` in `kanban-view.ts` now key the horizontal anchor per lane, skip
  0×0 (collapsed) lane boards, and run ONLY when `boardStructureWillChange()` (exported from
  `board-renderer.ts`) says the full-render path will be taken. 3.3: the same gate wraps
  `patchBoard` with `captureBoardScroll`/`restoreBoardScroll` — per-column scrollTop keyed by
  lane+column id plus the `.kap-lanes` stack — restored synchronously after the render (no
  frame paints at scroll 0). 3.2: `applyUniformCardHeight` snapshots every `.kap-column-cards`/
  `.kap-lanes` scrollTop before the clear→measure→set cycle and restores after, killing the
  silent clamp. 2.1/2.2 scroll legs: the calendar and timeline controllers wrap their
  full-teardown renderers with selector-keyed snapshots (`.kap-panel-list`/`.kap-calendar`/
  `.kap-cal-focus-day`; `.kap-tl-panel-body`/`.kap-tl-body`), clamped to the new extent.
  The signature-gate parts of 2.1/2.2 were already covered by theme 1; their optimistic-drop
  legs remain open under theme 3.
- **Theme "render-from-cached-cards" (findings 2.3, 2.4) — IMPLEMENTED**: the
  calendar/timeline host interfaces replaced `rebuild()` with `refresh()`, wired in
  `kanban-view.ts` to `applyFilterAndRender()` — every controller callback (tab switch,
  legend toggle, range/anchor/Today, panel + group toggles, focus day, zoom, type
  hide) and the resize-driven panel auto-collapse now re-render synchronously from the
  ALREADY-DERIVED card set instead of re-deriving relationships/cards/search index.
  Audit result: no calendar/timeline callback changes which cards exist (type hiding
  filters at render time), so none kept the full rebuild. Persists still happen; the
  echo is absorbed by the theme-1 signature gate, whose calendar/timeline signatures
  already cover all callback-mutated state — the state change renders exactly once.
  The timeline's resize-tick re-render (`onResize`) also switched from `rebuild()` to
  `applyFilterAndRender()` (partial N1: width-unchanged ticks are now gated no-ops;
  the px-threshold gating remains open).
- **Theme 3 (complete the optimistic model) — IMPLEMENTED** for findings **4.1, 1.4, 4.2, 4.3**
  (live-verified except the triage value-click override, which needs enum fixtures):
  4.1: `applyLaneChange` now mutates `card.laneValue` + `laneValueByPath` BEFORE the write via
  pure `laneValueForLaneId` (view-config.ts, unit-tested — same normalization as the echo's
  `computeLaneValues`), so the optimistic render draws the card in the target lane (live: card
  in target lane at t+150ms, no snap-back). 1.4: `bulkSetStatus`/`bulkArchive`
  (board-selection.ts) mutate the model for all selected cards and render ONCE up front via new
  host hooks (`applyBulkStatus`/`removeCardsFromModel`); writes stay sequential; a failed write
  triggers `requestRebuild()` so optimistic state never sticks (live: both cards in the target
  column at t+100ms). 4.2: `triageSetProperty` feeds a `TriageValueOverride` through
  `renderTriage` → `buildTriageData`/`buildTriagePane`/`triageRank` (override value coerced with
  `coerceSortValue`, matching the echo's re-read), so the click renders immediately and the echo
  is absorbed; `renderTriageView` also saves/restores keyboard focus across its teardown via
  `data-kap-focus` keys (live: focus stays on Next across an advance). 4.3: card-menu enum/date
  writes go through `applyCardWrite` — recompute the card's display with the just-written value
  substituted (`buildCardDisplay` gained an `overrides` map, unit-tested; the entry/cache are
  stale until the echo), render immediately, `refocusCardKey` in board mode. `applyCardWrite`
  resolves the LIVE card by key — reused DOM nodes keep menu closures over card objects from
  older renders, so mutating the passed card can be a no-op (found live).
- **Themes 4 + 5 (reserve space / guard the resize path) — IMPLEMENTED** for findings
  **5.2, 5.4, 5.7, 5.8, 5.5, 5.6, N1, N2** (live-verified except the hidden-tab legs, which
  need a backgrounded window): 5.2: `scrollbar-gutter: stable` on every plugin scroller
  (board, column cards, lanes, calendar grid + panel list + focus day, timeline body +
  undated panel, triage body, WBS panel + tree, config-modal content). 5.4: the selection
  bar now appears/disappears on the SELECT-MODE toggle (the deliberate layout moment) with
  its actions disabled at 0 selected — first-select/last-deselect no longer shifts the
  board (live: board top delta 0 on first select). 5.7: the card drag placeholder and the
  column drop indicator are absolutely positioned overlays (pure `insertionLineOffset` in
  `ui/board/drop-indicator.ts`, unit-tested) — repositioning them no longer shifts cards
  or re-widths columns (live: target-column card offset delta 0 mid-drag). 5.8: the drag
  ghost copies the source card's `offsetHeight` alongside width. 5.5: `onResize` skips
  everything at 0×0 and skips equalize when the board width is unchanged since the last
  pass (`lastEqualizeWidth`); `applyUniformCardHeight` keeps the previous
  `--kap-card-height` when every card measures 0 (hidden tab) instead of destroying it
  (`cardHeightVarValue`, unit-tested). N1: timeline resize re-renders only when a bar
  crosses the 24/32px affordance gates (pure `timelineWidthGatesCrossed` in
  `ui/timeline/width-gates.ts`, unit-tested; the renderer consumes the same constants) —
  everything else is %-positioned and reflows in pure CSS. 5.6: the settings 'chrome'
  branch calls `equalizeCardHeights()` so the chip-style height shift lands with its
  cause. N2: `applyRefocus` runs AFTER `equalizeCardHeights` with
  `focus({ preventScroll: true })` + a scoped `scrollIntoView({ block/inline: 'nearest' })`
  against the final layout.
- All other findings: not yet implemented (5.1 and 5.3 need a maintainer decision on the
  uniform-height / equal-grow invariants; 3.4, 5.9, N3, N4 remain open).

## Render pipeline overview

- **Triggers into one funnel:** `onDataUpdated` (kanban-view.ts:436-438), `metadataCache 'changed'` + vault rename/delete (344-364, gated only by path via `affectsBoard` 397-410) all call `debouncedRebuild` (249, 250ms, non-resetting).
- **Pipeline:** `resolveAndRebuild` (490-504; sequential per-file async Starter Kit recognition) → `rebuild` (607-648; properties, relationships, all cards, search index) → `applyFilterAndRender` (656-774).
- **Per-render side effects (unconditional):** toolbar teardown (`renderToolbar` 686/692/698/738 → view-toolbar.ts:47/63 `empty()`), calendar render (693), timeline render (699), column anchor capture/restore (748/766, impl 802-828), `applyRefocus` (767), `equalizeCardHeights` (773, def 834 → card-equalize.ts:36-42).
- **DOM absorbers (board mode only):** `patchBoard` keyed reconcile via `structureSignature` (board-renderer.ts:86-88) and per-card `cardSignature` (signatures.ts:28-51); full `renderBoard` fallback does `rootEl.empty()` (board-renderer.ts:48). Triage mode has a render-signature guard (`lastTriageSignature`, kanban-view.ts:207, 1847-1848). **Calendar and timeline have neither guard nor scroll capture** (calendar-renderer.ts:81 `rootEl.empty()`, timeline-renderer.ts:111 `root.empty()`).
- **No content diff, no self-write suppression, no reentrancy guard exists anywhere on the funnel** — only triage has a signature gate.

---

## Category 1 — Echo/rebuild pipeline: no content diff, no self-write suppression

### 1.1 `onDataUpdated` has no content diff or self-write echo guard — every Bases push runs the full rebuild pipeline (HIGH)

- **Trigger:** any Bases data push — most commonly the echo of the plugin's OWN frontmatter writes (drag-drop, lane reassign, relationship add/remove, date/enum/triage writes; echo comment at kanban-view.ts:1354-1355). Both notification channels ('changed' + `onDataUpdated`) feed the same non-resetting 250ms debouncer, so one logical write can produce two full pipelines.
- **Mechanism:** kanban-view.ts:436-438 is a bare `this.debouncedRebuild()`. No hash/diff of the resolved card set, no "expected write" bookkeeping. Even on a byte-identical echo, `applyFilterAndRender`'s side effects run: toolbar teardown, per-lane scrollLeft rewrite, equalize forced reflow, selection refresh. In calendar/timeline mode the echo is a full DOM teardown.
- **User-visible effect:** in board mode mostly wasted CPU + forced reflow + toolbar focus loss (DOM absorbers protect card scroll); in calendar/timeline mode the echo is a full teardown with scroll reset for zero visible change.
- **Live repro:** REPRODUCED — byte-identical `vault.modify` ran the full pipeline; drag echo produced a second render ~900ms after the optimistic one.
- **Fix direction:** compute a cheap signature of the resolved card set (the `lastTriageSignature` pattern already in the file, 1847-1848) before `applyFilterAndRender` and skip the render + side effects when unchanged; optionally suppress the next echo after own writes. Pure less-work — the optimistic render remains the immediate feedback.

### 1.2 `metadataCache 'changed'` rebuilds on body-only edits — `affectsBoard` checks path only, never what changed (HIGH)

- **Trigger:** any re-index of a board note or relationship target — including edits touching only the note body — e.g. typing prose in a split pane.
- **Mechanism:** kanban-view.ts:344-350 + `affectsBoard` (397-410) gate by path membership only. Cards are built purely from frontmatter/basename, so a body edit is provably content-free for the board, yet schedules the full pipeline.
- **User-visible effect:** board mode: equalize scrollTop clamp + non-first-lane scrollLeft snap + toolbar focus loss per re-index tick; calendar/timeline mode: full teardown + scroll reset repeatedly while the user types in the adjacent pane.
- **Live repro:** REPRODUCED in board, calendar and timeline modes (body-only `vault.process` → full rebuild each time).
- **Fix direction:** diff the frontmatter subset the board actually renders (or the derived card signatures) before rendering; a matching signature makes the pass a true no-op. Same signature gate as 1.1 covers this.

### 1.3 `config.set` echoes back through Bases — every persisted UI interaction renders two-to-three times (MEDIUM)

- **Trigger:** any interaction that calls `config.set` then renders synchronously: lane/column collapse (845-857), column reorder (932), mode switch (1779), compact toggle (1802), filter clear/commit (2276/2284), calendar persist (calendar-controller.ts:114-122, five sets in `persistCalendarState` kanban-view.ts:887-891), timeline range (906).
- **Mechanism:** the view cannot recognize its own config echo; `onDataUpdated` fires again (live-measured: ~+50ms in-memory notification AND ~+1.3–2.8s when the debounced .base file save lands) → up to two additional full content-identical pipelines per click. Triage is now self-healing via `lastTriageSignature`; board/calendar/timeline are not.
- **User-visible effect:** calendar/timeline: the whole mode is torn down again ~250ms (and again seconds) after the interaction already rendered — any scrolling done in that window snaps back. Board: redundant equalize/anchor passes (CPU + clamp risk).
- **Live repro:** REPRODUCED — one lane-collapse click = 2 rebuilds; calendar tab click = 2 rebuilds + grid scrollTop 200→0 twice; timeline range click = 2 rebuilds + scroll reset.
- **Fix direction:** same render-signature guard as 1.1 absorbs the echo naturally (the data is identical by construction — config keys are plugin-private view state); alternatively mark own config writes and ignore the matching data push.

### 1.4 Sequential bulk writes stream intermediate rebuilds; bulk actions have no optimistic model update (MEDIUM)

- **Trigger:** bulk set-status / bulk archive over N selected cards (board-selection.ts:170-191 / 193-212 — sequential awaited writes per card, no model mutation, unlike `applyMove` which mutates + renders first) and `applyMove`'s multi-file renumber path (kanban-view.ts:~1360).
- **Mechanism:** each write fires 'changed'; the debouncer (resetTimer=false) fires 250ms after the FIRST event even while events keep arriving — a long bulk op runs a full pipeline every ~250ms, each rendering a partially-applied state. With showEmptyColumns=false an intermediate batch can flip the structure signature → full `rootEl.empty()` teardown mid-operation.
- **User-visible effect:** cards visibly hop columns in waves for one logical action; possible repeated full-teardown scroll loss.
- **Live repro:** REPRODUCED — 54 sequential writes over ~1.2s produced 5 mid-operation full rebuilds.
- **Fix direction:** give bulk actions the same optimistic pattern `applyMove` already has (mutate all selected cards in the model, render once immediately, then persist); the echo is then absorbed by the 1.1 signature gate. Never delay the writes themselves.

### 1.5 `resolveAndRebuild` has no reentrancy/staleness guard — late async completions re-render over fresher renders (LOW)

- **Mechanism:** kanban-view.ts:490-504 captures `files()` up front, awaits per-file recognition (507-515, unbounded external-plugin latency), then unconditionally calls `rebuild()`. No generation counter. A stale completion re-runs the scroll-mutating post-render passes and can overwrite `noteTypeByPath`/`laneValueByPath` with stale data (worst case: struct flip → full teardown showing stale grouping).
- **Fix direction:** monotonic build-id captured at entry, checked before the final `rebuild()`; stale completions are dropped. Zero latency cost.

### 1.6 Pending filter debounce never cancelled; `commitFilter` has no query-unchanged guard (LOW)

- **Mechanism:** `debouncedFilter` (251, 150ms) is never `.cancel()`ed; `onFilterClear` (2276) and `setFilterQuery`/zoom (2292) commit immediately, so the stale timer fires later and re-runs `commitFilter` (2284: unconditional `config.set` + render) with the already-committed query. Duplicate render re-runs equalize (clamp risk) and toolbar teardown (focus loss); board DOM itself no-ops.
- **Fix direction:** call `debouncedFilter.cancel()` in the immediate-commit paths and add a query-equality early-return in `commitFilter`. (The 150ms typing debounce itself stays — it is not user-visible latency on committed actions.)

### 1.7 Settings 'full' scope fans out to every open view per keystroke, relevant or not (MEDIUM)

- **Trigger:** settings-tab text/textarea `onChange` fires per keystroke → `saveSettings()` default 'full' (plugin.ts:185-190, fan-out at 187); ConfigureBoardModal note-type edits via `upsertNoteType` likewise.
- **Mechanism:** every tracked view gets `onSettingsChanged('full')` → full `debouncedRebuild`, with no relevance check — e.g. editing 'Default statuses' rebuilds a board whose view config overrides statuses (`resolveColumnValues` short-circuits on view config), or note type A's edits rebuild boards showing only type B.
- **User-visible effect:** calendar/timeline views visibly tear down and lose scroll ~every 250ms while typing in settings; board views burn CPU.
- **Live repro:** REPRODUCED — `saveSettings()` with zero mutations reset an open timeline's scroll.
- **Fix direction:** the 1.1 signature gate absorbs the irrelevant rebuilds for free; additionally, scope more settings writes (the 'chrome'/'cards' scopes already exist) and/or pass a relevance hint (note-type id) that views can check against their config.

### 1.8 Debounced rebuild lands mid-drag — no coordination between the pipeline and BoardDnd (MEDIUM)

- **Trigger:** starting a drag within the echo window of a previous write (or any sync/edit landing during a held drag).
- **Mechanism:** nothing in `applyFilterAndRender`/`patchBoard` checks for an in-flight drag (`BoardDnd.dragging` is private, dnd-controller.ts:38-39; view only constructs/destroys it). A signature-driven card rebuild or full render detaches the dimmed `sourceCardEl` mid-gesture: the replacement lacks `.kap-card-dragging` (full-opacity duplicate under the pointer ghost); even a no-op patch's cursor walk (board-renderer.ts:239-251) treats the in-flow placeholder as an anchor and displaces it to the column bottom until the next pointermove.
- **Live repro:** REPRODUCED — echo landing mid-hold left the detached dimmed node + a full-opacity replacement + the ghost simultaneously.
- **Fix direction:** defer the debounced rebuild while a drag is in flight (flush on pointerup — this delays only redundant background work, never user feedback), and/or re-bind `sourceCardEl` by card key after a patch; teach the reconcile cursor walk to skip the placeholder node.

---

## Category 2 — Unguarded full-teardown renderers (calendar, timeline)

### 2.1 Calendar renderer: no signature guard, no scroll capture — `rootEl.empty()` on every render (HIGH)

- **Mechanism:** calendar-renderer.ts:81 unconditionally empties the host and rebuilds panel + grid. No change detection (triage has one), no scrollTop capture for `.kap-panel-list` (styles.src.css:1098-1099) or the grid scroller (1121-1123) or `.kap-cal-focus-day` (1404-1406). Calendar drag-drop has NO optimistic render — it relies on the echo (calendar-controller.ts:334-354, comment 329-333): a drop shows nothing until the debounce, then the whole calendar tears down to move one chip.
- **User-visible effect:** panel/grid scroll reset + focus loss on every rebuild, including content-free ones (body edits, config echoes).
- **Live repro:** REPRODUCED — body-only edit destroyed the marked grid node, scrollTop 199→0.
- **Fix direction:** apply the triage pattern: signature over the derived calendar model; skip identical renders. For real deltas, capture/restore panel + grid scrollTop across the teardown (or patch chips in place). Add an optimistic chip move on drop (consistent with constraint 1 — currently the calendar is the one surface withOUT optimistic feedback, which is a snappiness gap in itself).

### 2.2 Timeline renderer: same defect — `root.empty()` every render; bar drags rely entirely on the echo (HIGH)

- **Mechanism:** timeline-renderer.ts:111 empties and rebuilds header/axis/rows/undated with no diffing, no `.kap-tl-body` scrollTop save (overflow-y-auto, styles.src.css:1594-1596). `shiftDates` (timeline-controller.ts:~271-283) writes start+end sequentially with no optimistic render; the drag transform is removed on pointerup, so the bar visibly snaps back until the echo.
- **Live repro:** REPRODUCED — body-only edit destroyed the row list, scrollTop 199→0.
- **Fix direction:** signature gate + scrollTop capture/restore as in 2.1; optimistic bar position on drop (keep the drag transform or patch the one row until the echo confirms).

### 2.3 Calendar controller routes every UI-state-only change through `host.rebuild()` (HIGH)

- **Mechanism:** all ten calendar callbacks (calendar-controller.ts:237-284) and resize-driven panel auto-collapse (134-159, persist+rebuild at 151-152/156-157 on the 36rem flip) call the FULL view rebuild (relationships, card set, search index) ending in the 2.1 teardown. A legend toggle leaves the panel byte-identical; a tab switch leaves the grid byte-identical — both are destroyed anyway. The persist adds a config echo (1.3) — second teardown.
- **Live repro:** REPRODUCED — anchor '›' click: full data re-derivation + teardown + grid scroll 200→0; panel tab click: twice.
- **Fix direction:** UI-state changes should re-render the calendar from the already-derived card set (a `renderOnly` host hook) instead of `rebuild()`; combined with the 2.1 signature/scroll fix the unchanged pane keeps scroll. The response stays synchronous — strictly less work.

### 2.4 Timeline controller: same pattern for range/anchor/Today/undated toggles (MEDIUM)

- **Mechanism:** timeline-controller.ts callbacks (~165-185, zoom ~300) call `host.rebuild()`; `onTogglePanel`/`onToggleUndatedGroup` (the timeline's Unplanned panel toggles) change only the panel outside the scroller yet destroys the dated row list; anchor/range shifts change bar geometry, not row identity — a scrollTop save/restore would be exact.
- **Live repro:** REPRODUCED — "Quarter" click: 2 rebuilds + body scroll reset.
- **Fix direction:** render-from-cached-cards hook as in 2.3 + scrollTop capture/restore across the teardown; longer term patch rows in place for geometry-only changes.

---

## Category 3 — Scroll preservation gaps in board rendering

### 3.1 `restoreColumnAnchor` captures lane 1's horizontal anchor and force-applies it to EVERY lane on every render (HIGH)

- **Mechanism:** capture reads only the FIRST `.kap-board` (kanban-view.ts:802-812); restore loops `querySelectorAll('.kap-board')` and writes `scrollLeft += delta - offset` on every lane containing the anchor column id (815-828). Lanes are independent horizontal scrollers (board-renderer.ts:132; overflow-x:auto styles.src.css:372), so lanes 2..n scrolled differently from lane 1 are snapped to lane 1's offset even when the patch was a complete DOM no-op. Degenerate case: lane 1 collapsed (body display:none, styles.src.css:558-560) → all rects 0 → anchor falls back to `{cols[0], offset 0}` → every EXPANDED lane resets to the left edge on every render.
- **Live repro:** REPRODUCED both variants (lane 2 snapped 600→0 on a body-only edit; collapsed-lane-1 reset all lanes to left edge).
- **Fix direction:** capture the anchor per lane (keyed by lane id) and skip restore entirely when the structure signature did not change; skip lanes whose board measures 0×0 (collapsed).

### 3.2 `equalizeCardHeights` clear→forced-measure→set cycle clamps deep column/lane scrollTop on every render and resize (HIGH)

- **Mechanism:** card-equalize.ts:36-42 removes `--kap-card-height`, reads `offsetHeight` on every card (forced synchronous layout at natural heights), re-sets. During that intermediate layout, `.kap-column-cards` (styles.src.css:491-498) and `.kap-lanes` (501-509) have shrunken scrollHeights, so the browser clamps scrollTop of any column scrolled past the shrunken extent; re-setting the var does not restore it. No column/lane scrollTop save/restore exists anywhere in src/. Runs on EVERY render (kanban-view.ts:773) and every debounced resize (2381-2385) — including content-identical echoes where the reconciler deliberately reused every node to preserve scroll.
- **Live repro:** REPRODUCED — bottom-scrolled column lost 291px of scrollTop on a body-only edit, silently.
- **Fix direction:** skip the pass when no card signature changed (falls out of the 1.1 gate); when it must run, capture each visible scroller's scrollTop before the clear and restore after the re-set. Also fixes measure-at-wrong-width interplay with 5.2.

### 3.3 Any structure-signature flip forces full `renderBoard` `rootEl.empty()` — per-column and lane-stack vertical scroll never captured (HIGH)

- **Mechanism:** any lane/column SHAPE change (one card emptying a column with showEmptyColumns=false — kanban-view.ts:~724-734; Unmapped materializing/vanishing — board-model.ts:114-120; column reorder — kanban-view.ts:932; filter keystroke; lane appearing) flips `structureSignature` (signatures.ts:20-25) → `renderBoard` `rootEl.empty()` (board-renderer.ts:48, check at 86-88). Only the horizontal anchor is restored; every `.kap-column-cards` and `.kap-lanes` scrollTop resets. For the user's own drag the loss happens at the OPTIMISTIC render itself (the echo then no-ops). Column reorder changes NO card list yet wipes all vertical scroll.
- **Live repro:** REPRODUCED — struct flip reset an unrelated column's scrollTop 291→0.
- **Fix direction:** per-column scrollTop save/restore keyed by column id across the full render (and `.kap-lanes` scrollTop); longer term, patch structural deltas in place (move column nodes on reorder) instead of falling back to full render.

### 3.4 No scroll state survives view reopen (LOW)

- **Mechanism:** collapse/filter/ranges are persisted per issue #19 (kanban-view.ts:860-906+), scroll offsets are not; onunload discards everything; first render lands async after an empty host (brief empty→populated pop).
- **Fix direction:** implement `getEphemeralState`/`setEphemeralState` (the idiomatic Obsidian channel — avoids churning the .base file per scroll) carrying board scrollLeft + per-column scrollTop + calendar/timeline/triage body scroll.

---

## Category 4 — Optimistic-update gaps: the echo carries the visible change

(Constraint 1 note: these are cases where the optimistic path is _missing or incomplete_ — the fix is to complete it, never to lean harder on the echo.)

### 4.1 Cross-lane drag: optimistic render uses stale `card.laneValue` — snap-back to source lane, then jump on the echo (HIGH)

- **Mechanism:** `applyLaneChange` (kanban-view.ts:1253-1272) writes the grouping property but never updates in-memory `card.laneValue` (only `resolveAndRebuild` recomputes it); `applyMove` (1289-1363) mutates only order/statusValue then renders optimistically. `buildBoard` groups strictly by `card.laneValue` (board-model.ts:191), so the optimistic render draws the card back in the SOURCE lane; the echo moves it to the target lane — two visible movements for one gesture, intermediate state matching neither before nor after. Defeats the issue-#64 optimistic mechanism.
- **Live repro:** REPRODUCED — card in source lane at t0/t120, target lane only at t~900.
- **Fix direction:** update `card.laneValue` (and `laneValueByPath`) in the optimistic mutation before rendering — the echo then re-derives the identical state and is absorbed.

### 4.2 Triage value click: stale-cache signature suppresses the immediate render; the echo does the visible teardown with focus loss (MEDIUM)

- **Mechanism:** after the awaited write, `renderTriage` (1810) runs immediately but `buildTriageData` (2181+) reads the still-stale metadata cache → recomputed data equals pre-write data → signature matches `lastTriageSignature` (1847) → render skipped. The click shows nothing until the echo, whose different signature triggers the full `container.empty()` teardown (triage-view.ts:80) — scroll preserved, keyboard focus dropped. The guard built to absorb echoes inverts here.
- **Live repro:** PARTIAL — echo-teardown/focus-loss half reproduced; click path needed enum fixtures not stageable safely.
- **Fix direction:** feed the just-written value as an override into `buildTriageData` (the `cardUnsetCount` override param at ~2091 is the existing precedent) so the immediate render reflects the click; the echo then matches the new signature and is skipped. Add focus save/restore in triage-view for renders that do proceed.

### 4.3 Card-menu enum/date writes: no optimistic update — change lands on the echo as a whole-card node swap with focus loss (LOW)

- **Mechanism:** `setCardProperty` (1747) and `writeCardDate` (1613) are pure frontmatter writes — no model mutation, no immediate render, no `refocusCardKey` (set only for move/reorder/send-to-edge at 1514/1527/1542). Change appears ~250ms later; if the property is displayed, `cardSignature` changes → reconciler removes+rebuilds the node (reconcile.ts:54-61) → keyboard focus lost; if the new chip changes the tallest card, equalize resizes every card board-wide.
- **Fix direction:** follow the `applyMove` pattern: mutate the in-memory card field + render immediately, set `refocusCardKey` for the keyboard path (or patch the chip in place instead of swapping the node). The board-wide height shift is a Category-5 design consequence, not fixable here.

---

## Category 5 — CSS & layout coupling

### 5.1 Board-wide `--kap-card-height` coupling — one card's content change resizes every card in every column and lane (MEDIUM)

- **Mechanism:** card-equalize.ts:36-42 takes a single max over ALL `.kap-card`, stamped on boardEl; consumed as `min-height` at styles.src.css:591. When the max changes (one chip edited, tallest card filtered/moved, title rewrap on any width change), every card everywhere changes height; content-sized lanes (514-519) reflow the whole stack. Deliberate design ("uniform card envelope"), but the blast radius exceeds the content change.
- **Live repro:** REPRODUCED — renaming the tallest card changed every measured card 93→69px board-wide.
- **Fix direction:** scope equalization per column or per lane (movement confined to where content changed), or replace the measured max with a CSS-only cap/uniform policy that doesn't couple unrelated columns. Design decision required — flag for maintainer.

### 5.2 No `scrollbar-gutter` reservation on any scroll container (HIGH — MEDIUM on overlay-scrollbar platforms)

- **Mechanism:** zero `scrollbar-gutter` rules; `scrollbar-width: thin` (styles.src.css:1543-1551) renders a layout-consuming ~14px scrollbar (live-measured 15px). Any container crossing its overflow threshold — which can toggle WITHOUT content change in that container (a `--kap-card-height` increase from a DIFFERENT column, selection bar shrinking the host, resize) — narrows content, rewraps chips/titles, changes natural heights, republishes the board-wide height var. Compounding: equalize clears the min-height before measuring, so measurement can happen scrollbar-free while display has the scrollbar — the published uniform height is computed at a different width than displayed, so some cards exceed it and uniformity visibly breaks (stable break, not oscillation). `.kap-tl-body` (1594-1596) is a further gutter-less scroller.
- **Live repro:** REPRODUCED — overflowing column clientWidth 445 vs sibling 460.
- **Fix direction:** `scrollbar-gutter: stable` on all scroll containers (.kap-board, .kap-column-cards, .kap-lanes, .kap-calendar, .kap-panel-list, .kap-cal-focus-day, .kap-tl-body); eliminates the whole class. Reserved space = constraint-3-compliant stability.

### 5.3 `flex-grow:1` columns — any column-count change re-widths every column, rewrapping and re-heightening the whole board (HIGH when spare width exists)

- **Mechanism:** `.kap-column { flex: 1 0 17rem }` (styles.src.css:384; equal-grow is a documented invariant, issue #73). Removing/adding one column (Unmapped toggling, empty-column stripping, filter keystroke, drag emptying its source, collapse freeing width) changes every column's share (W/4 → W/3) → board-wide rewrap → new `--kap-card-height` → board-wide re-height, coinciding with the 3.3 full teardown for count changes. No effect when the board already overflows horizontally (widths pinned at 17rem).
- **Live repro:** REPRODUCED — emptying one column re-widthed untouched columns 462→699px.
- **Fix direction:** conflicts with the issue-#73 invariant — needs a maintainer decision: keep fixed 17rem (no grow) or grow a trailing spacer instead of the columns, confining the visible change to the removed column.

### 5.4 Selection bar insertion steals board-host height mid-click (MEDIUM)

- **Mechanism:** the bar sits in flow between toolbar and flex-1 board host (kanban-view.ts:270); `renderBar` toggles `kap-hidden` on first-select/last-deselect (board-selection.ts:116-124+). Unhiding takes ~45-56px from the host: the whole board translates down, every column loses that height (the just-clicked card moves under the pointer; shift-click ranges can misfire), can push near-full columns over the scroll threshold (cascading into 5.2), and the boardEl resize fires the equalize pass.
- **Live repro:** REPRODUCED — board-host top +55.9px on first selection click.
- **Fix direction:** reserve the bar's height while select mode is active (mode toggle is the deliberate layout moment), or overlay it — no reflow on selection count changes.

### 5.5 Resize-driven equalization unguarded: height-only no-ops and hidden-tab var destruction (MEDIUM)

- **Mechanism:** ResizeObserver → 120ms debounce → `onResize` (kanban-view.ts:2381-2385) → equalize with no zero-size or width-unchanged guard. Height-only changes (selection bar, 'No cards match' toggle) run the pointless clear→measure→set cycle with the 3.2 clamp risk. Hidden tab: all cards measure 0 → `uniformCardHeight` returns null → the var is REMOVED and never re-set (card-equalize.ts:18-24, 37) → tab return paints uneven natural heights until the show-side resize re-stamps.
- **Live repro:** NOT REPRODUCIBLE in test env (ResizeObserver callbacks never fired in the throttled/hidden window — code path confirmed by reading; needs a foregrounded window).
- **Fix direction:** guard `onResize`: skip when boardEl measures 0×0; skip equalize when width is unchanged since the last pass. Pure less-work.

### 5.6 Chip-style ('chrome') settings change never re-equalizes — deferred board-wide height jump attached to the next unrelated rebuild (MEDIUM)

- **Mechanism:** the 'chrome' branch (kanban-view.ts:1556-1558) only calls `applyChipStyle()` (2017-2023, class toggle); chip styles have different geometry (styles.src.css:719-830) so natural heights change immediately while `--kap-card-height` stays stale; the correcting equalize lands on the NEXT rebuild — e.g. a content-identical echo — so every card jumps "for no reason".
- **Live repro:** REPRODUCED (mechanism; fixtures had no chips to expose the jump visually).
- **Fix direction:** call `equalizeCardHeights()` from the 'chrome' branch — one-line, ties the reflow to its cause.

### 5.7 In-flow drag placeholder and column drop indicator shift siblings on reposition (LOW)

- **Mechanism:** card placeholder is an in-flow 2px div + margins joining the gap chain (dnd-controller.ts:108/141; styles.src.css:1010-1015) — each slot change shifts all cards below ~14px and changes both columns' scrollHeights; column indicator is `flex 0 0 3px` in the board row (column-dnd.ts:112/133; 425-430), slightly re-widthing all columns. (Earlier jitter claim refuted — the feedback is hysteretic, not oscillatory.) The calendar's `.kap-cal-drop` outline (1379-1386) is the in-repo non-displacing counter-example.
- **Fix direction:** overlay/outline drop indicators (calendar pattern) instead of in-flow spacers; keeps feedback instant with zero displacement.

### 5.8 Drag ghost loses `--kap-card-height` when cloned onto body — visible shrink at drag start (LOW)

- **Mechanism:** dnd-controller.ts:102-106 copies only width; the height var is inline on boardEl only, so the body-parented ghost falls back to 2.75rem min-height (styles.src.css:591) and renders shorter than the equalized in-column card. Cosmetic.
- **Fix direction:** copy `offsetHeight` to the ghost alongside width.

### 5.9 Config modal: active-tab font-weight shifts sibling tabs in the wrapped narrow nav (LOW)

- **Mechanism:** styles.src.css:1494 bolds the active tab; in the ≤600px wrapped row (1517-1528) tabs are intrinsically sized, so activation widens the label, shifting siblings/wrap point. Desktop's fixed 11rem column absorbs it. Modal chrome only.
- **Fix direction:** reserve width (fixed basis or text-shadow bolding trick) or drop the weight change in the wrapped layout.

### 5.10 Toolbar slots emptied and rebuilt on every render pass — keyboard focus dropped on no-op echoes (LOW)

- **Mechanism:** view-toolbar.ts:47/63 `empty()` + rebuild with fresh listeners each `applyFilterAndRender` (686/692/698/738). Visually pixel-identical on no-op state; the cost is keyboard focus/hover loss and possible swallowed clicks. The persistent FilterBar middle slot (kanban-view.ts:263-268) is the in-repo counter-example.
- **Fix direction:** diff `ViewToolbarState` and patch classes/tooltips in place (or make the slots persistent like the filter bar); largely subsumed by the 1.1 signature gate for no-op passes.

---

## Critic-identified gaps / unverified hypotheses

### N1. Timeline mode: every resize tick triggers a FULL rebuild (model re-derivation + teardown) — repeatedly during a splitter drag, twice per tab hide/reveal (NEW, code-verified)

- kanban-view.ts:2381-2385: `onResize()` ends with `if (this.timelineMode()) this.rebuild()`; debouncedResize (250, 120ms, non-resetting) fires ~every 120ms DURING a continuous drag; the doc comment (2376-2380) confirms hidden→visible leaves fire it too (rebuild at 0×0, then again at reveal). Zero scroll preservation (2.2).
- **Fix direction:** gate on width actually crossing the px thresholds the comment cites (issue #80); skip when boardEl measures 0×0; capture/restore `.kap-tl-body` scroll across the teardown.

### N2. `applyRefocus` ordering: `focus()` without `preventScroll` runs between anchor restore and equalize (NEW, code-verified)

- kanban-view.ts:766/767/773; `applyRefocus` (777-783) calls native `el?.focus()` — reveal-scroll is computed against a layout that equalize invalidates one statement later, and the ancestor `.kap-board` scroll it triggers can override the anchor just restored. The scroll-to-focused-card is user-justified; the ORDERING is the defect.
- **Fix direction:** `focus({ preventScroll: true })` + explicit scoped scrollIntoView AFTER `equalizeCardHeights`, or move `applyRefocus` after the equalize call.

### N3. Touch input: `touch-action:none` on cards makes touch-scrolling columns impossible and turns a >5px pan into a silent drag that can write frontmatter (NEW, code-verified)

- styles.src.css:598 (.kap-card), :400, :1292; dnd-controller.ts:63-84 never checks `pointerType` and drags at the 5px threshold. Touchscreen laptops run desktop Obsidian despite `isDesktopOnly`.
- **Fix direction:** `touch-action: pan-y` on cards (pan-x where appropriate) or gate touch drags behind a long-press before suppressing native panning; mouse drag latency unchanged.

### N4. Popout windows: drag pointermove/pointerup listeners bound to the MAIN window (PROBABLE — not runtime-verified)

- dnd-controller.ts:73-75 and calendar-dnd.ts:63-65 use `window.addEventListener`; the ghost is popout-aware (`activeDocument.body`) but the handlers are not — a drag in a popout likely never updates/completes (leaked ghost, stuck `kap-card-dragging`). Needs a live popout repro.
- **Fix direction:** bind to `cardEl.win` / `activeWindow` per project API conventions.

### Follow-up coverage gaps (unquantified, from critic)

- **O(N) forced layout per pass:** equalize reads `offsetHeight` on every card per render AND per resize tick — main-thread jank on large boards distinct from the clamp defect; the 1.1 gate + 5.5 guards reduce frequency, virtualization is the long-term answer.
- **Ephemeral state API unimplemented** — named as the fix vehicle for 3.4.
- **Hover popover anchored to echo-destroyed card nodes** (kanban-view.ts:~383-390) — minor; subsumed by echo suppression.
- **`prefers-reduced-motion` drag ghost never positioned** (dnd-controller.ts:112 early-return) — verify where the ghost renders in that mode; cosmetic.
- **Confirmed non-issues:** no `@keyframes`/`animation:` anywhere; `.kap-card` transitions cover only border/shadow/transform — height changes snap, no compounding animation.

---

## Cross-cutting fix themes (priority order, all constraint-compliant)

1. **Render-signature gate on the funnel** (generalize `lastTriageSignature` to board/calendar/timeline before `applyFilterAndRender`): kills 1.1, 1.2, 1.3, 1.7 and the no-op halves of 3.1/3.2/5.10 in one mechanism. Echoes become true no-ops; optimistic renders stay the immediate feedback.
2. **Scroll capture/restore where teardown is genuinely needed**: per-column/lane scrollTop across full board renders (3.3), calendar/timeline body scroll (2.1/2.2/2.3/2.4), per-lane horizontal anchors (3.1), scrollTop snapshot around equalize (3.2).
3. **Complete the optimistic model**: `card.laneValue` (4.1), bulk actions (1.4), triage value override (4.2), card-menu writes (4.3), calendar/timeline drops (2.1/2.2).
4. **Reserve space instead of reacting**: `scrollbar-gutter: stable` (5.2), selection-bar height reservation (5.4), overlay drop indicators (5.7).
5. **Guard the resize path**: zero-size + width-unchanged skips (5.5, N1), chrome-branch equalize (5.6), refocus ordering (N2).

## Appendix

- **Findings resolved by recent code changes:** none. (Triage mode's `lastTriageSignature` guard, added earlier, partially mitigates 1.3 for triage only — noted inline.)
- **Rejected findings:** none — every audited finding was confirmed by all three verification lenses or downgraded/scoped inline (toolbar teardown and drag-ghost shrink were contested on the manifestation lens as chrome-only/cosmetic and are recorded at LOW with that scoping; the placeholder "jitter" sub-claim was refuted and removed from 5.7).
- **Environment caveat:** ResizeObserver callbacks never fired in the live-repro Obsidian instance (background-throttled window), so 5.5 and the resize legs of N1 are code-verified but not runtime-verified.
