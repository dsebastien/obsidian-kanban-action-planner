/**
 * Claiming a pointer gesture from a host that also drags on `pointerdown`.
 *
 * Obsidian Canvas moves the whole node when a `pointerdown` bubbles out of the
 * node's content: `CanvasNode.onPointerdown` starts a selection drag unless the
 * event target is an `<input>`, a `contenteditable`, `.metadata-container`, or
 * `.inline-title` — none of which a Kanban card, column header, calendar chip,
 * WBS row, or timeline bar is. So on a board embedded in a Canvas, grabbing a
 * card dragged the canvas node instead of the card (issue #154).
 *
 * The fix is to stop the event from bubbling at the exact moment one of our
 * drag controllers takes ownership of the gesture. Only that one case is
 * claimed: a `pointerdown` on the board's chrome or background still bubbles,
 * so the canvas node can be moved by dragging the board's empty space as usual.
 *
 * `stopPropagation` (never `stopImmediatePropagation`) is deliberate: every
 * board drag controller binds its own listener to the same `boardEl`, and they
 * must all still see the event. `preventDefault` is deliberately NOT called —
 * that would break focus and the click that opens a note.
 */
export function claimPointerDrag(e: PointerEvent): void {
    e.stopPropagation()
}
