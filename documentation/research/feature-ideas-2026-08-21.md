# Feature idea research — issue #1 resources (2026-08-21)

Consolidated findings from exploring every resource listed in [issue #1](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/1). Each resource was mined for feature ideas, then deduplicated against the current feature set (README, v1.16.0) and the open issue backlog. Ideas already shipped or already filed are folded into the relevant issues instead of being listed as new.

## Resources explored

| Resource                                                                                                                                                                                                                     | Verdict                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contexts + switching (first checkbox)                                                                                                                                                                                        | **Shipped** (`@` switcher, `context=` embeds). Remaining stretch work already tracked in #112 and #121.                                                                                                          |
| [xiwcx/obsidian-bases-kanban](https://github.com/xiwcx/obsidian-bases-kanban)                                                                                                                                                | Closest Bases-native competitor (columns, swimlanes, drag/drop). Active; being forked as "Hans Kanban" for the directory. Differentiators are card visuals + creation ergonomics, not board structure.           |
| [xupisco/obsidian-yabacavi](https://github.com/xupisco/obsidian-yabacavi)                                                                                                                                                    | Early-stage Bases **calendar/agenda** view, not a Kanban. Standout: native Todoist integration on the calendar grid.                                                                                             |
| [Kanban Moonlight](https://community.obsidian.md/plugins/kanban-moonlight) (+ [Reddit](https://www.reddit.com/r/ObsidianMD/comments/1unc0v4/kanban_moonlight))                                                               | Young single-dev frontmatter Kanban (board/Gantt/dashboard, history log). Far less feature-dense than KAP; same positioning pitch though.                                                                        |
| [Operon 2.0](https://www.reddit.com/r/ObsidianMD/comments/1uq8c41/operon_20_is_out_a_task_table_for_obsidian_like)                                                                                                           | The most serious competitor. Unified inline-task + file-task index, Notion-style task **table** with in-cell editing, migration docs from Tasks/TaskNotes, active Discord. Heavy, substantive Reddit engagement. |
| [Timeline app follow-up (r/PKMS)](https://www.reddit.com/r/PKMS/comments/1uq83yh/a_followup_on_my_timeline_app_after_reading_your)                                                                                           | everie.app — free Gantt/timeline tool. Ideas: in-bar segments/markers, chatbot/API event creation, dual text view of the same data.                                                                              |
| ["CTO chaos" thread (r/PKMS)](https://www.reddit.com/r/PKMS/comments/1umnzc3/the_system_i_use_to_manage_chaos_as_a_cto)                                                                                                      | Same author/app as above; post mod-removed for self-promo. Comments still valuable — source of the "Waiting On" delegation insight.                                                                              |
| Belki ([v0.1](https://www.reddit.com/r/ObsidianMD/comments/1ue3e6c/belki_a_minimal_todoistlike_task_manager_for), [v0.2](https://www.reddit.com/r/ObsidianMD/comments/1ujia8b/belki_02_a_calm_todoistlike_task_manager_for)) | "Calm" Todoist-like Obsidian task manager; deliberately anti-Kanban, anti-settings-sprawl. Its Reddit commenters are a goldmine of validated demand (group-by, daily-note linkage, heatmap).                     |
| [chrisvel/tududi](https://github.com/chrisvel/tududi)                                                                                                                                                                        | Self-hosted GTD app. Areas→Projects→Tasks hierarchy, completion-based recurrence, Telegram capture + daily digest, CalDAV two-way sync.                                                                          |

## Top-tier candidates (high fit, proven demand)

1. **"Waiting On" / delegated state, distinct from `blocked_by`.** Items done when _someone else_ acts have a different completion condition than dependency-blocked items, and silently fall off the radar. A `waiting_on` (person/link) property surfaced as its own bucket (Agenda mode, board badge, filter qualifier `is:waiting`), plus a staleness nudge ("delegated 12 days ago, no movement"). Two independent commenters converged on this. Synergy: the vault's own `Waiting for` note pattern (OSK) maps 1:1.
2. **Table mode.** Operon 2.0's headline and its biggest mindshare driver. Bases already has a native table, so a KAP table must earn its place with task-specific value: in-cell status menus honoring the state machine, per-note-type enum pickers, bulk edit across selected rows, group/subgroup with rollup summaries (estimates as `1d 2h`), and mode-switching that keeps the current filter. A dense scan-and-edit surface the visual modes don't serve.
3. **Group-by as a secondary axis inside columns.** Belki's most-requested post-launch feature: group cards within a column by priority/label with sort applied _within_ groups. Distinct from swimlanes (board-level lanes); this is in-column sectioning with headers.
4. **Card context menu for property edits + quick-peek modal.** Right-click → edit any property from the card (superset of filed #47); and a configurable card-open mode: floating modal preview, current tab, new tab, split. Keeps the user on the board.
5. **Daily-note bridges.** Two proven asks: (a) auto-insert a "Completed today" section into the day's daily note; (b) a plain `- [ ]` checkbox in a daily note mirroring a rich task note, two-way (check it → status transition on the note). Fits the frontmatter-source-of-truth philosophy and the OSK daily-note workflow.
6. **Relative date-window filter chips.** One-click Today / Next 7 days / Next 30 days chips next to the filter box, instead of typing a query. Trivial to build on the existing filter engine.
7. **Per-note history trail.** Kanban Moonlight writes a `history` array (timestamp + transition + origin) on every status change. An opt-in, capped audit trail enables cycle-time analytics later (#38, #118 would consume it) and answers "when did this move to Doing?" with zero setup. File-size-sensitive: opt-in, truncated.
8. **Activity heatmap.** GitHub-style completion heatmap (e.g. 26 weeks) per view — a cheap, visceral throughput view far short of full flow metrics (#38).

## Second tier (worthwhile, more niche)

9. **Card cover images.** An image property renders as a card cover (fit mode + aspect ratio). Turns boards into moodboards/media pipelines — new audience (recipes, media libraries), cheap on the existing card layer.
10. **Card coloring by arbitrary property.** Color the card background/border by any property, not just status/column — e.g. color by priority while columns stay status.
11. **Status accent bars/dots.** A lighter visual language than full card coloring: left-edge stripe or bullet mapped from a property (yabacavi).
12. **Timeline bar segments and markers.** Annotate sub-ranges (phases) and point markers (checkpoints) _inside_ a single timeline bar without splitting into child cards — everie's core differentiator vs Mermaid Gantt.
13. **Wikilinks and link-properties rendered live on cards.** `[[links]]` in displayed text properties and Bases link-type properties as clickable pills (bases-kanban #99; Belki shipped it buggy — clicks must actually navigate).
14. **Text digest view.** A flat, readable markdown-style digest of the current view's cards (grouped, linkified) — for scanning/reading or copy-out, complementing Agenda mode.
15. **Areas / board-of-boards.** tududi's Areas layer above projects: an optional grouping to see several boards/note-type scopes together (Health / Work / DeveloPassion). Partially covered by Bases-as-views; the new part is a cross-board overview surface.
16. **In-UI color editing.** Click a column/status swatch on the board to recolor, instead of a settings round-trip (repeated Belki friction complaint).
17. **Calendar schedule source widening.** Allow a Bases formula or file ctime/mtime as the plotted date source, not only literal frontmatter date properties.
18. **Double-click an empty calendar day to create a dated note** (template-aware) — pure ergonomics on the existing quick-capture machinery.

## Integrations (bigger bets)

19. **External task-service overlay (Todoist first).** yabacavi displays and drag-reschedules Todoist tasks on the same grid as vault notes. Categorically new surface; consider after #120 (ICS read-only) proves demand.
20. **Webhook/agent-driven capture + outbound digest.** Inbound: an external trigger (script, chatbot, agent) creates cards through a documented contract. Outbound: a scheduled digest of Agenda content (to daily note, webhook, or notification). Extends the automation engine in both directions; pairs with #59 (API) — the tududi pattern there is scoped personal API keys.
21. **Shared boards over synced vaults.** Top Moonlight Reddit ask ("me and my partner"). Real demand, very hard (concurrent frontmatter merges over Syncthing/iCloud/Git). Probably a declared non-goal — but worth deciding explicitly.

## Fold into existing issues (spec enrichment, not new)

-   **#44 (subtask progress):** segmented bar in detailed mode / ring in compact mode; optional inline expandable subtask list on the card; manual subtask reorder that persists (done items keep user order).
-   **#48 (recurring):** completion-based vs calendar-based recurrence toggle (chores must not stack up); multi-weekday selection ("every Tue, Thu"); auto-generated follow-up task when a delegated item goes stale (ties into Waiting On).
-   **#120 (ICS overlay):** two-way CalDAV sync as the explicit stretch beyond read-only.
-   **#59 (API):** scoped personal API keys; document + test the external-write contract (an agent/script writing a valid note must appear on the board with zero manual steps — first-class use case).
-   **#114 (saved views):** cross-mode filter carry-over (verify the typed filter survives board↔calendar↔timeline↔WBS switches); board picker/switcher as physical scope-splitting, not just re-filtering.
-   **#47 (inline edits):** grow into the full card context-menu idea (top-tier #4).

## Round 2 — broader plugin landscape (2026-08-21, same day)

A second sweep beyond issue #1's list: mgmeyers **Obsidian Kanban** (the classic; now `community-archive/obsidian-kanban`), **CardBoard**, **TaskNotes**, **Task Genius**, **Time Ruler**, **Day Planner**, **Full Calendar**, **Obsidian Tasks** (top feature requests only), **Projects** (archived), **DB Folder** (archived), the **Bases custom-view ecosystem**, and Obsidian's **native Bases roadmap**.

### The strategic fact

**Obsidian is building a native Bases Kanban view (roadmap: "Active") and a Calendar view ("Planned"); Cards/gallery, Maps, List, group-by, cross-note lookup (`file()`, `Link.asFile()`) and the Bases view API have already shipped.** Native aggregation/rollups have NOT shipped. Implications:

-   Never compete on the basics — the native MVP will own "columns + drag/drop". KAP's defensible layer is state machines, automation, relationships + rollups, WBS/Gantt/Triage/Agenda, GTD workflow depth.
-   Plan to ride `file()`/`Link.asFile()` for relationship resolution instead of maintaining fully proprietary resolution.
-   The Bases-kanban niche is crowding fast (Power Bases, Kanban Bases View, Base Board, bases-kanban/Hans Kanban) — differentiation must be _legible_ (docs, comparison pages), not just real.
-   Both classic kanban plugins are effectively decaying (mgmeyers → community-archive org, "is this maintained?" issues; CardBoard last commit Feb 2024) — a migration audience exists now.

### Strongest cross-corroborated gap: hour-level scheduling

Time-of-day on `date_scheduled`/`date_due` + an hour-grid time-blocking view is Time Ruler's and Day Planner's entire reason to exist, and the #2 most-upvoted open Obsidian Tasks request (56 👍; #1 is a public query API at 75 👍, validating #59). Everything else in round 2 is smaller than this.

### Other high-signal finds (per source, deduplicated)

-   **TaskNotes** (closest relative; now fully Bases-native with web/iOS/Android companions on a portable "mdbase" format): typed dependency relationships (`FINISHTOSTART`/etc. + ISO-8601 lag `gap`, auto reverse-sync); Eisenhower matrix view (its #4 request); relative + absolute reminders; scheduled (cron-like) automations; conditional capture templates; click-to-cycle status badge; Canvas snapshot export with dependency edges. Interop package: align `blocked_by` with their `blockedBy`/`reltype`/`gap`, read their user-field registry, match reminder field shape.
-   **Task Genius**: MCP server for agent access (sharper shape for #59); habit tracking + rewards (explicit anti-lesson: its settings sprawl came from bolting on parallel subsystems — any KAP adoption must extend the existing property/automation model).
-   **mgmeyers Kanban** top unserved requests KAP could still add: multi-row wrapping column layout (20+ 👍), board-embedded-in-Canvas (15 👍), GitHub issues integration (13 👍), column-ordering config, "stamp completion date" as a one-click preset (34 👍 across dupes — achievable via automations today; ship it as a recipe).
-   **Day Planner / Time Ruler / Full Calendar** ergonomics: auto-stretch an open-ended block until the next scheduled item; configurable visible hour range; drag-on-empty-canvas creation (gesture sets start + duration); ICS **export** feed (inverse of #120's overlay); rolling "next 3 hours" sidebar widget.
-   **Obsidian Tasks** requests: dependency-aware urgency scoring (14 👍); frontmatter minimalism — never write unset scaffold properties (9 👍); per-occurrence skip/postpone for recurrence.
-   **Projects (archived)**: inline-checkbox subtasks as sub-cards under a note-card (its top request — the softer version of Operon's inline indexing); drag-to-reorder table columns.
-   **DB Folder (archived)**: multi-cell copy/paste + drag-fill for a table mode; row numbers. Its death lesson: non-native UI breaks on mobile/themes — KAP's native-Bases-view architecture is the fix, say so.
-   **Bases ecosystem conventions**: consume Bases formula fields as config (colors, dates) rather than inventing DSLs; natural-language → view/filter/rule config is an emerging pattern (AI chart config already exists).
-   **TaskForge** (mobile companion): notification intelligence — dependency-aware (no pings for blocked tasks), working-hours-aware, actionable (complete/snooze from the notification). The right spec for KAP reminders.
-   **Gallery mode: skip.** Native Cards view already ships cover images/fit/aspect — it sits as a sibling tab on the same `.base`. Only a task-optimized grid (badges for WIP/blocked/triage) would add value; low priority.

## Holistic value-adds (first-principles, not competitor-derived)

Thinking from the user journeys the plugin serves — capture → clarify → organize → engage → reflect — rather than from competitor feature lists:

-   **Trust: undo/redo for board operations.** Every drag, bulk action, and automation writes frontmatter across many files. A session-scoped undo stack with a toast ("Moved 12 cards — Undo") converts the scariest property of the plugin (it edits your notes) into a confidence feature. Nobody in the space has this.
-   **Onboarding: board doctor + "why isn't this note here?" inspector.** A diagnostic that answers the #1 support question of every Bases/query plugin: paste a note path, see exactly which filter/status/type rule excluded it or which column caught it. Plus a first-run wizard that scans actual property values and proposes statuses/columns from them. Directly cuts support load and bad reviews.
-   **Planning ritual support: "Plan my day/week" flow.** A guided pass — pick from available (is:available) cards into today's plan with a live capacity bar (sum of estimates vs configured hours/day), then write date_scheduled. The weekly variant walks project by project: no next action → flag as stalled. Extends triage (#122) and capacity (#58) into a ritual, which matches how people actually use action systems (and the OSK daily/weekly workflow).
-   **Next-action discipline.** Mark or derive one next action per project; `is:next` filter qualifier; stalled-project detection (project in progress with zero available children). Sharper, GTD-native version of the filed alignment check (#55).
-   **Calendar workload heat.** Color each calendar day by scheduled-estimate load vs capacity so overcommitment is visible at a glance before it happens. The visual complement of #58.
-   **Focus/engage mode.** Spotlight one card (from Agenda/board), with an optional timer that feeds the filed time-tracking property (#119) — done → next card. Bridges planning to actual execution, where most planning tools stop.
-   **Project blueprints.** Instantiate a project note plus its standard task set (with relative dates and relationships pre-wired) from a template — recurring project structures (launch checklist, article pipeline) in one action. Quick capture for whole subtrees.
-   **Reporting/export.** Generate a markdown/HTML weekly report (done this week from history/status changes, what moved, what's overdue, next week's plan) into a vault note — shareable, journal-ready, and a natural daily/weekly-note companion.
-   **AI-assist layer (opt-in).** Card → "propose subtasks" (writes WBS children), triage assistant proposing priority/estimate/contexts from note content, natural-language bulk commands ("push everything overdue in project X to next week"). Rides the plugin-API work (#59) and fits the agent-driven-vault trend; no task board in the Obsidian space has a native AI layer yet.
-   **Automation rule dry-run.** Preview what a rule would have done against current notes before enabling it (list of would-be writes). Automation that edits files needs a rehearsal mode; pairs with undo.
-   **Dashboard/overview mode.** One read-only surface across the whole action system: per-goal progress bars (reusing WBS rollups), counts by status/type, overdue and aging highlights, context load. The "10,000-foot" mode the five existing modes don't provide.
-   **i18n.** Competitors ship 2-8 languages (Operon 8, Moonlight 2, tududi 24); localization measurably widens community adoption and is cheap if done before the string count grows further.

## Positioning & docs lessons (no code)

-   **Migration docs win mindshare.** Operon's "coming from Obsidian Tasks / TaskNotes" guides are why it converts skeptics. Write "coming from Kanban plugin / Kanban Moonlight / Tasks / TaskNotes" pages.
-   **State the uninstall guarantee.** "What survives if you remove the plugin: everything — it's all frontmatter" came up unprompted as a top trust concern. One README/FAQ section, zero code.
-   **Publish explicit non-goals.** Belki's stated ceilings ("no Kanban, no sync, no settings sprawl") measurably reduced scope-creep pressure and built trust. Decide and declare: multi-user, push notifications, inline-checkbox indexing.
-   **Positioning risk:** "frontmatter-driven Kanban" is now table stakes (Moonlight uses the same pitch). Lead with what only KAP does: WBS rollups, relationship graph + focus, automation rules, state machines per note type, five modes on one dataset.
-   **The Operon question to answer deliberately:** inline `- [ ]` checkbox indexing alongside note-based cards is Operon's core differentiator and the one structural gap. Huge scope; either commit to it as a long-term bet or declare it a non-goal and own the "one note = one card" model loudly.
