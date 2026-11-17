### Embedded boards can point at their own note

In a board embedded in a note, `this` as a filter value now means the note the embed is in. Before, the filter had to name the note, so renaming the note emptied the board. Now `this` follows the new name.

Put this in a project note and it shows that project's tasks:

```
![[Actions (Base).base#Kanban: Tasks|mode=board filter=parent:this]]
```

- It works with every relationship (`parent:this`, `child:this`, `ancestor:this`) and with any link property (`project:this`).
- It matches only the whole name: in a note called "Website", `parent:this` never matches a parent called "Website Redesign".
- New cards you create from the embed get linked to the note.
- It finds the note when it's open in a tab, embedded in another note, shown in a hover preview, or placed on a Canvas as a note card.
- A full Base tab or a Canvas text card has no note around the board, so `this` matches nothing there.
- To look for a note really called "this", quote it: `parent:"this"`.

Since `this` never names a note, the same embed works in every note. Put a `filter=parent:this` board in your project template, and a `filter=ancestor:this` board in WBS or calendar mode in your goal template to see everything below a goal.

### The toolbar fits narrow views

The toolbar now follows the width of the view itself (an embed, a split pane, a phone), not the width of the window. When space runs out, controls move into menus instead of squeezing the filter box.

- First, the date-window chips (Today, Next 7 days, Next 30 days) go into a **More** (**⋯**) menu at the right end of the toolbar.
- On narrower views, the icon buttons go there too (select, compact cards, contexts, properties, configure), and only the active mode stays. Its **▾** opens a menu with every mode.
- The match count, clear and help buttons always stay inside the filter box.
- In the **More** menu, a check mark shows what's on. The **More** button turns to the accent color when a control hidden in it is on, so a hidden date window or select mode doesn't go unnoticed.
- In embeds, the toolbar icons are no longer squeezed to half their width.

### The note type check reads the right order property

**Check note types against the Starter Kit** now checks the global **Manual order property**, the one boards write unless a board sets its own in **Configure view**. It used to check a per-note-type copy that boards never used, so after a change of the global setting it could check the wrong property. Boards behave as before.
