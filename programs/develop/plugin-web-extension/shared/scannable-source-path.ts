// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const SCANNABLE_SOURCE_RE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx|vue|svelte)$/

// The source files a dev scan reads. The module graph names an SFC block as
// file.vue?vue&type=script, so the query goes before the extension test.
export function scannableSourcePath(
  resource: string | undefined
): string | undefined {
  if (!resource || resource.includes('node_modules')) return undefined

  const bare = resource.split('?')[0]

  return SCANNABLE_SOURCE_RE.test(bare) ? bare : undefined
}
