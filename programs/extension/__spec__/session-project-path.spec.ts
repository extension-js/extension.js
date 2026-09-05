import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// The mocked bridge carries the real develop-side walk so these specs prove
// the readers agree with dev, not with a stand-in.
const state = vi.hoisted(() => ({
  ready: null as unknown,
  readyReads: [] as unknown[][],
  commands: [] as unknown[]
}))

vi.mock('../helpers/extension-develop-runtime', async () => {
  const {resolveSessionProjectRoot} = await import(
    '../../develop/lib/session-project-root'
  )
  return {
    loadExtensionDevelopBridgeModule: vi.fn(async () => ({
      resolveSessionProjectRoot,
      readReadyContract: (...args: unknown[]) => {
        state.readyReads.push(args)
        return state.ready
      },
      readControlToken: () => 'tok',
      readPersistedControlPort: () => 4001,
      controlPortFilePath: (p: string, b: string) =>
        `${p}/.extension-js/control-port-${b}`,
      BridgeController: class {
        async connect() {
          return {capabilities: {storage: true, reload: true}}
        }
        async command(payload: unknown) {
          state.commands.push(payload)
          return {ok: true, value: {}}
        }
        close() {}
      },
      BridgeConsumer: class {
        start() {}
        close() {}
      }
    }))
  }
})

import {readRecentConsole, registerActCommands} from '../commands/act'
import {runWaitMode} from '../commands/dev-wait'
import {runDoctor} from '../commands/doctor'
import {registerLogsCommand} from '../commands/logs'
import {
  resolveSessionProjectPath,
  sessionReadyPath
} from '../helpers/session-project-path'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let root: string
let src: string
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

function writeSessionLogs(browser: string) {
  const out = path.join(root, 'dist', 'extension-js', browser)
  fs.mkdirSync(out, {recursive: true})
  fs.writeFileSync(
    path.join(out, 'logs.ndjson'),
    [
      JSON.stringify({v: 1, type: 'header', runId: 'r'}),
      JSON.stringify({
        seq: 1,
        level: 'log',
        context: 'content',
        messageParts: ['from-root']
      })
    ].join('\n'),
    'utf8'
  )
}

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-spp-')))
  src = path.join(root, 'src')
  fs.mkdirSync(src, {recursive: true})
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"ext"}')
  fs.writeFileSync(
    path.join(src, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'ext', version: '1.0.0'})
  )
  state.ready = null
  state.readyReads = []
  state.commands = []
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('resolveSessionProjectPath', () => {
  it('keeps the argument as given when the bridge predates the resolver', () => {
    expect(resolveSessionProjectPath({}, src)).toBe(src)
    expect(resolveSessionProjectPath(undefined, src)).toBe(src)
  })

  it('names the ready contract under the resolved root', () => {
    expect(sessionReadyPath({}, root, 'chromium')).toBe(
      path.join(root, 'dist', 'extension-js', 'chromium', 'ready.json')
    )
    expect(
      sessionReadyPath(
        {readyContractPath: (p: string, b: string) => `${p}/x/${b}`},
        root,
        'chromium'
      )
    ).toBe(`${root}/x/chromium`)
  })
})

describe('doctor given the manifest folder', () => {
  it('reads the contract where dev wrote it', async () => {
    state.ready = {
      controlPort: 4001,
      instanceId: 'inst-1',
      runId: 'run-A',
      status: 'ready',
      pid: process.pid,
      cdpPort: 9222
    }
    await runDoctor(src, {browser: 'chromium'})
    expect(state.readyReads[0][0]).toBe(root)
  })

  it('names the absolute ready path when nothing is running', async () => {
    const results = await runDoctor(src, {})
    const contract = results.find((r) => r.check === 'ready-contract')
    expect(contract?.status).toBe('fail')
    expect(contract?.detail).toContain(
      path.join(root, 'dist', 'extension-js', 'chromium', 'ready.json')
    )
  })

  it('still finds a session from the package root', async () => {
    const dir = path.join(root, 'dist', 'extension-js', 'firefox')
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(path.join(dir, 'ready.json'), '{"status":"ready"}')
    state.ready = {controlPort: 1, instanceId: 'i', status: 'ready'}
    await runDoctor(root, {})
    expect(state.readyReads[0]).toEqual([root, 'firefox'])
  })
})

describe('session verbs given the manifest folder', () => {
  const run = (argv: string[]) => runCli(makeProgram(registerActCommands), argv)

  it('opens a surface through the root session', async () => {
    state.ready = {controlPort: 9123, instanceId: 'inst-1'}
    expect(await run(['open', 'popup', src])).toBe(0)
    expect(state.readyReads[0][0]).toBe(root)
    expect(state.commands).toHaveLength(1)
  })

  it('prints the absolute location it checked when no session runs', async () => {
    expect(await run(['storage', 'get', src])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      path.join(root, 'dist', 'extension-js', 'chromium', 'ready.json')
    )
  })

  it('reads the recent console from the root session', async () => {
    writeSessionLogs('chromium')
    state.ready = {controlPort: 9123, instanceId: 'inst-1'}
    expect(
      await run(['inspect', src, '--with-console', '5', '--output', 'json'])
    ).toBe(0)
    const printed = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(printed.console[0]).toMatchObject({messageParts: ['from-root']})
    expect(readRecentConsole(root, 'chromium', {}, 5)).toHaveLength(1)
  })
})

describe('logs given the manifest folder', () => {
  const run = (argv: string[]) => runCli(makeProgram(registerLogsCommand), argv)

  it('reads the root log file in one-shot mode', async () => {
    writeSessionLogs('chromium')
    expect(await run(['logs', src, '--output', 'ndjson'])).toBe(0)
    expect(logSpy.mock.calls).toHaveLength(1)
  })

  it('names the absolute ready path when follow finds no session', async () => {
    expect(await run(['logs', src, '--follow', '--output', 'ndjson'])).toBe(1)
    expect(state.readyReads[0][0]).toBe(root)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      path.join(root, 'dist', 'extension-js', 'chromium', 'ready.json')
    )
  })
})

describe('dev --wait given the manifest folder', () => {
  it('finds the contract dev writes at the package root', async () => {
    const dir = path.join(root, 'dist', 'extension-js', 'chromium')
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'ready.json'),
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        pid: process.pid,
        compiledAt: new Date().toISOString()
      })
    )
    const result = await runWaitMode({
      command: 'dev',
      pathOrRemoteUrl: src,
      browsers: ['chromium'],
      waitTimeout: '2000',
      waitFormat: 'json'
    })
    expect(result.results[0]).toMatchObject({browser: 'chromium'})
  })
})
