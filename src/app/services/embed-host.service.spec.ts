import { describe, expect, test } from 'bun:test'
import { TFile } from 'obsidian'
import { HoverHostTracker } from './embed-host.service'
import type { LinkResolver, PopoverOwner } from './embed-host.service'

function file(path: string): TFile {
    const basename = path.replace(/^.*\//, '').replace(/\.md$/, '')
    return Object.assign(new TFile(), { path, basename })
}

/** A resolver that knows the given files by basename. */
function resolverFor(files: TFile[]): LinkResolver {
    return (linkpath) => files.find((f) => f.basename === linkpath) ?? null
}

/** A popover owner whose popover element contains exactly `inside`. */
function ownerHolding(inside: Node): PopoverOwner {
    return { hoverPopover: { hoverEl: { contains: (node) => node === inside } } }
}

const board = Object.create(null) as Node
const elsewhere = Object.create(null) as Node

describe('HoverHostTracker', () => {
    const project = file('Projects/Website (Project).md')

    test('finds the note of the popover that contains the board', () => {
        const tracker = new HoverHostTracker(resolverFor([project]))
        tracker.record({
            hoverParent: ownerHolding(board),
            linktext: 'Website (Project)#Tasks',
            sourcePath: 'Daily.md'
        })
        expect(tracker.hostFor(board as Element)).toBe(project)
        expect(tracker.hostFor(elsewhere as Element)).toBeNull()
    })

    test('the latest hover of a parent wins', () => {
        const other = file('Other.md')
        const tracker = new HoverHostTracker(resolverFor([project, other]))
        const owner = ownerHolding(board)
        tracker.record({ hoverParent: owner, linktext: 'Website (Project)', sourcePath: '' })
        tracker.record({ hoverParent: owner, linktext: 'Other', sourcePath: '' })
        expect(tracker.hostFor(board as Element)).toBe(other)
    })

    test('ignores malformed events and unresolved links', () => {
        const tracker = new HoverHostTracker(resolverFor([project]))
        tracker.record(null)
        tracker.record({ linktext: 'Website (Project)' })
        tracker.record({ hoverParent: ownerHolding(board), linktext: 'Missing' })
        tracker.record({ hoverParent: ownerHolding(board), linktext: '' })
        expect(tracker.hostFor(board as Element)).toBeNull()
    })

    test('a closed popover gives no host', () => {
        const tracker = new HoverHostTracker(resolverFor([project]))
        const owner = ownerHolding(board)
        tracker.record({ hoverParent: owner, linktext: 'Website (Project)' })
        owner.hoverPopover = null
        expect(tracker.hostFor(board as Element)).toBeNull()
    })
})
