// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const reported = new WeakMap<object, Set<string>>()

export function markPageReportedMissing(
  compilation: object,
  outputFile: string
): void {
  const files = reported.get(compilation) ?? new Set<string>()

  files.add(outputFile.replace(/^\/+/, ''))
  reported.set(compilation, files)
}

export function pagesReportedMissing(compilation: object): ReadonlySet<string> {
  return reported.get(compilation) ?? new Set<string>()
}
