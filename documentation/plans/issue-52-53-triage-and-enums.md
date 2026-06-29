# Triage mode + enum quick-set (#53 + #52)

Status: **shipped** (both parts). **#52 enum quick-set** (d0fe74b) and **#53 triage mode**
(9112c70) are implemented, tested, and live-verified. This document is kept as the design
record; the as-built notes match it except where noted below.

**As-built deltas:** triage role lists use `multitext` (no multi-property Bases option exists),
so props are entered as ids (`priority`, `formula.x`); the unset rule also treats a value that
**isn't among known allowed values** as unset (added during design); the triage queue is a
**stable per-session snapshot** (cursor by card key) rather than rebuilt each render.

## Goal

Attack backlog overwhelm with a focused, one-card-at-a-time **Triage mode**: clarify items
whose planning properties are unset/TBD/invalid, and (via a scope toggle) re-prioritize
already-complete items. Triage edits enum properties in one click — which requires first
teaching the plugin every property's **allowed values** (not just `status`).

## Locked design decisions (from design interview)

1. **Build #52 enum quick-set first**, as the foundation; triage reuses its allowed-values
   resolution + quick-set menu. Quick-set also lands on the normal board (independently useful).
2. **Allowed-values source:** Starter Kit auto-detect (`SkPropertyDefinition.allowedValues`,
   already exposed but only consumed for `status` today) **+ a manual per-note-type fallback**
   for local types / props SK doesn't define. Mirrors the existing local-note-type pattern (#31).
3. **Triage config lives per-view** (in the `.base`, via `this.config`), like cardSort/grouping —
   so it can reference **both** note properties **and** base formulas (`formula.priority_score`).
4. **Three role lists with smart defaults:**
    - **Update** — editable enum props (must be writeable `note.*` with known allowed-values).
    - **Use** (gating: decides "unclarified") — defaults to the Update set.
    - **See** (read-only context, incl. `formula.*`/`file.*`) — defaults to the view's existing
      card-display props (`config.getOrder()`).
5. **"Unset / unclarified" rule** (convention-agnostic — never hardcode `99 - TBD`): a gating
   prop counts as unset when **empty/absent** OR its value contains one of a per-view
   **needs-triage tokens** list (user sets e.g. `TBD, No Target`) OR — **when allowed-values are
   known** — the value is **not among them** (stale/invalid).
6. **Form factor:** dedicated **Triage mode** = 3rd toolbar button (Board / Calendar / Triage).
   View area becomes a one-card-at-a-time queue: read-only context on top, editable enum
   controls, **Next / Skip**, remaining count.
7. **Scope toggle** (queue membership):
    - **Needs clarification** — only cards with an unset gating prop (the #53 behavior).
    - **All cards** — re-prioritize everything, worst-first.
    - (Future) **Due for review** — `last_reviewed`/`review_interval`, pulls in #57. Leave room.
8. **Queue order:** worst-first (most unset gating props), ties broken by the view's configured
   card sort. In "All cards" scope with nothing unset, falls through to the view sort.
9. **Behaviors:** triage respects the **toolbar text filter** (narrow the queue); **no
   auto-advance** after setting values (explicit Next/Skip so the recomputed score is visible);
   **mixed-type views** resolve gating/editable props + allowed-values **per card** against that
   card's recognized note type (`noteTypeByPath`). A card is queued if any of _its applicable_
   gating props is unset.

---

## Part A — Enum quick-set (#52)

### A1. Domain: manual allowed-values on the note type

`src/app/domain/note-type.ts` — extend `noteTypeSchema` with an optional manual enum map.
Default `{}` so older stored note types degrade gracefully (no backfill — see CLAUDE.md rule).

```ts
// property name (lower-cased key at read time) → ordered allowed values
enumProperties: z.record(z.string(), z.array(z.string())).default({})
```

This is the **fallback/override**: when SK supplies allowed-values for a property, those win
unless a manual list exists; without SK, the manual list is the only source.

### A2. Service: resolve a property's allowed-values

New pure-ish resolver (e.g. in `src/app/services/enum.service.ts` + `.spec.ts`):

```ts
// Resolve ordered allowed values for `propertyName` on the note type the card resolved to.
// Precedence: manual note-type list → Starter Kit property allowedValues → [] (free value).
resolveAllowedValues(app, plugin, noteTypeId | SkNoteType, propertyName): string[]
```

- SK side: generalize beyond `findStatusProperty` — add `findProperty(noteType, name)` returning
  `{ name, allowedValues }` for **any** property (reuse `toStringValues`).
- Manual side: read `noteType.enumProperties[name]` (case-insensitive key match like
  `findKeyCaseInsensitive`).
- Returns `[]` when neither source knows the property → quick-set not offered (free-text only).

### A3. Card menu: generic "Set <property>" submenu

`src/app/views/kanban/card-menu.ts` + host wiring in `kanban-view.ts`.

- Generalize the existing "Set status" block (`buildCardMenu`) into a reusable submenu builder:
  for each configured enum property that has allowed-values for the card's note type, add a
  **Set <DisplayName>** submenu listing the values, **current value checked**, plus **Clear**.
- New `CardMenuHost` members:
    - `enumPropertiesFor(card): Array<{ name, displayName, values: string[], current: string|null }>`
    - `setCardProperty(card, propertyName, value: string|null): Promise<void>`
- Host impl in `kanban-view.ts`: resolve via A2 using `noteTypeByPath.get(card.file.path)`;
  read current via `getFrontmatterValue`; write via `setProperty` / clear via `deleteProperty`
  (frontmatter.service). The #13 metadata listener already re-renders live after the write.
- **Which properties get a Set-menu on the board?** The note type's `enumProperties` keys ∪ any
  SK select-typed props. (Status keeps its dedicated path; don't double-list it.)

### A4. Settings UI for manual enums

`src/app/ui/configure-board-modal.ts` — add an **"Enums"** section (note-type scope): list
properties with an editable ordered allowed-values list (add / reorder / remove), like the
existing fields editors. Show SK-detected values as read-only hints where present. Persists via a
new `note-type.service.ts` mutator `setEnumProperty(plugin, noteTypeId, name, values)`.

### A5. Tests (#52)

- `enum.service.spec.ts`: precedence (manual > SK > empty), case-insensitive name match,
  empty-on-unknown.
- Card-menu unit: submenu built only for props with values; current value checked; Clear present.
- `note-type.service.spec.ts`: `setEnumProperty` round-trips; default `{}` on legacy shapes.

---

## Part B — Triage mode (#53)

### B1. Per-view config options

`src/app/views/kanban/kanban-view-options.ts` — add a **Triage** option group:

| Option key          | Type                                    | Meaning                                       |
| ------------------- | --------------------------------------- | --------------------------------------------- |
| `triageUpdateProps` | id list (writeable `note.*` w/ enums)   | editable props                                |
| `triageGateProps`   | id list (`note.*`)                      | gating; **empty ⇒ defaults to update set**    |
| `triageSeeProps`    | id list (`note.*`/`formula.*`/`file.*`) | context; **empty ⇒ defaults to `getOrder()`** |
| `triageTokens`      | multitext                               | needs-triage tokens (e.g. `TBD, No Target`)   |
| `triageScope`       | enum `clarify`\|`all`                   | queue membership (room for `review` later)    |
| `triageMode`        | bool (persisted, like `calendarMode`)   | active mode flag                              |

- Update/gate pickers use the **writeable** filter (`buildPropertyFilter`, `note.*` only — you
  can only set what you can write). See picker uses `buildReadOnlyPropertyFilter` (allows
  formula/file). Read via `view-config.ts` helpers (`readIdArray`, `readStringArray`).
- Generalize the toolbar mode from boolean to tri-state: keep `calendarMode` + add `triageMode`;
  precedence triage > calendar > board, or refactor to a single `viewMode` string. (Prefer adding
  `triageMode` to avoid churn in existing calendar code; document the precedence.)

### B2. Pure predicates + queue builder

New `src/app/views/kanban/triage.ts` + `triage.spec.ts` — **pure**, no Obsidian deps; takes
resolved scalars + allowed-values so it unit-tests cleanly:

```ts
// A single gating prop's state for one card.
isPropUnset(value: string|null, tokens: string[], allowedValues: string[] | null): boolean
// empty/absent → true; token substring match → true;
// allowedValues!=null && value∉allowedValues → true; else false.

// Count unset gating props for a card (0 ⇒ clarified).
unsetCount(card, gateRefs, resolve): number

// Build the ordered queue from the (already text-filtered) card list.
buildTriageQueue(cards, scope, gateRefs, resolve, viewSortCompare): Card[]
//  clarify: keep unsetCount>0; all: keep everything.
//  order: unsetCount desc, then viewSortCompare (reuse existing comparator).
```

Value resolution reuses `parsePropertyRef` + `unwrapValue` (note→`getFrontmatterValue`,
computed→`entriesByPath.get(path).getValue(id)`), exactly as `cardComparator`/`computeLaneValues`
already do. Gating/allowed-values resolve **per card** via `noteTypeByPath`.

### B3. Triage view UI

New `src/app/ui/triage/triage-view.ts` (rendered into the board host when `triageMode`), with a
small renderer + callbacks host (mirror `card-renderer` + `CardMenuHost` separation; keep DOM
pure-ish for snapshotting):

- **Header:** remaining count (`n of N`), scope label, Exit (returns to board).
- **Context panel (See):** read-only fields — reuse `buildCardDisplay`-style rendering for the
  See refs (formulas included), plus the due chip. Card title links to the note.
- **Edit panel (Update):** one control per editable enum prop — a segmented/dropdown of allowed
  values with the current value selected, "needs-triage" ones flagged; choosing writes
  immediately (`setCardProperty`) and **recomputes** the score field live (re-read after the
  metadata refresh). Props with no allowed-values fall back to a text input.
- **Footer:** **Skip** (advance, no change) / **Next** (advance). Keyboard: `→`/`Enter` next,
  `s` skip, `Esc` exit, number keys pick the focused prop's nth value (nice-to-have).
- Advancing past the end → "All clear" empty state with a Back-to-board button.

### B4. View integration

`src/app/views/kanban/kanban-view.ts`:

- Toolbar: add **Triage** mode button (`view-toolbar.ts`) next to Board/Calendar; wire
  `onSetTriageMode`. Selection-mode/lane-nav hidden in triage.
- Render gate: in the rebuild/render path where `calendarMode` is checked, branch to triage
  rendering when `triageMode`. Triage queue built from the **filtered** card list (after the
  toolbar text filter), reusing `noteTypeByPath`, `entriesByPath`, and the view's sort comparator.
- On a triage write, the existing `onDataUpdated`/metadata `changed` → debounced rebuild keeps the
  queue and score current; preserve the queue cursor across rebuilds (track current card key, not
  index).
- Persist `triageMode`/`triageScope` to `this.config` like calendar state (#19 view-state).

### B5. Commands

`src/app/plugin.ts` — add (via the `onActiveView` pattern):

- `toggle-triage-mode` → `view.toggleTriage()`
- `triage-next`, `triage-skip` (active only in triage) — optional, for keyboard-first use.

### B6. Tests (#53)

- `triage.spec.ts`: `isPropUnset` truth table (empty / token / invalid-vs-allowed / valid);
  `unsetCount`; queue membership per scope; worst-first ordering + view-sort tie-break;
  empty-gate defaults-to-update behavior.
- View-config helpers: triage option round-trips; empty gate/see → defaults.
- Live (real vault, per Testing rules): on `Kanban: Goals`, enter Triage, confirm only
  unclarified cards queue, set `priority`/`urgency`, watch `priority_score` recompute and the card
  drop from the clarify queue; flip scope to All and confirm full worst-first list; verify the
  Board/Calendar/Triage switch and `obsidian dev:errors` clean.

---

## Files

**Create:** `services/enum.service.ts` (+spec), `views/kanban/triage.ts` (+spec),
`ui/triage/triage-view.ts` (+ renderer/host), `ui/triage/*.spec.ts`.
**Modify:** `domain/note-type.ts` (enumProperties), `services/note-type.service.ts`
(`setEnumProperty`), `services/starter-kit.service.ts` (`findProperty`),
`views/kanban/card-menu.ts` + `kanban-view.ts` (generic Set-menu + triage integration),
`views/kanban/kanban-view-options.ts` + `view-config.ts` (triage + enum options),
`ui/view-toolbar.ts` (3rd mode button), `ui/configure-board-modal.ts` (Enums section),
`plugin.ts` (commands), `src/styles.src.css` (triage layout — Tailwind `@apply`, colors via
Obsidian vars, scoped under `.kap-root`).

## Build order

1. #52: SK `findProperty` → `enum.service` resolver → domain `enumProperties` + `setEnumProperty`
   → generic Set-menu on the board → Enums settings section. Ship + verify live.
2. #53: per-view triage options → pure `triage.ts` predicates/queue → triage view UI → toolbar
   button + render gate + commands → live-verify both scopes.

## Out of scope / future

- **Due-for-review scope (#57):** add `triageScope='review'` driven by
  `last_reviewed`/`review_interval`, writing `review_count`/`last_reviewed` on advance. The queue
  machinery (B2/B3) is built to accept it without rework.
- **Multi-key sort (#49):** the triage tie-break reuses the view comparator; once #49 lands,
  worst-first naturally chains into the multi-key order.

## Business rule additions (on implementation)

- **Enum allowed-values:** precedence manual note-type list → Starter Kit → none; quick-set
  offered only when values are known; writes go to frontmatter, live-refresh via the #13 listener.
- **Triage mode:** per-view config (use/see/update + tokens + scope); convention-agnostic "unset"
  rule (empty/token/not-in-allowed); dedicated mode; worst-first queue; respects the text filter;
  no auto-advance; per-card note-type resolution on mixed boards.
