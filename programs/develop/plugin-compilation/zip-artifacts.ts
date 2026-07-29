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
