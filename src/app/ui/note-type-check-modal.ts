import { Modal } from 'obsidian'
import type { App } from 'obsidian'
import type { NoteTypeCheckReport } from '../services/note-type-check.service'
import { describeFinding } from '../services/note-type-check.service'

/**
 * Shows the read-only "Check note types against the Starter Kit" report
 * (issue #232): per type, the properties the planner uses that the Starter
 * Kit type does not declare or declares with another type.
 */
export class NoteTypeCheckModal extends Modal {
    constructor(
        app: App,
        private readonly report: NoteTypeCheckReport
    ) {
        super(app)
    }

    override onOpen(): void {
        this.titleEl.setText('Note types against the Starter Kit')
        const root = this.contentEl.createDiv({ cls: 'kap-root kap-type-check' })
        const report = this.report
        if (report.kind === 'unavailable') {
            root.createEl('p', { text: 'The Obsidian Starter Kit plugin is not enabled.' })
            return
        }
        if (report.kind === 'no-global-properties') {
            root.createEl('p', {
                text: 'This Starter Kit version does not list its global properties. Update it to run the check.'
            })
            return
        }
        const withFindings = report.types.filter((t) => t.findings.length > 0)
        const clean = report.types.length - withFindings.length
        root.createEl('p', {
            text:
                withFindings.length === 0
                    ? `All ${String(report.types.length)} note types declare every property the planner uses for them.`
                    : `${String(withFindings.length)} of ${String(report.types.length)} note types use a property their Starter Kit type does not declare, or declares with another type (${String(clean)} match). Only the features a type uses are checked: dates when its calendar is on or it names a date property, tracking when it has a Time tracking setting, the week planner when it has time blocks, its relationship links, and so on. The planner does not write an undeclared property on a Starter Kit type: the action is hidden or skipped with a notice (time tracking only warns).`
        })
        for (const type of withFindings) {
            const section = root.createDiv({ cls: 'kap-type-check-type' })
            section.createEl('h4', {
                text: type.configured ? type.name : `${type.name} (not configured yet, defaults)`
            })
            const list = section.createEl('ul')
            for (const finding of type.findings)
                list.createEl('li', { text: describeFinding(finding) })
        }
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
