import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const CHROME_ID = 'fddgkoildhakngagamnhmeehkmadmpaj'
const CHROME_DEMO = `chrome-extension://${CHROME_ID}/pages/demo.html`
const FIREFOX_BASE = 'moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/'
const FIREFOX_DEMO = `${FIREFOX_BASE}pages/demo.html`

const session = {
  result: {ok: false, error: {}} as any,
  readyDocument: {} as Record<string, unknown> | null,
  tabs: [] as Array<Record<string, unknown>>
}

const bridgeCommands: Array<{op?: string}> = []
const cdpCalls: Array<Record<string, unknown>> = []
const rdpCalls: Array<Record<string, unknown>> = []
let cdpOutcome: unknown
let rdpOutcome: unknown
let controllerCloses = 0

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
          ? {ok: true, value: session.tabs}
          : session.result
      }
      close() {
        controllerCloses++
      }
    }
  }))
}))

vi.mock('../browsers/run-chromium/cdp/evaluate-tab-document', () => ({
  evaluateChromiumTabDocument: async (options: Record<string, unknown>) => {
    cdpCalls.push(options)
    expect(controllerCloses, 'the controller closed too early').toBe(0)

    return cdpOutcome
  }
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
      evaluateTabDocument: async (options: Record<string, unknown>) => {
        rdpCalls.push(options)

        return rdpOutcome
      }
    }
  }
)

import {ownExtensionPageBase, registerActCommands} from '../commands/act'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const CHROMIUM_REFUSAL = {
  ok: false,
  error: {
    name: 'InjectionRefused',
    message: `Cannot access contents of url "${CHROME_DEMO}". Extension manifest must request permission to access this host.`,
    engine: 'chromium',
    code: 'injection_refused'
  }
}

const FIREFOX_REFUSAL = {
  ok: false,
  error: {
    name: 'InjectionRefused',
    message: 'Missing host permission for the tab',
    engine: 'firefox',
    code: 'injection_refused'
  }
}

const SNAPSHOT = {
  url: CHROME_DEMO,
  title: 'Probe Demo',
  summary: {htmlLength: 196, scriptCount: 1, styleCount: 0}
}

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  bridgeCommands.length = 0
  cdpCalls.length = 0
  rdpCalls.length = 0
  cdpOutcome = {ok: true, value: SNAPSHOT}
  rdpOutcome = {ok: true, value: 'Probe Demo'}
  controllerCloses = 0
  // The command writes its hint onto the frame, so each run gets its own.
  session.result = structuredClone(CHROMIUM_REFUSAL)
  session.readyDocument = {
    controlPort: 9123,
    instanceId: 'inst-1',
    cdpPort: 9222,
    extensionId: CHROME_ID
  }

  session.tabs = [
    {id: 5, url: 'chrome://extensions/', active: false},
    {id: 6, url: CHROME_DEMO, active: true}
  ]
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const run = (argv: string[]) => runCli(makeProgram(registerActCommands), argv)

const frame = () => JSON.parse(String(logSpy.mock.calls[0][0]))

describe("a tab on the extension's own page, on Chromium", () => {
  it('is inspected over the debugger port when injection is refused', async () => {
    expect(
      await run([
        'inspect',
        '--browser',
        'chrome',
        '--context',
        'page',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(frame().ok).toBe(true)
    expect(frame().value).toEqual(SNAPSHOT)
    expect(bridgeCommands.map((command) => command.op)).toEqual([
      'inspect',
      'tabs.query'
    ])

    expect(cdpCalls).toHaveLength(1)
    expect(cdpCalls[0].cdpPort).toBe(9222)
    expect(cdpCalls[0].url).toBe(CHROME_DEMO)
    expect(String(cdpCalls[0].expression)).toContain('htmlLength')
  })

  it('evaluates the expression there, addressed by tab id', async () => {
    cdpOutcome = {ok: true, value: 'Probe Demo'}
    session.tabs = [
      {id: 5, url: 'https://example.com/', active: true},
      {id: 6, url: CHROME_DEMO, active: false}
    ]

    expect(
      await run([
        'eval',
        'document.title',
        '--browser',
        'chrome',
        '--context',
        'page',
        '--tab',
        '6',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(frame().value).toBe('Probe Demo')
    expect(cdpCalls[0].expression).toBe('document.title')
    expect(cdpCalls[0].url).toBe(CHROME_DEMO)
  })

  it('reports what the expression threw there as an eval failure', async () => {
    cdpOutcome = {
      ok: false,
      error: {
        name: 'ReferenceError',
        message: 'nope is not defined',
        engine: 'chromium'
      }
    }

    expect(
      await run([
        'eval',
        'nope',
        '--browser',
        'chrome',
        '--context',
        'page',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(frame().error.code).toBe('E_EVAL')
    expect(frame().error.message).toBe('nope is not defined')
  })

  it('keeps the refusal and says why when the contract has no debugger port', async () => {
    session.readyDocument = {
      controlPort: 9123,
      instanceId: 'inst-1',
      extensionId: CHROME_ID
    }

    expect(
      await run([
        'inspect',
        '--browser',
        'chrome',
        '--context',
        'page',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(cdpCalls).toHaveLength(0)
    expect(frame().error.code).toBe('E_COMMAND_UNSUPPORTED_FOR_TARGET')
    expect(frame().error.message).toContain('must request permission')
    expect(frame().error.hint).toContain('debugger port')
    expect(frame().error.hint).toContain('--context options')
  })

  it('does not read a page of another extension', async () => {
    session.tabs = [
      {
        id: 6,
        url: 'chrome-extension://kgdaecdpfkikjncaalnmmnjjfpofkcbl/pages/welcome.html',
        active: true
      }
    ]

    expect(
      await run([
        'inspect',
        '--browser',
        'chrome',
        '--context',
        'page',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(cdpCalls).toHaveLength(0)
    expect(frame().error.hint).toContain('another extension')
  })

  it('names the page context when the content world was asked for', async () => {
    expect(
      await run([
        'inspect',
        '--browser',
        'chrome',
        '--context',
        'content',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(cdpCalls).toHaveLength(0)
    expect(frame().error.hint).toContain('--context page')
  })

  it('leaves a refusal on a web page alone', async () => {
    session.tabs = [{id: 6, url: 'https://example.com/', active: true}]

    expect(
      await run([
        'inspect',
        '--browser',
        'chrome',
        '--context',
        'page',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(cdpCalls).toHaveLength(0)
    expect(frame().error.hint).toBeUndefined()
  })
})

describe("a tab on the extension's own page, on Firefox", () => {
  beforeEach(() => {
    session.result = structuredClone(FIREFOX_REFUSAL)
    session.readyDocument = {
      controlPort: 9123,
      instanceId: 'inst-1',
      rdpPort: 6000,
      extensionId: 'probe@temporary-addon',
      extensionBaseUrl: FIREFOX_BASE
    }

    session.tabs = [
      {id: 1, url: 'about:blank', active: false},
      {id: 3, url: FIREFOX_DEMO, active: true}
    ]
  })

  it('is evaluated through the tab console actor', async () => {
    expect(
      await run([
        'eval',
        'document.title',
        '--browser',
        'firefox',
        '--context',
        'page',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(frame().value).toBe('Probe Demo')
    expect(cdpCalls).toHaveLength(0)
    expect(rdpCalls).toHaveLength(1)
    expect(rdpCalls[0].rdpPort).toBe(6000)
    expect(rdpCalls[0].url).toBe(FIREFOX_DEMO)
    expect(rdpCalls[0].expression).toBe('document.title')
  })

  it('is inspected with the snapshot the bridge would have answered', async () => {
    rdpOutcome = {ok: true, value: {...SNAPSHOT, url: FIREFOX_DEMO}}

    expect(
      await run([
        'inspect',
        '--browser',
        'firefox',
        '--context',
        'page',
        '--include',
        'html,summary',
        '--output',
        'json'
      ])
    ).toBe(0)

    expect(frame().value.url).toBe(FIREFOX_DEMO)
    expect(String(rdpCalls[0].expression)).toContain('outerHTML')
  })

  it('keeps the refusal when the contract carries no base url', async () => {
    delete (session.readyDocument as Record<string, unknown>).extensionBaseUrl

    expect(
      await run([
        'inspect',
        '--browser',
        'firefox',
        '--context',
        'page',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(rdpCalls).toHaveLength(0)
    expect(frame().error.message).toContain('Missing host permission')
    expect(frame().error.hint).toContain('extension address')
  })
})

describe('ownExtensionPageBase', () => {
  it('builds the Chromium base from the id on the contract', () => {
    expect(ownExtensionPageBase({extensionId: CHROME_ID}, 'chrome')).toBe(
      `chrome-extension://${CHROME_ID}/`
    )

    expect(ownExtensionPageBase({extensionId: 'not-an-id'}, 'chrome')).toBe(
      undefined
    )
  })

  it('takes the Firefox base only as the browser stamped it', () => {
    expect(
      ownExtensionPageBase(
        {extensionId: 'probe@temporary-addon', extensionBaseUrl: FIREFOX_BASE},
        'firefox'
      )
    ).toBe(FIREFOX_BASE)

    expect(
      ownExtensionPageBase({extensionId: 'probe@temporary-addon'}, 'firefox')
    ).toBe(undefined)

    expect(ownExtensionPageBase(null, 'firefox')).toBe(undefined)
  })
})
