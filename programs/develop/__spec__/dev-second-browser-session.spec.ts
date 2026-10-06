import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {writePersistedControlPort} from '../dev-server/control-bridge/control-port-store'
import {writeControlToken} from '../dev-server/control-bridge/session-token'
import {getProjectStructure} from '../lib/project'
import {controlPortFilePath} from '../lib/session-paths'
import webpackConfig from '../rspack-config'
import {devWatchOptions} from './helpers/dev-watch-options'

const roots: string[] = []
const sessions: Array<{close: () => Promise<void>}> = []

afterAll(async () => {
  for (const session of sessions) await session.close()
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-second-session-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'second-session', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    'console.log("second-session-bg-v1")\n'
  )

  fs.writeFileSync(
    path.join(root, 'content.js'),
    'console.log("second-session-cs")\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'second-session',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content.js']}
      ]
    })
  )

  // The watcher treats a file written within its accuracy margin (up to 2s
  // on coarse clocks) of the first compile as changed and compiles again.
  const settled = new Date(Date.now() - 10_000)

  for (const entry of fs.readdirSync(root)) {
    fs.utimesSync(path.join(root, entry), settled, settled)
  }

  return root
}

async function watchSession(root: string, browser: 'chromium' | 'firefox') {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', browser)
  const config = webpackConfig(projectStructure, {
    browser,
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  const compiler: Compiler = rspack(config)
  const dones: Stats[] = []
  let lastDoneAt = 0
  compiler.hooks.done.tap('spec-second-session', (stats) => {
    dones.push(stats)
    lastDoneAt = Date.now()
  })

  const settle = () =>
    new Promise<number>((resolve) => {
      const poll = () => {
        if (dones.length > 0 && Date.now() - lastDoneAt > 1000) {
          return resolve(dones.length)
        }

        setTimeout(poll, 50)
      }

      poll()
    })

  const watching = compiler.watch(
    devWatchOptions(compiler, {aggregateTimeout: 50}),
    () => {}
  )
  const session = {
    dones,
    settle,
    close: () =>
      new Promise<void>((resolve) => {
        watching.close(() => resolve())
      })
  }
  sessions.push(session)

  return session
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('a first dev session', () => {
  it('compiles once at startup although it creates dist under the watched root', async () => {
    const root = project()
    const chromium = await watchSession(root, 'chromium')
    const seen = await chromium.settle()
    await sleep(2000)

    expect(seen).toBe(1)
    expect(chromium.dones).toHaveLength(1)
  }, 30000)
})

describe('a second dev session for another browser', () => {
  it('starts without making the first session compile again', async () => {
    const root = project()
    const chromium = await watchSession(root, 'chromium')
    writePersistedControlPort(controlPortFilePath(root, 'chromium'), 18998)
    writeControlToken(root, 'chromium')
    const seen = await chromium.settle()

    const firefox = await watchSession(root, 'firefox')
    await firefox.settle()
    writePersistedControlPort(controlPortFilePath(root, 'firefox'), 18999)
    writeControlToken(root, 'firefox')
    await sleep(3000)

    expect(chromium.dones).toHaveLength(seen)

    fs.writeFileSync(
      path.join(root, 'background.js'),
      'console.log("second-session-bg-v2")\n'
    )

    await sleep(3000)
    expect(chromium.dones.length).toBeGreaterThan(seen)
  }, 60000)
})
