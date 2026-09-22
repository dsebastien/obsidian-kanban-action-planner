# Detect the Starter Kit's optional name prefix and suffix

**STATUS: DONE.** Implemented in full (changes 1-4, tests, docs). `SkNoteType` feature-detects
`noteNamePrefixOptional` / `noteNameSuffixOptional`; `creationDefaults` returns `''` for an
optional affix; `namingConfigSchema` carries `prefixOptional` / `suffixOptional` (default
false) and the mirror refresh fills them through `namingOf` / `resolveNaming`; the configure
board modal shows `None (optional in the Starter Kit)` and appends `(optional in the Starter
Kit)` to the Strip descriptions. Stripping is unchanged. Docs: `docs/configuration.md`,
`README.md`, `documentation/Business Rules.md` (rules 52 creation layers, 57 card titles).
The named mutation (make `creationDefaults` ignore the flag) was run and went red.

Companion of the Obsidian Starter Kit plugin change "a note type can mark its name prefix or suffix as optional" (Starter Kit ≥ 1.22). Vault task: "the kanban action planner plugin (which also supports filtering prefixes/suffixes) should be updated so it auto detects that from osk plugin".

## The one line

_"When the Starter Kit says a type's prefix or suffix is optional, the planner stops adding it to new notes and keeps stripping it from cards when it is there."_

## What the Starter Kit exposes (≥ 1.22)

- `listNoteTypes()` / `getNoteType(id)` entries carry `noteNamePrefixOptional?: boolean` and `noteNameSuffixOptional?: boolean` (absent = required, i.e. today's behaviour).
- `resolveNoteTypeAffixes(ref, date?)` returns `{ noteType, prefix, suffix, prefixOptional, suffixOptional }`.

Feature-detect as every other Starter Kit field is (`src/app/services/starter-kit.service.ts`): an older Starter Kit has no flag and the planner behaves exactly as today.

## Changes

1. `SkNoteType` gains the two optional booleans; `creationDefaults(noteType)` returns `''` for an optional affix (the Starter Kit's rule is "nothing adds it unless a person asks"; the board's own **Name prefix / Name suffix** override still wins when set, so a person can keep decorating notes from one board).
2. `namingConfigSchema` (`src/app/domain/card-title.ts`) gains `prefixOptional` / `suffixOptional` (`z.boolean().default(false)`), mirrored in `note-type.service.ts` where `draft.naming` is refreshed from the Starter Kit, so an offline board knows too. Card-title stripping is unchanged in behaviour: an affix is stripped when present, optional or not.
3. The configure-board modal (`src/app/ui/configure-board-modal.ts`): the **Name prefix / Name suffix** placeholders read `None (optional in the Starter Kit)` instead of the inherited value when the flag is set; the **Strip the name prefix / suffix** descriptions say `(optional in the Starter Kit)` after the affix when it is optional, so a person understands why new cards have no suffix while old ones are still cleaned.
4. `titleAffixesFor` keeps stripping the affix (live lookup first, mirror second) — add the live flag to the mirror refresh only; no behaviour change there.

## Tests

- `starter-kit.service.spec.ts` (or wherever `creationDefaults` is covered): optional prefix → `namePrefix: ''`; required → inherited; missing flag → inherited.
- `note-creation.spec.ts`: with an optional inherited suffix and no board override, `buildNoteBasename` produces the bare name; with a board override, the override is applied.
- `card-title.spec.ts`: the schema defaults; stripping still removes an optional affix when present.
- `note-type.service` mirror refresh carries the flags.
- Mutation to run and report: make `creationDefaults` ignore the flag → the first spec goes red.

## Docs

`docs/configuration.md`: the creation table row for Name prefix / suffix (optional affixes are not inherited) and the Strip rows (optional affixes are still stripped). `README.md` only if it describes affix inheritance. Update `documentation/Business Rules.md` if it states the inheritance rule.

## Commit

One `feat:` commit in the user's vocabulary (e.g. `feat: notes created from a board no longer get a name prefix or suffix the Starter Kit marks optional`). `bun run format`, `bun run validate`, `bun run build` green before the commit. Do not touch versions or `CHANGELOG.md`.
