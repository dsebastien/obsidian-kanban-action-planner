import type { LowerChoice, TrackedTimeDecision } from '../domain/tracked-time-decision'

/** What a Keep / Drop wrote. */
export interface DecisionApplied {
    /** The stored minutes afterwards (null when nothing was decided after all). */
    minutes: number | null
    /** Minutes kept as a "Manual adjustment" entry (0 for a drop). */
    adjusted: number
}

/** One note (or one rollup) whose stored time is above the computed one. */
export interface TrackedTimeDecisionRow {
    /** Shown as the row name. */
    title: string
    decision: TrackedTimeDecision
    /** Write the user's choice (planned again from the note at that moment). */
    apply: (choice: LowerChoice) => Promise<DecisionApplied>
    /** The row's current numbers; null when there is nothing to decide any more. */
    refresh: () => Promise<TrackedTimeDecision | null>
}

export type DecisionRowStatus = 'open' | 'busy' | 'done' | 'resolved' | 'failed'

/** One row's live state in the dialog. */
export interface DecisionRowState {
    readonly row: TrackedTimeDecisionRow
    status: DecisionRowStatus
    /** The numbers shown while the row is open (refreshed after each choice). */
    decision: TrackedTimeDecision
    /** What was written, once decided. */
    message: string | null
}

/**
 * The Keep / Drop dialog's logic (business rule 79), without DOM: each choice
 * is written at once and its row shows what was written; the other open rows
 * are refreshed (a row whose difference is gone is closed as resolved).
 * "Keep all" / "Drop all" answer every row still open. Nothing is written for
 * a row the user never answered.
 */
export class TrackedTimeDecisionSession {
    readonly states: DecisionRowState[]
    private readonly format: (minutes: number) => string
    private readonly onChange: () => void

    constructor(
        rows: readonly TrackedTimeDecisionRow[],
        format: (minutes: number) => string,
        onChange: () => void
    ) {
        this.states = rows.map((row) => ({
            row,
            status: 'open',
            decision: row.decision,
            message: null
        }))
        this.format = format
        this.onChange = onChange
    }

    /** The rows still waiting for a choice. */
    get openCount(): number {
        return this.states.filter((s) => s.status === 'open' || s.status === 'busy').length
    }

    /** Write one row's choice, show what was written, refresh the other open rows. */
    async decide(index: number, choice: LowerChoice): Promise<void> {
        const state = this.states[index]
        if (!state || state.status !== 'open') return
        state.status = 'busy'
        this.onChange()
        try {
            const applied = await state.row.apply(choice)
            state.status = 'done'
            state.message =
                applied.minutes === null
                    ? 'Nothing to decide any more'
                    : choice === 'keep'
                      ? `Kept ${this.format(applied.minutes)}: ${this.format(applied.adjusted)} added as a manual adjustment`
                      : `Set to ${this.format(applied.minutes)}`
        } catch {
            state.status = 'failed'
            state.message = 'Not saved: the note could not be written'
        }
        await this.refreshOpen()
        this.onChange()
    }

    /** Answer every open row, one after the other. */
    async decideAll(choice: LowerChoice): Promise<void> {
        for (let i = 0; i < this.states.length; i++) await this.decide(i, choice)
    }

    /** Re-read the numbers of the rows still open. */
    private async refreshOpen(): Promise<void> {
        for (const state of this.states) {
            if (state.status !== 'open') continue
            const current = await state.row.refresh()
            if (current) {
                state.decision = current
            } else {
                state.status = 'resolved'
                state.message = 'Nothing to decide any more'
            }
        }
    }
}
