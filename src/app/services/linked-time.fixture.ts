import { TFile } from 'obsidian'
import type { CachedMetadata, FrontmatterLinkCache } from 'obsidian'
import type { LinkedTimeApp } from './linked-time.service'

/**
 * A tiny in-memory vault for the linked-time specs: notes by path with their
 * frontmatter; frontmatter wikilinks are derived the way Obsidian lists them
 * (`prop` / `prop.<i>` keys, the alias dropped from `link`), and link paths
 * resolve by basename or full path.
 */
export interface FakeVault {
    app: LinkedTimeApp
    files: Map<string, TFile>
    frontmatter: Map<string, Record<string, unknown>>
    file(path: string): TFile
    set(path: string, fm: Record<string, unknown>): TFile
    delete(path: string): void
}

function linksOf(fm: Record<string, unknown>): FrontmatterLinkCache[] {
    const links: FrontmatterLinkCache[] = []
    const add = (key: string, value: unknown): void => {
        if (typeof value !== 'string') return
        const match = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(value.trim())
        const link = match?.[1]
        if (link === undefined) return
        links.push({ key, link, original: value, displayText: match?.[2] ?? link })
    }
    for (const [key, value] of Object.entries(fm)) {
        if (Array.isArray(value)) value.forEach((item, i) => add(`${key}.${i}`, item))
        else add(key, value)
    }
    return links
}

export function fakeVault(notes: Record<string, Record<string, unknown>> = {}): FakeVault {
    const files = new Map<string, TFile>()
    const frontmatter = new Map<string, Record<string, unknown>>()
    const set = (path: string, fm: Record<string, unknown>): TFile => {
        const name = path.split('/').pop() ?? path
        const file =
            files.get(path) ??
            Object.assign(new TFile(), {
                path,
                name,
                basename: name.replace(/\.md$/, ''),
                extension: 'md'
            })
        files.set(path, file)
        frontmatter.set(path, fm)
        return file
    }
    for (const [path, fm] of Object.entries(notes)) set(path, fm)
    const app: LinkedTimeApp = {
        vault: {
            getMarkdownFiles: () => [...files.values()],
            getFileByPath: (path: string) => files.get(path) ?? null
        },
        metadataCache: {
            getFileCache: (file: TFile): CachedMetadata | null => {
                const fm = frontmatter.get(file.path)
                if (!fm) return null
                return { frontmatter: fm, frontmatterLinks: linksOf(fm) }
            },
            getFirstLinkpathDest: (linkpath: string, _source: string): TFile | null => {
                for (const file of files.values()) {
                    if (file.path === linkpath || file.path === `${linkpath}.md`) return file
                    if (file.basename === linkpath) return file
                }
                return null
            }
        }
    }
    return {
        app,
        files,
        frontmatter,
        set,
        file: (path) => {
            const file = files.get(path)
            if (!file) throw new Error(`no note ${path}`)
            return file
        },
        delete: (path) => {
            files.delete(path)
            frontmatter.delete(path)
        }
    }
}
