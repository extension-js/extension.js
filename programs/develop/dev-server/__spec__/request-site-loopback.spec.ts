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
  const session = await bootLoopback({root, ...options})
  sessions.push(session)
  await session.firstCompile

  return session
}

// The first frames the stock server sends an admitted or a refused socket.
async function socketFrames(port: number, origin: string | null) {
  const client = await connectClient(port, origin)

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

  it('opens the reload socket for the session and closes it for another site', async () => {
    expect(await socketFrames(session.port, EXTENSION)).toEqual(
      expect.arrayContaining(['hot', 'liveReload'])
    )

    expect(await socketFrames(session.port, own())).toEqual(
      expect.arrayContaining(['hot', 'liveReload'])
    )

    expect(await socketFrames(session.port, 'https://other.test')).toEqual([
      'error: Invalid Host/Origin header'
    ])

    // A socket with no Origin is closed by the stock server too.
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
        setupMiddlewares: undefined
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
    expect(await socketFrames(stock.port, 'https://other.test')).toEqual([
      'error: Invalid Host/Origin header'
    ])

    expect(await socketFrames(stock.port, null)).toEqual([
      'error: Invalid Host/Origin header'
    ])
  })
})

describe('a session reached through a named host', () => {
  it('serves a page on the --allowed-hosts name and names no refusal', async () => {
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
    // A proxy that rewrites Host leaves only the Origin to name the page.
    const rewritten = await request(session.port, BUNDLE, {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      origin: 'https://dev.example.test'
    })

    expect([page.status, withOrigin.status, rewritten.status]).toEqual([
      200, 200, 200
    ])

    expect(hostRefused).toEqual([])
    expect(siteRefused).toEqual([])
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
  })
})

describe('a session with the emulator viewer', () => {
  it('serves the viewer its file index, files and reload socket', async () => {
    const holder = createEmulatorFileIndexHolder('instance')
    const session = await boot({
      beforeServer: (compiler) => attachEmulatorFileIndex(compiler, holder),
      input: () => ({emulatorOrigin: VIEWER, emulatorFiles: holder})
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
