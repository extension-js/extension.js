import fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  bootLoopback,
  closeSocket,
  connectClient,
  createFixture,
  type LoopbackSession,
  waitFor
} from './helpers/loopback-dev-server'

// The stock rspack dev server on loopback with this folder's config and a
// bare compiler, so none of this needs the compiled dist.
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

async function waitForQuiet(
  count: () => number,
  quietMs: number,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs
  let seen = count()
  let quietSince = Date.now()

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))

    if (count() !== seen) {
      seen = count()
      quietSince = Date.now()
    } else if (Date.now() - quietSince >= quietMs) {
      return
    }
  }

  throw new Error(`frames kept arriving for ${timeoutMs} ms`)
}

async function withSession(
  env: Record<string, string>,
  run: (session: LoopbackSession) => Promise<void>
) {
  const root = createFixture('extjs-loopback-')
  roots.push(root)
  let session: LoopbackSession | undefined

  try {
    session = await bootLoopback({root, env})
    await session.firstCompile
    await run(session)
  } finally {
    await session?.server.stop()
  }
}

describe('the dev server on loopback', () => {
  it('normalizes the public/ watch to the stock options', async () => {
    await withSession({}, async (session) => {
      const options = (
        session.server as unknown as {
          options: {
            watchFiles: Array<{paths: unknown; options: unknown}>
            hot: unknown
            liveReload: unknown
          }
        }
      ).options

      expect(options.hot).toBe(true)
      expect(options.liveReload).toBe(true)
      expect(options.watchFiles).toEqual([
        {
          paths: [path.join(session.publicFolder, '**/*')],
          options: {
            ignoreInitial: true,
            persistent: true,
            followSymlinks: false,
            atomic: false,
            alwaysStat: true,
            ignorePermissionErrors: true,
            usePolling: false,
            ignored: [path.join(session.root, 'dist', '**/*')]
          }
        }
      ])
    })
  })

  // Pins today's behavior: chokidar 5 reads `public/**/*` as a literal path,
  // so this watch sees no edit. The compiler's own reload is untouched.
  it.each([
    ['native events', {}],
    [
      'polling',
      {EXTENSION_WATCH_POLL: 'true', EXTENSION_WATCH_POLL_INTERVAL: '100'}
    ]
  ])('sends nothing for a public/ edit with %s', async (_name, env) => {
    await withSession(env, async (session) => {
      let socket:
        | Awaited<ReturnType<typeof connectClient>>['socket']
        | undefined

      try {
        const client = await connectClient(session.port)
        socket = client.socket

        expect(
          await waitFor(
            () => client.messages.some((m) => m.type === 'liveReload'),
            2000
          )
        ).toBe(true)

        // A rebuild for fixture files written as the watcher started can land
        // late, so the edit waits for a second with no frame.
        await waitForQuiet(() => client.messages.length, 1000, 10000)
        const compilesBefore = session.compiles()
        client.messages.length = 0

        fs.writeFileSync(path.join(session.publicFolder, 'data.txt'), 'two\n')

        await waitFor(() => client.messages.length > 0, 2500)
        expect(client.messages).toEqual([])
        expect(session.compiles()).toBe(compilesBefore)
      } finally {
        await closeSocket(socket)
      }
    })
  })
})
