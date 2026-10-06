import {EventEmitter} from 'node:events'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createFirefoxContext} from '../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../run-firefox/firefox-launch'

const dirs: string[] = []
let tmp: string
let exitSpy: ReturnType<typeof vi.spyOn>

function logger() {
  return {info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}
}

function makePlugin() {
  return new FirefoxLaunchPlugin(
    {browser: 'firefox', extension: [tmp]} as any,
    createFirefoxContext() as any
  )
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'extjs-firefox-no-exit-'))
  dirs.push(tmp)
  writeFileSync(
    join(tmp, 'manifest.json'),
    JSON.stringify({manifest_version: 2, name: 'x', version: '1.0.0'})
  )

  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit was called')
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

describe('a Firefox launch that fails inside the compiler done hook', () => {
  it('stamps the coded failure, logs it and hands the compile back without exiting', async () => {
    const plugin = makePlugin()
    const log = logger()
    let doneHandler: any = null
    const compiler: any = {
      getInfrastructureLogger: () => log,
      hooks: {
        done: {
          tapAsync: (_name: string, fn: any) => {
            doneHandler = fn
          }
        }
      }
    }
    const readyDir = join(tmp, 'dist', 'extension-js', 'firefox')
    const readyPath = join(readyDir, 'ready.json')
    mkdirSync(readyDir, {recursive: true})
    writeFileSync(
      readyPath,
      JSON.stringify({command: 'dev', status: 'starting', runId: 'run-1'})
    )
    ;(plugin as any).extensionOutputPath = join(tmp, 'dist', 'firefox')
    ;(plugin as any).launchRunId = 'run-1'
    ;(plugin as any).launch = vi.fn().mockRejectedValueOnce(
      Object.assign(new Error('no debugger greeting'), {
        code: 'E_BROWSER_START_TIMEOUT'
      })
    )

    plugin.apply(compiler)
    expect(typeof doneHandler).toBe('function')

    const done = vi.fn()
    await doneHandler(
      {
        hasErrors: () => false,
        compilation: {options: {mode: 'development', output: {path: tmp}}}
      },
      done
    )

    expect(exitSpy).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledWith()
    expect(log.error).toHaveBeenCalled()
    expect(String(log.error.mock.calls[0][0])).toMatch(/no debugger greeting/)

    const ready = JSON.parse(readFileSync(readyPath, 'utf8'))
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('browser_launch_failed')
    expect(ready.browserLaunchFailedCode).toBe('E_BROWSER_START_TIMEOUT')
  })
})

describe('a failing recompile once Firefox is up', () => {
  it('skips the launch quietly, the skip line belongs before the first launch', async () => {
    const plugin = makePlugin()
    const log = logger()
    let doneHandler: any = null
    const compiler: any = {
      getInfrastructureLogger: () => log,
      hooks: {
        done: {
          tapAsync: (_name: string, fn: any) => {
            doneHandler = fn
          }
        }
      }
    }
    ;(plugin as any).launch = vi.fn().mockResolvedValue(undefined)
    ;(plugin as any).reportReady = vi.fn()

    plugin.apply(compiler)

    const failing = {
      hasErrors: () => true,
      compilation: {options: {mode: 'development', output: {path: tmp}}}
    }
    const skipped = () =>
      log.info.mock.calls.filter((call) =>
        /Skipping the browser launch/.test(String(call[0] || ''))
      )

    await doneHandler(failing, vi.fn())
    expect(skipped()).toHaveLength(1)
    expect((plugin as any).launch).not.toHaveBeenCalled()

    await doneHandler(
      {
        hasErrors: () => false,
        compilation: {options: {mode: 'development', output: {path: tmp}}}
      },
      vi.fn()
    )

    expect((plugin as any).launch).toHaveBeenCalledTimes(1)

    const done = vi.fn()
    await doneHandler(failing, done)
    expect(done).toHaveBeenCalledTimes(1)
    expect(skipped()).toHaveLength(1)
    expect((plugin as any).launch).toHaveBeenCalledTimes(1)
  })
})

describe('a Firefox child process that errors after it spawned', () => {
  it('is logged and left to its close handler instead of ending the process', () => {
    const plugin = makePlugin()
    const log = logger()
    ;(plugin as any).ctx.logger = log
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: null,
      stderr: null
    })
    ;(plugin as any).child = child
    ;(plugin as any).wireChildLifecycle()

    expect(() =>
      child.emit('error', new Error('EPIPE after spawn'))
    ).not.toThrow()

    expect(exitSpy).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(String(log.error.mock.calls[0][0])).toMatch(/EPIPE after spawn/)
  })
})
