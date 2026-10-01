# Mobile-first

Epic: #194 (closed when phases 1–2 shipped). Business rule 12 / 12a.

## Shipped (phases 1–2)

- Platform hooks: `.kap-mobile` / `.kap-phone` / `.kap-tablet` on `.kap-root` from Obsidian's
  `Platform` (`ui/platform.ts`).
- Board touch drag = long press (`dnd-controller.ts`, `LONG_PRESS_MS`); cards
  `touch-action: pan-x pan-y`; lift without moving = card menu; native long-press menu swallowed.
- Edge auto-scroll while dragging a card (`ui/board/auto-scroll.ts`); snapping suspended.
- Phone: one column at a time (board-wide columns, snap) + column switcher chips
  (`ui/board/column-switcher.ts`, board mode only).
- Finger-sized targets: board icon/mode buttons ≥ 36px; week/timeline resize handles always
  faintly visible, finger-wide zones (`SIDE_EDGE_TOUCH_PX`, `BAR_HANDLES_MIN_PX_MOBILE`).
- Mobile posture: no ideal-week print (command hidden); file import relies on the OS picker,
  paste always works.

## Remaining (one issue each)

- #210 Ideal week on phones: day/3-day pager, long-press block move, zoom, targets table.
- #211 Timeline: long-press bar drag, pinch/zoom control.
- #212 WBS: drill-down list, long-press re-parent.
- #213 Calendar: long-press chip drag, phone layout.
- #214 Touch multi-select: selection mode instead of marquee.
- #215 Thumb-reachable controls: bottom bar, bottom-sheet card menu.
- #216 Performance on phones: keyboard-open renders, virtualization (#111).
- #217 Board follow-ups: long-press column reorder, lane sync, device validation.

## Approach for the remaining modes

- Reuse the board idiom: long press to pick up, swipes scroll, lift = menu, edge auto-scroll.
- Branch drag controllers on `pointerType`; don't rewrite them.
- Key layouts off the platform classes; width queries for finer breakpoints only.
