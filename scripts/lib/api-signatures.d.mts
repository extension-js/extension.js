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
export function emitDeclarations(
  sources: string[],
  outDir: string,
  root?: string
): string
export function reportEntry(declarationsDir: string, entryFile: string): string
export function reportDeclarationFile(packageDir: string, entry: string): string
