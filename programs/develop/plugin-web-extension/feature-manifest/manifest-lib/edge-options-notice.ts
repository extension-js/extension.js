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

// Dev rebuilds the manifest on every save, so the line prints once a process.
let reported = false

export function reportEdgeEmbeddedOptions(
  manifest: Manifest,
  browser: DevOptions['browser']
): void {
  if (reported || !edgeEmbedsOptionsPage(manifest, browser)) return

  reported = true
  humanLine(messages.edgeEmbeddedOptionsDialog())
}

// Tests drive the reporter repeatedly, so they need the latch cleared.
export function resetEdgeOptionsNotice(): void {
  reported = false
}
