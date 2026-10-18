# Multi-rule, type-scoped relationships + Add card writes the parent link (2.6.0)

## Goal

Reported in the Knowii community: on a project note, a board embedded with
`filter=parent:"<Project>"` creates a task through **+ Add card** whose `related_projects` is empty,
so the card never shows on the project's board. Fixing it needs to know WHICH property links a
child to a parent of a given type: a task's parent can be a project, an activity, a plan or a goal,
each through a different property. So relationships become several rules per role, each scoped to
target note types, configured in the Starter Kit (mirrored when it declares them) or locally.

Business rules: 5 (method presence), 6, 9, 44, new 70 (model + reads + WBS), 71 (source + write
selection), 72 (Add card parent link).

## Design

- Schema: `relationshipRuleSchema` gains `targetTypeIds?` and `mirrored?`; `NoteType` gains
  `relationshipsMirrored?`. No backfill: absent = any type / local config.
- Pure model `domain/relationship-rules.ts`: `roleLinkRules` (local: no rule = default property,
  empty property = None marker; mirrored: only mirrored rules, no defaults), `roleProperties`
  (reads union), `selectLinkProperty` (target type scoped rules, else unscoped; one writes, zero or
  several refuse).
- Source of truth: `starter-kit.service.ts` `getNoteTypeRelationships` (by method presence, ApiResult
  unwrapped, unusable entries skipped); `domain/relationship-mirror.ts` `reconcileRelationships`;
  `mirrorNoteType` applies it. OSK note type ids ARE KAP mirrored type ids (a mirrored type is keyed
  by the Starter Kit id), so `targetTypes[].id` maps 1:1 with no lookup. Local rules are kept for the
  hand-back and for the plugin-owned child-by-tag heuristic.
- Reads: `toRecord` unions every property of the role; resolution, inverses, `parent:`/`ancestor:`,
  badges and WBS needed no other change (WBS already lists a multi-parent note under each parent).
- Writes (`kanban-view.ts`): `relationshipRulesForPath`, `targetTypeId` (board map, local rules, then
  Starter Kit recognition), `linkRelationship` (menu add), `removeRelationship` (from every property
  holding the link). WBS host: `parentPropertiesForPath`/`childPropertiesForPath` (all) and
  `parentPropertyFor`/`childPropertyFor` (the one to write); `edgeStorage` names the holding
  properties so removals never hit the property a new link would use.
- Add card: `planNewCardParentLink` (`getZoomTerm` -> `resolveParentNote` -> `planParentLink`), the
  link joins `listProperties` of the single post-template write, subtitle and unmet notice via
  `parentLinkSubtitle`/`parentLinkUnmet`; `mergeList` drops template `[null]` placeholders.
- UI: Configure board → Relationships is a multi-rule editor (`domain/relationship-edit.ts`) or the
  read-only mirrored view.

## Done

- [x] Schema, pure model, mirror, edit helpers, parent-link planning (+ specs)
- [x] Service: reads union, SK adapter, mirror in `mirrorNoteType`, parent resolution
- [x] View: write selection for menu add/remove, WBS set parent / drag re-parent / un-parent
- [x] Quick capture parent link (subtitle, single write, unmet notice)
- [x] Configure board multi-rule editor + mirrored read-only view
- [x] Docs: Business Rules, Domain Model, Architecture, Configuration, docs/usage, docs/configuration,
      README, NEXT_RELEASE.md
- [x] `bun run format`, `bun run validate`, `bun run build`
- [x] Live validation (real vault, local-config path): Add card on the AI Tooling project board
      links `related_projects` and the card lands in Backlog; scoped rules route a goal parent to
      `related_goals`; menu remove keeps the other property; WBS drag onto a goal row moves the link
      to `related_goals`; several-candidates refusal Notice

## Not covered here (manual)

- Mirrored path against a real Starter Kit with `getNoteTypeRelationships` (installed 1.38.1 lacks
  it): unit-tested with a mocked API only.
- WBS drag onto a target whose type only the Starter Kit can recognize (drag recognition is
  synchronous, local rules only): the drop is refused unless an unscoped rule exists.

## Status: DONE
