import { TFile, moment } from 'obsidian'
import type { App } from 'obsidian'
import type { CardPresentation } from '../domain/profile'
import { getFrontmatterValue } from './frontmatter.service'
import { formatScalar, stripWikiLink } from '../utils/format'
import type { CardDisplay, CardFieldView } from '../ui/board/types'

interface MomentLike {
    isValid(): boolean
    format(format: string): string
}
const parseMoment = moment as unknown as (input?: unknown) => MomentLike

/**
 * Build the presentation data for a card from a profile's card config:
 * the title (note name or a property), the configured body fields (type-aware),
 * an optional cover image, and the wrap setting. The due-date property is shown
 * in red by default when set and not already among the configured fields.
 */
export function buildCardDisplay(
    app: App,
    file: TFile,
    presentation: CardPresentation,
    dueDateProperty: string | null
): CardDisplay {
    const title = resolveTitle(app, file, presentation)
    const fields: CardFieldView[] = []
    const seen = new Set<string>()

    for (const field of presentation.fields) {
        const text = formatValue(getFrontmatterValue(app, file, field.property), field.dateFormat)
        if (!text) continue
        seen.add(field.property.toLowerCase())
        fields.push({
            label: field.showLabel ? field.property : null,
            text,
            emphasis: field.emphasis ?? 'normal'
        })
    }

    if (dueDateProperty && !seen.has(dueDateProperty.toLowerCase())) {
        const dueText = formatValue(getFrontmatterValue(app, file, dueDateProperty), undefined)
        if (dueText) fields.push({ label: null, text: dueText, emphasis: 'due-red' })
    }

    const coverUrl = presentation.coverImageProperty
        ? resolveCover(app, file, getFrontmatterValue(app, file, presentation.coverImageProperty))
        : null

    return { title, fields, coverUrl, wrap: presentation.wrapPropertyValues }
}

function resolveTitle(app: App, file: TFile, presentation: CardPresentation): string {
    if (presentation.titleSource.kind === 'property') {
        const raw = getFrontmatterValue(app, file, presentation.titleSource.property)
        const text = formatScalar(raw)
        if (text) return text
    }
    return file.basename
}

function formatValue(raw: unknown, dateFormat: string | undefined): string {
    if (dateFormat && typeof raw === 'string' && raw.trim() !== '') {
        const m = parseMoment(raw)
        if (m.isValid()) return m.format(dateFormat)
    }
    return formatScalar(raw)
}

function resolveCover(app: App, file: TFile, raw: unknown): string | null {
    const first = Array.isArray(raw) ? raw[0] : raw
    if (typeof first !== 'string' || first.trim() === '') return null
    const value = first.trim()

    if (/^https?:\/\//i.test(value)) return value

    const linkpath = stripWikiLink(value)
    const dest = app.metadataCache.getFirstLinkpathDest(linkpath, file.path)
    if (dest) return app.vault.getResourcePath(dest)

    const byPath = app.vault.getAbstractFileByPath(linkpath)
    if (byPath instanceof TFile) return app.vault.getResourcePath(byPath)

    return null
}
