// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../lib/messaging'

// Printed in place of the plain reloading line when a save touched a content
// script the dev manifest keeps static, since that reload costs page state.
export function reloadingExtensionForStaticContentScript(label: string) {
  return (
    `${prefix('info')} Reloading the extension for ${label}: a ` +
    `${colors.blue('document_start')} content script is read once when the ` +
    'extension loads, so the pages it matches reload too.'
  )
}

// Printed in place of the plain reloading line when the edit only ran
// files the background had injected again, since no page reloads for it.
export function ranInjectedFilesAgain(files: string[], tabs: number) {
  const shown = files.slice(0, 2).join(', ')
  const extra = files.length > 2 ? ` +${files.length - 2} more` : ''

  return (
    `${prefix('info')} Ran ${shown}${extra} again in ${tabs} open ` +
    `${tabs === 1 ? 'tab' : 'tabs'}, with no page reload.`
  )
}

export function backgroundIsRequiredMessageOnly(backgroundChunkName: string) {
  return (
    `Check the ${colors.blue(backgroundChunkName.replace('/', '.'))} ` +
    `field in your ${colors.blue('manifest.json')} file.`
  )
}

// A declared entry that starts itself at import cannot be cleaned up, so
// each re-inject adds a copy. Said in the session, where it bites.
export function contentScriptWithoutDefaultExport(
  file: string,
  oldCopyOutlivesReload: boolean
) {
  // Chromium leaves the copy from before a whole-extension reload alive in
  // the tab with a dead runtime. Firefox drops that copy's world.
  const afterWholeReload = oldCopyOutlivesReload
    ? 'On Chromium a whole-extension reload leaves the old copy running in the open tab beside the new one, timers and listeners included, and no cleanup runs for it. Reload the tab to end it, or have long-lived work stop once chrome.runtime.id is gone. What it added to the page stays too, so mount that under an element with data-extension-root and the next copy removes it.'
    : "A whole-extension reload discards the old copy's code, so no cleanup runs for it and what it added to the page stays. Mount that under an element with data-extension-root and the next copy removes it."

  return (
    `${prefix('warn')} ${colors.yellow(file)} has no default export, so each re-inject in this dev session runs it again and the copy before it keeps running.\n` +
    `Export a default function that mounts the script and returns a cleanup, and Extension.js calls that cleanup before the next copy starts.\n` +
    afterWholeReload
  )
}

// The runtime cannot see a call the script makes to its own function, so
// the extra run is said here, in the session where its leftovers show.
export function defaultExportCalledAgain(file: string, name: string) {
  return (
    `${prefix('warn')} ${colors.yellow(file)} calls ${name}() itself, and Extension.js also runs the default export once the page is ready, so ${name} runs more than once.\n` +
    `Only the run Extension.js starts has its cleanup called before the next copy in this dev session, so what the other run adds stays on the page.\n` +
    `Remove the call if one run is what you want. Keep it if another run is intended, for example on a navigation event.`
  )
}

// The reload kind then comes from file names, which can pick a wider reload.
export function debugSourceIndexUnreadable(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error)

  return `${prefix('debug')} reload  could not read which bundle holds each file (${reason}), so the reload kind comes from file names`
}

// A page edit the dev client applies in the open page, so nothing reloads.
export function updatedPage(label: string) {
  return `${prefix('info')} Updated ${label}.`
}
