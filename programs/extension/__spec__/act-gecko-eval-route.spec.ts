import fs from 'node:fs'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {registerActCommands} from '../commands/act'
import {makeProgram, runCli, stubProcessExit} from './command-harness'
import {bridgeStandIn} from './helpers/engine-stand-ins'
import {trackTempFolders} from './helpers/temp-folders'

const session = {
  result: {ok: false, error: {}} as unknown,
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

const loadBridge = async () =>
  bridgeStandIn({
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
  })

// Stand-ins for the debugger-protocol reads, which need a live Firefox.
const evaluateGecko = (async (options: Record<string, unknown>) => {
  protocolCalls.push(options)

  return protocolOutcome
}) as never
const evaluateGeckoTab = (async (options: Record<string, unknown>) => {
  tabCalls.push(options)
  expect(controllerCloses, 'the controller closed too early').toBe(0)

  return tabOutcome
}) as never

const makeTempFolder = trackTempFolders()

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

const run = (argv: string[]) =>
  runCli(
    makeProgram((program) =>
      registerActCommands(program, {
        loadBridge,
        evaluateGecko,
        evaluateGeckoTab
      })
    ),
    argv
  )

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

  it('never routes a content or page context over the add-on watcher', async () => {
    for (const context of ['content', 'page']) {
      logSpy.mockClear()
      tabOutcome = undefined
      controllerCloses = 0
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
    expect(frame().error.hint).toBe(
      'Firefox suspends an MV3 event page when it goes idle, and a suspended page has nothing to evaluate in. Wake the extension first, by opening one of its surfaces or triggering one of its listeners, then evaluate again.'
    )
  })

  it('gives no idle event page advice when nothing ever connected', async () => {
    session.result = {
      ok: false,
      error: {
        name: 'Unavailable',
        message:
          'no executor connected: no extension background page has connected since this dev session started. The session runs with --no-browser'
      }
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

    expect(frame().error.code).toBe('E_CONTROL_UNAVAILABLE')
    expect(frame().error.hint).toBeUndefined()
  })

  it('keeps a recorded load refusal and opens no debugger for it', async () => {
    const message =
      'no executor connected: the browser refused to load this extension, so no background page runs and no retry changes that. The browser said: background.service_worker is currently disabled. Fix what it names and save, the dev session tries the load again on the next build. If it stays refused, restart extension dev'

    session.result = {
      ok: false,
      error: {name: 'Unavailable', message, code: 'extension_load_refused'}
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
    expect(frame().status).toBe('load-refused')
    expect(frame().error.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(frame().error.message).toBe(message)
    expect(frame().error.hint).toBeUndefined()
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
    const dist = makeTempFolder('extjs-gecko-eval-')
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

  it('names the background page the session emitted', async () => {
    const dist = makeTempFolder('extjs-gecko-eval-')
    fs.writeFileSync(
      path.join(dist, 'manifest.json'),
      JSON.stringify({background: {page: 'background/index.html'}})
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
        'background',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(protocolCalls[0]).toMatchObject({
      context: 'background',
      pagePath: 'background/index.html'
    })

    expect(frame()).toMatchObject({ok: true, value: 2})
  })

  it('needs a page path for a surface context and keeps the refusal without one', async () => {
    const empty = makeTempFolder('extjs-gecko-eval-')
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

const PAGE_REFUSAL = {
  type: 'result',
  cmdId: 'c-1-1',
  ok: false,
  error: {
    name: 'EvalError',
    message: 'call to eval() blocked by CSP',
    engine: 'firefox'
  }
}

const pageEval = (extra: string[], browser = 'firefox') =>
  run([
    'eval',
    'document.title',
    '--browser',
    browser,
    '--context',
    'page',
    ...extra,
    '--output',
    'json'
  ])

describe("eval on a Gecko web page the site's own policy locks down", () => {
  beforeEach(() => {
    session.result = structuredClone(PAGE_REFUSAL)
  })

  it("evaluates through the tab's console actor and answers with the value", async () => {
    expect(await pageEval(['--tab', '7'])).toBe(0)

    expect(bridgeCommands.map((command) => command.op)).toEqual([
      'eval',
      'tabs.query'
    ])

    expect(tabCalls).toEqual([
      {
        rdpPort: 9222,
        url: 'http://127.0.0.1:8791/csp.html',
        expression: 'document.title',
        timeoutMs: 5000
      }
    ])

    expect(frame()).toMatchObject({ok: true, value: 'csp host page'})
    expect(controllerCloses).toBe(1)
  })

  it('finds the tab by --url, and by the active tab when nothing names one', async () => {
    expect(await pageEval(['--url', 'csp.html'])).toBe(0)
    expect(tabCalls[0].url).toBe('http://127.0.0.1:8791/csp.html')

    logSpy.mockClear()
    controllerCloses = 0
    session.result = structuredClone(PAGE_REFUSAL)
    expect(await pageEval([])).toBe(0)
    expect(tabCalls[1].url).toBe('moz-extension://uuid/pages/welcome.html')
  })

  it('keeps the refusal, with the page hint of the golden, when the tab cannot be told apart', async () => {
    tabOutcome = undefined

    const golden = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          'contract',
          'golden.eval.csp-blocks-eval.page.json'
        ),
        'utf8'
      )
    )

    expect(await pageEval(['--tab', '7'])).toBe(1)
    expect(frame()).toEqual(golden)
  })

  it('asks for no tab list when the tab id is not open, and keeps the refusal', async () => {
    expect(await pageEval(['--tab', '99'])).toBe(1)
    expect(tabCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_CSP_BLOCKS_EVAL')
  })

  it('stays off the debugger when the contract carries no rdpPort', async () => {
    session.readyDocument = {controlPort: 9123, instanceId: 'inst-1'}

    expect(await pageEval(['--tab', '7'])).toBe(1)
    expect(bridgeCommands.map((command) => command.op)).toEqual(['eval'])
    expect(tabCalls).toHaveLength(0)
    expect(frame().error.hint).toContain("page's own Content-Security-Policy")
  })

  it('reports a throw in the page as a guest error', async () => {
    tabOutcome = {
      ok: false,
      error: {
        name: 'EvalError',
        message: 'ReferenceError: nope is not defined',
        engine: 'firefox'
      }
    }

    expect(await pageEval(['--tab', '7'])).toBe(1)
    expect(frame().error).toMatchObject({
      code: 'E_EVAL',
      message: 'ReferenceError: nope is not defined'
    })
  })

  it('never opens the Gecko debugger for a Chromium session, and names the page policy', async () => {
    expect(await pageEval(['--tab', '7'], 'chrome')).toBe(1)

    expect(tabCalls).toHaveLength(0)
    expect(bridgeCommands.map((command) => command.op)).toEqual(['eval'])

    const {error} = frame()

    expect(error.code).toBe('E_CSP_BLOCKS_EVAL')
    expect(error.hint).toContain("page's own Content-Security-Policy")
    expect(error.hint).not.toContain('Firefox')
  })

  it('leaves a page that evaluated, or failed for another reason, alone', async () => {
    session.result = {
      ok: false,
      error: {name: 'ReferenceError', message: 'nope is not defined'}
    }

    expect(await pageEval(['--tab', '7'])).toBe(1)
    expect(tabCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_EVAL')
  })

  it('names the content-script world for a content refusal and opens no debugger', async () => {
    session.result = {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          "eval of a string is blocked in the ISOLATED (content) world by the extension's content_security_policy",
        engine: 'firefox',
        code: 'csp_blocks_eval'
      }
    }

    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'firefox',
        '--context',
        'content',
        '--tab',
        '7',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(tabCalls).toHaveLength(0)
    expect(frame().error.hint).toContain('content-script world')
  })
})

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
  const dist = makeTempFolder('extjs-gecko-inspect-')
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

  // With no page in the manifest there is nothing to open, so neither route
  // may answer "not open" and send the caller to open it.
  it('says the manifest declares no such page instead of asking to open it', async () => {
    const dist = optionsDist()
    session.result = {
      ok: false,
      error: {name: 'Unavailable', message: 'no executor connected'}
    }

    for (const command of ['inspect', 'eval']) {
      logSpy.mockClear()

      expect(
        await run([
          command,
          ...(command === 'eval' ? ['1+1'] : []),
          dist,
          '--browser',
          'firefox',
          '--context',
          'sidebar',
          '--output',
          'json'
        ])
      ).toBe(1)

      expect(protocolCalls, command).toHaveLength(0)
      expect(frame().error, command).toMatchObject({
        name: 'Unsupported',
        code: 'E_TARGET_NOT_FOUND',
        message:
          'the manifest declares no sidebar page: it has no side_panel.default_path or sidebar_action.default_panel',
        hint: `Add side_panel.default_path or sidebar_action.default_panel to manifest.json and point it at the page, then run extension ${command} --context sidebar again.`
      })
    }
  })

  it('keeps the producer refusal for an undeclared page free of the idle hint', async () => {
    session.readyDocument = {...session.readyDocument, rdpPort: 0}
    session.result = {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          'the manifest declares no devtools page: it has no devtools_page',
        engine: 'firefox',
        code: 'surface_not_declared'
      }
    }

    expect(
      await run([
        'eval',
        '1+1',
        '--browser',
        'firefox',
        '--context',
        'devtools',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(frame().error.code).toBe('E_TARGET_NOT_FOUND')
    expect(frame().error.hint).toBe(
      'Add devtools_page to manifest.json and point it at the page, then run extension eval --context devtools again.'
    )
  })

  it('never opens the Gecko debugger for a Chromium session', async () => {
    const dist = optionsDist()
    session.result = NOT_OPEN

    expect(
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
    ).toBe(1)

    expect(protocolCalls).toHaveLength(0)
    expect(frame().error).toMatchObject({
      code: 'E_TARGET_NOT_FOUND',
      message: NOT_OPEN.error.message
    })
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
