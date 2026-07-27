//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {humanLine} from '../../dev-server/lifecycle-stream'

export const sharedState = {
  bannerPrinted: false as boolean,
  pendingCompilationLine: '' as string
}

export function markBannerPrinted() {
  sharedState.bannerPrinted = true

  if (sharedState.pendingCompilationLine) {
    humanLine(sharedState.pendingCompilationLine)
    sharedState.pendingCompilationLine = ''
  }
}

export function isBannerPrinted(): boolean {
  if (sharedState.bannerPrinted) return true
  // The card printers live in other bundles, so their signal arrives through
  // the environment; converting it here also flushes the parked line.
  if (process.env.EXTENSION_CLI_BANNER_PRINTED === 'true') {
    markBannerPrinted()
    return true
  }
  return false
}

export function setPendingCompilationLine(line: string) {
  sharedState.pendingCompilationLine = line
}
