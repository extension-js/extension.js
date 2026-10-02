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

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContract: () => session.readyDocument,
    readReadyContractDocument: () => session.readyDocument,
    readControlToken: () => 'tok-1',
    BridgeController: class {
      async connect() {}
      async command() {
        return session.result
      }
      close() {}
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

describe('eval on a Gecko extension document the CSP locks down', () => {
  it('evaluates over the protocol and answers with the value', async () => {
    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'firefox',
        '--context',
        'background',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(protocolCalls).toHaveLength(1)
    expect(protocolCalls[0]).toMatchObject({
      rdpPort: 9222,
      extensionId: 'repro@extension.js',
      context: 'background',
      expression: '1+1',
      timeoutMs: 5000
    })

    expect(frame()).toMatchObject({ok: true, value: 2, error: null})
  })

  it('maps a throw inside the document onto the guest-error code', async () => {
    protocolOutcome = {
      ok: false,
      error: {
        name: 'EvalError',
        message: 'nope is not defined',
        engine: 'firefox'
      }
    }

    expect(
      await run([
        'eval',
        'nope.nope',
        '--browser',
        'firefox',
        '--context',
        'background',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(frame().error).toMatchObject({
      code: 'E_EVAL',
      message: 'nope is not defined'
    })
  })

  it('keeps the CSP refusal when the contract carries no rdpPort yet', async () => {
    session.readyDocument = {controlPort: 9123, instanceId: 'inst-1'}

    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'firefox',
        '--context',
        'background',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(protocolCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_CSP_BLOCKS_EVAL')
  })

  it('never routes a Chromium session over the Gecko protocol', async () => {
    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'chrome',
        '--context',
        'background',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(protocolCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_CSP_BLOCKS_EVAL')
  })

  it('never routes a content or page context over the Gecko protocol', async () => {
    for (const context of ['content', 'page']) {
      logSpy.mockClear()
      expect(
        await run([
          'eval',
          '1+1',
          '--browser',
          'firefox',
          '--context',
          context,
          '--tab',
          '7',
          '--output',
          'json'
        ])
      ).toBe(1)

      expect(protocolCalls, context).toHaveLength(0)
      expect(frame().error.code).toBe('E_CSP_BLOCKS_EVAL')
    }
  })

  // An idled MV3 event page leaves no executor, so the bridge refuses before
  // any CSP verdict exists. The protocol route does not need the executor.
  it('routes over the protocol when no executor is connected', async () => {
    session.result = {
      ok: false,
      error: {name: 'Unavailable', message: 'no executor connected'}
    }

    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'firefox',
        '--context',
        'background',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(protocolCalls).toHaveLength(1)
    expect(frame().ok).toBe(true)
    expect(frame().value).toBe(2)
  })

  it('explains an idle event page when the protocol route is unavailable', async () => {
    session.result = {
      ok: false,
      error: {name: 'Unavailable', message: 'no executor connected'}
    }

    session.readyDocument = {...session.readyDocument, rdpPort: 0}

    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'firefox',
        '--context',
        'background',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(protocolCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_CONTROL_UNAVAILABLE')
    expect(String(frame().error.hint)).toMatch(/idle|suspend/i)
  })

  it('leaves a refusal the protocol cannot help with alone', async () => {
    session.result = {
      ok: false,
      error: {name: 'EvalDisabled', message: 'eval is not enabled here'}
    }

    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'firefox',
        '--context',
        'background',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(protocolCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_EVAL_REFUSED')
  })

  it('resolves a surface context to the page path the session emitted', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gecko-eval-'))
    fs.writeFileSync(
      path.join(dist, 'manifest.json'),
      JSON.stringify({action: {default_popup: 'action/index.html'}})
    )

    session.readyDocument = {...session.readyDocument, distPath: dist}

    expect(
      await run([
        'eval',
        '1+1',
        dist,
        '--browser',
        'firefox',
        '--context',
        'popup',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(protocolCalls[0]).toMatchObject({
      context: 'popup',
      pagePath: 'action/index.html'
    })
  })

  it('needs a page path for a surface context and keeps the refusal without one', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gecko-eval-'))
    session.readyDocument = {...session.readyDocument, distPath: empty}

    expect(
      await run([
        'eval',
        '1+1',
        empty,
        '--browser',
        'firefox',
        '--context',
        'sidebar',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(protocolCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_CSP_BLOCKS_EVAL')
  })
})
