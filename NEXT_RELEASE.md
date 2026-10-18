### Single-link relationship properties

Some notes link to their parent through one text property rather than a list: a season's
`show: "[[My Show]]"`, a comic album's `series`, a board game expansion's `base_game`. The
plugin now keeps those as a single link. **Set parent…**, dragging in the WBS and **Add card**
on a board filtered with `parent:"My Show"` write the one wikilink (replacing the previous
parent when there is one), and removing it clears the property. A season now shows up under its
show in the WBS, and the show lists its seasons, even though the show stores nothing.

The Starter Kit tells the plugin which properties are single-link; for relationships you set up
in the plugin, a property that Obsidian types as Text is treated the same way.
