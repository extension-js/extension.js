import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const session = {
  result: {ok: false, error: {}} as any,
  readyDocument: {
    controlPort: 9123,
    instanceId: 'inst-1',
    rdpPort: 9222,
    extensionId: 'repro@extension.js',
    distPath: '/nowhere'
  } as Record<string, unknown> | null
}

const protocolCalls: Array<Record<string, unknown>> = []
let protocolOutcome: unknown = {ok: true, value: 2}

const bridgeCommands: Array<{op?: string}> = []
const tabCalls: Array<Record<string, unknown>> = []
let tabOutcome: unknown = {ok: true, value: 'csp host page'}
let controllerCloses = 0

const OPEN_TABS = [
  {id: 7, url: 'http://127.0.0.1:8791/csp.html', active: false},
  {id: 8, url: 'moz-extension://uuid/pages/welcome.html', active: true}
]

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContract: () => session.readyDocument,
    readReadyContractDocument: () => session.readyDocument,
    readControlToken: () => 'tok-1',
    BridgeController: class {
      async connect() {}
      async command(command: {op?: string}) {
        bridgeCommands.push(command)

        return command.op === 'tabs.query'
          ? {ok: true, value: OPEN_TABS}
          : session.result
      }
      close() {
        controllerCloses++
      }
    }
  }))
}))

vi.mock(
  '../browsers/run-firefox/rdp/evaluate-extension-document',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../browsers/run-firefox/rdp/evaluate-extension-document')
      >()

    return {
      ...actual,
      evaluateExtensionDocument: async (options: Record<string, unknown>) => {
        protocolCalls.push(options)

        return protocolOutcome
      },
      evaluateTabDocument: async (options: Record<string, unknown>) => {
        tabCalls.push(options)
        expect(controllerCloses, 'the controller closed too early').toBe(0)

        return tabOutcome
      }
    }
  }
)

import {registerActCommands} from '../commands/act'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const CSP_REFUSAL = {
  ok: false,
  error: {
    name: 'Unsupported',
    message:
      "eval is blocked in the extension background by the extension's content_security_policy",
    engine: 'firefox',
    code: 'csp_blocks_eval'
  }
}

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  protocolCalls.length = 0
  protocolOutcome = {ok: true, value: 2}
  bridgeCommands.length = 0
  tabCalls.length = 0
  tabOutcome = {ok: true, value: 'csp host page'}
  controllerCloses = 0
  session.result = CSP_REFUSAL
  session.readyDocument = {
    controlPort: 9123,
    instanceId: 'inst-1',
    rdpPort: 9222,
    extensionId: 'repro@extension.js',
    distPath: '/nowhere'
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const run = (argv: string[]) => runCli(makeProgram(registerActCommands), argv)

const frame = () => JSON.parse(String(logSpy.mock.calls[0][0]))

// A Firefox start session had no relay in its production pages, so a page the
// bridge cannot reach is read over the debugger, the way eval already is.
const NOT_OPEN = {
  ok: false,
  error: {
    name: 'Unsupported',
    message:
      "surface 'options' is not open (open it first: extension open options)",
    engine: 'firefox',
    code: 'surface_not_open'
  }
}

const SNAPSHOT = {
  url: 'moz-extension://uuid/options/index.html',
  title: 'Options 974',
  summary: {htmlLength: 120, scriptCount: 1, styleCount: 0}
}

function optionsDist() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gecko-inspect-'))
  fs.writeFileSync(
    path.join(dist, 'manifest.json'),
    JSON.stringify({options_ui: {page: 'options/index.html'}})
  )

  session.readyDocument = {...session.readyDocument, distPath: dist}

  return dist
}

describe('inspect on a Gecko extension page the bridge cannot reach', () => {
  it('reads the page over the debugger and answers the snapshot', async () => {
    const dist = optionsDist()
    session.result = NOT_OPEN
    protocolOutcome = {ok: true, value: SNAPSHOT}

    expect(
      await run([
        'inspect',
        dist,
        '--browser',
        'firefox',
        '--context',
        'options',
        '--include',
        'summary,html',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(protocolCalls).toHaveLength(1)
    expect(protocolCalls[0]).toMatchObject({
      rdpPort: 9222,
      extensionId: 'repro@extension.js',
      context: 'options',
      pagePath: 'options/index.html'
    })

    expect(String(protocolCalls[0].expression)).toContain('outerHTML')
    expect(frame()).toMatchObject({ok: true, value: SNAPSHOT})
  })

  it('keeps the bridge refusal when the debugger cannot read the page either', async () => {
    const dist = optionsDist()
    session.result = NOT_OPEN
    protocolOutcome = {
      ok: false,
      error: {name: 'Unavailable', message: 'no document', engine: 'firefox'}
    }

    expect(
      await run([
        'inspect',
        dist,
        '--browser',
        'firefox',
        '--context',
        'options',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(frame().error.code).toBe('E_TARGET_NOT_FOUND')
  })

  it('never opens the Gecko debugger for a Chromium session', async () => {
    const dist = optionsDist()
    session.result = NOT_OPEN

    await run([
      'inspect',
      dist,
      '--browser',
      'chrome',
      '--context',
      'options',
      '--output',
      'json'
    ])

    expect(protocolCalls).toHaveLength(0)
  })
})

describe('a refused injection in a tab that exists', () => {
  it('is not reported as a missing target', async () => {
    session.result = {
      ok: false,
      error: {
        name: 'InjectionRefused',
        message: 'Missing host permission for the tab',
        engine: 'firefox',
        code: 'injection_refused'
      }
    }

    expect(
      await run([
        'inspect',
        '--browser',
        'firefox',
        '--context',
        'page',
        '--tab',
        '8',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(frame().error.code).toBe('E_COMMAND_UNSUPPORTED_FOR_TARGET')
    expect(frame().error.message).toContain('Missing host permission')
  })
})
