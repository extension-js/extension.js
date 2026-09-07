//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// The first-run install offer records its outcome here and the command event
// reads it on the way out. A plain module with no imports keeps the browser
// launcher clear of telemetry's module-level side effects.

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
