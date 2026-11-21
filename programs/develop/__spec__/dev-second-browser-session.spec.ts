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
  } as Parameters<typeof webpackConfig>[1])
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  const compiler: Compiler = rspack(config)
  const dones: Stats[] = []
  // The files that started each compile, so a stray recompile shows by name.
  const changed: string[][] = []
  let lastDoneAt = 0
  compiler.hooks.watchRun.tap('spec-second-session', (watched) => {
    changed.push([...(watched.modifiedFiles ?? [])].map(real))
  })

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
    changed,
    settle,
    close: () =>
      new Promise<void>((resolve) => {
        watching.close(() => resolve())
      })
  }
  sessions.push(session)

  return session
}

// The temp folder can sit behind a symlink the bundler resolves.
function real(file: string) {
  try {
    return fs.realpathSync(file)
  } catch {
    return file
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(check: () => boolean, deadlineMs: number) {
  const giveUpAt = Date.now() + deadlineMs
  while (!check() && Date.now() < giveUpAt) await sleep(50)
}

// A source edit after the writes under test is the end marker: a recompile
// those writes caused lands before its compile or inside it, by name.
async function editAndWait(
  root: string,
  session: Awaited<ReturnType<typeof watchSession>>,
  seen: number,
  text: string
) {
  fs.writeFileSync(path.join(root, 'background.js'), `console.log("${text}")\n`)
  // Edit-to-done latency grows on a loaded machine, so poll up to 30s.
  await waitUntil(() => session.dones.length > seen, 30_000)

  return session.changed.slice(seen)
}

describe('a first dev session', () => {
  it('compiles once at startup although it creates dist under the watched root', async () => {
    const root = project()
    const chromium = await watchSession(root, 'chromium')
    const seen = await chromium.settle()

    expect(seen).toBe(1)
    expect(await editAndWait(root, chromium, seen, 'v2')).toEqual([
      [real(path.join(root, 'background.js'))]
    ])
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

    expect(await editAndWait(root, chromium, seen, 'v2')).toEqual([
      [real(path.join(root, 'background.js'))]
    ])
  }, 90000)
})
