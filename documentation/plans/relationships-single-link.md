# Single-link relationship properties (2.7.0)

## Goal

Media types link child to parent with a text property holding one wikilink (season `show`, album `series`, game `base_game`). Relationships (2.6.0) only wrote lists. Rule 73.

## Design

- `RelationshipRule.cardinality?` (absent = inferred: Obsidian `text` property type, else many); mirrored from the Starter Kit `getNoteTypeRelationships`.
- `LinkRule.cardinality`, `selectLinkProperty` returns it; `addRelationshipLink(..., cardinality)` writes a replacing scalar; remove never turns a scalar into a list.
- WBS re-parent: `propertiesToClear` skips the removal on the replaced property. Add card: `placeParentLink` puts the scalar in `properties`.
- Mirrored types receive every role (`activeRoles`), so parents get inverse children though the Starter Kit declares none.

## Done

- [x] Schema, model, mirror, SK adapter, property type lookup, writes, WBS, quick capture, specs, docs
- [x] format, validate, build
- [x] Live (real vault, OSK rules mirrored): season under its show in WBS, menu link writes scalar, WBS drag replaces it, remove deletes it

## Not covered (manual)

- Add card with a template on a real media board (not exercised live: Templater prompts); unit-tested via `placeParentLink`.
- No local-editor UI for cardinality (inferred only).

## Status: DONE
