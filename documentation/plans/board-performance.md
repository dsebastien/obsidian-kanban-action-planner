# Board performance

Status: INVESTIGATED (2026-08-28). Column-triage fix SHIPPED (655a5ea). Items below are
proposed, not implemented.

## Measurements (live vault, 200-card single-column fixture, v1.19.1+655a5ea)

Method: temp fixture folder + root `.base`; synchronous `dispatchEvent` timing for
interactions; instance-method wrapping (`basesLeaf.view.controller.view`) for the pipeline;
raw probes for style recalc/reflow.

- **Data pipeline is cheap.** Full `resolveAndRebuild` (recognize types, relationships,
  cards, search records): 10–44ms. `toCard` ×200 = 3ms total, recognition ~2ms,
  `collectPropertyNames` <2ms. Not a bottleneck.
- **The DOM pass costs ~160ms, ~135ms of it `equalizeCardHeights`.**
  `buildBoard` + `patchBoard` + signature + toolbar ≈ 27ms.
- **The unit cost is STYLE RECALC, not plugin CSS and not layout geometry.** Board DOM is
  tiny (793 nodes, 2 per card). But ANY invalidation + forced read on the board subtree
  costs ~60–68ms — even a single card's `min-height`, even a bare class toggle with no
  geometry change (64ms). Control probes: 800 plain divs with NO plugin classes cost
  169ms; a de-classed board clone 94ms. Cause: the vault document carries 64 stylesheets /
  14k+ top-level rules (theme, snippets, ~80 plugins) → ~0.08–0.1ms recalc per element,
  environment-wide. The plugin cannot fix that tax; it can only invalidate fewer elements,
  less often.
- **Interaction costs at 200 cards:** card move (drag/status change) = one DOM pass
  ≈ 160ms sync. Filter typing = debounced 150ms, then one ~160ms pass. Column-triage
  decision (post-fix) = 50–98ms (overlay remount + `focus()` + ghost rect ≈ 1–2
  subtree invalidations). Echo rebuild after a write ≈ 50–90ms task (derive + gated
  no-op render).

## Proposed fixes (ranked)

1. **Gate `equalizeCardHeights` on a height signature.** A pure move/reorder cannot change
   any card's natural height. Skip equalize when unchanged: sorted multiset of
   `cardSignature(card, '')` (content only, accent excluded) for cards in
   non-collapsed columns/lanes + `structureSignature` (columns are `flex: 1 0 17rem`, so
   the visible column set changes card width) + collapse state + compact flag. Direct
   equalize calls (resize at width change, chrome settings) stay unconditional.
   Effect: move interaction ~160ms → ~27ms. ⚠️ Touches Business Rule 8a ("recomputed on
   every rebuild") — the uniform-height invariant is preserved, only the recompute trigger
   narrows; needs owner sign-off. Residual risk: an external CSS change (theme/font
   toggle) that alters natural heights without a resize keeps the stale uniform height
   until the next content change.
2. **Patch the column-triage overlay in place** instead of full remount per decision
   (update face title/fields, chips' current/ordinal state, counter, rails, stack titles).
   Shrinks per-decision invalidation from the whole overlay subtree to a handful of text
   nodes; expected decision cost 50–98ms → ~10–20ms. The render signature gate stays as
   the outer guard.
3. **Defer the ghost's rect read**: cache the face rect right after each overlay render
   (post-layout, e.g. rAF) so `spawnColumnTriageDecisionGhost` doesn't force a recalc at
   decision time. Only worth it after (2).

Non-goals: virtualizing/`content-visibility` (DOM is already tiny; recalc tax is
per-element in this environment, and 793 nodes is fine); optimizing the derive pipeline
(already <45ms at 200 cards).

## User-environment note

The ~0.1ms/element recalc tax comes from the vault's stylesheet volume (theme + snippets +
~80 plugins), and applies to every Obsidian plugin's UI in that vault, not just this one.
