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
import {settleFixture} from './helpers/settled-fixture'

// The stock rspack dev server on loopback with this folder's config and a
// bare compiler, so none of this needs the compiled dist.
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

interface CompileTrack {
  started: () => number
  finished: () => number
}

async function withSession(
  run: (session: LoopbackSession, track: CompileTrack) => Promise<void>
) {
  const root = createFixture('extjs-loopback-')
  roots.push(root)
  // Unsettled, the fixture rebuilt src/index.js late, after the edit.
  await settleFixture(root)
  let session: LoopbackSession | undefined
  let started = 0
  let finished = 0

  try {
    session = await bootLoopback({
      root,
      beforeServer: (compiler) => {
        compiler.hooks.watchRun.tap('loopback-track', () => {
          started++
        })

        compiler.hooks.done.tap('loopback-track', () => {
          finished++
        })
      }
    })

    await session.firstCompile
    await run(session, {started: () => started, finished: () => finished})
  } finally {
    await session?.server.stop()
  }
}

describe('the dev server on loopback', () => {
  it('opens no watcher of its own beside the compiler', async () => {
    await withSession(async (session) => {
      const server = session.server as unknown as {
        options: {watchFiles: unknown[]; hot: unknown; liveReload: unknown}
        staticWatchers: unknown[]
      }

      expect(server.options.hot).toBe(true)
      expect(server.options.liveReload).toBe(true)
      expect(server.options.watchFiles).toEqual([])
      expect(server.staticWatchers).toEqual([])
    })
  })

  // The server watches nothing under public/, so an edit there sends no
  // frame from it. The compiler's own copy and reload are untouched.
  it('sends nothing for a public/ edit', async () => {
    await withSession(async (session, track) => {
      let socket:
        | Awaited<ReturnType<typeof connectClient>>['socket']
        | undefined

      try {
        const client = await connectClient(session.port)
        socket = client.socket

        // The server sends its whole connect greeting at once and ends it with
        // ok, so clearing before that ok would count a greeting frame as edit.
        expect(
          await waitFor(
            () => client.messages.some((m) => m.type === 'ok'),
            2000
          )
        ).toBe(true)

        expect(client.messages.map((m) => m.type)).toEqual([
          'hot',
          'liveReload',
          'hash',
          'ok'
        ])

        // With the fixture settled the first compile is the only one, so the
        // edit starts from an idle compiler and any later compile is its own.
        expect(track.started()).toBe(1)
        expect(track.finished()).toBe(1)
        client.messages.length = 0

        fs.writeFileSync(path.join(session.publicFolder, 'data.txt'), 'two\n')

        await waitFor(() => client.messages.length > 0, 2500)
        expect(client.messages).toEqual([])
        expect(track.started()).toBe(1)
        expect(session.compiles()).toBe(1)
      } finally {
        await closeSocket(socket)
      }
    })
  })

  it('keeps the compiled manifest off disk and leaves node:fs alone', async () => {
    const root = createFixture('extjs-loopback-manifest-')
    roots.push(root)
    const manifest = path.join(root, 'dist', 'chrome', 'manifest.json')
    const writeFileSync = fs.writeFileSync
    let session: LoopbackSession | undefined

    try {
      session = await bootLoopback({root})
      await session.firstCompile

      // The middleware swaps the compiler onto memory, so the compiler never
      // writes through node:fs: only the middleware's writeToDisk does.
      expect(session.compiler.outputFileSystem).not.toBe(fs)
      expect(
        String(
          (
            session.compiler.outputFileSystem as unknown as {
              readFileSync: (file: string) => Buffer
            }
          ).readFileSync(manifest)
        )
      ).toBe('{"manifest_version":3}')

      expect(fs.existsSync(path.join(session.distPath, 'background.js'))).toBe(
        true
      )

      expect(fs.existsSync(manifest)).toBe(false)

      // The middleware's filter is the only gate: an in-process write lands.
      expect(fs.writeFileSync).toBe(writeFileSync)
      fs.writeFileSync(manifest, 'sync')
      expect(fs.readFileSync(manifest, 'utf8')).toBe('sync')
    } finally {
      await session?.server.stop()
    }
  })
})
