import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {RspackDevServer} from '@rspack/dev-server'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  buildRestartBundle,
  createSessionRestartHandler
} from '../session-restart-handler'

const roots: string[] = []
const compilers: Compiler[] = []

function compilerIn(root: string) {
  const compiler = rspack({
    mode: 'development',
    context: root,
    entry: {background: path.join(root, 'index.js')},
    output: {path: path.join(root, 'dist', 'chrome')},
    stats: 'none',
    infrastructureLogging: {level: 'none'}
  })
  compilers.push(compiler)

  return compiler
}

afterEach(async () => {
  for (const compiler of compilers.splice(0)) {
    await new Promise<void>((resolve) => compiler.close(() => resolve()))
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

// The session's own bookkeeping, driven as the dev server drives it.
function sessionState(serving: Compiler) {
  let active: Compiler | null = serving

  return {
    active: () => active,
    setActive: (compiler: Compiler | null) => {
      active = compiler
    }
  }
}

describe('building the next bundle of a restart', () => {
  it('puts the session back when the build throws after the compiler exists', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-restart-bundle-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'index.js'), 'export const a = 1\n')

    const serving = compilerIn(root)
    const state = sessionState(serving)
    let abandoned: Compiler | undefined
    let closed = 0

    await expect(
      buildRestartBundle({
        build: async () => {
          abandoned = compilerIn(root)
          const close = abandoned.close.bind(abandoned)
          vi.spyOn(abandoned, 'close').mockImplementation((callback) => {
            closed++
            close(callback)
          })

          state.setActive(abandoned)

          throw new Error('a plugin threw while the server was wired')
        },
        activeCompiler: state.active,
        setActiveCompiler: state.setActive
      })
    ).rejects.toThrow('a plugin threw while the server was wired')

    expect(abandoned).toBeDefined()
    expect(state.active()).toBe(serving)
    expect(closed).toBe(1)
  })

  it('hands back the bundle and keeps its compiler when the build succeeds', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-restart-bundle-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'index.js'), 'export const a = 1\n')
    const serving = compilerIn(root)
    const next = compilerIn(root)
    const state = sessionState(serving)

    const bundle = await buildRestartBundle({
      build: async () => {
        state.setActive(next)

        return {compiler: next}
      },
      activeCompiler: state.active,
      setActiveCompiler: state.setActive
    })

    expect(bundle.compiler).toBe(next)
    expect(state.active()).toBe(next)
  })
})

describe('a bundle built for a restart that a shutdown overtakes', () => {
  // Shutdown begins while the bundle is built, or while the old server stops.
  it.each([
    ['is built', 'build'],
    ['waits for the old server to stop', 'stop']
  ])('lets go of its compiler when shutdown begins while it %s', async (_name, moment) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-restart-bundle-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'index.js'), 'export const a = 1\n')

    // The next bundle as the session builds it: a real compiler and the
    // stock server.
    const compiler = rspack({
      mode: 'development',
      context: root,
      entry: {background: path.join(root, 'index.js')},
      output: {path: path.join(root, 'dist', 'chrome')},
      stats: 'none',
      infrastructureLogging: {level: 'none'}
    })
    let closed = 0
    const close = compiler.close.bind(compiler)
    vi.spyOn(compiler, 'close').mockImplementation((callback) => {
      closed++
      close(callback)
    })

    let shuttingDown = false
    let ended = 0

    const restart = createSessionRestartHandler<RspackDevServer>({
      announce: () => {},
      createBundle: async () => {
        const server = new RspackDevServer(
          {port: 0, host: '127.0.0.1', hot: false, client: false} as never,
          compiler
        )

        if (moment === 'build') shuttingDown = true

        return {compiler, server, firstCompile: Promise.resolve(null)}
      },
      currentServer: () =>
        ({
          stop: async () => {
            if (moment === 'stop') shuttingDown = true
          }
        }) as never,
      setCurrentServer: () => {},
      holdPort: () => {},
      endPortHold: () => {
        ended++
      },
      startBundler: async () => {
        throw new Error('a server must not start once shutdown began')
      },
      onBundleFailure: () => {},
      onStopFailure: () => {},
      onStartFailure: () => {},
      onUnexpectedFailure: (error) => {
        throw error
      },
      isShuttingDown: () => shuttingDown,
      fullReloadsDelivered: () => 0,
      reloadAfterRestart: async () => {}
    })

    await restart({reason: 'scripts', pathAfter: 'scripts/new.js'})

    expect(ended).toBe(moment === 'stop' ? 1 : 0)
    expect(closed).toBe(1)
  })
})
