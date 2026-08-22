# Changelog

All notable changes to this project will be documented in this file.

## [1.16.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.16.0...1.16.1) (2026-08-22)

### Bug Fixes

* **plugin:** make drag-and-drop work in boards embedded in Canvas ([c7a241c](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c7a241c2c1088c506d7307c81e5661b401cbf450)), closes [#154](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/154)

## [1.16.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.15.1...1.16.0) (2026-08-20)

### Features

* **plugin:** column aggregates in the column header ([c41ffb6](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c41ffb60beec85b0041662938e7326cf1dba3e47))
* **plugin:** let the due countdown follow the scheduled date ([406ff5b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/406ff5b8ab750bc75ab5f224bfae1072d661f2da)), closes [#68](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/68)

## [1.15.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.15.0...1.15.1) (2026-08-19)

### Bug Fixes

* **plugin:** stop board drags from selecting surrounding note text ([f6d35c0](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/f6d35c06eb98125800ed1226313e324a4ebc73cc))

## [1.15.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.14.0...1.15.0) (2026-08-19)

### Features

* **plugin:** whole-name columns=/lanes= embed terms via an = prefix ([e1e0bf1](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/e1e0bf1476b4d8c6334dda249b3d02e9782b7137))

## [1.14.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.13.0...1.14.0) (2026-08-12)

### Features

* **plugin:** agenda mode - a prioritized Overdue / Today / Upcoming list ([c23fd0b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c23fd0beeea6bfa5cb28746f31e5ed4825a81d0b)), closes [#113](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/113) [#39](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/39)
* **plugin:** defer dates + availability filtering (Next actions) ([55ba57c](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/55ba57cdd756ba37ae186a6975ae9b48fbd93ee9)), closes [#113](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/113)
* **plugin:** embed a single column or column subset via columns= ([03adb2d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/03adb2d22e4e41fc1a999d4f13abbe22ac430559)), closes [#128](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/128)
* **plugin:** embed a single swimlane or lane subset via lanes= ([8231b54](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/8231b54d050ec3a3893a4cde1ece56beda973cca)), closes [#128](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/128) [#131](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/131)
* **plugin:** reorder mode tabs to Board, Calendar, Timeline, WBS, Triage ([cbcc512](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/cbcc51242e2eeed0ccda02a80430b5e444e439c6)), closes [#127](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/127)

### Bug Fixes

* **plugin:** keyboard card menu respects an active multi-selection ([18aa5f3](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/18aa5f3d9f3d8ad54008207fcfd4701567c5e24e)), closes [#129](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/129) [#130](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/130)
* **plugin:** right-click on a multi-card selection acts on the whole selection ([be464cc](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/be464cc3f1e1810542090aea4e71d5617a1b8622)), closes [#129](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/129)

## [1.13.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.12.0...1.13.0) (2026-08-11)

### Features

* **plugin:** add a quick-capture + button to column headers ([dbaacdc](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/dbaacdc90d3ff524d9564ef4438a18f17cb47e03))
* **plugin:** create cards from the board (quick capture) ([787af77](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/787af7764eec811cd04062c2efaae92a87117ddf)), closes [#46](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/46)

### Bug Fixes

* **plugin:** drop cards for notes deleted outside the board ([23def47](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/23def475b0742ec8c08833e71285c8436333497b))
* **plugin:** keep the column scroll put on send to top/bottom ([2b4b77f](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/2b4b77f24478f31c59ca22c39044462327656007))
* **plugin:** stop dragged cards snapping back to their old column ([aa4cd19](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/aa4cd19ed98cfae61798cf68d4c03fe13eb5c16d))

## [1.12.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.11.0...1.12.0) (2026-07-29)

### Features

* **plugin:** natural-language date entry in date prompts ([cf6405a](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/cf6405a83d3609ef1de166fa43084cc78a30b64f)), closes [#116](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/116)
* **plugin:** show what's new in a tab instead of a modal dialog ([9284a1d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9284a1dc9bc7fb680129f47f2839d750800dba60))
* **plugin:** surface support CTAs everywhere users can see them ([27269ec](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/27269ec1a17e0cd7a363c8e35542c3ebc08c56e5))

## [1.11.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.10.0...1.11.0) (2026-07-29)

### Features

* **plugin:** aggregate what's new dialogs across simultaneously updated plugins ([781f4e2](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/781f4e28ff685cea3250861da99ebb955b346f24))

## [1.10.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.9.0...1.10.0) (2026-07-29)

### Features

* **plugin:** add Knowii community to the what's new dialog and harden it ([39f19f3](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/39f19f353ad12f7bb9164adb674992e8c6ff6665))

## [1.9.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.8.0...1.9.0) (2026-07-27)

### Features

* **plugin:** show a what's new dialog once after plugin updates ([dc0a182](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/dc0a18210a68a00b87905362c5581fed00f24444))

### Bug Fixes

* **plugin:** support public Obsidian releases (minAppVersion 1.12.0) ([f66456d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/f66456d6e00ccba5583508c19676589381565607))

## [1.8.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.7.2...1.8.0) (2026-07-18)

### Features

* **plugin:** context writes, coloring, and context= embeds ([713339e](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/713339e8c97ec3d5f605dd32812a14061fcb78ee))
* **plugin:** filter cards by GTD contexts ([8cb68ff](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/8cb68ff41db2c33e5d1ac469e138c6099802d9b9))

## [1.7.2](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.7.1...1.7.2) (2026-07-17)

### Bug Fixes

* **plugin:** touch-friendly drag gestures and popout-window drag support ([0f7de3a](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/0f7de3ab62d79c7cf1aa6bdf8d1d04881347819c)), closes [#109](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/109)

### Performance Improvements

* **plugin:** gate WBS renders, cheaper calendar/timeline signatures, config-tab fix ([a7ead1c](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/a7ead1cc9b4b915c49c443c3a663397429bd1c2e)), closes [issue-#105](https://github.com/dsebastien/issue-/issues/105) [#110](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/110) [#110](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/110)

## [1.7.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.7.0...1.7.1) (2026-07-17)

## [1.7.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.6.0...1.7.0) (2026-07-17)

### Features

* **plugin:** edit WBS estimates inline on the chip ([e3c30f0](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/e3c30f0c9cbc2312bbed34dff3932ed8052248df)), closes [#106](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/106)
* **plugin:** embed views in notes with ephemeral mode/filter/height overrides ([483d40d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/483d40dc82b5d3ad507b2d7da6b4b2127111e004)), closes [#103](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/103)
* **plugin:** hover page-preview in calendar, timeline, and WBS modes ([67b5d5e](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/67b5d5e74b7d37c683f2a40bd9ff0fe661298e87)), closes [#99](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/99)

### Bug Fixes

* **plugin:** re-apply embed overrides when the embed line is edited ([80fc4d6](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/80fc4d60989f6ab8b96f54533cc95a24f3849f74))
* **plugin:** shrink embeds to content and harden embed write suppression ([d9e8ea0](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/d9e8ea03901333c1ddc6161957e5598c5a238c9d))

### Performance Improvements

* **plugin:** memoize WBS rollups and reconcile needs-planning panel groups ([6c8f178](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/6c8f1786443b8a6836468ef73c03cb5580542ad9)), closes [#100](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/100)

## [1.6.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.5.0...1.6.0) (2026-07-16)

### Features

* **plugin:** per-note-type automation rules on status, done, archive and property triggers ([ded5849](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/ded5849538dab9714b0aaebb4341955e4a2e926f))

## [1.5.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.4.0...1.5.0) (2026-07-16)

### Features

* **plugin:** add inline status control on WBS rows ([c13ffb3](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c13ffb3c91436e9d0558aa220635a32e094ca345)), closes [#98](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/98)
* **plugin:** per-note-type done states counting as 100% in progress rollups ([81963c5](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/81963c508f522a1c6bfed87a598dce12a30eede7)), closes [#56](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/56)

### Bug Fixes

* **plugin:** resolve live cards, add write rollbacks and harden the render gate ([033478b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/033478b7374d710c640002e6b4cdf662fa7c489b))

### Performance Improvements

* **plugin:** complete the optimistic model for lane, bulk, triage and card-menu writes ([f7331ed](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/f7331edf34f92359b01c76eb2f12fd4783dd74ef))
* **plugin:** preserve scroll positions across full-teardown re-renders ([2e69547](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/2e69547fda18f31f2173efc2dc0375ce9cca256c))
* **plugin:** render calendar/timeline ui-state changes from the cached card set ([b5d5f1c](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/b5d5f1c168ead80b51423a872e21104fcadd292e))
* **plugin:** reserve layout space and guard the resize path ([9137ede](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9137edeba9a9b70fce146676908d911b016e3856))
* **plugin:** skip content-identical render passes with a render-signature gate ([e9c0831](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/e9c08317be2800cb0c9d821ee1c9e90cc8758aa5))

## [1.4.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.3.0...1.4.0) (2026-07-15)

### Features

* **plugin:** accept generic duration syntax in the estimate prompt ([5a6e56f](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/5a6e56fa63f7ff9b4909ab22ecdf5c5d44f44d98))
* **plugin:** align estimate units in fixed slots in the WBS column ([bc33b57](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/bc33b575c7835688304bfdf62bb2e4748abf9981))
* **plugin:** drag cards between status groups in the scheduling panels ([b9789e7](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/b9789e7a624fa2e6e3d4e89dce0243392de3a60f))
* **plugin:** one composite duration format for every estimate display ([6f7d9df](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/6f7d9df5662fb6d24d3640e70d13261a53f4b995))
* **plugin:** per-note-type estimate property and unit (days or minutes) ([9e28ccc](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9e28ccc9b71167f1f31c287aa5d266ebc655b693))
* **plugin:** per-type relationship resolution on mixed boards ([4d0f996](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/4d0f996ecea3d876a74acb2c49d8cc0b583f7575))

### Bug Fixes

* **plugin:** drop view names from the scheduling property descriptions ([84d3c08](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/84d3c08ef3b3274c34868dd8b9335d0602f8f704))
* **plugin:** keep WBS columns aligned on context rows and roll up 0% progress ([29d7370](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/29d737056daae8773cfecf4c4430d62a1607669f))
* **plugin:** sentence-case the chip placeholder and countdown copy ([327ddae](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/327ddae3957b06e4f0736d88d3cc7830a7d22483))

## [1.3.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.2.0...1.3.0) (2026-07-14)

### Features

* **plugin:** keep the WBS usable on single-type, filtered and flat views ([29aafe3](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/29aafe3b60d64f1b76300052514e68cd53c1965d))

## [1.2.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.1.0...1.2.0) (2026-07-14)

### Features

* **plugin:** add a WBS view mode with rollups, progress bars and drag re-parenting ([#76](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/76)) ([d85b853](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/d85b853b3c209388a2a3f66f8329bb0709f51d70))
* **plugin:** add WBS due dates, detach by drag and reconciled rendering ([#76](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/76)) ([9842c2a](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9842c2a071006c93404738be8bd4a4947d7c1b11))

## [1.1.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/1.0.0...1.1.0) (2026-07-03)

### Features

* **plugin:** add a grouped navigation pane to triage mode ([988824f](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/988824f4fd1f88308b5d44040da5aa444213ffee))
* **plugin:** add send to top/bottom card menu actions ([#79](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/79)) ([132bf1f](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/132bf1fde361c0a3cbc6f1ff812e35b4010e17c7)), closes [#17](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/17) [#78](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/78)
* **plugin:** calendar estimate spans, cleaner bars, global properties ([183faf1](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/183faf1d91a4cea605c163ea86f29649a5296c95))
* **plugin:** drag timeline milestones to another day ([21e5aeb](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/21e5aeb7257d0e9135ee7d0a6b23e7b1ca396816))
* **plugin:** group the calendar scheduling panel by note type and status ([60f6e23](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/60f6e23efd3f85553fc41de0dc2f107132839594))
* **plugin:** improve timeline mode ([3a7e73b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/3a7e73b1926ec6cfc7faa324a0a6186b011fb893))
* **plugin:** render unplanned type groups as full-width tabs ([9ece322](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9ece32266a904ac176f935319bf1617dc7b30b23))
* **plugin:** rework timeline around start date + estimate ([87ddf1b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/87ddf1b3015a2c6be14e94d76d218c728df0a5b3))
* **plugin:** seed a 1-day estimate when scheduling onto the timeline ([75e342b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/75e342bd74472c64d19c7ad8bc951c0fe9a54a59))
* **plugin:** show a red deadline line per timeline row ([1bb653e](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/1bb653e4e29d48e00ebfc7e7dbdd4868d5bb3a93))
* **plugin:** show the resize date inside the timeline bar ([8cda27e](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/8cda27ec5964a5a3b4f6874144d0c213e0d508d9))
* **plugin:** timeline view and per-type mixed boards ([66ceb8d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/66ceb8d64ccff9a84db363f226b91a5ccfb4414c)), closes [#77](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/77)

## [1.0.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.9.1...1.0.0) (2026-07-03)

### Features

* **plugin:** zoom into a card's children (focus mode) ([8c0bb33](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/8c0bb33dfefef38451bf08412b7779af4c0c193e)), closes [#74](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/74)
* **plugin:** zoom to all descendants (whole subtree) ([4502d20](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/4502d20f157cdd971cff8d46a2c815b5692f9489))
* **plugin:** zoom up from a card via its parents badge ([3ceae11](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/3ceae11f72681a3d47cbe971d48054fd459b4e18)), closes [#74](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/74)

## [0.9.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.9.0...0.9.1) (2026-07-03)

### Bug Fixes

* **plugin:** reintroduce configurable card title property ([82db5d1](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/82db5d15427ad92ed42c44a0a8c7614af700a423)), closes [#50](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/50) [#4](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/4)

## [0.9.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.8.1...0.9.0) (2026-07-03)

### Features

* **plugin:** add compact mode toggle showing title-only cards ([9242744](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9242744cd238dada29fd4e67a97f3a38db930e73))

### Bug Fixes

* **plugin:** let columns expand equally to fill spare board width ([5a999f9](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/5a999f911a210b307481049da82c5ba670d17e84)), closes [#73](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/73) [#73](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/73)

## [0.8.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.8.0...0.8.1) (2026-06-30)

### Bug Fixes

* **plugin:** resolve community-reviewer lint and deprecation warnings ([400d0db](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/400d0db71e6901f4bed30d8efc70054cfe9dd2bd))

## [0.8.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.7.6...0.8.0) (2026-06-30)

### Features

* **plugin:** auto-advance and scroll-reset in triage mode ([1d62e10](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/1d62e1052854b3ad9b72f2b6ff489439aa76fedf))

## [0.7.6](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.7.5...0.7.6) (2026-06-30)

### Features

* **plugin:** celebrate completed triage and stop the scroll jump ([11f8090](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/11f8090644879b25580dda55e7f7b222c55ea716))

## [0.7.5](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.7.4...0.7.5) (2026-06-30)

### Bug Fixes

* **plugin:** clear scorecard warnings (activeDocument, activeLeaf, redundant cast) ([a70d4b5](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/a70d4b585253f9a4228a0c8819ec8875a276436e))

## [0.7.4](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.7.3...0.7.4) (2026-06-30)

### Bug Fixes

* **plugin:** remove empty bar under toolbar when nothing selected ([#60](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/60)) ([086a1fb](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/086a1fb06fab05bec9caa6d688f682d03003a40a))

## [0.7.3](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.7.2...0.7.3) (2026-06-30)

### Bug Fixes

* **plugin:** highlight the select-mode toggle when active ([018d0e5](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/018d0e5ef0ae9c62efca4533ee3200a03c6bd05d))

## [0.7.2](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.7.1...0.7.2) (2026-06-30)

### Features

* **plugin:** optimistic UI updates for moves and relationships ([9e29cb5](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9e29cb53aabca350160e8b92e76ad78718cb06c4)), closes [#64](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/64) [#64](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/64)

### Bug Fixes

* **plugin:** redesign triage UI — scrollable, sticky actions, bolder card ([1a9a92e](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/1a9a92e09c59e47c9313da578a5e9b13fda0ff9c)), closes [#65](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/65) [#65](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/65)
* **plugin:** selected-card highlight applies immediately ([#61](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/61)) ([b7e02de](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/b7e02de2d8b278192fdcbf3121c669a27cfaf1b9))

## [0.7.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.7.0...0.7.1) (2026-06-30)

### Bug Fixes

* **plugin:** triage queue populates on direct open + scope/value highlighting ([3eee8fb](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/3eee8fbc2a3e1942416af6205ec964e367ddbc46)), closes [#66](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/66) [#66](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/66)

## [0.7.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.6.1...0.7.0) (2026-06-30)

### Features

* **plugin:** card chip style setting (minimal / tinted / rail) ([6aa9e82](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/6aa9e8285854f4cf1190a5350d4921227d008269))
* **plugin:** due countdown badge with selectable position ([a258f4d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/a258f4d12ffdf6e8e2a757442b835908308e1292)), closes [#67](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/67) [#62](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/62) [#67](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/67)

### Bug Fixes

* **plugin:** enlarge filter clear and help button icons ([#63](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/63)) ([0b929ee](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/0b929ee1c756f0b71d2385a9853d2eda3a3b7ec3))

## [0.6.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.6.0...0.6.1) (2026-06-30)

### Features

* **plugin:** color-coded, scannable property chips on cards ([3c85bdd](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/3c85bddc70a862608222bb87cce7b322933924b1))

## [0.6.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.5.0...0.6.0) (2026-06-29)

### Features

* **plugin:** card fields from the Bases view's properties ([#50](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/50), part 3) ([c2f3ab6](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c2f3ab661db115581791ceb0abb50f0a5cd76d66))
* **plugin:** de-emphasize card field labels, render progress as a bar ([f406303](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/f406303f435ee0313ba4e531bae80cdfe9974e3b))
* **plugin:** enum quick-set — "Set <property>" card menu ([#52](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/52)) ([d0fe74b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/d0fe74b4c5ea1f98cf5fdedd754af84ac9b7e9f0)), closes [#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53) [#13](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/13)
* **plugin:** group swimlanes by a Bases formula/file column ([#50](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/50), part 2) ([480754b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/480754b82449360a6b3f676756c3d51f05c6c856))
* **plugin:** sort by Bases formula/file columns ([#50](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/50), part 1) ([b514368](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/b5143684b57439c5434f99782ccc5e60e0506f08))
* **plugin:** triage "Due for review" scope — spaced repetition ([#57](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/57)) ([6fcec69](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/6fcec69ec541b7812bac03cd561ae033b787f090))
* **plugin:** triage config modal with property pickers, not free-text ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53)) ([c554e4b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c554e4b9399852ec233bab997ae52a3319280986))
* **plugin:** triage mode — focused clarify / re-prioritize queue ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53)) ([9112c70](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9112c70d7c8b5eeaa1e88cfd683d5e7d49be01bf)), closes [#52](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/52)
* **plugin:** type-aware triage gating for mixed-type boards ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53)) ([6a4578d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/6a4578d1bde2259972a895385d417919f4695221))

### Bug Fixes

* **plugin:** source triage props from note types + base formulas, no fallback ([#53](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/53)) ([bd10487](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/bd10487149b3e2aa623e3f2d22178c0e55120670))

## [0.5.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.4.1...0.5.0) (2026-06-28)

### Features

* **plugin:** add/remove relationships from the card menu ([#14](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/14)) ([27950c3](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/27950c3f02a741539e1e73df1bc7be9fa2c75e17)), closes [#13](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/13)
* **plugin:** native note preview on card hover ([3dc25f5](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/3dc25f57df3b6a56ba79edbb5f60d9e79de6fac5))

## [0.4.1](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.4.0...0.4.1) (2026-06-28)

### Bug Fixes

* **plugin:** log instead of silently dropping note-type writes ([6717919](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/67179199a0a7dafce3b0a810eec2d5746c06b102))
* **plugin:** use activeDocument for drag ghost + hit-testing ([0074a94](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/0074a94770aab86eab779adfd526ac582a3a9eae))

## [0.4.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.3.0...0.4.0) (2026-06-28)

### Features

* **plugin:** sort cards within a column by a property ([#17](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/17)) ([8d80164](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/8d8016426921ff4d4f020141cf5e102af88b69c8))

### Bug Fixes

* **plugin:** blockers may be off-board; only archived ones drop ([#13](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/13)) ([8c53406](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/8c534063504b7a24355c2f67eb2800d2a25a5198))
* **plugin:** stop archived/off-board blockers from blocking ([#13](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/13)) ([e4e291b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/e4e291bf7740d25efd52bf217a86f2e04e2adec7))

## [0.3.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.2.0...0.3.0) (2026-06-28)

### Features

* **plugin:** add a JQL-lite filter bar to the toolbar ([b5b6e57](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/b5b6e57f9fe05dfb13d93ef34e6caee12eab5d59)), closes [#34](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/34)
* **plugin:** auto-archive on multiple trigger statuses ([d4d0041](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/d4d0041ad2df29b6c42e6fca9f0e3d4fabd6b17b)), closes [#32](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/32)
* **plugin:** clean the Bases property pickers (issue [#8](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/8)) ([81e0675](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/81e0675e3dfb3c75a1a2bdf0cd42af53ef1750b2))
* **plugin:** command-palette commands for the active Kanban view ([77cf243](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/77cf24317407f906c373f14e62ea516589df7ab9)), closes [#27](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/27)
* **plugin:** drag column headers to reorder columns ([adf37a2](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/adf37a21ec287beb04857d975312bcf5ed2c571b)), closes [#24](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/24)
* **plugin:** fully turn off relationship roles set to "None" ([a40e402](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/a40e40279e1a3a142076c70abe193a67e2b5a009))
* **plugin:** keyboard move, reorder, and menu for cards (a11y) ([025466b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/025466b516bfa78720ca21e5398215614d9e5571)), closes [#20](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/20)
* **plugin:** local note types — create + recognize without the Starter Kit ([015431a](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/015431ab428afef4d0c71af84332bdc09cd6987c)), closes [#31](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/31)
* **plugin:** multi-select cards + bulk actions ([c746362](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c7463626bf2688bdfedaa9cc046d9a45377dcc11)), closes [#18](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/18)
* **plugin:** persist calendar & lane view state across reloads ([#19](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/19)) ([3ec3ca4](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/3ec3ca44511352d5f95d6ebfdd4c096216bb0b69))
* **plugin:** soft WIP limits per column ([9951b3e](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/9951b3e5d8b352aeb4da770ef9c41a577abf4158)), closes [#16](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/16)
* **plugin:** stabilize horizontal scroll when the Unmapped column toggles ([5e7a8a9](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/5e7a8a98786049a43f7a3ad2703c3dabca8deec8)), closes [#12](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/12)
* **plugin:** stronger overdue emphasis on cards ([c701c52](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c701c520e0668e60a8b98dace09d6da7761ea218)), closes [#22](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/22)
* **plugin:** uniform card height and per-note-type card fields ([c49172f](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c49172f76549e010a3011543cdf5ee41b0a96612))

## [0.2.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.1.0...0.2.0) (2026-06-28)

### Features

* **plugin:** central Note Types settings — define each type's config once ([7643341](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/76433414f06347cc8378d9f1d79fa8ab01537b4c))
* **plugin:** note-type-specific archiving (per-type archive folders) ([75f1cff](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/75f1cff769279f8e63ee67629ff9682347426767))
* **plugin:** unified calendar showing scheduled and deadline dates together ([858417d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/858417dbd08233d057713970f60eb0084de84abd))

### Bug Fixes

* **plugin:** show a pointer cursor on every plugin button ([f7df0b9](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/f7df0b9e24780a42e30fa032d0601c05bf497f4d))

## [0.1.0](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.0.4...0.1.0) (2026-06-28)

### Features

* **plugin:** auto-collapse the scheduling pane when the calendar is narrow ([6767493](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/676749321d0619c54703cbe7a3bd9563763af3c3))
* **plugin:** folder autocomplete and a tabbed Configure board dialog ([3085c51](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/3085c5116a127ca69c80bcd7b44940fcc037edff))
* **plugin:** orange edge for deadline-placed chips in the calendar ([a977473](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/a97747373f334f2e66512efe4f7d5fbda21abcea))
* **plugin:** pointer cursor on calendar grid days to signal click-to-zoom ([98486fe](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/98486fefc9061a2b6ff5d1132cffec7d480072cd))

### Bug Fixes

* **plugin:** keep all calendar days visible when days have cards ([f1b29f5](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/f1b29f5034022d08b90654e9893a33ee5427e91c))
* **plugin:** pluralize relationship property labels in board settings ([1ff718f](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/1ff718fe3998559da93a6f00e344dd655d01ded8))
* **plugin:** remove horizontal scrollbar in Configure board dialog ([c239640](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c239640e49f2fa79c28937c76a19fe76a5096b04))

## [0.0.4](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.0.3...0.0.4) (2026-06-27)

### Features

* **plugin:** calendar toolbar (Board/Calendar switch + gear) and readable panel chips ([becceb4](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/becceb46c02c33db3963562917c2f77a180c38c0))
* **plugin:** cap swimlane height at one screen and add collapsible columns ([314f5a8](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/314f5a8b52259ec173d377b12bc18ac1db96515e))
* **plugin:** consistent swimlane heights, lane nav buttons, bigger toggle ([41a37ac](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/41a37ac6cffdb5a7cb619fbcc2cf15f5c4455e2f))

### Bug Fixes

* **plugin:** render lane and column collapse chevrons at a consistent size ([b57d374](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/b57d3742e8d89c9e76a14e159b2defaef15b7313))
* **plugin:** rotate only the gear icon on hover, not its button ([4f93e10](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/4f93e1023d405661bd19cf4c45151fdde922641b))

## [0.0.3](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.0.2...0.0.3) (2026-06-27)

### Features

* **plugin:** make Day a first-class calendar range + add Today to the day view ([9582025](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/95820256fdbeeabe47fb17b076867f496cd5d567))

## [0.0.2](https://github.com/dsebastien/obsidian-kanban-action-planner/compare/0.0.1...0.0.2) (2026-06-27)

### Features

* **plugin:** configurable first day of the week ([7f0073d](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/7f0073d16b1f7522bf1d5fcf1e8699c0a890ca80))
* **plugin:** zoom into a single day on the calendar ([8fbd671](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/8fbd671908475a8a64d423f555dbb9e3f3f4bacb))

## 0.0.1 (2026-06-27)

### Features

* **plugin:** archiving — move notes to a placeholder folder (M4b, [#7](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/7)) ([923afc7](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/923afc76a58e6878754be625498bb659fdf2e9d1))
* **plugin:** calendar drag-to-schedule and drag-to-clear (M5c/M5d) ([82ba403](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/82ba403c5a552e8c5238b79b1bdc3793e699a10b))
* **plugin:** calendar mode — scheduling panel + grid (M5a/M5b) ([c50c2df](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/c50c2df9769b35a52ef55bbf8a8a165550a7e619))
* **plugin:** configurable card presentation (title, fields, cover, wrapping) ([ebfd74a](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/ebfd74a4ac374c7bc009eaa46e7398ab69dfb002)), closes [3-#6](https://github.com/dsebastien/3-/issues/6)
* **plugin:** configurable swimlanes (M3, [#2](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/2)) ([5b10a63](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/5b10a63c26a975f5fd2e5835ed2e4886f69a29ae))
* **plugin:** core Kanban board with drag/drop and order persistence ([375fb2b](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/375fb2b2f0cab6f68039b4b9089e1eaa54ba6534))
* **plugin:** definition-driven columns + ctrl/cmd-click opens new tab ([d17afcc](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/d17afcc2e908eca40d63fb56c0be8de94b388d3b))
* **plugin:** incremental board refresh + uniform sizing (M6) ([f36a4eb](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/f36a4ebef22b14ef40694596b735e687b957f0bd))
* **plugin:** note-type profiles, Starter Kit mirroring, and colors ([6b0c609](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/6b0c6093d777f957feccc164218500f920953b76))
* **plugin:** open related notes in a new tab on ctrl/cmd-click ([fa41292](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/fa41292c0a49c02a9b4b7293c376128778696fc0))
* **plugin:** place Unmapped column first by default, configurable per view ([1212b15](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/1212b150df15c9bd330e2ff0fcac441cdfa2ca54))
* **plugin:** register Kanban Bases view scaffold and config model ([cc2b722](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/cc2b7228d5d2d21969d09cfe871e6104ad70003e))
* **plugin:** relationships, blocked-by & relational filtering (M4) ([65526a0](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/65526a02d301a1d48904c744fd57d6cb13569e51))
* **plugin:** scheduling-panel sort + filter; M5 docs (M5e) ([4cae2e2](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/4cae2e21f1270d6704c83191412a2b5dfd3d3635)), closes [#tag](https://github.com/dsebastien/obsidian-kanban-action-planner/issues/tag)
* scaffold Kanban Action Planner plugin and add implementation plan ([2c8bf54](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/2c8bf54c12edf4ff250271cf0ee78342d9d9e554))

### Bug Fixes

* **plugin:** match Starter Kit's {{quarter}} placeholder format (Q2, not 2) ([4fde618](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/4fde6185c5956e3f6fd2ca3a9b03e70cf5e16840))
* **plugin:** persist discovered statuses so Show empty columns works ([cf91b81](https://github.com/dsebastien/obsidian-kanban-action-planner/commit/cf91b81a1b0786e35c73f4885882e2dc33564c62))











































