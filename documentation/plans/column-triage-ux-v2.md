# Column triage UX v2 — design (issue #170 follow-up)

Status: IMPLEMENTED (v2.1 + final-review fixes). Kept as the design record.
Owner ask: "much better UI/UX. Like Wim Cools' video: the different statuses listed at the
bottom of the card at the center. Animations too — a confetti or stamp effect when a choice
is made (clicking another status, selecting Keep, clicking the left/right targets if they
remain, swiping, or drag-dropping)."

## Current state (shipped in d27fe20)

Full-pane overlay (`.kap-focus kap-coltriage`): header (position/total, exit), a centered
card (title, fields, Keep button, hints), and two tall dashed prev/next drop targets at the
pane edges that "arm" while a drag points at them. Swipe left/right = previous/next status
(carousel over the card's OWN type's columns), down/Space = keep. All writes go through
`setCardStatus` (automations fire). State lives in `kanban-view.ts` (`columnTriage`:
columnId, label, queue keys, index); every render pass re-mounts the overlay
(`renderColumnTriageOverlay`), which re-derives the current card.

## v2 design

### Layout (Tinder-style, one visual center)

1. **Card stack, centered.** The current card front and center; the next 2 queue cards
   peek behind it (scaled ~0.95/0.90, translated up a few px, no content interactivity) so
   progress feels tangible. The stack replaces the flat lone card.
2. **Status chip row at the bottom of the card, centered** (the Wim Cools pattern): ALL of
   the card's own type's status columns as chips, in column order, each with its column
   color dot + label; the card's CURRENT status is highlighted and non-clickable. Clicking
   any other chip moves the card straight to that status (no carousel hop needed). Chips
   show a `1..9` keyboard hint ordinal.
3. **Prev/next side targets: FULL-HEIGHT drop zones.** Owner feedback on v1: the side
   buttons floating at a different height than the card look bad. In v2 they span 100% of
   the pane height (edge to edge, hugging the left/right pane borders), wide enough to
   read and hit comfortably, labeled with the previous/next column name. They double as
   drag-drop zones with clear visual effects: idle = subtle dashed edge zone; drag in
   progress = both zones lift into view (stronger border/background); pointer over a zone
   = armed accent fill + label scale. Carousel semantics preserved for swipe muscle
   memory.
4. **Keep** stays as a button under the chip row (and ↓ / Space / swipe down).
5. **Header** adds a thin progress bar (like triage mode) under the position counter.

### Interactions (every one triggers the decision animation)

- Click a status chip → move to that status.
- Click Keep → keep.
- Click a side rail → move prev/next (carousel).
- Keyboard: `1..9` = jump to nth chip; ← / → = carousel prev/next; ↓ / Space = keep;
  Esc = exit; O = open.
- Swipe: left/right = carousel prev/next; down = keep.
- **Drag-drop**: dragging the card over a chip or a side rail highlights it as a drop
  target; releasing there commits that exact status. (Chips hit-test by elementFromPoint
  under the pointer since the card has pointer capture.)

### Decision animation (the "stamp" + fly-out)

On ANY commit:

1. A **stamp** appears over the card: the target status label (or "KEEP"), uppercase, in a
   thick rounded border, rotated −12°, scaling from 1.6→1 with a fast ease-out and a brief
   opacity flash — the classic passport-stamp slam (~180ms).
2. The card then **flies out** toward the decision direction (left/right = off-screen with
   rotation; a chip / Keep = downward-fade), ~220ms ease-in, while the next stack card
   promotes to the front (scale/translate transition).
3. **Confetti** (reuse `ui/triage/confetti.ts` `burstConfetti`) fires when (a) the chosen
   status is a DONE state for the card's type (`isDoneValue`), or (b) the pass completes
   (last card). Everyday moves get the stamp only — confetti on every card would wear out.
4. `prefers-reduced-motion: reduce` → skip fly-out/stamp scaling, use a simple fade;
   confetti already respects it or is skipped.

### Animation vs. re-render (the hard part)

Writes trigger a metadata-cache rebuild that re-mounts the overlay mid-animation. Sequence:

1. User commits a decision → set `columnTriageAnimating = true`, play stamp + fly-out on
   the CURRENT DOM (optimistic), dispatch the write (`setCardStatus`) without awaiting the
   render.
2. `renderColumnTriageOverlay()` returns early while `columnTriageAnimating` (the rebuild
   that lands mid-animation is absorbed; the queue/index state is already updated).
3. On `animationend` (with a `setTimeout` fallback ~400ms in case the event never fires,
   e.g. element detached), clear the flag and force one re-render → next card mounts with
   a subtle enter animation.

### Out of scope

- No sound. No per-chip confetti. No reordering within the pass. Board-side drag of cards
  onto columns is untouched. Triage mode (global) untouched except shared CSS reuse.

## Open questions for the reviewer

1. Is the animating-flag approach sound against the rebuild pipeline, or does it risk a
   stale overlay (e.g. write fails, animation ends, re-render shows the card gone/back)?
2. elementFromPoint drop targeting while the card has pointer capture — pitfalls?
3. Chip row on mixed-type boards: chips are the CURRENT card's type's columns — is
   rendering a different chip set per card confusing enough to need a type label?
4. Anything cheap that would make the interaction feel dramatically better?

## v2.1 — refinements after adversarial review (gpt-5.6-sol xhigh)

Review verdict: interaction concept strong, state/DOM lifecycle unsafe as drafted. All 19
findings accepted; resolutions:

1. **Stable overlay host** (F1/F2): the overlay mounts in the view's `rootEl` (never
   emptied by mode renderers), not `boardEl`. Re-render passes are gated by a **render
   signature** (current key · index · completed · queue length · card status); identical
   signatures and in-flight animations (`busy`) skip the remount. Late metadata echoes
   become no-ops.
2. **Decision state machine** (F5/F13): one `columnTriageDecide()` gate — `busy` input
   lock + a `generation` token; every entry point (chip, rail, keep, key, swipe, drop)
   funnels through it. Animation completion = named-keyframe `animationend` filtered by
   animation name, raced with an owning-window timeout; both idempotent via the token.
3. **Write-outcome handling** (F3): the card is removed from the queue only AFTER the
   status write resolves without throwing; the stamp/fly-out runs concurrently
   (optimistic), and a failed write re-renders the card back with a Notice, no confetti.
4. **Lane-correct queue** (F4): the column-header button now passes `laneId`, the column
   label, AND the exact rendered card keys — the pass snapshots precisely what the user
   clicked.
5. **Stationary tray** (F6): the chip row + Keep live OUTSIDE the moving card face, pinned
   under the stack; only the face transforms. Drag-drop targets = chips, Keep, and rails,
   hit-tested with `doc.elementsFromPoint` excluding the face (F7), recomputed on
   pointerup; pointer listeners/timers use the owning `el.win`/`el.doc` (F9, popouts).
6. **Full-height rails** (owner + F10): rails stretch the full pane height, wide
   (clamp 7–16rem), labelled with the destination status; drag lifts them, pointer-over
   arms them (accent fill). A container query collapses them below 640px pane width —
   chips + Keep remain the narrow-pane path. Desktop-only plugin; `touch-action` stays on
   the face only (F8).
7. **Done confetti** (F11): only when the card's resolved status property equals its done
   definition's property AND the destination status is a done value; plus a completion
   burst when the pass ends (overlay kept mounted for the burst, then exits).
8. **Reduced motion** (F14): new `--kap-anim`/`--kap-anim-fast` duration vars, zeroed in
   the existing reduced-motion block; the animation helper also short-circuits via the
   owning window's `matchMedia`.
9. **Progress** (F15): `initialTotal` + decisions-done (`completed` moves + `index`
   keeps) drive the counter, progress bar, and completion — totals never drift.
10. **Keyboard** (F16/F17): repeats/modifiers ignored, Space/Enter left to focused
    controls, digit hints only for the first 9 chips, chip row wraps; `aria-keyshortcuts`
    on the controls.
11. **Carousel wrap kept deliberately** (F18): the owner's #170 spec asks for it, and the
    rails always NAME their destination, so the wrap is explicit, never a surprise.
12. **CSS discipline** (F19): all effects class/data-state driven under `@layer`, `kap-`
    prefixed keyframes, only custom-property values set via `setCssProps`.
13. **Comprehension** (reviewer suggestion): the stamp is tinted with the destination
    column's color, chip moves fly left/right by relative column position, and Keep is
    labelled "Keep in <status>".
