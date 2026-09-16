//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type BrowserInstallOutcome =
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'failed'

interface BrowserInstallRecord {
  outcome: BrowserInstallOutcome
  browser: string
  seconds?: number
}

let record: BrowserInstallRecord | null = null

// Later outcomes describe the same offer, so the last one wins.
export function recordBrowserInstall(
  outcome: BrowserInstallOutcome,
  browser: string,
  seconds?: number
): void {
  record = {
    outcome,
    browser,
    ...(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      ? {seconds: Math.round(seconds)}
      : {})
  }
}

export function readBrowserInstall(): BrowserInstallRecord | null {
  return record
}

export function resetBrowserInstall(): void {
  record = null
}
