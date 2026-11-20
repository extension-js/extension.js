// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compiler, Stats} from '@rspack/core'
import {isInsidePath} from '../lib/real-path'

// The socket server under the dev server. It names the request each client
// opened its socket with, which is where a page says which page it shows.
interface ClientConnections<Client> {
  on: (
    event: 'connection',
    listener: (client: Client, request?: {url?: string}) => void
  ) => unknown
}

interface RefreshServer<Client> {
  webSocketServer?: {
    clients: Client[]
    implementation?: ClientConnections<Client>
  } | null
  sendMessage: (clients: Client[], type: string, data?: unknown) => void
}

interface PageAsset {
  name: string
  info?: {sourceFilename?: string}
}

function isUnder(file: string, dir: string): boolean {
  return isInsidePath(dir, file)
}

function toPageName(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

// The page a client socket says it shows, as its emitted path such as
// "options/index.html". Undefined when the socket URL names none.
export function pageOfSocketRequest(
  url: string | undefined
): string | undefined {
  if (!url) return undefined

  try {
    const page = new URL(url, 'http://localhost').searchParams.get('page')

    return page ? toPageName(page) : undefined
  } catch {
    // A request line that is no URL names no page, so nothing reloads for it
    return undefined
  }
}

// The emitted pages a source page becomes, read from the asset info.
export function pagesBuiltFrom(
  source: string,
  assets: Iterable<PageAsset>,
  context: string
): string[] {
  const pages: string[] = []

  for (const asset of assets) {
    const from = asset.info?.sourceFilename
    if (!from || !/\.html?$/i.test(asset.name)) continue
    if (path.normalize(path.resolve(context, from)) !== source) continue

    pages.push(toPageName(asset.name))
  }

  return pages
}

// Every page the build emitted, which is every path a tab can truly show.
export function emittedPages(assets: Iterable<PageAsset>): string[] {
  const pages: string[] = []

  for (const asset of assets) {
    if (/\.html?$/i.test(asset.name)) pages.push(toPageName(asset.name))
  }

  return pages
}

// A client that names no page, a path no emitted page has (a route the page
// pushed), or a source no page claims, still reloads: an extra reload costs
// less than a page left showing old markup.
export function clientsShowing<Client>(
  clients: Client[],
  pages: string[],
  pageOf: (client: Client) => string | undefined,
  emitted: string[] = pages
): Client[] {
  if (pages.length === 0) return clients

  return clients.filter((client) => {
    const page = pageOf(client)

    return !page || pages.includes(page) || !emitted.includes(page)
  })
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
// Only the clients showing the saved page get the message.
export function attachHtmlRefresh<Client extends object>(
  compiler: Compiler,
  server: RefreshServer<Client>
): void {
  const pageOfClient = new WeakMap<Client, string>()
  const watched = new WeakSet<object>()
  const saved = new Set<string>()
  // A save during a compile starts the next one and the first never reaches
  // done, so its files still wait for the compile that does.
  let compileEnded = true

  const watchClients = () => {
    const connections = server.webSocketServer?.implementation
    if (!connections || watched.has(connections)) return

    watched.add(connections)
    connections.on('connection', (client, request) => {
      const page = pageOfSocketRequest(request?.url)
      if (page) pageOfClient.set(client, page)
    })
  }

  const remember = (files: Iterable<string> | undefined) => {
    for (const file of files || []) saved.add(file)
  }

  watchClients()

  compiler.hooks?.watchRun?.tap?.('extjs-html-refresh', () => {
    if (compileEnded) saved.clear()

    compileEnded = false
    remember(compiler.modifiedFiles)
    watchClients()
  })

  compiler.hooks?.done?.tap?.('extjs-html-refresh', (stats: Stats) => {
    const compilation = stats.compilation
    remember(compiler.modifiedFiles)
    watchClients()

    // A failed compile emits nothing, so its saved pages wait for the next.
    if (compilation.errors && compilation.errors.length > 0) return

    compileEnded = true

    const clients = server.webSocketServer?.clients
    if (!clients || clients.length === 0) return

    const outputPath = String(compilation.options?.output?.path || '')
    const context = String(compiler.options?.context || '')
    const changed = htmlSourcesToRefresh(
      saved,
      compilation.fileDependencies,
      outputPath
    )
    const assets = changed.length > 0 ? compilation.getAssets?.() || [] : []
    const emitted = emittedPages(assets)

    for (const file of changed) {
      const showing = clientsShowing(
        clients,
        pagesBuiltFrom(file, assets, context),
        (client) => pageOfClient.get(client),
        emitted
      )

      if (showing.length > 0) {
        server.sendMessage(showing, 'static-changed', file)
      }
    }
  })
}
