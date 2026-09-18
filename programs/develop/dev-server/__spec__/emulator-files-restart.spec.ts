import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {RspackDevServer} from '@rspack/dev-server'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'
import {
  attachEmulatorFileIndex,
  createEmulatorFileIndexHolder,
  createEmulatorFilesMiddlewareEntry,
  EMULATOR_FILES_PATH,
  type EmulatorFileIndexHolder
} from '../emulator-lane'

const roots: string[] = []

function scaffold() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emulator-restart-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'extjs-emulator-restart'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'emulator-restart',
      version: '0.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>'
  )

  fs.writeFileSync(path.join(root, 'popup.js'), "console.log('run one')\n")

  return root
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(absolute, out)
    else out.push(absolute)
  }

  return out
}

async function startRun(
  root: string,
  holder: EmulatorFileIndexHolder,
  webSocketPath?: string
) {
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  const compiler = rspack(config)
  attachEmulatorFileIndex(compiler, holder)

  let compiles = 0
  let onCompile: (() => void) | null = null
  compiler.hooks.done.tap('spec-compile-count', () => {
    compiles++
    onCompile?.()
  })

  const server = new RspackDevServer(
    {
      port: 0,
      host: '127.0.0.1',
      hot: true,
      liveReload: true,
      client: false,
      devMiddleware: {writeToDisk: () => true},
      ...(webSocketPath
        ? {webSocketServer: {type: 'ws', options: {path: webSocketPath}}}
        : {}),
      setupMiddlewares: (middlewares: any[], devServer: unknown) => [
        createEmulatorFilesMiddlewareEntry(holder, devServer),
        ...middlewares
      ]
    } as any,
    compiler
  )
  await server.start()

  const address = (server.server as any)?.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const nextCompile = (after: number) =>
    new Promise<void>((resolve) => {
      if (compiles > after) {
        resolve()

        return
      }

      onCompile = () => {
        if (compiles > after) resolve()
      }
    })

  return {server, port, nextCompile, compiles: () => compiles}
}

describe('files.json across a dev server restart', () => {
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  it('lists only paths the restarted server serves', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    const holder = createEmulatorFileIndexHolder('inst-restart')

    const first = await startRun(root, holder)

    try {
      await first.nextCompile(0)
      const settled = first.compiles()
      fs.writeFileSync(path.join(root, 'popup.js'), "console.log('run two')\n")
      await first.nextCompile(settled)

      const during = await (
        await fetch(`http://127.0.0.1:${first.port}${EMULATOR_FILES_PATH}`)
      ).json()
      expect(during.livereload).toEqual({path: '/ws'})
      expect(
        during.files.some((file: {path: string}) =>
          file.path.startsWith('hot/')
        )
      ).toBe(false)
    } finally {
      await first.server.stop()
    }

    const staleHot = listFiles(path.join(dist, 'hot'))
    expect(staleHot.length).toBeGreaterThan(0)

    const second = await startRun(root, holder, '/custom-livereload')

    try {
      const response = await fetch(
        `http://127.0.0.1:${second.port}${EMULATOR_FILES_PATH}`
      )
      expect(response.status).toBe(200)

      const index = await response.json()
      expect(index.version).toBe(1)
      expect(index.livereload).toEqual({path: '/custom-livereload'})

      const listed = index.files.map((file: {path: string}) => file.path)
      expect(listed).toContain('manifest.json')
      expect(listed.some((file: string) => file.startsWith('hot/'))).toBe(false)

      for (const file of listed) {
        const served = await fetch(
          new URL(file, `http://127.0.0.1:${second.port}${index.root}`)
        )
        expect({file, status: served.status}).toEqual({file, status: 200})
      }

      const staleUrl = path
        .relative(dist, staleHot[0])
        .split(path.sep)
        .join('/')
      const stale = await fetch(`http://127.0.0.1:${second.port}/${staleUrl}`)
      expect(stale.status).toBe(404)
    } finally {
      await second.server.stop()
    }
  }, 120_000)
})
