import fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  attachEmulatorFileIndex,
  createEmulatorFileIndexHolder,
  EMULATOR_FILES_PATH
} from '../emulator-lane'
import {
  bootLoopback,
  closeSocket,
  connectClient,
  createFixture,
  type LoopbackSession,
  waitFor
} from './helpers/loopback-dev-server'
import {settleFixture} from './helpers/settled-fixture'

// The stock rspack dev server on loopback with this folder's config and a
// bare compiler: every client shape of the dev server, one request each.
const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const OTHER_EXTENSION = 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
const VIEWER = 'https://viewer.example'
const BUNDLE = '/background.js'

const roots: string[] = []
const sessions: LoopbackSession[] = []

interface Answer {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function request(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {host: '127.0.0.1', port, path, method, headers, agent: false},
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })

        res.once('end', () =>
          resolve({status: res.statusCode ?? 0, headers: res.headers, body})
        )
      }
    )
    req.once('error', reject)
    req.end()
  })
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({host: '127.0.0.1', port})
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => resolve(false))
  })
}

async function boot(
  options: Omit<Parameters<typeof bootLoopback>[0], 'root'> = {}
) {
  const root = createFixture('extjs-request-site-')
  roots.push(root)
  // Unsettled, the fixture rebuilt late and changed the bytes the rows compare.
  await settleFixture(root)
  const session = await bootLoopback({root, ...options})
  sessions.push(session)
  await session.firstCompile

  return session
}

// The first frames the stock server sends an admitted or a refused socket,
// or the answer to an upgrade that never completed.
async function socketFrames(
  port: number,
  origin: string | null,
  socketPath?: string
) {
  let client: Awaited<ReturnType<typeof connectClient>>

  try {
    client = await connectClient(port, origin, socketPath)
  } catch (error) {
    return [`refused: ${(error as Error).message}`]
  }

  try {
    await waitFor(() => client.messages.length > 0, 2000)

    return client.messages.map((message) =>
      message.type === 'error' ? `error: ${String(message.data)}` : message.type
    )
  } finally {
    await closeSocket(client.socket)
  }
}

afterAll(async () => {
  for (const session of sessions) await session.server.stop()

  for (const session of sessions) {
    expect(await isListening(session.port)).toBe(false)
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('requests to the dev server on loopback', () => {
  let session: LoopbackSession
  let bytes: string
  const refused: string[] = []
  const own = () => `http://127.0.0.1:${session.port}`

  beforeAll(async () => {
    session = await boot({
      input: () => ({
        isSessionExtensionOrigin: (origin) => origin === EXTENSION,
        onSiteRefused: (origin) => refused.push(origin)
      })
    })

    bytes = (await request(session.port, BUNDLE)).body
  })

  it('serves a client that sends no fetch metadata, as the stock server does', async () => {
    const answer = await request(session.port, BUNDLE)

    expect(answer.status).toBe(200)
    expect(bytes).toContain('const a = 1')
    expect((await request(session.port, '/data.txt')).body).toBe('one\n')
  })

  it("serves the session's own pages", async () => {
    const sameOrigin = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'script'
    })
    const typed = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document'
    })
    const otherSpelling = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: `http://localhost:${session.port}`
    })

    expect([sameOrigin.status, typed.status, otherSpelling.status]).toEqual([
      200, 200, 200
    ])

    expect(sameOrigin.body).toBe(bytes)
    expect(typed.body).toBe(bytes)
    expect(otherSpelling.body).toBe(bytes)
  })

  it('serves the session extension and lets it read the answer', async () => {
    const answer = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: EXTENSION
    })

    expect(answer.status).toBe(200)
    expect(answer.body).toBe(bytes)
    expect(answer.headers['access-control-allow-origin']).toBe(EXTENSION)
  })

  it.each<[string, string, Record<string, string>]>([
    [
      'a script tag for a compiled file',
      BUNDLE,
      {'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors'}
    ],
    [
      'a fetch for a compiled file',
      BUNDLE,
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        origin: 'https://other.test'
      }
    ],
    [
      'a file from public/',
      '/data.txt',
      {'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors'}
    ],
    [
      'a page on another loopback port',
      BUNDLE,
      {
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'no-cors',
        referer: 'http://127.0.0.1:3000/'
      }
    ],
    [
      'an extension that is not the session one',
      BUNDLE,
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        origin: OTHER_EXTENSION
      }
    ],
    [
      'a link to the server from another site',
      '/',
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document'
      }
    ]
  ])('refuses a request from another site: %s', async (_name, path, headers) => {
    const answer = await request(session.port, path, headers)

    expect(answer.status).toBe(403)
    expect(answer.body).toBe(
      'Extension.js dev server refused a request from another site.\n' +
        'Open this address directly in the browser to load it.\n'
    )

    expect(answer.body).not.toContain('const a = 1')
    expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(answer.headers['x-content-type-options']).toBe('nosniff')
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(answer.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('refuses a preflight from another site', async () => {
    const answer = await request(
      session.port,
      BUNDLE,
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        origin: 'https://other.test',
        'access-control-request-method': 'GET'
      },
      'OPTIONS'
    )

    expect(answer.status).toBe(403)
  })

  // A page could otherwise forge the forwarded host the proxy rule trusts,
  // so no preflight grants it the header.
  it('grants no page the forwarded host header', async () => {
    for (const origin of [own(), EXTENSION]) {
      const answer = await request(
        session.port,
        BUNDLE,
        {
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'cors',
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-forwarded-host'
        },
        'OPTIONS'
      )
      const granted = String(
        answer.headers['access-control-allow-headers'] ?? ''
      ).toLowerCase()

      expect(granted).not.toMatch(/x-forwarded-host|\*/)
    }
  })

  it("runs before the server's own routes", async () => {
    const compiles = session.compiles()
    const answer = await request(
      session.port,
      '/rspack-dev-server/invalidate',
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'no-cors'
      }
    )

    expect(answer.status).toBe(403)
    await waitFor(() => session.compiles() > compiles, 500)
    expect(session.compiles()).toBe(compiles)
  })

  it('reports the first refused request of the session and no other', async () => {
    const fromOther = {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: 'https://other.test'
    }

    await request(session.port, BUNDLE, fromOther)
    await request(session.port, BUNDLE, fromOther)

    expect(refused).toHaveLength(1)
  })

  it('opens the reload socket for the session', async () => {
    const opened = expect.arrayContaining(['hot', 'liveReload'])

    expect(await socketFrames(session.port, own())).toEqual(opened)
    expect(
      await socketFrames(session.port, `http://localhost:${session.port}`)
    ).toEqual(opened)

    expect(await socketFrames(session.port, EXTENSION)).toEqual(opened)
  })

  // An extension dials before the session knows it, so every one is let in.
  it('opens the reload socket for an extension it has not met', async () => {
    expect(await socketFrames(session.port, OTHER_EXTENSION)).toEqual(
      expect.arrayContaining(['hot', 'liveReload'])
    )
  })

  it.each([
    ['another site', 'https://other.test'],
    ['another port on the same address', 'http://127.0.0.1:3000'],
    ['another port on localhost', 'http://localhost:3000'],
    ['a frame with no origin of its own', 'null']
  ])('refuses the reload socket to %s', async (_name, origin) => {
    expect(await socketFrames(session.port, origin)).toEqual([
      'refused: Unexpected server response: 403'
    ])
  })

  // Only the session's own extension is built with the path that names it.
  it.each([
    ['the path with no session', '/ws'],
    ['the path of another session', '/ws/another-session']
  ])('refuses the reload socket at %s at once', async (_name, socketPath) => {
    for (const origin of [own(), EXTENSION]) {
      const started = Date.now()

      expect(await socketFrames(session.port, origin, socketPath)).toEqual([
        'refused: Unexpected server response: 404'
      ])

      // A stale build learns now, not at its handshake timeout.
      expect(Date.now() - started).toBeLessThan(1000)
    }

    const answer = await request(session.port, socketPath, {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
    })

    expect(answer.status).toBe(404)
    expect(answer.body.trim().split('\n')).toHaveLength(1)
    expect(answer.body).toMatch(/another dev session/)
  })

  it('leaves a socket with no Origin to the stock server, which closes it', async () => {
    expect(await socketFrames(session.port, null)).toEqual([
      'error: Invalid Host/Origin header'
    ])
  })
})

describe('the stock dev server with its default host list', () => {
  it('answers plain request shapes as ours does', async () => {
    const stock = await boot({
      mutateConfig: (config) => ({
        ...config,
        allowedHosts: 'auto',
        setupMiddlewares: undefined,
        webSocketServer: undefined
      })
    })
    const ours = await boot()
    const shapes: Array<Record<string, string>> = [
      {},
      {'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors'},
      {'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors'}
    ]
    const statuses = async (port: number) =>
      await Promise.all(
        shapes.map(
          async (headers) => (await request(port, BUNDLE, headers)).status
        )
      )

    expect(await statuses(stock.port)).toEqual([200, 403, 200])
    expect(await statuses(ours.port)).toEqual([200, 403, 200])
    // The stock server listens at the bare path.
    expect(await socketFrames(stock.port, 'https://other.test', '/ws')).toEqual(
      ['error: Invalid Host/Origin header']
    )

    expect(await socketFrames(stock.port, null, '/ws')).toEqual([
      'error: Invalid Host/Origin header'
    ])
  })
})

describe('a session reached through a named host', () => {
  it('serves a page on the --allowed-hosts name on the session port', async () => {
    const hostRefused: string[] = []
    const siteRefused: string[] = []
    const session = await boot({
      input: () => ({
        allowedHosts: 'dev.example.test',
        onHostRefused: (host) => hostRefused.push(host),
        onSiteRefused: (origin) => siteRefused.push(origin)
      })
    })
    const page = await request(session.port, BUNDLE, {
      host: 'dev.example.test',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'no-cors'
    })
    const withOrigin = await request(session.port, BUNDLE, {
      host: 'dev.example.test',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      origin: 'https://dev.example.test'
    })
    // A proxy that rewrites Host leaves only the Origin to name the page,
    // and a named host counts on the dev server's own port alone.
    const rewritten = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: `https://dev.example.test:${session.port}`
    })
    const otherPort = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: 'https://dev.example.test'
    })

    expect([
      page.status,
      withOrigin.status,
      rewritten.status,
      otherPort.status
    ]).toEqual([200, 200, 200, 403])

    expect(
      await socketFrames(
        session.port,
        `https://dev.example.test:${session.port}`
      )
    ).toEqual(expect.arrayContaining(['hot', 'liveReload']))

    expect(hostRefused).toEqual([])
    expect(siteRefused).toEqual(['https://dev.example.test'])
  })

  it('serves a page on the --public-host address', async () => {
    const session = await boot({
      input: () => ({connectableHost: 'devbox.local'})
    })
    const page = await request(session.port, BUNDLE, {
      host: `devbox.local:${session.port}`,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'no-cors'
    })
    const fromPublicHost = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: `http://devbox.local:${session.port}`
    })
    const otherPort = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      origin: 'http://devbox.local:3000'
    })

    expect([page.status, fromPublicHost.status, otherPort.status]).toEqual([
      200, 200, 403
    ])

    expect(
      await socketFrames(session.port, `http://devbox.local:${session.port}`)
    ).toEqual(expect.arrayContaining(['hot', 'liveReload']))

    expect(
      await socketFrames(session.port, 'http://devbox.local:3000')
    ).toEqual(['refused: Unexpected server response: 403'])
  })
})

describe('a session with the emulator viewer', () => {
  it('serves the viewer its file index, files and reload socket', async () => {
    const holder = createEmulatorFileIndexHolder('instance')
    const siteRefused: string[] = []
    const session = await boot({
      beforeServer: (compiler) => attachEmulatorFileIndex(compiler, holder),
      input: () => ({
        emulatorOrigin: VIEWER,
        emulatorFiles: holder,
        onSiteRefused: (origin) => siteRefused.push(origin)
      })
    })
    const viewer = {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: VIEWER
    }
    const preflight = await request(
      session.port,
      EMULATOR_FILES_PATH,
      {...viewer, 'access-control-request-method': 'GET'},
      'OPTIONS'
    )
    const index = await request(session.port, EMULATOR_FILES_PATH, viewer)
    const file = await request(session.port, BUNDLE, viewer)

    expect(preflight.status).toBe(204)
    expect(index.status).toBe(200)
    expect(index.headers['access-control-allow-origin']).toBe(VIEWER)
    expect(
      (JSON.parse(index.body) as {files: Array<{path: string}>}).files.map(
        (entry) => entry.path
      )
    ).toContain('background.js')

    expect(file.status).toBe(200)
    expect(file.headers['access-control-allow-origin']).toBe(VIEWER)
    expect(
      await socketFrames(session.port, 'https://viewer.example:8443')
    ).toEqual(['refused: Unexpected server response: 403'])

    // A refused socket is reported like a refused request.
    expect(siteRefused).toEqual(['https://viewer.example:8443'])

    expect(await socketFrames(session.port, VIEWER)).toEqual(
      expect.arrayContaining(['hot', 'liveReload'])
    )
  })

  it('refuses another site the file index', async () => {
    const holder = createEmulatorFileIndexHolder('instance')
    const session = await boot({
      beforeServer: (compiler) => attachEmulatorFileIndex(compiler, holder),
      input: () => ({emulatorOrigin: VIEWER, emulatorFiles: holder})
    })
    const answer = await request(session.port, EMULATOR_FILES_PATH, {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'no-cors'
    })
    const unnamedHost = await request(session.port, EMULATOR_FILES_PATH, {
      host: 'unnamed.example.test'
    })

    expect(answer.status).toBe(403)
    expect(answer.body).not.toContain('background.js')
    expect(unnamedHost.status).toBe(403)
    expect(unnamedHost.body).not.toContain('background.js')
  })
})
