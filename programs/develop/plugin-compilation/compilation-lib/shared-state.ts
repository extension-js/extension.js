//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

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

// Listen for the cross-package signal emitted by banner.ts the moment it
// finishes printing the " 🧩 Extension.js x.y.z" card. This guarantees the
// first deferred compile line flushes immediately after the banner — without
// it, the line stays parked until the next `done` hook (so the initial run
// shows zero lines and the first reload double-prints)
let listenerInstalled = false

function ensureBannerListener() {
  if (listenerInstalled) return
  listenerInstalled = true
  ;(process as any).on(BANNER_PRINTED_EVENT, () => {
    markBannerPrinted()
  })
}

ensureBannerListener()

export function isBannerPrinted(): boolean {
  if (sharedState.bannerPrinted) return true
  // The browser-side banner printer lives in a separate package
  // (programs/extension/browsers/browsers-lib/banner.ts). The
  // BANNER_PRINTED_EVENT listener above flushes synchronously when the
  // banner prints, but if the event was missed (e.g. develop loaded after
  // the banner fired), fall back to the env var that banner.ts also sets
  if (process.env.EXTENSION_CLI_BANNER_PRINTED === 'true') {
    markBannerPrinted()
    return true
  }
  return false
}

export function setPendingCompilationLine(line: string) {
  sharedState.pendingCompilationLine = line
}
