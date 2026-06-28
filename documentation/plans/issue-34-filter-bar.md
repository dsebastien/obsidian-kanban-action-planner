# Issue #34 — Filter bar (quick search, JQL-lite)

A filter/search box in the view toolbar that narrows the visible cards in **both**
board and calendar mode. Type plain words and/or `property:value` qualifiers; results
update live.

## Decided behavior

### Query language (JQL-lite)

Grammar (flat, no recursion):

```
query  := group (OR group)*          # OR-separated; OR keyword (case-insensitive) or |
group  := clause (clause)*           # whitespace = AND; AND binds tighter than OR
clause := ['-' | 'NOT'] (term | qualifier)
term   := word | "quoted words"
qualifier := name ':' value          # value may be quoted; comma = OR within the field
```

- **OR of AND-groups.** `book project OR goal` = `(book AND project) OR goal`. No
  parentheses in v1.
- **Comma = OR within a field.** `status:active,done` = status in (active OR done).
- **Negation.** Leading `-` or `NOT` on any clause: `-status:done`, `project NOT book`.
- **Case-insensitive substring** matching everywhere (except `due:` operators). `proj`
  matches "Project".
- **Best-effort parse** — malformed input (e.g. unclosed quote) never throws; parse what
  we can.

### Recognized properties (`name:` vocabulary)

Reserved keywords win over a same-named frontmatter property:

| Qualifier                                | Matches                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `title:`                                 | card title                                                                                                 |
| `status:`                                | status value — matched against **both** raw value and column label (`status:active` matches `30 - Active`) |
| `parent:` `child:` `sibling:` `blocked:` | related note names for that role (`blocked` = `blocked_by`)                                                |
| `tag:`                                   | the note's tags                                                                                            |
| `due:`                                   | the view's due-date property (`date_due`) — see operators below                                            |
| _any other_ `name:`                      | frontmatter property `name`, case-insensitive, matched against its value(s); list props match any element  |

### `due:` operators & keywords (due-only; other props stay contains-match)

- Operators: `due:>2026-01-01`, `due:<…`, `due:>=…`, `due:<=…`, bare `due:2026-01-01`
  = that exact day.
- Keywords: `today`, `overdue` (strictly before today), `none` (no due date),
  `week` / `month` / `quarter` / `year` = the **calendar period containing today**
  (same period math as the calendar view; e.g. on 2026-06-28 `due:quarter` =
  2026-04-01…2026-06-30).

### Bare-term haystack (a plain word with no `name:`)

Searches: **title + relationship names (all roles) + tags + all frontmatter property
values**. NOT the note body. (Explicit `name:` qualifiers can still address any property.)

### UI

- **Inline in the existing toolbar, right after the Board / Calendar buttons** (no
  separate row). Search icon, input grows to fill, **clear (×)** when non-empty.
- Placeholder: `Filter… e.g. book parent:"PKM" status:active OR overdue`.
- **`?` help popover** with a compact syntax cheat-sheet (operators, `OR`, `-`, `due:`
  keywords).
- **Live**, debounced (~150 ms). **Esc** clears.
- The input is a **persistent element** (created once, not rebuilt with the rest of the
  toolbar) so a filter-triggered re-render never steals focus / caret mid-typing.
- **Match count** shown in the bar when a filter is active (e.g. "23 matches").
- Responsiveness: input is flex-shrinkable with a sensible min-width; toolbar wraps on
  very narrow widths. Mobile posture: same inline input.

### Structure & feedback

- Filter only shrinks the card set. **Column/lane visibility keeps the existing rules**
  (`showEmptyColumns`, unmapped/ungrouped hide-when-empty). No auto-hide.
- Header counts reflect filtered cards.
- **Empty state** when nothing matches: "No cards match the filter." (bar stays editable).
- Applies **with** the existing blocked filter (both must pass; AND).

### Calendar mode

- The global filter narrows the **whole** calendar — grid placement **and** the
  Scheduling panel (Unplanned / No-deadline tabs).
- **Retire `calendarFilter`** (the old scheduling-panel-only "name or #tag" option): drop
  it from the view options; any stored value is ignored (harmless). The global filter
  subsumes it.

### Persistence

- Per-view, in `this.config` under `filterQuery` (saved in the `.base` file; survives
  reload). Managed by the toolbar input only (not duplicated as a Configure-view option).

## Implementation outline

**New — domain (pure, unit-tested):** `src/app/domain/filter-query.ts`

- `parseFilterQuery(input: string): FilterQuery` → AST: `{ groups: Clause[][] }` where a
  `Clause` is `{ negated, kind: 'term'|'qualifier', name?, op?, values: string[] }`.
  Tokenizer handles quotes, `OR`/`|`, `-`/`NOT`, `name:value`, comma-split values, `due:`
  operators. Never throws.
- `matchesFilterQuery(record: CardSearchRecord, query: FilterQuery, ctx): boolean` —
  evaluates OR-of-AND over a card's search record. `ctx` carries "today" for `due:`
  period math (pass it in; do not call `new Date()` in the pure module).
- `CardSearchRecord`: `{ haystack: string; title: string; status: string[]; rels:
Record<role,string[]>; tags: string[]; due: Date|null; props: Map<string,string[]> }`
  (all lowercased; `status` holds raw + label).
- Reuse existing calendar period helpers (`startOf*/endOf*`) for `due:` ranges, or factor
  a small `periodRange(kind, today)` helper.

**View — `kanban-view.ts`:**

- Build a `CardSearchRecord` per card in `toCard` (or a sibling builder) using the
  metadata cache (frontmatter values, `getAllTags`), the resolved relationships, and the
  status value/label. Cache alongside the card so keystroke matching is cheap (no file
  reads).
- Apply the parsed query in the card pipeline right after the blocked `passesFilter`
  (covers board and calendar, since both consume the same `cards`).
- Hold `filterQuery` (string from `this.config`) + parsed AST; re-parse on change.
- On input change: debounced (~150 ms) `set('filterQuery', …)` then a light re-render
  (re-filter + re-build board / calendar; no profile/relationship re-resolution).

**Toolbar — `view-toolbar.ts` + `kanban-view.ts`:**

- Add the persistent filter input after the mode switch; wire value, clear, `?` popover,
  Esc, and the match count. Keep it out of the part `renderViewToolbar` empties.

**View options — `kanban-view-options.ts`:** remove the `calendarFilter` item.

**Styles — `src/styles.src.css`:** `.kap-filter*` classes (input, icon, clear, count,
help popover) under `.kap-root`, Tailwind `@apply` + Obsidian vars only.

**Optional (note, not committing):** a command "Focus filter" for keyboard access.

## Out of scope (v1)

- Parentheses / nested grouping.
- Generic numeric comparisons (`progress:>50`) — only `due:` gets operators.
- Note **body** content search (chosen scope is title + properties + relationships).
- Saved/named filters beyond the single per-view persisted query.

## Definition of done

- `bun run tsc`, `bun run lint` (`--max-warnings 0`), `bun test` (new `filter-query.spec.ts`
  covering parse + match: OR/AND/negation/comma/quotes/`due:` ops & keywords/reserved-vs-
  frontmatter), `bun run build` all green.
- Live-verified in the vault (board + calendar) with a throwaway fixture, then fixtures
  removed and any mutated state restored.
- Docs updated: `docs/usage.md` (filter bar + syntax), `docs/configuration.md`
  (`calendarFilter` removed), `documentation/Business Rules.md`, `documentation/Architecture.md`.
  (Per request: no `documentation/history/` entry for this work.)
