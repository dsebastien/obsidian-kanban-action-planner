import type { TimeBlock } from './time-blocks'
import { MINUTES_PER_DAY, formatMinutes, slotsOf } from './time-blocks'

/**
 * Import and export of the week-planner app's files (issue #172, phase D).
 *
 * The app (github.com/dsebastien/week-planner) keeps one block per
 * `{startDay, daySpan, startTime, duration}` on a 30-minute grid, styled;
 * it exports JSON (`WeekPlannerData { version: '1.0', blocks, config,
 * exportedAt }`) and Markdown (`## Monday` … `## Sunday` sections of
 * `- 09:00 - 10:30: Text` lines, a multi-day block repeated per day with a
 * `(Day x/y)` suffix, and a `block_styles` front matter). Here a block's
 * TEXT names the note it belongs to; styling is the note's contexts' job
 * and is dropped on import.
 *
 * Pure: no Obsidian imports.
 */

/** One block read from the app, before it is matched to a note. */
export interface ImportedBlock {
    /** The block's text, trimmed (the note name to match). */
    text: string
    /** Monday-first day indexes, sorted, unique. */
    days: number[]
    /** Minutes from 00:00 (0..1425). */
    start: number
    /** Minutes from 00:00; `end <= start` crosses midnight (the vault's grammar). */
    end: number
}

export interface ImportResult {
    blocks: ImportedBlock[]
    /** Lines or records that could not be read, with the reason. */
    errors: { entry: string; error: string }[]
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const APP_GRID = 30

/** Normalise an absolute end (may exceed 1440) into the vault's `end` (crossers wrap). */
function wrapEnd(endAbs: number): number {
    return endAbs >= MINUTES_PER_DAY ? endAbs % MINUTES_PER_DAY : endAbs
}

/** Merge blocks with the same text, start and end into one day list. */
function mergeSameTimes(blocks: ImportedBlock[]): ImportedBlock[] {
    const byKey = new Map<string, ImportedBlock>()
    for (const block of blocks) {
        const key = `${block.text}|${block.start}|${block.end}`
        const existing = byKey.get(key)
        if (existing) {
            existing.days = [...new Set([...existing.days, ...block.days])].sort((a, b) => a - b)
        } else {
            byKey.set(key, { ...block, days: [...block.days] })
        }
    }
    return [...byKey.values()]
}

/** Read the app's JSON export. */
export function parseAppJson(text: string): ImportResult {
    const errors: ImportResult['errors'] = []
    let data: unknown
    try {
        data = JSON.parse(text)
    } catch (error) {
        return { blocks: [], errors: [{ entry: 'file', error: `Not JSON: ${String(error)}` }] }
    }
    if (typeof data !== 'object' || data === null) {
        return { blocks: [], errors: [{ entry: 'file', error: 'Not a week-planner export' }] }
    }
    const record = data as Record<string, unknown>
    if (record['version'] !== '1.0') {
        errors.push({ entry: 'version', error: `Unsupported version ${String(record['version'])}` })
    }
    const raw = Array.isArray(record['blocks']) ? record['blocks'] : []
    const blocks: ImportedBlock[] = []
    raw.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) {
            errors.push({ entry: `block ${index + 1}`, error: 'Not an object' })
            return
        }
        const b = item as Record<string, unknown>
        const startTime = Number(b['startTime'])
        const duration = Number(b['duration'])
        const startDay = Number(b['startDay'])
        const daySpan = Number(b['daySpan'] ?? 1)
        const text = typeof b['text'] === 'string' ? b['text'].trim() : ''
        const label = text || `block ${index + 1}`
        if (![startTime, duration, startDay, daySpan].every(Number.isFinite)) {
            errors.push({ entry: label, error: 'Missing start, duration or day' })
            return
        }
        if (text === '') {
            errors.push({
                entry: `block ${index + 1}`,
                error: 'No text (nothing to match a note on)'
            })
            return
        }
        if (startDay < 0 || startDay > 6 || daySpan < 1) {
            errors.push({ entry: label, error: `Day ${startDay} / span ${daySpan} out of range` })
            return
        }
        if (startTime < 0 || startTime >= MINUTES_PER_DAY || duration <= 0) {
            errors.push({
                entry: label,
                error: `Time ${startTime} / duration ${duration} out of range`
            })
            return
        }
        const days: number[] = []
        for (let d = startDay; d < Math.min(7, startDay + daySpan); d++) days.push(d)
        blocks.push({ text, days, start: startTime, end: wrapEnd(startTime + duration) })
    })
    return { blocks: mergeSameTimes(blocks), errors }
}

const TIME_LINE = /^-\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2}):\s*(.+)$/
const DAY_PART = /^(.+?)\s+\(Day\s+(\d+)\/(\d+)\)$/

/** Read the app's Markdown export (front matter ignored, styles dropped). */
export function parseAppMarkdown(text: string): ImportResult {
    const errors: ImportResult['errors'] = []
    const blocks: ImportedBlock[] = []
    let body = text
    if (body.startsWith('---\n')) {
        const close = body.indexOf('\n---', 4)
        if (close >= 0) body = body.slice(close + 4)
    }
    let day = -1
    for (const rawLine of body.split('\n')) {
        const line = rawLine.trim()
        const heading = /^##\s+(.+)$/.exec(line)
        if (heading) {
            const index = DAY_NAMES.indexOf((heading[1] ?? '').trim().toLowerCase())
            day = index
            continue
        }
        if (!line.startsWith('- ')) continue
        if (/^-\s+No events scheduled/i.test(line)) continue
        const match = TIME_LINE.exec(line)
        if (!match) {
            if (day >= 0) errors.push({ entry: line, error: 'Not a `- HH:MM - HH:MM: text` line' })
            continue
        }
        if (day < 0) {
            errors.push({ entry: line, error: 'Outside a day section (## Monday …)' })
            continue
        }
        const start = Number(match[1]) * 60 + Number(match[2])
        let endAbs = Number(match[3]) * 60 + Number(match[4])
        if (endAbs <= start) endAbs += MINUTES_PER_DAY
        let name = (match[5] ?? '').trim()
        const part = DAY_PART.exec(name)
        if (part) name = (part[1] ?? '').trim()
        if (name === '') {
            errors.push({ entry: line, error: 'No text' })
            continue
        }
        blocks.push({ text: name, days: [day], start, end: wrapEnd(endAbs) })
    }
    return { blocks: mergeSameTimes(blocks), errors }
}

/** Read either format, deciding on the content. */
export function parseAppExport(text: string): ImportResult {
    const trimmed = text.trimStart()
    return trimmed.startsWith('{') ? parseAppJson(text) : parseAppMarkdown(text)
}

export interface NoteCandidate {
    path: string
    title: string
}

export interface MatchedImport {
    block: ImportedBlock
    /** The matched note path, or null when nothing matched (ask the user). */
    path: string | null
    how: 'exact' | 'case-insensitive' | 'none'
}

/**
 * Match every imported block's text to a note title: exact first, then
 * case-insensitive (whitespace collapsed); everything else is left for the
 * user to resolve. Titles are compared with and without a trailing
 * ` (Activity)` / ` (Project)` style suffix, so `Running` finds
 * `Running (Activity)`.
 */
export function matchImports(blocks: ImportedBlock[], notes: NoteCandidate[]): MatchedImport[] {
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
    const bare = (s: string): string => s.replace(/\s*\([^()]*\)\s*$/, '')
    const exact = new Map<string, string>()
    const loose = new Map<string, string>()
    for (const note of notes) {
        for (const title of [note.title, bare(note.title)]) {
            if (!exact.has(title)) exact.set(title, note.path)
            const key = norm(title)
            if (!loose.has(key)) loose.set(key, note.path)
        }
    }
    return blocks.map((block) => {
        const direct = exact.get(block.text) ?? exact.get(bare(block.text))
        if (direct) return { block, path: direct, how: 'exact' }
        const relaxed = loose.get(norm(block.text)) ?? loose.get(norm(bare(block.text)))
        if (relaxed) return { block, path: relaxed, how: 'case-insensitive' }
        return { block, path: null, how: 'none' }
    })
}

/** The vault blocks a note gets from its imported blocks (same times merged). */
export function toTimeBlocks(blocks: readonly ImportedBlock[]): TimeBlock[] {
    return mergeSameTimes([...blocks]).map((b) => ({
        days: [...b.days],
        start: b.start,
        end: b.end
    }))
}

// ── Export ──────────────────────────────────────────────────────────

export interface ExportEntry {
    title: string
    blocks: readonly TimeBlock[]
    /** Hex colour for the app's block styling (the first context's colour), or null. */
    color: string | null
}

export interface AppBlock {
    id: string
    startTime: number
    duration: number
    startDay: number
    daySpan: number
    text: string
    color: string
    textColor: string
    fontSize: number
    fontStyle: { bold: boolean; italic: boolean }
    textAlignment: 'left' | 'center' | 'right'
    verticalAlignment: 'top' | 'middle' | 'bottom'
    borderStyle: { width: number; style: 'solid' | 'dashed' | 'dotted'; color: string }
    cornerRadius: number
}

export interface ExportResult {
    blocks: AppBlock[]
    /** Slots whose 15-minute times were rounded to the app's 30-minute grid. */
    rounded: { title: string; from: string; to: string }[]
}

const DEFAULT_COLOR = '#64748b'

/** Round a 15-minute slot outwards to the app's 30-minute grid. */
function roundToApp(start: number, endAbs: number): { start: number; end: number } {
    const s = Math.floor(start / APP_GRID) * APP_GRID
    const e = Math.max(s + APP_GRID, Math.ceil(endAbs / APP_GRID) * APP_GRID)
    return { start: s, end: e }
}

/**
 * The app's blocks for the current ideal week: every note's slots, grouped
 * into one app block per run of consecutive days sharing a time, rounded
 * to 30 minutes (reported). Overnight slots keep their absolute duration.
 */
export function toAppBlocks(entries: readonly ExportEntry[]): ExportResult {
    const out: AppBlock[] = []
    const rounded: ExportResult['rounded'] = []
    let n = 0
    for (const entry of entries) {
        // Group the note's slots by (rounded start, rounded end) → days.
        const runs = new Map<string, { start: number; end: number; days: Set<number> }>()
        for (const slot of slotsOf(entry.blocks)) {
            const endAbs = slot.end <= slot.start ? slot.end + MINUTES_PER_DAY : slot.end
            const r = roundToApp(slot.start, endAbs)
            const from = `${formatMinutes(slot.start)}–${formatMinutes(endAbs % MINUTES_PER_DAY)}`
            const to = `${formatMinutes(r.start)}–${formatMinutes(r.end % MINUTES_PER_DAY)}`
            if (
                (r.start !== slot.start || r.end !== endAbs) &&
                !rounded.some((x) => x.title === entry.title && x.from === from && x.to === to)
            ) {
                rounded.push({ title: entry.title, from, to })
            }
            const key = `${r.start}|${r.end}`
            const run = runs.get(key) ?? { start: r.start, end: r.end, days: new Set<number>() }
            run.days.add(slot.day)
            runs.set(key, run)
        }
        for (const run of runs.values()) {
            const days = [...run.days].sort((a, b) => a - b)
            // Consecutive days become one app block with a daySpan.
            let i = 0
            while (i < days.length) {
                let j = i
                while (j + 1 < days.length && days[j + 1] === (days[j] ?? 0) + 1) j++
                n++
                out.push({
                    id: `block_${String(n)}`,
                    startTime: run.start,
                    duration: run.end - run.start,
                    startDay: days[i] ?? 0,
                    daySpan: j - i + 1,
                    text: entry.title,
                    color: entry.color ?? DEFAULT_COLOR,
                    textColor: '#ffffff',
                    fontSize: 16,
                    fontStyle: { bold: false, italic: false },
                    textAlignment: 'center',
                    verticalAlignment: 'middle',
                    borderStyle: { width: 0, style: 'solid', color: entry.color ?? DEFAULT_COLOR },
                    cornerRadius: 4
                })
                i = j + 1
            }
        }
    }
    out.sort((a, b) => a.startDay - b.startDay || a.startTime - b.startTime)
    return { blocks: out, rounded }
}

/** The app's JSON file for `blocks`. */
export function toAppJson(
    blocks: readonly AppBlock[],
    grid: { startHour: number; endHour: number },
    exportedAt: Date
): string {
    const data = {
        version: '1.0',
        blocks,
        config: {
            startHour: grid.startHour,
            endHour: grid.endHour,
            timeSlotHeight: 30,
            dayWidth: 200,
            headerHeight: 60,
            timeColumnWidth: 120,
            days: DAY_LABELS,
            canvasWidth: 120 + 7 * 200,
            canvasHeight: 60 + (grid.endHour - grid.startHour) * 60
        },
        exportedAt: exportedAt.toISOString()
    }
    return JSON.stringify(data, null, 2)
}

/** The app's Markdown file for `blocks` (front matter with block styles, one section per day). */
export function toAppMarkdown(blocks: readonly AppBlock[], exportedAt: Date): string {
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
    const dateStr = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`
    const lines: string[] = [
        '---',
        `date: "${dateStr}"`,
        `exported_at: "${exportedAt.toISOString()}"`
    ]
    lines.push('block_styles:')
    for (const b of blocks) {
        const dayLabel =
            b.daySpan === 1
                ? `[${DAY_LABELS[b.startDay]}]`
                : `[${DAY_LABELS[b.startDay]} - ${DAY_LABELS[Math.min(6, b.startDay + b.daySpan - 1)]}]`
        const time = `${formatMinutes(b.startTime)} - ${formatMinutes((b.startTime + b.duration) % MINUTES_PER_DAY)}`
        lines.push(`  - time_block: "${dayLabel} ${time}: ${b.text.replace(/"/g, '\\"')}"`)
        lines.push(`    color: "${b.color}"`)
        lines.push(`    text_color: "${b.textColor}"`)
        lines.push(`    font_size: ${b.fontSize}`)
        lines.push('    font_style:')
        lines.push(`      bold: ${b.fontStyle.bold}`)
        lines.push(`      italic: ${b.fontStyle.italic}`)
        lines.push(`    text_alignment: "${b.textAlignment}"`)
        lines.push(`    vertical_alignment: "${b.verticalAlignment}"`)
        lines.push('    border:')
        lines.push(`      width: ${b.borderStyle.width}`)
        lines.push(`      style: "${b.borderStyle.style}"`)
        lines.push(`      color: "${b.borderStyle.color}"`)
        lines.push(`    corner_radius: ${b.cornerRadius}`)
    }
    lines.push('---', '', `# ${dateStr} - Week Planning`, '')
    for (let day = 0; day < 7; day++) {
        lines.push(`## ${DAY_LABELS[day]}`)
        const todays = blocks
            .filter((b) => day >= b.startDay && day < b.startDay + b.daySpan)
            .sort((a, b) => a.startTime - b.startTime)
        if (todays.length === 0) {
            lines.push('- No events scheduled', '')
            continue
        }
        for (const b of todays) {
            const time = `${formatMinutes(b.startTime)} - ${formatMinutes((b.startTime + b.duration) % MINUTES_PER_DAY)}`
            const part = b.daySpan > 1 ? ` (Day ${day - b.startDay + 1}/${b.daySpan})` : ''
            lines.push(`- ${time}: ${b.text}${part}`)
        }
        lines.push('')
    }
    return lines.join('\n')
}
