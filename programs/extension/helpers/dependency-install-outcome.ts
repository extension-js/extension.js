//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type DependencyInstallOutcome = 'skipped' | 'installed' | 'failed'

interface DependencyInstallRecord {
  outcome: DependencyInstallOutcome
  seconds?: number
}

let record: DependencyInstallRecord | null = null

export function recordDependencyInstall(
  outcome: DependencyInstallOutcome,
  seconds?: number
): void {
  record = {
    outcome,
    ...(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      ? {seconds: Math.round(seconds)}
      : {})
  }
}

export function readDependencyInstall(): DependencyInstallRecord | null {
  return record
}

export function resetDependencyInstall(): void {
  record = null
}
