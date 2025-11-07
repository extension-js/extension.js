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
  return sharedState.bannerPrinted
}

export function setPendingCompilationLine(line: string) {
  sharedState.pendingCompilationLine = line
}
