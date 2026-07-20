//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const sharedState = {
  bannerPrinted: false as boolean,
  pendingCompilationLine: '' as string
}

const BANNER_PRINTED_EVENT = 'extensionjs:banner-printed'

export function markBannerPrinted() {
  sharedState.bannerPrinted = true

  if (sharedState.pendingCompilationLine) {
    console.log(sharedState.pendingCompilationLine)
    sharedState.pendingCompilationLine = ''
  }
}

// Listen for the cross-package banner-printed signal so the first deferred
// compile line flushes immediately; otherwise it parks until the next done hook.
let listenerInstalled = false

function ensureBannerListener() {
  if (listenerInstalled) return
  listenerInstalled = true
  process.on(BANNER_PRINTED_EVENT, () => {
    markBannerPrinted()
  })
}

ensureBannerListener()

export function isBannerPrinted(): boolean {
  if (sharedState.bannerPrinted) return true
  // The banner printer lives in another package; if its event was missed
  // (develop loaded late), fall back to the env var banner.ts also sets.
  if (process.env.EXTENSION_CLI_BANNER_PRINTED === 'true') {
    markBannerPrinted()
    return true
  }
  return false
}

export function setPendingCompilationLine(line: string) {
  sharedState.pendingCompilationLine = line
}
