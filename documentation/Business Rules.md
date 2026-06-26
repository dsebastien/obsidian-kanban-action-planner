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
2. **Status drives columns.** Columns derive from a status property (auto-detected: prefer a
   field literally named `status`, else any field whose name contains `status`;
   configurable). Before configuration, all notes sit in a single **Unmapped** column;
   notes with missing/invalid status also go there. **Unmapped is hidden when empty.**
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
9. **Relationships.** Roles parent/sibling/child/`blocked_by` detected via explicit
   link-properties (primary) and a tag+link heuristic (secondary); inverses via reverse
   lookup. Non-empty `blocked_by` flags the card and enables navigate-to-blockers + filter;
   no auto-transition.
10. **Calendar mode.** A toggle adds a collapsible "Scheduling" panel (Unplanned /
    No-Deadline tabs; title always visible, vertical when collapsed) + a week/month/quarter/
    year calendar. Dragging a card to a day sets the relevant date property (momentjs format,
    default `YYYY-MM-DD`); dragging back clears it.
11. **Archiving (issue #7).** A card's note can be archived by **moving** it to a
    configurable archive folder that supports Starter-Kit-style placeholders (`{{year}}`,
    `{{month}}`, `{{week}}`, `{{quarter}}`, `{{day}}`, `{{date}}`, `{{datetime}}`,
    `{{uuid}}`). Archiving is manual (context menu) plus an **optional, opt-in** per-profile
    status trigger (auto-archive when a card reaches a chosen status). File moves preserve
    links; auto-archiving is guarded against accidental mass-archiving and logged.
12. **Responsiveness (hard invariant).** Every UI works on large desktop, small/narrow
    desktop, and mobile; layouts adapt and never break/overflow. One Pointer-event DnD path
    serves mouse/trackpad/touch, with a non-drag fallback. `isDesktopOnly` stays `false`.
    Deliberate mobile **graceful degradation** is allowed but must be intentional and
    documented per feature ("mobile posture"). Respect `prefers-reduced-motion` everywhere.
13. **Documentation is a first-class, per-milestone deliverable.** Every user-visible change
    updates end-user docs in `docs/` and technical docs in `documentation/` (Architecture,
    Domain Model, Configuration, Business Rules) — not as a follow-up.
14. **Tech baseline.** Vanilla DOM + native Pointer events + CSS grid; **zero UI
    dependencies**; Tailwind v4 for styling with **all styles scoped** under `.kap-root` and
    a `kap-` prefix (colors via Obsidian CSS vars only); Immer for state; Zod for validating
    stored config.
15. **Big-bang delivery.** No public release between milestones; a single `1.0.0` cut after
    all milestones pass (version stays `0.0.0` until then). UI behavior is never claimed from
    a green build alone — it is flagged for manual verification in Obsidian.
