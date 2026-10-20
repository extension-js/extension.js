// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compiler, Stats} from '@rspack/core'

interface RefreshServer<Client> {
  webSocketServer?: {clients: Client[]} | null
  sendMessage: (clients: Client[], type: string, data?: unknown) => void
}

function isUnder(file: string, dir: string): boolean {
  const rel = path.relative(dir, file)

  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// The page markup the build read in this compile and the author just saved.
// The dev-server client refreshes a page on the "static-changed" message,
// and a changed html file never reaches an open page any other way: the
// compile emits it, but no module update carries it, so the hot path keeps
// the page as it was.
export function htmlSourcesToRefresh(
  modifiedFiles: Iterable<string> | undefined,
  fileDependencies: Iterable<string>,
  outputPath: string
): string[] {
  if (!modifiedFiles) return []

  const known = new Set<string>()

  for (const file of fileDependencies) {
    if (/\.html?$/i.test(file)) known.add(path.normalize(file))
  }

  const out: string[] = []

  for (const file of modifiedFiles) {
    const normalized = path.normalize(file)
    if (!known.has(normalized)) continue
    if (outputPath && isUnder(normalized, outputPath)) continue
    if (!out.includes(normalized)) out.push(normalized)
  }

  return out.sort()
}

// Only the pages the build knows refresh: a demo page or a fixture saved
// elsewhere in the project is not a dependency, so no open page reloads for it.
export function attachHtmlRefresh<Client>(
  compiler: Compiler,
  server: RefreshServer<Client>
): void {
  compiler.hooks?.done?.tap?.('extjs-html-refresh', (stats: Stats) => {
    const compilation = stats.compilation
    if (compilation.errors && compilation.errors.length > 0) return

    const clients = server.webSocketServer?.clients
    if (!clients || clients.length === 0) return

    const outputPath = String(compilation.options?.output?.path || '')
    const changed = htmlSourcesToRefresh(
      compiler.modifiedFiles,
      compilation.fileDependencies,
      outputPath
    )

    for (const file of changed) {
      server.sendMessage(clients, 'static-changed', file)
    }
  })
}
