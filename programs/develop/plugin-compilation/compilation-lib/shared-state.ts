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

export function markBannerPrinted() {
  sharedState.bannerPrinted = true

  if (sharedState.pendingCompilationLine) {
    console.log(sharedState.pendingCompilationLine)
    sharedState.pendingCompilationLine = ''
  }
}

export function isBannerPrinted(): boolean {
  if (sharedState.bannerPrinted) return true
  // The browser-side banner printer lives in a separate package
  // (programs/extension/browsers/browsers-lib/banner.ts) and has its own
  // `bannerPrinted` flag. It signals the launch CLI across that package
  // boundary via `process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'` once it
  // has written the " 🧩 Extension.js x.y.z" card. Pick that signal up here
  // and flush any compile line that arrived before the banner — without this
  // bridge every rebuild line in browser-launch mode would stay parked in
  // `pendingCompilationLine` and never reach stdout.
  if (process.env.EXTENSION_CLI_BANNER_PRINTED === 'true') {
    markBannerPrinted()
    return true
  }
  return false
}

export function setPendingCompilationLine(line: string) {
  sharedState.pendingCompilationLine = line
}
