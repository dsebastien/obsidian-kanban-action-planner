# Release Notes

## 1.20.0 (2026-08-30)

### Features

- **build:** fail the build on a lockfile the catalog review cannot parse
- **build:** make the rule floor check that it is still wired in
- **build:** refuse commits that loosen the rules instead of fixing the finding
- **plugin:** add the {{isoyear}} expression token

## 1.19.4 (2026-08-29)

### Bug Fixes

- **build:** align with the catalog reviewer's archive, ruleset and audit

## 1.19.3 (2026-08-28)

### Bug Fixes

- **plugin:** match the board drag ghost to the card's rendered display mode

## 1.19.2 (2026-08-28)

### Performance Improvements

- **plugin:** gate card-height equalization and patch the triage overlay in place
- **plugin:** skip the hidden board render during column-triage decisions

## 1.19.1 (2026-08-28)

### Bug Fixes

- **plugin:** make Esc reliably exit column triage via a keymap scope

## 1.19.0 (2026-08-28)

### Features

- optimistic column-triage decisions with instant advance and arrow-up step-back

## 1.18.1 (2026-08-28)

### Bug Fixes

- column-triage drop-zone feedback invisible under Obsidian's unlayered button styles

## 1.18.0 (2026-08-28)

### Features

- column triage — one-card pass over a board column with carousel status swipes [#170](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/170)
- column triage v2 — status tray, card stack, stamp/confetti animations [#170](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/170) [#122](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/122)
- filter aliases for configured properties (scheduled, estimate, progress, order)
- focus mode — single-card spotlight with timer [#160](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/160)
- keyboard and swipe triage quick actions
- time tracking with duration and totalDuration WBS rollup

### Bug Fixes

- column triage v2 — final-review hardening
- column-triage rails pinned to 30px by Obsidian's unlayered button height
- filter-bar focus ring, swipe outcome badges, column-triage drop targets [#160](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/160) [#169](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/169) [#170](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/170)

## 1.17.0 (2026-08-25)

### Features

- **plugin:** resolve context: filter qualifier to the configured contexts property

### Bug Fixes

- **plugin:** force the context-row chip ghosting past Obsidian's unlayered disabled style
- **plugin:** ghost read-only chips on WBS context rows
- **plugin:** size the WBS expand/collapse-all icons so they stop collapsing to a sliver

## 1.16.1 (2026-08-22)

### Bug Fixes

- **plugin:** make drag-and-drop work in boards embedded in Canvas

## 1.16.0 (2026-08-20)

### Features

- **plugin:** column aggregates in the column header
- **plugin:** let the due countdown follow the scheduled date

## 1.15.1 (2026-08-19)

### Bug Fixes

- **plugin:** stop board drags from selecting surrounding note text

## 1.15.0 (2026-08-19)

### Features

- **plugin:** whole-name columns=/lanes= embed terms via an = prefix

## 1.14.0 (2026-08-12)

### Features

- **plugin:** agenda mode - a prioritized Overdue / Today / Upcoming list [#39](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/39)
- **plugin:** defer dates + availability filtering (Next actions)
- **plugin:** embed a single column or column subset via columns=
- **plugin:** embed a single swimlane or lane subset via lanes= [#131](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/131)
- **plugin:** reorder mode tabs to Board, Calendar, Timeline, WBS, Triage

### Bug Fixes

- **plugin:** keyboard card menu respects an active multi-selection [#130](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/130)
- **plugin:** right-click on a multi-card selection acts on the whole selection

## 1.13.0 (2026-08-11)

### Features

- **plugin:** add a quick-capture + button to column headers
- **plugin:** create cards from the board (quick capture)

### Bug Fixes

- **plugin:** drop cards for notes deleted outside the board
- **plugin:** keep the column scroll put on send to top/bottom
- **plugin:** stop dragged cards snapping back to their old column

## 1.12.0 (2026-07-29)

### Features

- **plugin:** natural-language date entry in date prompts
- **plugin:** show what's new in a tab instead of a modal dialog
- **plugin:** surface support CTAs everywhere users can see them

## 1.11.0 (2026-07-29)

### Features

- **plugin:** aggregate what's new dialogs across simultaneously updated plugins

## 1.10.0 (2026-07-29)

### Features

- **plugin:** add Knowii community to the what's new dialog and harden it

## 1.9.0 (2026-07-27)

### Features

- **plugin:** show a what's new dialog once after plugin updates

### Bug Fixes

- **plugin:** support public Obsidian releases (minAppVersion 1.12.0)

## 1.8.0 (2026-07-18)

### Features

- **plugin:** context writes, coloring, and context= embeds
- **plugin:** filter cards by GTD contexts

## 1.7.2 (2026-07-17)

### Bug Fixes

- **plugin:** touch-friendly drag gestures and popout-window drag support

### Performance Improvements

- **plugin:** gate WBS renders, cheaper calendar/timeline signatures, config-tab fix, closes [issue-#105](https://github.com/dsebastien/issue-/issues/105) [#110](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/110) [#110](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/110)

## 1.7.1 (2026-07-17)

## 1.7.0 (2026-07-17)

### Features

- **plugin:** edit WBS estimates inline on the chip
- **plugin:** embed views in notes with ephemeral mode/filter/height overrides
- **plugin:** hover page-preview in calendar, timeline, and WBS modes

### Bug Fixes

- **plugin:** re-apply embed overrides when the embed line is edited
- **plugin:** shrink embeds to content and harden embed write suppression

### Performance Improvements

- **plugin:** memoize WBS rollups and reconcile needs-planning panel groups

## 1.6.0 (2026-07-16)

### Features

- **plugin:** per-note-type automation rules on status, done, archive and property triggers

## 1.5.0 (2026-07-16)

### Features

- **plugin:** add inline status control on WBS rows
- **plugin:** per-note-type done states counting as 100% in progress rollups

### Bug Fixes

- **plugin:** resolve live cards, add write rollbacks and harden the render gate

### Performance Improvements

- **plugin:** complete the optimistic model for lane, bulk, triage and card-menu writes
- **plugin:** preserve scroll positions across full-teardown re-renders
- **plugin:** render calendar/timeline ui-state changes from the cached card set
- **plugin:** reserve layout space and guard the resize path
- **plugin:** skip content-identical render passes with a render-signature gate

## 1.4.0 (2026-07-15)

### Features

- **plugin:** accept generic duration syntax in the estimate prompt
- **plugin:** align estimate units in fixed slots in the WBS column
- **plugin:** drag cards between status groups in the scheduling panels
- **plugin:** one composite duration format for every estimate display
- **plugin:** per-note-type estimate property and unit (days or minutes)
- **plugin:** per-type relationship resolution on mixed boards

### Bug Fixes

- **plugin:** drop view names from the scheduling property descriptions
- **plugin:** keep WBS columns aligned on context rows and roll up 0% progress
- **plugin:** sentence-case the chip placeholder and countdown copy

## 1.3.0 (2026-07-14)

### Features

- **plugin:** keep the WBS usable on single-type, filtered and flat views

## 1.2.0 (2026-07-14)

### Features

- **plugin:** add a WBS view mode with rollups, progress bars and drag re-parenting ([#76](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/76))
- **plugin:** add WBS due dates, detach by drag and reconciled rendering ([#76](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/76))

## 1.1.0 (2026-07-03)

### Features

- **plugin:** add a grouped navigation pane to triage mode
- **plugin:** add send to top/bottom card menu actions ([#79](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/79)) [#78](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/78)
- **plugin:** calendar estimate spans, cleaner bars, global properties
- **plugin:** drag timeline milestones to another day
- **plugin:** group the calendar scheduling panel by note type and status
- **plugin:** improve timeline mode
- **plugin:** render unplanned type groups as full-width tabs
- **plugin:** rework timeline around start date + estimate
- **plugin:** seed a 1-day estimate when scheduling onto the timeline
- **plugin:** show a red deadline line per timeline row
- **plugin:** show the resize date inside the timeline bar
- **plugin:** timeline view and per-type mixed boards

## 1.0.0 (2026-07-03)

### Features

- **plugin:** zoom into a card's children (focus mode)
- **plugin:** zoom to all descendants (whole subtree)
- **plugin:** zoom up from a card via its parents badge

## 0.9.1 (2026-07-03)

### Bug Fixes

- **plugin:** reintroduce configurable card title property [#4](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/4)

## 0.9.0 (2026-07-03)

### Features

- **plugin:** add compact mode toggle showing title-only cards

### Bug Fixes

- **plugin:** let columns expand equally to fill spare board width [#73](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/73)

## 0.8.1 (2026-06-30)

### Bug Fixes

- **plugin:** resolve community-reviewer lint and deprecation warnings

## 0.8.0 (2026-06-30)

### Features

- **plugin:** auto-advance and scroll-reset in triage mode

## 0.7.6 (2026-06-30)

### Features

- **plugin:** celebrate completed triage and stop the scroll jump

## 0.7.5 (2026-06-30)

### Bug Fixes

- **plugin:** clear scorecard warnings (activeDocument, activeLeaf, redundant cast)

## 0.7.4 (2026-06-30)

### Bug Fixes

- **plugin:** remove empty bar under toolbar when nothing selected ([#60](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/60))

## 0.7.3 (2026-06-30)

### Bug Fixes

- **plugin:** highlight the select-mode toggle when active

## 0.7.2 (2026-06-30)

### Features

- **plugin:** optimistic UI updates for moves and relationships [#64](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/64)

### Bug Fixes

- **plugin:** redesign triage UI — scrollable, sticky actions, bolder card [#65](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/65)
- **plugin:** selected-card highlight applies immediately ([#61](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/61))

## 0.7.1 (2026-06-30)

### Bug Fixes

- **plugin:** triage queue populates on direct open + scope/value highlighting [#66](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/66)

## 0.7.0 (2026-06-30)

### Features

- **plugin:** card chip style setting (minimal / tinted / rail)
- **plugin:** due countdown badge with selectable position [#62](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/62) [#67](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/67)

### Bug Fixes

- **plugin:** enlarge filter clear and help button icons ([#63](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/63))

## 0.6.1 (2026-06-30)

### Features

- **plugin:** color-coded, scannable property chips on cards

## 0.6.0 (2026-06-29)

### Features

- **plugin:** card fields from the Bases view's properties ([#50](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/50), part 3)
- **plugin:** de-emphasize card field labels, render progress as a bar
- **plugin:** enum quick-set — "Set <property>" card menu ([#52](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/52)) [#13](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/13)
- **plugin:** group swimlanes by a Bases formula/file column ([#50](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/50), part 2)
- **plugin:** sort by Bases formula/file columns ([#50](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/50), part 1)
- **plugin:** triage "Due for review" scope — spaced repetition ([#57](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/57))
- **plugin:** triage config modal with property pickers, not free-text ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53))
- **plugin:** triage mode — focused clarify / re-prioritize queue ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53))
- **plugin:** type-aware triage gating for mixed-type boards ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53))

### Bug Fixes

- **plugin:** source triage props from note types + base formulas, no fallback ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53))

## 0.5.0 (2026-06-28)

### Features

- **plugin:** add/remove relationships from the card menu ([#14](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/14))
- **plugin:** native note preview on card hover

## 0.4.1 (2026-06-28)

### Bug Fixes

- **plugin:** log instead of silently dropping note-type writes
- **plugin:** use activeDocument for drag ghost + hit-testing

## 0.4.0 (2026-06-28)

### Features

- **plugin:** sort cards within a column by a property ([#17](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/17))

### Bug Fixes

- **plugin:** blockers may be off-board; only archived ones drop ([#13](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/13))
- **plugin:** stop archived/off-board blockers from blocking ([#13](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/13))

## 0.3.0 (2026-06-28)

### Features

- **plugin:** add a JQL-lite filter bar to the toolbar
- **plugin:** auto-archive on multiple trigger statuses
- **plugin:** clean the Bases property pickers (issue [#8](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/8))
- **plugin:** command-palette commands for the active Kanban view
- **plugin:** drag column headers to reorder columns
- **plugin:** fully turn off relationship roles set to "None"
- **plugin:** keyboard move, reorder, and menu for cards (a11y)
- **plugin:** local note types — create + recognize without the Starter Kit
- **plugin:** multi-select cards + bulk actions
- **plugin:** persist calendar & lane view state across reloads ([#19](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/19))
- **plugin:** soft WIP limits per column
- **plugin:** stabilize horizontal scroll when the Unmapped column toggles
- **plugin:** stronger overdue emphasis on cards
- **plugin:** uniform card height and per-note-type card fields

## 0.2.0 (2026-06-28)

### Features

- **plugin:** central Note Types settings — define each type's config once
- **plugin:** note-type-specific archiving (per-type archive folders)
- **plugin:** unified calendar showing scheduled and deadline dates together

### Bug Fixes

- **plugin:** show a pointer cursor on every plugin button

## 0.1.0 (2026-06-28)

### Features

- **plugin:** auto-collapse the scheduling pane when the calendar is narrow
- **plugin:** folder autocomplete and a tabbed Configure board dialog
- **plugin:** orange edge for deadline-placed chips in the calendar
- **plugin:** pointer cursor on calendar grid days to signal click-to-zoom

### Bug Fixes

- **plugin:** keep all calendar days visible when days have cards
- **plugin:** pluralize relationship property labels in board settings
- **plugin:** remove horizontal scrollbar in Configure board dialog

## 0.0.4 (2026-06-27)

### Features

- **plugin:** calendar toolbar (Board/Calendar switch + gear) and readable panel chips
- **plugin:** cap swimlane height at one screen and add collapsible columns
- **plugin:** consistent swimlane heights, lane nav buttons, bigger toggle

### Bug Fixes

- **plugin:** render lane and column collapse chevrons at a consistent size
- **plugin:** rotate only the gear icon on hover, not its button

## 0.0.3 (2026-06-27)

### Features

- **plugin:** make Day a first-class calendar range + add Today to the day view

## 0.0.2 (2026-06-27)

### Features

- **plugin:** configurable first day of the week
- **plugin:** zoom into a single day on the calendar

## 0.0.1 (2026-06-27)

### Features

- **plugin:** archiving — move notes to a placeholder folder (M4b, [#7](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/7))
- **plugin:** calendar drag-to-schedule and drag-to-clear (M5c/M5d)
- **plugin:** calendar mode — scheduling panel + grid (M5a/M5b)
- **plugin:** configurable card presentation (title, fields, cover, wrapping), closes [3-#6](https://github.com/dsebastien/3-/issues/6)
- **plugin:** configurable swimlanes (M3, [#2](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/2))
- **plugin:** core Kanban board with drag/drop and order persistence
- **plugin:** definition-driven columns + ctrl/cmd-click opens new tab
- **plugin:** incremental board refresh + uniform sizing (M6)
- **plugin:** note-type profiles, Starter Kit mirroring, and colors
- **plugin:** open related notes in a new tab on ctrl/cmd-click
- **plugin:** place Unmapped column first by default, configurable per view
- **plugin:** register Kanban Bases view scaffold and config model
- **plugin:** relationships, blocked-by & relational filtering (M4)
- **plugin:** scheduling-panel sort + filter; M5 docs (M5e), closes [#tag](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/tag)
- scaffold Kanban Action Planner plugin and add implementation plan

### Bug Fixes

- **plugin:** match Starter Kit's {{quarter}} placeholder format (Q2, not 2)
- **plugin:** persist discovered statuses so Show empty columns works
