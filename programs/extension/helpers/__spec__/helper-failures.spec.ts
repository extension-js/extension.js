import fs from 'node:fs'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {resolveConfigBrowser} from '../config-browser'
import {
  loadExtensionDevelopModule,
  resolveExtensionDevelopRoot
} from '../extension-develop-runtime'
import {KNOWN_COMMANDS} from '../known-commands'
import {CODES} from '../messaging'
import {resolveNoBrowser} from '../no-browser'
import {
  enforceSupportedNodeVersion,
  unsupportedNodeVersionFrame
} from '../node-version-guard'
import {setupParentWatchdog} from '../parent-watchdog'
import {detectInvokedCommand} from '../telemetry-cli'

const makeTempFolder = trackTempFolders()

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the safari command and the known command list', () => {
  it('counts safari runs under their own name', () => {
    expect(KNOWN_COMMANDS.has('safari')).toBe(true)
    expect(
      detectInvokedCommand(['node', 'extension', 'safari', 'button'])
    ).toBe('safari')
  })
})

describe('the runtime guard under --output json', () => {
  const jsonBuild = ['node', 'extension', 'build', '--output', 'json']

  function refuse(run: () => void) {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const write = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)

    expect(run).toThrow('exit')

    return {exit, error, log, write}
  }

  it.each([
    ['Bun', '1.1.38', undefined, 'Requires Bun >= 1.2'],
    ['Deno', undefined, '2.4.0', 'Requires Deno >= 2.5'],
    ['Deno', undefined, '2.8.0', 'Deno 2.8.0 cannot load node:querystring']
  ])('refuses an old %s with one envelope on stdout', (_runtime, bun, deno, needle) => {
    const seen = refuse(() =>
      enforceSupportedNodeVersion('22.12.0', bun, deno, jsonBuild)
    )

    expect(String(seen.error.mock.calls[0][0])).toContain(needle)
    expect(seen.write).toHaveBeenCalledTimes(1)

    const frame = JSON.parse(String(seen.write.mock.calls[0][1]))

    expect(frame).toMatchObject({
      ok: false,
      command: 'build',
      status: 'usage',
      error: {code: 'E_NODE_VERSION'}
    })

    expect(frame.error.message).toContain(needle)
    expect(frame.error.message).not.toContain('[Extension.js]')
    expect(seen.exit).toHaveBeenCalledWith(1)
  })

  it('writes the envelope for an old Node', () => {
    const seen = refuse(() =>
      enforceSupportedNodeVersion('20.19.4', undefined, undefined, jsonBuild)
    )

    expect(seen.write).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(seen.write.mock.calls[0][1]))).toMatchObject({
      ok: false,
      command: 'build',
      status: 'usage',
      error: {code: 'E_NODE_VERSION'}
    })
  })

  it('prints the envelope with console.log when stdout refuses the write', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw Object.assign(new Error('EAGAIN'), {code: 'EAGAIN'})
    })

    expect(() =>
      enforceSupportedNodeVersion('20.19.4', undefined, undefined, jsonBuild)
    ).toThrow('exit')

    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      ok: false,
      command: 'build',
      error: {code: 'E_NODE_VERSION'}
    })

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('names the command after a flag typed before it', () => {
    const frame = unsupportedNodeVersionFrame('20.19.4', [
      'node',
      'extension',
      '--browser',
      'firefox',
      'build',
      '--output',
      'json'
    ])

    expect(frame?.command).toBe('build')
  })
})

describe('a config file that throws', () => {
  function projectWithThrowingConfig(): string {
    const dir = makeTempFolder('extjs-throwing-config-')

    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"probe"}')

    // CommonJS on purpose: Node 22.12 leaves a stray rejection behind when a
    // required ES module throws, and that fails the run, not the test.
    fs.writeFileSync(
      path.join(dir, 'extension.config.js'),
      "throw new Error('config boom')\n" +
        "module.exports = {commands: {dev: {noBrowser: true, browser: 'firefox'}}}\n"
    )

    return dir
  }

  // The engine reads the same file before it builds or launches anything and
  // fails the run with E_CONFIG_LOAD, so these answers never reach a launch.
  it('leaves the answer to the engine, which refuses the same config', async () => {
    vi.stubEnv('EXTENSION_CLI_NO_BROWSER', undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const project = projectWithThrowingConfig()

    await expect(resolveNoBrowser(project, 'dev')).resolves.toBe(false)
    await expect(resolveConfigBrowser(project, 'dev')).resolves.toBeUndefined()

    const develop = await loadExtensionDevelopModule()

    for (const command of ['dev', 'build', 'start', 'preview'] as const) {
      await expect(
        develop.loadCommandConfig(project, command)
      ).rejects.toMatchObject({code: CODES.E_CONFIG_LOAD})
    }
  })

  it.each([
    'dev',
    'start',
    'preview'
  ] as const)('keeps a typed --no-browser for %s whatever the config does', async (command) => {
    vi.stubEnv('EXTENSION_CLI_NO_BROWSER', '1')
    const loadDevelop = vi.fn(async () => ({
      loadCommandConfig: async () => {
        throw new Error('config boom')
      }
    }))

    await expect(
      resolveNoBrowser('/nowhere', command, loadDevelop)
    ).resolves.toBe(true)

    expect(loadDevelop).not.toHaveBeenCalled()
  })
})

describe('locating the extension-develop runtime', () => {
  it('warns once that an EXTENSION_DEVELOP_ROOT with no runtime is ignored', () => {
    const wrong = makeTempFolder('extjs-wrong-root-')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const start = makeTempFolder('extjs-start-')

    vi.stubEnv('EXTENSION_DEVELOP_ROOT', wrong)
    vi.stubEnv('EXTENSION_CREATE_DEVELOP_ROOT', undefined)

    const root = resolveExtensionDevelopRoot(start)

    expect(root).not.toBe(wrong)
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name
    ).toBe('extension-develop')

    expect(process.env.EXTENSION_DEVELOP_ROOT).toBe(root)
    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)

    const line = String(warn.mock.calls[0][0])

    expect(line).toContain('EXTENSION_DEVELOP_ROOT')
    expect(line).toContain(wrong)
    expect(line).toContain('no extension-develop package')

    // A second ask in the same run, with the variable back on the wrong path.
    vi.stubEnv('EXTENSION_DEVELOP_ROOT', wrong)
    resolveExtensionDevelopRoot(start)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('throws E_RUNTIME_NOT_FOUND when no candidate holds a package manifest', async () => {
    const start = makeTempFolder('extjs-start-')
    const exists = fs.existsSync.bind(fs)

    vi.stubEnv('EXTENSION_DEVELOP_ROOT', undefined)
    // Stands for an install with no extension-develop beside the CLI.
    vi.spyOn(fs, 'existsSync').mockImplementation((file) =>
      path.basename(String(file)) === 'package.json' ? false : exists(file)
    )

    expect(() => resolveExtensionDevelopRoot(start)).toThrow(
      expect.objectContaining({
        code: CODES.E_RUNTIME_NOT_FOUND,
        message: 'Unable to locate the extension-develop runtime.'
      })
    )

    await expect(loadExtensionDevelopModule(start)).rejects.toMatchObject({
      code: CODES.E_RUNTIME_NOT_FOUND,
      message: 'Unable to locate the extension-develop runtime.'
    })

    expect(process.env.EXTENSION_DEVELOP_ROOT).toBeUndefined()
  })
})

describe('the parent watchdog shutdown', () => {
  const PARENT = 4242

  // Both probes are answered here: no signal leaves and no process ends.
  function watchShutdown() {
    vi.useFakeTimers()

    return {
      kill: vi.spyOn(process, 'kill').mockImplementation(() => true),
      exit: vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never)
    }
  }

  it('sends itself SIGTERM once, then exits 1 when the grace period runs out', () => {
    const {kill, exit} = watchShutdown()
    const log = vi.fn()
    const emitFrame = vi.fn()

    setupParentWatchdog(PARENT, {log, emitFrame, isAlive: () => false})

    expect(log.mock.calls).toEqual([
      [
        `[Extension.js] Parent process ${PARENT} is gone (--parent-pid). Shutting down.`
      ]
    ])

    expect(emitFrame).toHaveBeenCalledTimes(1)
    expect(kill.mock.calls).toEqual([[process.pid, 'SIGTERM']])
    expect(exit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(4999)
    expect(exit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(exit.mock.calls).toEqual([[1]])
  })

  it('leaves the frame, the signal and the exit to a session that ended itself', () => {
    const {kill, exit} = watchShutdown()
    const emitFrame = vi.fn()
    const endSession = vi.fn(() => true)

    setupParentWatchdog(PARENT, {
      log: () => {},
      endSession,
      emitFrame,
      isAlive: () => false
    })

    expect(endSession).toHaveBeenCalledTimes(1)
    expect(emitFrame).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(exit).not.toHaveBeenCalled()
  })

  it.each([
    ['no session is live', () => false],
    [
      'ending the session throws',
      () => {
        throw new Error('engine gone')
      }
    ]
  ])('frames and signals itself when %s', (_name, endSession) => {
    const {kill} = watchShutdown()
    const emitFrame = vi.fn()

    setupParentWatchdog(PARENT, {
      log: () => {},
      endSession,
      emitFrame,
      isAlive: () => false
    })

    expect(emitFrame).toHaveBeenCalledTimes(1)
    expect(kill.mock.calls).toEqual([[process.pid, 'SIGTERM']])
  })

  it('exits 1 at once when the signal to itself cannot be sent', () => {
    const {kill, exit} = watchShutdown()

    kill.mockImplementation(() => {
      throw new Error('kill EPERM')
    })

    setupParentWatchdog(PARENT, {log: () => {}, isAlive: () => false})

    expect(exit.mock.calls).toEqual([[1]])
  })

  it('shuts down on the first poll that finds the parent gone, and only once', () => {
    const {kill} = watchShutdown()
    const answers = [true, true, false, false]
    const isAlive = vi.fn(() => answers.shift() ?? false)

    setupParentWatchdog(PARENT, {log: () => {}, isAlive})

    vi.advanceTimersByTime(2000)
    expect(kill).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2000)
    expect(kill.mock.calls).toEqual([[process.pid, 'SIGTERM']])

    vi.advanceTimersByTime(4000)
    expect(isAlive).toHaveBeenCalledTimes(3)
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('never shuts down after its cancel is called', () => {
    const {kill, exit} = watchShutdown()
    const cancel = setupParentWatchdog(PARENT, {
      log: () => {},
      isAlive: () => true
    })

    cancel()
    vi.advanceTimersByTime(60_000)

    expect(kill).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })
})
