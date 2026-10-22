// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as parse5utilities from 'parse5-utilities'
import {isChromiumBasedBrowser} from '../../../lib/constants'
import type {Manifest} from '../../../types'
import {OPTIONS_HTML_FEATURE} from '../../shared/html-surfaces'

// Chrome opens the embedded options_ui dialog on the page's first non-empty
// layout and stops drawing a guest shorter than 8px, so an empty first paint
// never opens it and a 1px one never grows. 32px keeps both out of reach.
export const OPTIONS_DIALOG_FLOOR_PX = 32
export const OPTIONS_DIALOG_FLOOR_MARK = 'options-dialog-floor'
export const OPTIONS_DIALOG_FLOOR_CSS = `html{min-height:${OPTIONS_DIALOG_FLOOR_PX}px}`

// Only the page Chromium embeds in chrome://extensions needs the floor: a
// legacy options_page or open_in_tab opens a tab, and Gecko sizes its own.
export function needsOptionsDialogFloor(
  manifest: Manifest | undefined,
  browser: string | undefined,
  feature: string
): boolean {
  if (feature !== OPTIONS_HTML_FEATURE) return false
  if (!isChromiumBasedBrowser(String(browser || ''))) return false

  const optionsUi = (
    manifest as
      | {options_ui?: {page?: unknown; open_in_tab?: unknown}}
      | undefined
  )?.options_ui
  const page = optionsUi?.page

  if (typeof page !== 'string' || !page.trim()) return false

  return optionsUi?.open_in_tab !== true
}

// First in <head>, so every author stylesheet comes later and wins.
export function injectOptionsDialogFloor(
  headNode: Parameters<typeof parse5utilities.prepend>[0]
): void {
  const styleTag = parse5utilities.createNode('style')
  styleTag.attrs = [
    {name: 'data-extension-js', value: OPTIONS_DIALOG_FLOOR_MARK}
  ]

  parse5utilities.setText(styleTag, OPTIONS_DIALOG_FLOOR_CSS)
  parse5utilities.prepend(headNode, styleTag)
}
