import { Notice, TFile } from 'obsidian'
import { produce } from 'immer'
import {
    isDeletedPath,
    newTrackingCommandId,
    orderPickerPaths,
    renameRecentPaths,
    renameTrackingCommands,
    renamedPath,
    trackingCommandName
} from '../domain/tracking-commands'
import type { TrackingCommand } from '../domain/tracking-commands'
import { TrackingNotePickerModal } from '../ui/tracking-note-picker'
import { startTimeSession } from './time-tracking.service'
import type { KanbanActionPlannerPlugin } from '../plugin'

/**
 * Time-tracking shortcuts (issue #228): per-note commands, the active-note
 * start and the switch picker. Every entry point goes through
 * `startTimeSession`, so switching behaves exactly like the card menu: the
 * running session is stopped and written first, and starting the note already
 * tracked changes nothing.
 */

/** Register the stored per-note commands and keep them in step with the vault. */
export function registerTrackingCommands(plugin: KanbanActionPlannerPlugin): void {
    for (const command of plugin.settings.trackingCommands) addCommandFor(plugin, command)
    plugin.registerEvent(
        plugin.app.vault.on('rename', (file, oldPath) => {
            void followRename(plugin, oldPath, file.path)
        })
    )
    plugin.registerEvent(
        plugin.app.vault.on('delete', (file) => {
            void dropDeleted(plugin, file.path)
        })
    )
}

/** Whether this note has its own tracking command. */
export function hasTrackingCommand(plugin: KanbanActionPlannerPlugin, path: string): boolean {
    return plugin.settings.trackingCommands.some((c) => c.path === path)
}

/** Give a note its own "Start time tracking: <note>" command. */
export async function addTrackingCommand(
    plugin: KanbanActionPlannerPlugin,
    path: string
): Promise<void> {
    if (hasTrackingCommand(plugin, path)) return
    const command = { id: newTrackingCommandId(plugin.settings.trackingCommands), path }
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.trackingCommands.push(command)
    })
    addCommandFor(plugin, command)
    await plugin.saveSettings('chrome')
    new Notice(
        `Shortcut added: ${trackingCommandName(path)}. Bind a hotkey to it in Settings → Hotkeys.`
    )
}

/** Remove a note's tracking command (and with it any hotkey bound to it). */
export async function removeTrackingCommand(
    plugin: KanbanActionPlannerPlugin,
    path: string
): Promise<void> {
    const command = plugin.settings.trackingCommands.find((c) => c.path === path)
    if (!command) return
    plugin.removeCommand(command.id)
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.trackingCommands = draft.trackingCommands.filter((c) => c.id !== command.id)
    })
    await plugin.saveSettings('chrome')
    new Notice(`Shortcut removed: ${trackingCommandName(path)}`)
}

/** Open the "Switch time tracking to…" picker. */
export function openTrackingPicker(plugin: KanbanActionPlannerPlugin): void {
    const files = plugin.app.vault.getMarkdownFiles()
    const byPath = new Map(files.map((f) => [f.path, f]))
    const ordered = orderPickerPaths(
        plugin.settings.recentTrackedPaths,
        plugin.app.workspace.getLastOpenFiles(),
        files.map((f) => f.path)
    ).flatMap((path) => byPath.get(path) ?? [])
    new TrackingNotePickerModal(
        plugin.app,
        ordered,
        plugin.settings.activeTimeSession?.path ?? null,
        (file) => void startTimeSession(plugin, file.path)
    ).open()
}

/** The markdown note open in the editor, or null. */
export function activeNote(plugin: KanbanActionPlannerPlugin): TFile | null {
    const file = plugin.app.workspace.getActiveFile()
    return file instanceof TFile && file.extension === 'md' ? file : null
}

/** Register one per-note command. The path is read at run time, so it follows renames. */
function addCommandFor(plugin: KanbanActionPlannerPlugin, command: TrackingCommand): void {
    plugin.addCommand({
        id: command.id,
        name: trackingCommandName(command.path),
        callback: () => {
            const current = plugin.settings.trackingCommands.find((c) => c.id === command.id)
            if (current) void startTimeSession(plugin, current.path)
        }
    })
}

/**
 * A renamed or moved note (archiving included): its tracking command, its
 * place in the recent list and a session running on it all follow. The
 * command is registered again under the same id so its name shows the new
 * note name while a bound hotkey stays bound.
 */
async function followRename(
    plugin: KanbanActionPlannerPlugin,
    oldPath: string,
    newPath: string
): Promise<void> {
    const commands = renameTrackingCommands(plugin.settings.trackingCommands, oldPath, newPath)
    const recent = renameRecentPaths(plugin.settings.recentTrackedPaths, oldPath, newPath)
    const session = plugin.settings.activeTimeSession
    const sessionPath = session ? renamedPath(session.path, oldPath, newPath) : null
    if (!commands && !recent && sessionPath === null) return
    const before = new Map(plugin.settings.trackingCommands.map((c) => [c.id, c.path]))
    const moved = (commands ?? []).filter((c) => before.get(c.id) !== c.path)
    plugin.settings = produce(plugin.settings, (draft) => {
        if (commands) draft.trackingCommands = commands
        if (recent) draft.recentTrackedPaths = recent
        if (draft.activeTimeSession && sessionPath !== null)
            draft.activeTimeSession.path = sessionPath
    })
    for (const command of moved) {
        plugin.removeCommand(command.id)
        addCommandFor(plugin, command)
    }
    await plugin.saveSettings('chrome')
}

/** A deleted note loses its tracking command and its place in the recent list. */
async function dropDeleted(plugin: KanbanActionPlannerPlugin, path: string): Promise<void> {
    const gone = plugin.settings.trackingCommands.filter((c) => isDeletedPath(c.path, path))
    const recentHit = plugin.settings.recentTrackedPaths.some((p) => isDeletedPath(p, path))
    if (gone.length === 0 && !recentHit) return
    for (const command of gone) plugin.removeCommand(command.id)
    plugin.settings = produce(plugin.settings, (draft) => {
        draft.trackingCommands = draft.trackingCommands.filter((c) => !isDeletedPath(c.path, path))
        draft.recentTrackedPaths = draft.recentTrackedPaths.filter((p) => !isDeletedPath(p, path))
    })
    await plugin.saveSettings('chrome')
}
