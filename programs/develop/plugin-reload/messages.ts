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

export function backgroundIsRequiredMessageOnly(backgroundChunkName: string) {
  return (
    `Check the ${colors.blue(backgroundChunkName.replace('/', '.'))} ` +
    `field in your ${colors.blue('manifest.json')} file.`
  )
}
