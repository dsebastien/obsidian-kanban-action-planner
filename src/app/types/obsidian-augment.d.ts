import 'obsidian'

/**
 * Type augmentation for menu submenus.
 *
 * `MenuItem.setSubmenu()` ships in Obsidian's runtime (and is relied on by the
 * card "Show fields" menu) but is absent from the published `obsidian` types.
 * Declared here so it is strongly typed instead of cast through `any`. Safe given
 * the manifest's `minAppVersion` is well past the version that introduced it.
 */
declare module 'obsidian' {
    interface MenuItem {
        /** Create and return a nested submenu attached to this item. */
        // eslint-disable-next-line no-undef -- `Menu` is the obsidian class being augmented in this same module; the non-type-aware no-undef rule can't see it.
        setSubmenu(): Menu
    }
}
