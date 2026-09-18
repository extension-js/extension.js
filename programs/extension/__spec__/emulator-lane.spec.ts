import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const bridge = vi.hoisted(() => ({
  document: null as Record<string, unknown> | null,
  controllers: 0
}))

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContractDocument: () => bridge.document,
    readReadyContract: () =>
      bridge.document
        ? {controlPort: 9123, instanceId: 'inst-1', runId: 'run-1'}
        : null,
    readControlToken: () => null,
    readPersistedControlPort: () => 9123,
    controlPortFilePath: (p: string, b: string) => `${p}/${b}`,
    BridgeController: class {
      constructor() {
        bridge.controllers++
      }
      async connect() {
        return {}
      }
      async command() {
        return {ok: true}
      }
      close() {}
    },
    BridgeConsumer: class {
      start() {
        bridge.controllers++
      }
      close() {}
    }
  }))
}))

import {launchBrowser} from '../browsers'
import {
  EMULATOR_BROWSERS,
  isChromiumBrowser,
  isEmulatorBrowser
} from '../browsers/browsers-lib/browser-family'
import {launchEmulator, openCommandFor} from '../browsers/run-emulator'
import {registerActCommands} from '../commands/act'
import {runDoctor} from '../commands/doctor'
import {registerLogsCommand} from '../commands/logs'
import {
  EMULATOR_LOGS_REFUSAL,
  emulatorRefusalFor,
  isEmulatorSession
} from '../helpers/emulator-session'
import {
  BROWSER_TARGETS_HELP,
  NO_SAFARI_BROWSER_TARGETS_HELP,
  SUPPORTED_BROWSER_TARGETS,
  supportedBrowserTargets,
  validateVendors
} from '../helpers/vendors'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const VIEWER_URL =
  'https://browsers.extension.land/chromium/#files=http%3A%2F%2F127.0.0.1%3A8080%2F__extjs-emulator%2Ffiles.json&instance=inst-1&v=1'

let errorSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>
let dir: string

beforeEach(() => {
  stubProcessExit()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  bridge.document = null
  bridge.controllers = 0
  delete process.env.EXTENSION_EXPERIMENTAL_EMULATOR
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emulator-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.EXTENSION_EXPERIMENTAL_EMULATOR
  fs.rmSync(dir, {recursive: true, force: true})
})

function reject(list: string[], options?: {allowEmulator?: boolean}) {
  let refused = ''
  const ok = validateVendors(
    list,
    (invalid) => {
      refused = invalid
    },
    options
  )

  return {ok, refused}
}

describe('chromium-emulator name gating', () => {
  it('refuses the name like any unknown name without the env flag', () => {
    expect(reject(['chromium-emulator'])).toEqual({
      ok: false,
      refused: 'chromium-emulator'
    })

    expect(supportedBrowserTargets({})).not.toContain('chromium-emulator')
  })

  it('accepts the name when EXTENSION_EXPERIMENTAL_EMULATOR=1', () => {
    process.env.EXTENSION_EXPERIMENTAL_EMULATOR = '1'
    expect(reject(['chromium-emulator'])).toEqual({ok: true, refused: ''})
    expect(
      supportedBrowserTargets({EXTENSION_EXPERIMENTAL_EMULATOR: '1'})
    ).toContain('chromium-emulator')
  })

  it('keeps start and preview refusing it even with the flag set', () => {
    process.env.EXTENSION_EXPERIMENTAL_EMULATOR = '1'
    expect(reject(['chromium-emulator'], {allowEmulator: false}).ok).toBe(false)
  })

  it('never lists the hidden name in help or the public target list', () => {
    process.env.EXTENSION_EXPERIMENTAL_EMULATOR = '1'
    expect(SUPPORTED_BROWSER_TARGETS).not.toContain('chromium-emulator')
    expect(BROWSER_TARGETS_HELP).not.toContain('emulator')
    expect(NO_SAFARI_BROWSER_TARGETS_HELP).not.toContain('emulator')
  })

  it('is its own engine family, never a Chromium binary launch', () => {
    expect([...EMULATOR_BROWSERS]).toEqual(['chromium-emulator'])
    expect(isEmulatorBrowser('chromium-emulator')).toBe(true)
    expect(isChromiumBrowser('chromium-emulator')).toBe(false)
    expect(isEmulatorBrowser('chromium')).toBe(false)
  })
})

describe('emulator launcher', () => {
  it('prints the viewer URL and opens it through the opener', async () => {
    const opened: string[] = []
    await launchEmulator(
      {
        browser: 'chromium-emulator',
        mode: 'development',
        emulatorViewerUrl: VIEWER_URL
      },
      (url) => opened.push(url)
    )

    expect(opened).toEqual([VIEWER_URL])
    expect(String(logSpy.mock.calls.flat().join('\n'))).toContain(VIEWER_URL)
  })

  it('respects --no-open and still prints the URL', async () => {
    const opened: string[] = []
    await launchEmulator(
      {
        browser: 'chromium-emulator',
        mode: 'development',
        noOpen: true,
        emulatorViewerUrl: VIEWER_URL
      },
      (url) => opened.push(url)
    )

    expect(opened).toEqual([])
    expect(String(logSpy.mock.calls.flat().join('\n'))).toContain(VIEWER_URL)
  })

  it('refuses outside extension dev and without a served URL', async () => {
    await expect(
      launchEmulator(
        {browser: 'chromium-emulator', emulatorViewerUrl: VIEWER_URL},
        () => {}
      )
    ).rejects.toThrow(/needs the dev server/)

    await expect(
      launchEmulator({browser: 'chromium-emulator', mode: 'development'})
    ).rejects.toThrow(/does not serve emulated Chromium/)
  })

  it('routes launchBrowser to the emulator with no CDP controller', async () => {
    const controller = await launchBrowser({
      browser: 'chromium-emulator',
      outputPath: dir,
      contextDir: dir,
      extensionsToLoad: [dir],
      mode: 'development',
      noOpen: true,
      emulatorViewerUrl: VIEWER_URL
    })
    expect(controller.retryExtensionLoad).toBeUndefined()
    expect(controller.getExtensionLoadRefusal).toBeUndefined()
    await controller.enableUnifiedLogging({level: 'off'})
  })

  it('picks the platform opener without a shell', () => {
    expect(openCommandFor(VIEWER_URL, 'darwin')).toEqual({
      command: 'open',
      args: [VIEWER_URL]
    })

    expect(openCommandFor(VIEWER_URL, 'linux').command).toBe('xdg-open')
    expect(openCommandFor(VIEWER_URL, 'win32')).toEqual({
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', VIEWER_URL]
    })
  })
})

describe('tooling refuses an emulator session', () => {
  it('detects the session from ready.json engine, not from the name alone', () => {
    const reader = {
      readReadyContractDocument: () => ({engine: 'emulator'})
    }
    expect(isEmulatorSession(reader, dir, 'chromium-emulator', {})).toBe(true)
    expect(isEmulatorSession({}, dir, 'chromium-emulator', {})).toBe(false)
    expect(
      isEmulatorSession({}, dir, 'chromium-emulator', {
        EXTENSION_EXPERIMENTAL_EMULATOR: '1'
      })
    ).toBe(true)

    expect(
      isEmulatorSession(
        {readReadyContractDocument: () => ({engine: undefined})},
        dir,
        'chromium',
        {}
      )
    ).toBe(false)
  })

  it('logs refuses with the one sentence and never opens a consumer', async () => {
    bridge.document = {engine: 'emulator'}
    const program = makeProgram(registerLogsCommand)
    const code = await runCli(program, [
      'logs',
      dir,
      '--browser',
      'chromium-emulator',
      '--follow',
      '--output',
      'pretty'
    ])
    expect(code).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(EMULATOR_LOGS_REFUSAL)
    expect(bridge.controllers).toBe(0)
  })

  it('act verbs refuse before dialing the control channel', async () => {
    bridge.document = {engine: 'emulator'}
    const program = makeProgram(registerActCommands)
    const code = await runCli(program, [
      'eval',
      '1+1',
      dir,
      '--browser',
      'chromium-emulator'
    ])
    expect(code).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(emulatorRefusalFor('eval'))
    expect(bridge.controllers).toBe(0)
  })

  it('doctor refuses with one engine check instead of misreporting', async () => {
    bridge.document = {engine: 'emulator'}
    const results = await runDoctor(dir, {browser: 'chromium-emulator'})
    expect(results).toEqual([
      {check: 'engine', status: 'fail', detail: emulatorRefusalFor('doctor')}
    ])

    expect(bridge.controllers).toBe(0)
  })

  it('leaves a chromium session alone', async () => {
    bridge.document = {engine: undefined}
    const results = await runDoctor(dir, {browser: 'chromium'})
    expect(results.map((r) => r.check)).not.toContain('engine')
  })
})
