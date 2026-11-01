//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const bridge = {
  ready: null as Record<string, unknown> | null
}

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContract: () => bridge.ready,
    resolveSessionProjectRoot: (input: string) => input
  }))
}))

import {fakeSafariUiTools} from '../browsers/__spec__/safari-fake-ui-tools'
import {
  registerSafariCommand,
  setSafariUiToolsForTests
} from '../commands/safari'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let logSpy: MockInstance<typeof console.log>
let errorSpy: MockInstance<typeof console.error>
let writeSpy: MockInstance<typeof fs.writeSync>
let frames: string[]
let project: string

function run(argv: string[]) {
  return runCli(makeProgram(registerSafariCommand), argv)
}

function lastFrame(): Record<string, unknown> {
  const line = frames.find((text) => text.startsWith('{"schema":1'))
  expect(line, `no envelope among ${JSON.stringify(frames)}`).toBeDefined()

  return JSON.parse(String(line))
}

beforeEach(() => {
  stubProcessExit()
  frames = []
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    frames.push(args.map(String).join(' '))
  })

  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  writeSpy = vi.spyOn(fs, 'writeSync').mockImplementation(((
    _fd: number,
    text: string
  ) => {
    frames.push(String(text).trim())

    return String(text).length
  }) as never)

  bridge.ready = null
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-cmd-'))
  fs.writeFileSync(
    path.join(project, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'My Ext',
      version: '1.0.0',
      commands: {
        _execute_action: {suggested_key: {default: 'Alt+Shift+H'}}
      }
    })
  )
})

afterEach(() => {
  setSafariUiToolsForTests(undefined)
  vi.restoreAllMocks()
  fs.rmSync(project, {recursive: true, force: true})
})

describe('extension safari', () => {
  it('reads the toolbar button as one envelope', async () => {
    setSafariUiToolsForTests(
      fakeSafariUiTools({
        unsigned: 1,
        registered: true,
        button: {title: 'My Ext: on', tooltip: 'My Ext: on', badge: '3'}
      })
    )

    const code = await run(['safari', 'button', project, '--output', 'json'])

    expect(code).toBe(0)
    expect(lastFrame()).toMatchObject({
      schema: 1,
      ok: true,
      command: 'safari',
      status: 'ok',
      browser: 'safari',
      value: {
        appName: 'My Ext',
        bundleId: 'dev.extensionjs.My-Ext',
        found: true,
        id: 'WebExtension-dev.extensionjs.My-Ext.Extension (UNSIGNED)',
        title: 'My Ext: on',
        badge: '3'
      },
      error: null
    })
  })

  it('lists the context menu titles', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools({unsigned: 1, registered: true}))

    await run(['safari', 'menu', project, '--output', 'json'])

    expect(lastFrame().value).toMatchObject({
      found: true,
      opened: true,
      items: [
        {title: 'Clear list', enabled: true},
        {title: 'Settings', enabled: true}
      ]
    })
  })

  it('presses the manifest shortcut when --keys is not given', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools())

    await run(['safari', 'press', project, '--output', 'json'])

    expect(lastFrame().value).toMatchObject({
      shortcut: 'Alt+Shift+H',
      key: 'h',
      modifiers: ['option down', 'shift down']
    })
  })

  it('presses --keys over the manifest', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools())

    await run([
      'safari',
      'press',
      project,
      '--keys',
      'Ctrl+Shift+Y',
      '--output',
      'json'
    ])

    expect(lastFrame().value).toMatchObject({
      shortcut: 'Ctrl+Shift+Y',
      modifiers: ['command down', 'shift down']
    })
  })

  it('reads the shortcut Settings shows and spells it the manifest way', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools({unsigned: 1, registered: true}))

    await run(['safari', 'shortcut', project, '--output', 'json'])

    expect(lastFrame().value).toMatchObject({
      listed: true,
      shown: '⌥⇧H',
      shortcut: 'Alt+Shift+H'
    })
  })

  it('takes the bundle id from the running Safari session', async () => {
    bridge.ready = {extensionId: 'com.example.custom.Extension'}
    setSafariUiToolsForTests(fakeSafariUiTools({unsigned: 1, registered: true}))

    await run(['safari', 'button', project, '--output', 'json'])

    expect(lastFrame().value).toMatchObject({
      bundleId: 'com.example.custom',
      id: 'WebExtension-com.example.custom.Extension (UNSIGNED)'
    })
  })

  it('enables through the three steps and answers the read-backs', async () => {
    const tools = fakeSafariUiTools()
    setSafariUiToolsForTests(tools)
    const dist = path.join(project, 'dist', 'safari')
    fs.mkdirSync(dist, {recursive: true})
    fs.copyFileSync(
      path.join(project, 'manifest.json'),
      path.join(dist, 'manifest.json')
    )

    fs.mkdirSync(
      path.join(
        project,
        'dist',
        'safari-xcode',
        '.derived',
        'Build',
        'Products',
        'Release',
        'My Ext.app',
        'Contents',
        'PlugIns',
        'My Ext Extension.appex'
      ),
      {recursive: true}
    )

    const code = await run(['safari', 'enable', project, '--output', 'json'])

    expect(code).toBe(0)
    expect(lastFrame().value).toMatchObject({
      enabled: true,
      listed: true,
      otherWebsites: 'Allow'
    })

    expect(tools.calls).toEqual([
      'probe',
      'running',
      'enabled:read',
      'unsigned:on',
      expect.stringMatching(/My Ext Extension\.appex$/),
      'enabled:on',
      'websites:allow'
    ])
  })

  it('refuses enable when no Safari app was built', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools())

    const code = await run(['safari', 'enable', project, '--output', 'json'])

    expect(code).toBe(1)
    expect(lastFrame()).toMatchObject({
      ok: false,
      status: 'not-found',
      error: {code: 'E_TARGET_NOT_FOUND'}
    })
  })

  it('refuses with one message naming the Accessibility pane and the host', async () => {
    setSafariUiToolsForTests(
      fakeSafariUiTools({accessibility: false, host: 'Cursor'})
    )

    const code = await run(['safari', 'button', project, '--output', 'json'])

    expect(code).toBe(1)
    const frame = lastFrame()
    expect(frame).toMatchObject({
      ok: false,
      status: 'denied',
      browser: 'safari',
      error: {code: 'E_ACCESSIBILITY_DENIED'}
    })

    expect(String((frame.error as {message: string}).message)).toContain(
      'Cursor'
    )

    expect(String(frame.hint)).toContain(
      'System Settings ▸ Privacy & Security ▸ Accessibility'
    )

    expect(String(frame.hint)).toContain('Cursor')
    const human = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(human).toContain('Privacy & Security ▸ Accessibility')
    expect(human).toContain('Cursor')
  })

  it('refuses off macOS without running a script', async () => {
    const tools = fakeSafariUiTools({platform: 'linux'})
    setSafariUiToolsForTests(tools)

    const code = await run(['safari', 'menu', project, '--output', 'json'])

    expect(code).toBe(1)
    expect(lastFrame()).toMatchObject({
      ok: false,
      error: {code: 'E_SAFARI_TOOLCHAIN'}
    })

    expect(tools.calls).toEqual([])
  })

  it('refuses an action it does not know as usage', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools())

    const code = await run(['safari', 'dance', project, '--output', 'json'])

    expect(code).toBe(1)
    expect(lastFrame()).toMatchObject({
      status: 'usage',
      error: {code: 'E_INVALID_OPTION'}
    })
  })

  it('says when the toolbar has no button for the extension', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools({button: null}))

    const code = await run(['safari', 'button', project, '--output', 'json'])

    expect(code).toBe(1)
    expect(lastFrame()).toMatchObject({
      status: 'not-found',
      error: {code: 'E_TARGET_NOT_FOUND'}
    })
  })

  it('frames a script failure as E_SAFARI_UI', async () => {
    setSafariUiToolsForTests(
      fakeSafariUiTools({scriptFails: 'Safari Settings did not open'})
    )

    const code = await run(['safari', 'shortcut', project, '--output', 'json'])

    expect(code).toBe(1)
    expect(lastFrame()).toMatchObject({
      status: 'failed',
      error: {code: 'E_SAFARI_UI', message: 'Safari Settings did not open'}
    })
  })

  it('prints the value as pretty JSON without a frame by default', async () => {
    setSafariUiToolsForTests(fakeSafariUiTools({unsigned: 1, registered: true}))

    const code = await run(['safari', 'shortcut', project])

    expect(code).toBe(0)
    expect(frames.some((text) => text.startsWith('{"schema":1'))).toBe(false)
    expect(logSpy.mock.calls.join('\n')).toContain('"shortcut": "Alt+Shift+H"')
    expect(writeSpy).not.toHaveBeenCalled()
  })
})
