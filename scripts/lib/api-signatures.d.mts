export interface PublishedEntry {
  subpath: string
  source: string
  declarationFile: boolean
}

export function publishedEntries(packageDir: string): PublishedEntry[]
export function signatureReports(
  packageDir: string,
  root?: string
): Record<string, string>
