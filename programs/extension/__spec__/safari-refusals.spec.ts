import fs from 'node:fs'
import * as path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {
  type FakeSafariState,
  fakeSafariUiTools
} from '../browsers/__spec__/safari-fake-ui-tools'
import type {SafariUiTools} from '../browsers/run-safari/safari-ui'
import {readScriptHeader} from '../browsers/run-safari/safari-ui/scripts'
import {registerSafariCommand} from '../commands/safari'
import {makeProgram, runCli, stubProcessExit} from './command-harness'
import {bridgeStandIn} from './helpers/engine-stand-ins'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()
const BUTTON_ID = 'WebExtension-dev.extensionjs.My-Ext.Extension (UNSIGNED)'

const loadBridge = async () =>
  bridgeStandIn({
    readReadyContract: () => null,
    resolveSessionProjectRoot: (input: string) => input
  })

let errorSpy: MockInstance<typeof console.error>
let written: string[]

beforeEach(() => {
  stubProcessExit()
  written = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(fs, 'writeSync').mockImplementation(((_fd: number, text: string) => {
    written.push(String(text).trim())

    return String(text).length
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function projectWith(manifest: Record<string, unknown>): string {
  const project = makeTempFolder('extjs-safari-refusal-')

  fs.writeFileSync(
    path.join(project, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'My Ext',
      version: '1.0.0',
      ...manifest
    })
  )

  return project
}

// Only fake tools reach the command, so no script runs against Safari.
function run(tools: SafariUiTools, argv: string[]) {
  return runCli(
    makeProgram((program) =>
      registerSafariCommand(program, {createUiTools: () => tools, loadBridge})
    ),
    argv
  )
}

// The stubbed exit throws inside the action's own catch, which frames it a
// second time. A real exit ends the process at the first frame.
function firstFrame(): Record<string, unknown> {
  expect(written.length).toBeGreaterThan(0)

  return JSON.parse(written[0])
}

function stderrText(): string {
  return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
}

function fake(overrides: Partial<FakeSafariState> = {}) {
  return fakeSafariUiTools({unsigned: 1, registered: true, ...overrides})
}

describe('extension safari refusals', () => {
  it('refuses menu when the toolbar has no button for the extension', async () => {
    const code = await run(fake({button: null}), [
      'safari',
      'menu',
      projectWith({}),
      '--output',
      'json'
    ])

    expect(code).toBe(1)
    expect(firstFrame()).toEqual({
      schema: 1,
      ok: false,
      command: 'safari',
      status: 'not-found',
      value: null,
      error: {
        code: 'E_TARGET_NOT_FOUND',
        message: `Safari's toolbar has no button ${BUTTON_ID}.`,
        name: 'CliError'
      },
      hint: 'Turn the extension on in Safari Settings, Extensions, then run again.',
      browser: 'safari',
      warnings: []
    })

    expect(stderrText()).toContain(BUTTON_ID)
  })

  it('refuses press when neither --keys nor the manifest names a shortcut', async () => {
    const tools = fake()
    const code = await run(tools, [
      'safari',
      'press',
      projectWith({}),
      '--output',
      'json'
    ])

    expect(code).toBe(1)
    expect(firstFrame()).toEqual({
      schema: 1,
      ok: false,
      command: 'safari',
      status: 'usage',
      value: null,
      error: {
        code: 'E_INVALID_OPTION',
        message: 'The manifest declares no commands shortcut to press.',
        name: 'CliError'
      },
      hint: 'Pass --keys <shortcut>, for example --keys Alt+Shift+H.',
      browser: 'safari',
      warnings: []
    })

    expect(tools.calls).toEqual(['probe'])
  })

  it('refuses shortcut when Safari does not list the extension', async () => {
    const code = await run(fake({registered: false}), [
      'safari',
      'shortcut',
      projectWith({}),
      '--output',
      'json'
    ])

    expect(code).toBe(1)
    expect(firstFrame()).toEqual({
      schema: 1,
      ok: false,
      command: 'safari',
      status: 'not-found',
      value: null,
      error: {
        code: 'E_TARGET_NOT_FOUND',
        message:
          'Safari does not list dev.extensionjs.My-Ext in Settings, Extensions.',
        name: 'CliError'
      },
      hint: 'Run extension safari enable first.',
      browser: 'safari',
      warnings: []
    })
  })

  it('refuses as denied when the grant is lost after the probe passed', async () => {
    const granted = fake({host: 'Cursor'})
    const tools: SafariUiTools = {
      ...granted,
      runScript: async (source) =>
        readScriptHeader(source)?.kind === 'probe'
          ? granted.runScript(source)
          : {
              ok: false,
              code: 1,
              output:
                'execution error: osascript is not allowed assistive access. (-1719)'
            }
    }

    const code = await run(tools, [
      'safari',
      'button',
      projectWith({}),
      '--output',
      'json'
    ])

    expect(code).toBe(1)
    expect(firstFrame()).toEqual({
      schema: 1,
      ok: false,
      command: 'safari',
      status: 'denied',
      value: null,
      error: {
        code: 'E_ACCESSIBILITY_DENIED',
        message:
          "macOS has not granted Cursor Accessibility, so Safari's own UI can't be read.",
        name: 'CliError'
      },
      hint: 'Open System Settings ▸ Privacy & Security ▸ Accessibility, add Cursor, and run again.',
      browser: 'safari',
      warnings: []
    })

    expect(stderrText()).toContain('Cursor')
  })

  it('prints the refusal on stderr alone without --output json', async () => {
    const code = await run(fake({registered: false}), [
      'safari',
      'shortcut',
      projectWith({})
    ])

    expect(code).toBe(1)
    expect(written).toEqual([])
    expect(stderrText()).toContain('dev.extensionjs.My-Ext')
  })
})
