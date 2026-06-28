# Issue #14 — CRUD on relationships

Relationships (parent / sibling / child / blocked_by) are currently **read-only** — resolved from
frontmatter link-properties but never written. Make them editable from the board: **add** and
**remove** a relationship via the card context menu. (Read is done; this adds C/U/D.)

This **changes Business Rule #9** ("relationships are read-only / never written back"). The user
selected #14, which is the explicit approval to change it.

## Scope (v1)

- Manage **direct** links only — the wikilinks stored in _this note's own_ role link-property.
  Inverse-derived (B declares parent→A shows child) and heuristic relations stay read-only: they
  live on the other note / are computed, so they can't be removed from this card. (A removable item
  only appears for links physically in this note's frontmatter.)
- Roles are addable only when the (active note type's) role has a **non-empty link-property**; a
  role set to "None" has nowhere to write, so no Add item.
- Uses the **active note type's** `roleProperties` (same as resolution, `resolveBoardRelationships`),
  so writes and reads agree on a mixed board.

## UX (card right-click menu)

A new **Relationships** submenu:

- **Add <role>…** per addable role → opens a fuzzy note picker (`FuzzySuggestModal<TFile>`,
  excludes this note + already-linked targets) → appends a `[[wikilink]]` to the role's property.
- **Remove <role>: <name>** per direct link currently on the note → drops that link (deletes the
  property when it becomes empty).

After a write, the `metadataCache.on('changed')` listener (added for #13) refreshes the board, so
badges/blocked state update without a reload.

## Implementation

**`domain/wikilinks.ts` (pure, unit-tested)**

- `toLinkStringList(raw): string[]` — normalize a frontmatter value (array | single string | absent)
  to a clean list of link strings.
- `parseWikiLinkTarget(raw): string` — extract the linkpath from `"[[path|alias#h]]"` (strip
  brackets, alias, subpath), or the trimmed raw if not a wikilink.
- `formatWikiLink(linktext): string` — `` `[[${linktext}]]` ``.

**`services/relationships.service.ts`**

- `directLinkTargets(app, file, property): { path; label; linkText }[]` — resolve the property's
  links to dest files (reuse for the existing private `linkPropertyTargets`, which keeps returning
  paths).
- `addRelationshipLink(app, file, property, target): Promise<boolean>` — dedup by resolved path;
  write `[[fileToLinktext(target)]]` into the property list (wikilink form regardless of the user's
  markdown-link setting). Returns false when already present.
- `removeRelationshipLink(app, file, property, targetPath): Promise<void>` — keep only links whose
  resolved dest ≠ targetPath; delete the property if the list empties.

**`ui/relationship-target-modal.ts`** — `FuzzySuggestModal<TFile>` over `vault.getMarkdownFiles()`
minus an exclude set; `onChooseItem` → callback.

**`card-menu.ts`** — add `addRelationshipEditItems(menu, card, host)`; extend `CardMenuHost` with
`relationshipProperties()` (role→property for the active type), `directRelationships(card)` (per
role, the removable {path,label}), `addRelationship(card, role)`, `removeRelationship(card, role,
path)`. Reuse the existing `RELATIONSHIP_MENU` label/icon table.

**`kanban-view.ts`** — implement the host: resolve `roleProperties(this.noteType)`; `directLinks`
via `directLinkTargets`; `addRelationship` opens the modal then `addRelationshipLink`;
`removeRelationship` calls `removeRelationshipLink`. A `Notice` on no-op/duplicate.

## Acceptance

Right-click a card → Relationships → **Add parent…** → pick a note → the card shows the parent badge
(and the target shows the inverse child) without reload; **Remove** drops it and clears the property
when empty. A `blocked_by` add/remove flips the blocked flag + filter live. Roles set to "None" show
no Add item.

## Docs

Business Rule #9 (relationships now editable: direct links via the menu; inverse/heuristic stay
read-only), `docs/usage.md` (Relationships section), `documentation/Architecture.md`.
