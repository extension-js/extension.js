// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {humanLine} from '../../../dev-server/lifecycle-stream'
import type {DevOptions, Manifest} from '../../../types'
import * as messages from '../messages'

// Edge hosts an embedded options page in a dialog capped at 400px, which
// leaves the page 368px, and it never sizes the dialog from the page. Chrome
// does, so a settings page that fits on Chrome is clipped on Edge only.
export function edgeEmbedsOptionsPage(
  manifest: Manifest,
  browser: DevOptions['browser']
): boolean {
  if (String(browser) !== 'edge') return false

  const optionsUi = (manifest as {options_ui?: unknown}).options_ui

  if (!optionsUi || typeof optionsUi !== 'object' || Array.isArray(optionsUi)) {
    return false
  }

  const {page, open_in_tab: openInTab} = optionsUi as {
    page?: unknown
    open_in_tab?: unknown
  }

  return typeof page === 'string' && page.length > 0 && openInTab !== true
}

// Dev rebuilds the manifest on every save, so each browser target gets
// the line once a process and a second target is not silenced by the first.
const reportedBrowsers = new Set<string>()

export function reportEdgeEmbeddedOptions(
  manifest: Manifest,
  browser: DevOptions['browser']
): void {
  const target = String(browser)

  if (reportedBrowsers.has(target)) return
  if (!edgeEmbedsOptionsPage(manifest, browser)) return

  reportedBrowsers.add(target)
  humanLine(messages.edgeEmbeddedOptionsDialog())
}

// Tests drive the reporter repeatedly, so they need the latch cleared.
export function resetEdgeOptionsNotice(): void {
  reportedBrowsers.clear()
}
