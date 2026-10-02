//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface ZipArtifactRecord {
  kind: 'source' | 'dist'
  path: string
  size: number
}

const ARTIFACTS_KEY = '__extensionJsZipArtifacts'

type ArtifactCarrier = {
  [ARTIFACTS_KEY]?: ZipArtifactRecord[]
}

// The receipts ride on the compilation object rather than module state, so
// the printer reads them from the same stats the compiler callback receives.
export function recordZipArtifact(
  carrier: unknown,
  artifact: ZipArtifactRecord
): void {
  if (!carrier || typeof carrier !== 'object') return

  const host = carrier as ArtifactCarrier
  if (!Array.isArray(host[ARTIFACTS_KEY])) host[ARTIFACTS_KEY] = []

  host[ARTIFACTS_KEY].push(artifact)
}

export function getZipArtifacts(carrier: unknown): ZipArtifactRecord[] {
  if (!carrier || typeof carrier !== 'object') return []

  const host = carrier as ArtifactCarrier

  return Array.isArray(host[ARTIFACTS_KEY]) ? host[ARTIFACTS_KEY] : []
}

export interface ZipFailureRecord {
  kind: 'source' | 'dist'
  path: string
  reason: string
}

const FAILURES_KEY = '__extensionJsZipFailures'

type FailureCarrier = {
  [FAILURES_KEY]?: ZipFailureRecord[]
}

// An archive the caller asked for and did not get. Recorded beside the
// receipts so the command can fail instead of reporting a build with no zip.
export function recordZipFailure(
  carrier: unknown,
  failure: ZipFailureRecord
): void {
  if (!carrier || typeof carrier !== 'object') return

  const host = carrier as FailureCarrier
  if (!Array.isArray(host[FAILURES_KEY])) host[FAILURES_KEY] = []

  host[FAILURES_KEY].push(failure)
}

export function getZipFailures(carrier: unknown): ZipFailureRecord[] {
  if (!carrier || typeof carrier !== 'object') return []

  const host = carrier as FailureCarrier

  return Array.isArray(host[FAILURES_KEY]) ? host[FAILURES_KEY] : []
}
