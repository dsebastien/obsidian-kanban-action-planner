# Quick capture — create cards from the board (issue #46)

## Goal

An **Add** affordance per column creates a new note that immediately shows up as a card in
that column: right folder, right note type, right template, right properties.

## Existing Starter Kit support (answer to "do we already have it?")

Yes, but read-only and partial. `services/starter-kit.service.ts` feature-detects the
`obsidian-starter-kit` plugin's `api` and mirrors **note types** (`listNoteTypes`,
`recognizeNoteType`, status property + allowed values, recognition mappings, enum
property values). It does **not** read the creation-relevant fields the OSK API already
exposes on each note type:

- `associatedFolder` — target folder (supports `{{year}}`-style expressions)
- `templatePath` — the type's template file
- `noteNamePrefix` / `noteNameSuffix` — name decoration (often part of the type's own
  regex recognition mapping, e.g. `.* \(Task\)$`)
- `properties[].required` / `defaultValue` and `tags`

This milestone extends the adapter to read those, so a Starter Kit type needs zero extra
configuration in this plugin.

## Template correctness — the hard part

Facts established by reading Templater 2.x (`on_file_creation`, `write_template_to_file`)
and the Starter Kit's own create-note command:

1. **Templater's frontmatter merge is template-wins.** `write_template_to_file` merges the
   template's frontmatter over the file's existing frontmatter (arrays are concatenated +
   deduped, non-empty scalars overwrite). ⇒ **our properties must be written AFTER the
   template**, never before, or the template silently overrides the column's status.
2. **Templates move and rename the file.** Real templates call `tp.file.rename()` /
   `tp.file.move()`. ⇒ hold the `TFile` (Obsidian mutates it in place), never a path
   string, and re-read `file.path` after templating.
3. **Templater's "trigger on new file creation" fires on OUR `vault.create`.** Its handler
   waits 300 ms, then applies the matching folder/file template unless the path is in
   `files_with_pending_templates`. `write_template_to_file` adds the path to that set
   synchronously. ⇒ calling `write_template_to_file` immediately after `vault.create`
   suppresses the auto-trigger, giving exactly one template application.
4. **If no template is configured but Templater would auto-apply one**, we resolve _that_
   template (`get_new_file_template_for_folder` / `_for_file`, with Templater's own
   `templates_folder` / `ignore_folders_on_creation` guards) and apply it ourselves. One
   deterministic, awaited code path instead of racing an unbounded background trigger.
5. **After our template application finishes**, Templater's create-trigger may still fire
   (it clears the pending marker at the end of its own write). If the produced note has an
   empty _body_, the trigger would apply the folder template a second time. ⇒ re-mark the
   path (old + new) as pending for ~500 ms after templating.
6. Everything above is feature-detected and wrapped: Templater absent → core **Templates**
   plugin substitution (`{{title}}`, `{{date}}`, `{{time}}`) → raw template copy. A
   template configured but unreadable is reported, never silently skipped.

## What lands where

### Domain (pure, unit-tested)

- `domain/base-filters.ts` — parse a `BasesConfigFile`-shaped filter tree into
  `{ folders, tags, properties }`. Only top-level `and` conjunctions contribute facts
  (`or`/`not` do not imply anything a new note must satisfy). Recognizes
  `file.inFolder("…")`, `file.hasTag("…")`, `note.prop == "…"` / `prop == "…"`,
  `prop.contains("…")`.
- `domain/note-creation.ts` — pure planning: decorate the title with prefix/suffix,
  resolve placeholders, build + uniquify the target path, and decide which template
  strategy applies.

### Services

- `services/starter-kit.service.ts` — expose `creationDefaults(noteType)` reading
  `associatedFolder` / `templatePath` / `noteNamePrefix` / `noteNameSuffix`.
- `services/note-creation.service.ts` — the imperative pipeline:
  `ensureFolder → vault.create('') → applyTemplate (awaited) → processFrontMatter (once)`.
- `services/templater.service.ts` — the Templater adapter (availability,
  `write_template_to_file`, auto-trigger resolution, pending-marker guard).

### Config

`NoteType.creation` (optional, no backfill — absent means "inherit everything"):

| field                       | empty means                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `folder`                    | Starter Kit `associatedFolder` → the Base's filter folder → Obsidian's default new-note folder |
| `templatePath`              | Starter Kit `templatePath` → the template Templater would auto-apply → none                    |
| `namePrefix` / `nameSuffix` | Starter Kit `noteNamePrefix` / `noteNameSuffix`                                                |
| `openAfterCreate`           | `true`                                                                                         |

Edited in **Configure board → Creating notes** (per note type), with folder + template
suggesters and placeholders showing the inherited Starter Kit values.

### UI

- Two entry points per column (not on the synthetic Unmapped column), behind a per-view
  `showAddCard` toggle (default on): a **+** in the column header (always in reach, hidden
  while collapsed) and a labelled `+ Add card` footer under the cards. Both are `<button>`s,
  which the column-reorder drag already ignores.
- `ui/create-note-modal.ts` — title input + live preview of the resulting path and the
  template that will be applied.
- The created card is focused/scrolled to; when the note ends up outside the view's
  filters (a template may move it), that is reported instead of silently vanishing.

### Frontmatter written (single transaction, after templating)

1. the column's status value → the card's note type status property
2. the lane's value → the swimlane property (property swimlanes only, real lane)
3. the manual-order property → end of the target column (manual sort only)
4. the note type's enabled **tag** recognition mappings (merged into `tags`, deduped)
5. the Base's filter-implied tags + property equalities

## Status: DONE

Shipped as business rule 44. `bun run tsc` / `lint` / `test` / `build` clean;
`README.md`, `docs/usage.md`, `docs/configuration.md`, `documentation/Architecture.md`
updated.

### Live validation

Real vault, Templater + Starter Kit, against `TPL Task.md` (six `tp.system.suggester`
prompts, a `tp.file.rename` and a `tp.file.move`):

- The modal previews the resolved path (`20 Actions/24 Tasks/… (Task).md`) and the
  Starter Kit template before creating.
- Answering the template's status prompt with **Done** while adding to **This Quarter**
  produced `status: 30 - This Quarter` — the column wins, every other template answer is
  kept.
- Exactly one template application (one `## Action` heading, one frontmatter block); the
  template's own rename/move was a no-op because the note was already in the right place.
- `tp.file.cursor()` resolves when the note opens; the marker is stripped when it does not.
- Base filter tags (`kapqc`) merged into the template's own tags; the card appeared in the
  clicked column.

### Adversarial review (Codex, xhigh) — accepted findings, all fixed

1. The Templater claim was not re-asserted after `write_template_to_file` cleared its own
   marker → a frontmatter-only template could be applied twice. `reassert()` added, and the
   claim is now held **across** the property write.
2. The filter regexes were not anchored, so `file.hasTag("draft") == false` and
   `note.kind == "a" || note.kind == "b"` produced bogus facts. Every pattern is now fully
   anchored, quote characters are forbidden inside literals, and any expression containing
   a boolean operator or `!` is rejected outright.
3. `..` / `.` segments survived folder normalization → dropped.
4. A Base filtering on the very property the columns write is contradictory; only folders
   were checked. `unmetFilterFacts` now reports every unsatisfiable fact after creation.
5. `folders[0]` picked the widest ANDed folder → `narrowestFolder` picks the deepest.
6. Appending an order to a column holding unordered cards placed the card FIRST (unset
   order sorts last) → no order is written in that case.
7. `getNewFileParent` got an arbitrary card's path → the active (`.base`) file's path.
8. The open/template phase could throw past `createNote`'s "never throws" contract →
   caught; the property write still runs.
9. Preview and creation used different expression contexts (`{{uuid}}`, midnight
   rollover) → one context is shared by the subtitle, the preview, and the creation.
10. `vault.create` TOCTOU on the unique path → bounded retry.

### Deliberately not changed (documented in code)

- **Starter Kit `tags` / required-property defaults are not written.** The Starter Kit
  makes auto-adding those an explicit opt-in, and a type's template already supplies them.
  Only the type's tag _recognition_ mappings (plus the Base's filter tags) are written —
  the minimum for the card to be recognized and to match the view.
- **Templater's loose `includes` test for its templates folder is reproduced verbatim.**
  Tightening it would apply a template where Templater itself applies none.
- **A Starter Kit template cannot be switched off per type** (empty means inherit). Point
  the type at a different template instead.
