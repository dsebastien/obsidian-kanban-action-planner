import { getLinkpath, MarkdownView, TFile } from 'obsidian'
import type { App } from 'obsidian'

/**
 * Finds the note that holds an embedded view (issue #239): `this` in an
 * embed filter names it. A board can sit in five places:
 *
 * 1. A note open in a tab: the markdown view that contains the embed.
 * 2. A note embedded in another note (`![[Project]]`): the inner note, named
 *    by the `src` attribute of its `.internal-embed.markdown-embed` wrapper,
 *    resolved against the note around it.
 * 3. A hover preview: the note the hovered link points to. Popovers keep no
 *    public link back to their note, so {@link HoverHostTracker} records each
 *    `hover-link` event and finds the popover that contains the board.
 * 4. A Canvas file card: the card's note, from the canvas node map (internal
 *    API, read defensively; anything unexpected gives no host).
 * 5. Anywhere else (a canvas text card, a `.base` card): no host.
 *
 * The result is a TFile: Obsidian renames a file in place, so the caller
 * sees the new name without asking again.
 */

/**
 * What the tracker needs of a `HoverParent`: the popover it owns now, if any,
 * and that popover's element. Obsidian's HoverParent fits this shape.
 */
export interface PopoverOwner {
    hoverPopover: { hoverEl: { contains(node: Node | null): boolean } } | null
}

/** Resolves a link path from a source note, like `getFirstLinkpathDest`. */
export type LinkResolver = (linkpath: string, sourcePath: string) => TFile | null

/** One `hover-link` event: who owns the popover and the note it shows. */
interface HoverRecord {
    parent: PopoverOwner
    file: TFile
}

/** How many recent hovers to keep; only an open popover can hold a board. */
const MAX_HOVER_RECORDS = 20

/**
 * Remembers the note behind each recent hover popover. Fed from the
 * workspace's `hover-link` event, which carries the link text, the source
 * path and the {@link HoverParent} that will own the popover.
 */
export class HoverHostTracker {
    private records: HoverRecord[] = []

    constructor(private readonly resolve: LinkResolver) {}

    /** Record one `hover-link` event payload (ignored when malformed). */
    record(data: unknown): void {
        if (typeof data !== 'object' || data === null) return
        const { hoverParent, linktext, sourcePath } = data as Record<string, unknown>
        if (typeof hoverParent !== 'object' || hoverParent === null) return
        if (typeof linktext !== 'string' || linktext.length === 0) return
        const file = this.resolve(
            getLinkpath(linktext),
            typeof sourcePath === 'string' ? sourcePath : ''
        )
        if (!file) return
        const parent = hoverParent as PopoverOwner
        this.records = [...this.records.filter((r) => r.parent !== parent), { parent, file }].slice(
            -MAX_HOVER_RECORDS
        )
    }

    /** The note shown by the open popover that contains `el`, or null. */
    hostFor(el: Element): TFile | null {
        for (let i = this.records.length - 1; i >= 0; i--) {
            const record = this.records[i]
            if (record?.parent.hoverPopover?.hoverEl.contains(el)) return record.file
        }
        return null
    }
}

/** The note that holds the embed `wrapper`, or null (see the module comment). */
export function findEmbedHost(app: App, wrapper: Element, hovers: HoverHostTracker): TFile | null {
    // 2. Transclusion: the closest markdown embed AROUND the wrapper.
    const outerEmbed = wrapper.parentElement?.closest('.internal-embed.markdown-embed')
    if (outerEmbed) {
        const src = outerEmbed.getAttribute('src')
        if (src) {
            const around = findEmbedHost(app, outerEmbed, hovers)
            const file = app.metadataCache.getFirstLinkpathDest(
                getLinkpath(src),
                around?.path ?? ''
            )
            if (file) return file
        }
    }
    // 3. Hover preview.
    if (wrapper.closest('.hover-popover')) return hovers.hostFor(wrapper)
    // 4. Canvas file card; 1. a note tab.
    let host: TFile | null = null
    app.workspace.iterateAllLeaves((leaf) => {
        if (host !== null || !leaf.view.containerEl.contains(wrapper)) return
        if (leaf.view instanceof MarkdownView) host = leaf.view.file
        else if (leaf.view.getViewType() === 'canvas') host = canvasCardFile(leaf.view, wrapper)
    })
    return host
}

/** Shape of the (internal) canvas node map, read defensively. */
interface CanvasLike {
    canvas?: { nodes?: Map<string, { nodeEl?: unknown; file?: unknown }> }
}

/** The markdown note of the canvas file card that contains `el`, or null. */
function canvasCardFile(view: unknown, el: Element): TFile | null {
    const nodes = (view as CanvasLike).canvas?.nodes
    if (!(nodes instanceof Map)) return null
    for (const node of nodes.values()) {
        const nodeEl = node.nodeEl
        if (!(nodeEl instanceof Node) || !nodeEl.contains(el)) continue
        const file = node.file
        return file instanceof TFile && file.extension === 'md' ? file : null
    }
    return null
}
