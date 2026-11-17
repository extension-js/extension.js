import * as http from 'node:http'
import type {AddressInfo} from 'node:net'
import axios from 'axios'
import {strToU8, zipSync} from 'fflate'
import type {TemplateFetch} from '../steps/import-external-template'

// What one path answers. A redirect names the path the client is sent to.
export type LoopbackReply =
  | {status?: number; type?: string; body: Buffer | string}
  | {redirectTo: string}

export interface LoopbackServer {
  url(pathname: string): string
  hits(pathname: string): number
  close(): Promise<void>
}

export function zipOf(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {}

  for (const [name, contents] of Object.entries(files)) {
    entries[name] = strToU8(contents)
  }

  return Buffer.from(zipSync(entries))
}

// Lives in the spec's own process, so it serves an import that runs there.
// A path with no reply answers 404.
export async function serveLoopback(
  routes: Record<string, LoopbackReply>
): Promise<LoopbackServer> {
  const hits = new Map<string, number>()
  let origin = ''

  const server = http.createServer((request, response) => {
    const pathname = String(request.url)
    const reply = routes[pathname]
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1)

    if (!reply) {
      response.writeHead(404, {'content-type': 'text/plain'})
      response.end('not found')

      return
    }

    if ('redirectTo' in reply) {
      response.writeHead(302, {location: `${origin}${reply.redirectTo}`})
      response.end()

      return
    }

    response.writeHead(reply.status ?? 200, {
      'content-type': reply.type ?? 'application/zip'
    })

    response.end(reply.body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url: (pathname) => `${origin}${pathname}`,
    hits: (pathname) => hits.get(pathname) ?? 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

// A loopback URL nothing listens on, so a connection to it is refused.
export async function refusedLoopbackUrl(pathname: string): Promise<string> {
  const server = await serveLoopback({})
  const url = server.url(pathname)
  await server.close()

  return url
}

// The real client, sent to one loopback URL whatever URL the import asked for.
// It is how a spec serves an https URL or the pinned catalog without leaving.
export function fetchFrom(url: string): TemplateFetch {
  return (_asked, config) => axios.get(url, config)
}
