import { setIcon } from 'obsidian'
import type { CardFieldView } from '../board/types'

/**
 * Focus mode (issue #160): a single-card spotlight rendered as a full-pane
 * overlay on top of whatever mode the view is in. Pure DOM from the passed
 * data — the host view assembles the data and owns every write (timer,
 * done-state, advancing), so focus rides the exact same write paths as the
 * board (automations fire once, from any path, as usual).
 */

/** One child note shown in the Subtasks section. */
export interface FocusSubtask {
    key: string
    title: string
    /** Done per its type's done definition (checked style). */
    done: boolean
}

/** One related-notes group (parent / blocked by / sibling). */
export interface FocusRelatedGroup {
    label: string
    icon: string
    items: Array<{ key: string; label: string }>
}

/** Everything needed to render the focused card. */
export interface FocusCardData {
    title: string
    statusLabel: string | null
    /** Read-only property fields, straight from the card display. */
    fields: CardFieldView[]
    subtasks: FocusSubtask[]
    related: FocusRelatedGroup[]
    /** Whether the global time-tracking session tracks THIS card. */
    tracking: boolean
    /** Total tracked time (live session included), formatted; null = none. */
    trackedLabel: string | null
    /** The card's estimate, formatted; null = unset. */
    estimateLabel: string | null
    /** Whether a done state is configured and the card is not done yet. */
    canMarkDone: boolean
    /** 1-based position in the view's current (filtered) card order. */
    position: number
    total: number
}

export interface FocusCallbacks {
    onExit(): void
    onOpen(newTab: boolean): void
    /** Advance to the next card in the same queue (wraps around). */
    onNext(): void
    /** Mark the card done (its type's done definition) and advance. */
    onDone(): void
    /** Start/stop the time-tracking session for this card (issue #119). */
    onToggleTimer(): void
    onOpenNote(key: string, newTab: boolean): void
    /** Open the full card menu (right-click anywhere on the overlay). */
    onMenu(event: MouseEvent): void
}

/** The CSS class the timer label carries — the host updates it in place. */
export const FOCUS_TIMER_LABEL_CLASS = 'kap-focus-timer-label'

/** Remove the focus overlay from `host` (exit / card gone). */
export function removeFocusView(host: HTMLElement): void {
    host.querySelector(':scope > .kap-focus')?.remove()
    host.removeClass('kap-focus-open')
}

/**
 * Render (or fully re-render) the focus overlay inside `host`. Keyboard:
 * Esc exits, → advances, D marks done, T toggles the timer, O opens the note.
 */
export function renderFocusView(
    host: HTMLElement,
    data: FocusCardData,
    callbacks: FocusCallbacks
): void {
    host.querySelector(':scope > .kap-focus')?.remove()
    host.addClass('kap-focus-open')
    const root = host.createDiv({ cls: 'kap-focus', attr: { tabindex: '-1' } })

    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault()
            callbacks.onExit()
        } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            callbacks.onNext()
        } else if (e.key === 'd' || e.key === 'D') {
            if (data.canMarkDone) callbacks.onDone()
        } else if (e.key === 't' || e.key === 'T') {
            callbacks.onToggleTimer()
        } else if (e.key === 'o' || e.key === 'O') {
            callbacks.onOpen(e.ctrlKey || e.metaKey)
        }
    })
    root.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        callbacks.onMenu(e)
    })

    // Header: position + exit.
    const header = root.createDiv({ cls: 'kap-focus-header' })
    header.createSpan({
        cls: 'kap-focus-count',
        text: `${String(data.position)} / ${String(data.total)}`
    })
    header.createSpan({ cls: 'kap-focus-mode-label', text: 'Focus' })
    const exit = header.createEl('button', {
        cls: 'kap-triage-icon-btn',
        attr: { 'aria-label': 'Exit focus (Esc)', 'title': 'Exit focus (Esc)' }
    })
    setIcon(exit, 'x')
    exit.addEventListener('click', () => callbacks.onExit())

    const body = root.createDiv({ cls: 'kap-focus-body' })
    const card = body.createDiv({ cls: 'kap-focus-card' })

    // Title row + status + open.
    const titleRow = card.createDiv({ cls: 'kap-focus-title-row' })
    titleRow.createEl('h2', { cls: 'kap-focus-title', text: data.title })
    if (data.statusLabel) {
        titleRow.createSpan({ cls: 'kap-focus-status', text: data.statusLabel })
    }
    const open = titleRow.createEl('button', {
        cls: 'kap-triage-open',
        attr: { 'aria-label': 'Open note (O)', 'title': 'Open note (O)' }
    })
    setIcon(open.createSpan({ cls: 'kap-triage-open-icon' }), 'square-arrow-out-up-right')
    open.createSpan({ text: 'Open' })
    open.addEventListener('click', (e) => callbacks.onOpen(e.ctrlKey || e.metaKey))

    // Timer block (issue #119 surface): tracked vs estimate + start/stop.
    const timer = card.createDiv({ cls: 'kap-focus-timer' })
    const timerBtn = timer.createEl('button', {
        cls: data.tracking ? 'kap-focus-timer-btn kap-focus-timer-on' : 'kap-focus-timer-btn',
        attr: {
            'aria-label': data.tracking ? 'Stop timer (T)' : 'Start timer (T)',
            'title': data.tracking ? 'Stop timer (T)' : 'Start timer (T)'
        }
    })
    setIcon(timerBtn.createSpan({ cls: 'kap-focus-timer-icon' }), data.tracking ? 'pause' : 'play')
    timerBtn.createSpan({ text: data.tracking ? 'Stop' : 'Start' })
    timerBtn.addEventListener('click', () => callbacks.onToggleTimer())
    timer.createSpan({
        cls: FOCUS_TIMER_LABEL_CLASS,
        text: formatTimerText(data.trackedLabel, data.estimateLabel)
    })

    // Read-only property fields (the card's configured display fields).
    if (data.fields.length > 0) {
        const ctx = card.createDiv({ cls: 'kap-triage-context' })
        for (const field of data.fields) {
            const chip = ctx.createDiv({ cls: 'kap-triage-context-field' })
            if (field.label) {
                chip.createSpan({ cls: 'kap-triage-context-label', text: `${field.label}: ` })
            }
            if (field.progress !== null) {
                const bar = chip.createDiv({ cls: 'kap-card-progress' })
                bar.createDiv({ cls: 'kap-card-progress-fill' }).style.width =
                    `${String(field.progress)}%`
            }
            chip.createSpan({ cls: 'kap-triage-context-value', text: field.text })
        }
    }

    // Subtasks (children), done ones checked off.
    if (data.subtasks.length > 0) {
        const section = card.createDiv({ cls: 'kap-focus-section' })
        section.createDiv({ cls: 'kap-focus-section-title', text: 'Subtasks' })
        for (const sub of data.subtasks) {
            const row = section.createEl('button', {
                cls: sub.done ? 'kap-focus-subtask kap-focus-subtask-done' : 'kap-focus-subtask',
                attr: { type: 'button', title: sub.title }
            })
            setIcon(
                row.createSpan({ cls: 'kap-focus-subtask-icon' }),
                sub.done ? 'check-circle-2' : 'circle'
            )
            row.createSpan({ text: sub.title })
            row.addEventListener('click', (e) =>
                callbacks.onOpenNote(sub.key, e.ctrlKey || e.metaKey)
            )
        }
    }

    // Related notes (parent / blocked by / sibling).
    if (data.related.length > 0) {
        const section = card.createDiv({ cls: 'kap-focus-section' })
        section.createDiv({ cls: 'kap-focus-section-title', text: 'Related' })
        for (const group of data.related) {
            for (const item of group.items) {
                const row = section.createEl('button', {
                    cls: 'kap-focus-related',
                    attr: { type: 'button', title: `${group.label}: ${item.label}` }
                })
                setIcon(row.createSpan({ cls: 'kap-focus-subtask-icon' }), group.icon)
                row.createSpan({ cls: 'kap-focus-related-role', text: `${group.label}: ` })
                row.createSpan({ text: item.label })
                row.addEventListener('click', (e) =>
                    callbacks.onOpenNote(item.key, e.ctrlKey || e.metaKey)
                )
            }
        }
    }

    // Sticky action column: Done (when a done state applies) + Next.
    const actions = body.createDiv({ cls: 'kap-focus-actions' })
    if (data.canMarkDone) {
        const done = actions.createEl('button', {
            cls: 'kap-triage-next',
            attr: { title: 'Mark done and advance (D)' }
        })
        setIcon(done.createSpan({ cls: 'kap-triage-action-icon' }), 'check')
        done.createSpan({ text: 'Done' })
        done.addEventListener('click', () => callbacks.onDone())
    }
    const next = actions.createEl('button', {
        cls: 'kap-triage-skip',
        attr: { title: 'Next card (→)' }
    })
    setIcon(next.createSpan({ cls: 'kap-triage-action-icon' }), 'arrow-right')
    next.createSpan({ text: 'Next' })
    next.addEventListener('click', () => callbacks.onNext())
    actions.createDiv({
        cls: 'kap-focus-hints',
        text: 'Esc exit · → next · D done · T timer · O open'
    })

    root.focus({ preventScroll: true })
}

/** Update just the timer label in an already-rendered overlay (1s tick). */
export function updateFocusTimerLabel(
    host: HTMLElement,
    trackedLabel: string | null,
    estimateLabel: string | null
): void {
    const el = host.querySelector<HTMLElement>(`.${FOCUS_TIMER_LABEL_CLASS}`)
    if (el) el.setText(formatTimerText(trackedLabel, estimateLabel))
}

/** "1h 30m tracked · est 2d" / "est 2d" / "Nothing tracked yet". */
export function formatTimerText(trackedLabel: string | null, estimateLabel: string | null): string {
    const parts: string[] = []
    if (trackedLabel) parts.push(`${trackedLabel} tracked`)
    if (estimateLabel) parts.push(`est ${estimateLabel}`)
    return parts.length > 0 ? parts.join(' · ') : 'Nothing tracked yet'
}
