import {EventEmitter} from 'events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// tryRuntimeReinjection now opens a fresh MessagingClient per call so the
// per-connection WatcherActor emits a current target every time. Stub
// the messaging-client module so tests inject the same mock-client they
// already wire onto RemoteFirefox.client.
let mockClientFactory: () => any = () => ({
  connect: async () => {},
  disconnect: () => {}
})
vi.mock(
  '../../../../run-firefox/firefox-source-inspection/remote-firefox/messaging-client',
  () => ({
    MessagingClient: class {
      private impl: any
      constructor() {
        this.impl = mockClientFactory()
      }
      connect = (port: number) => this.impl.connect?.(port) ?? Promise.resolve()
      disconnect = () => this.impl.disconnect?.()
      on = (event: string, cb: (msg: unknown) => void) =>
        this.impl.on?.(event, cb)
      removeListener = (event: string, cb: (msg: unknown) => void) =>
        this.impl.removeListener?.(event, cb)
      emit = (event: string, payload: unknown) =>
        this.impl.emit?.(event, payload)
      request = (req: unknown) => this.impl.request?.(req)
      getTargets = () => this.impl.getTargets?.()
      getTargetFromDescriptor = (id: string) =>
        this.impl.getTargetFromDescriptor?.(id)
      evaluate = (actor: string, expr: string) =>
        this.impl.evaluate?.(actor, expr)
      navigate = (...args: unknown[]) => this.impl.navigate?.(...args)
      navigateViaScript = (...args: unknown[]) =>
        this.impl.navigateViaScript?.(...args)
      waitForLoadEvent = (...args: unknown[]) =>
        this.impl.waitForLoadEvent?.(...args)
      attach = (...args: unknown[]) => this.impl.attach?.(...args)
    }
  })
)

import {reinjectMatchingTabsViaAddonRuntime} from '../../../../run-firefox/firefox-source-inspection/remote-firefox/runtime-reinject'
import {RemoteFirefox} from '../../../../run-firefox/firefox-source-inspection/remote-firefox'
import type {ContentScriptTargetRule} from '../../../../browsers-lib/content-script-targets'

function makeRule(
  index: number,
  matches: string[],
  world: 'extension' | 'main' = 'extension'
): ContentScriptTargetRule {
  return {
    index,
    world,
    matches,
    excludeMatches: [],
    includeGlobs: [],
    excludeGlobs: []
  }
}

function setupFixture() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-firefox-rt-'))
  const csDir = path.join(fixtureDir, 'content_scripts')
  fs.mkdirSync(csDir, {recursive: true})
  const jsPath = path.join(csDir, 'content-0.js')
  fs.writeFileSync(
    jsPath,
    'globalThis.__EXTENSIONJS_REINJECT_BUILD_TOKEN = "abc123";'
  )
  return {fixtureDir, jsPath}
}

// Build a mock RDP client wired for the watcher-based discovery flow:
// listAddons (root) → getWatcher (descriptor) → watchTargets (watcher) →
// target-available-form messages → evaluate kickoff + poll.
function makeMockClient(
  opts: {
    addons?: Array<{id?: string; actor?: string}>
    targets?: Array<{
      url?: string
      actor?: string
      consoleActor?: string
      targetType?: string
    }>
    capturedTargets?: Array<{
      url?: string
      actor?: string
      consoleActor?: string
      targetType?: string
    }>
    runtimeResult?: {
      reinjectedTabs: number
      hasRuntime: boolean
      hasScripting?: boolean
      entries?: number
      matches?: unknown[]
    } | null
    runtimeError?: string | null
  } = {}
) {
  const emitter = new EventEmitter()
  const addons = opts.addons ?? [{id: 'ext@example', actor: 'webExt-1'}]
  const watcherActor = 'watcher-1'
  const captured = opts.capturedTargets ?? [
    {
      url: 'moz-extension://abc/_generated_background_page.html',
      actor: 'bg-target',
      consoleActor: 'bg-console',
      targetType: 'frame'
    }
  ]
  const targets = opts.targets ?? [{url: 'https://docs.example.com/page'}]
  const runtimeResult = opts.runtimeResult ?? {
    reinjectedTabs: 1,
    hasRuntime: true,
    hasScripting: true,
    entries: 1,
    matches: [{index: 0, queriedTabs: 1, matchingTabs: 1}]
  }
  const runtimeError = opts.runtimeError ?? null

  const request = vi.fn(async (req: any) => {
    if (req?.to === 'root' && req?.type === 'listAddons') {
      return {addons}
    }
    if (req?.type === 'getWatcher') {
      return {actor: watcherActor}
    }
    if (req?.to === watcherActor && req?.type === 'watchTargets') {
      // Flush captured target-available-form messages on the next tick.
      setImmediate(() => {
        for (const target of captured) {
          emitter.emit('message', {
            from: watcherActor,
            type: 'target-available-form',
            target
          })
        }
      })
      return {}
    }
    return {}
  })
  const getTargets = vi.fn(async () => targets)
  const getTargetFromDescriptor = vi.fn(async () => ({}))
  const evaluate = vi.fn(async (_actor: string, expr: string) => {
    // Kickoff sets globalThis[<key>] = ...; poll reads it. Distinguish by
    // looking for the assignment.
    const isKickoff = /globalThis\['__EXTJS_REINJECT_RESULT_[^']+'\] = ''/.test(
      expr
    )
    if (isKickoff) return 'started'
    if (runtimeError) return `ERR:${runtimeError}`
    if (!runtimeResult) return ''
    return `OK:${JSON.stringify(runtimeResult)}`
  })
  const navigate = vi.fn(async () => {})
  const navigateViaScript = vi.fn(async () => {})
  const waitForLoadEvent = vi.fn(async () => {})
  const attach = vi.fn(async () => {})

  // Make sure on/emit/removeListener delegate to the EventEmitter so the
  // production code's client.on('message', ...) paths work.
  const client = Object.assign(emitter, {
    request,
    getTargets,
    getTargetFromDescriptor,
    evaluate,
    navigate,
    navigateViaScript,
    waitForLoadEvent,
    attach
  })

  return {
    client,
    request,
    getTargets,
    evaluate,
    navigate,
    navigateViaScript
  }
}

describe('reinjectMatchingTabsViaAddonRuntime', () => {
  let fixtureDir: string

  beforeEach(() => {
    vi.restoreAllMocks()
    const fixture = setupFixture()
    fixtureDir = fixture.fixtureDir
  })

  afterEach(() => {
    try {
      fs.rmSync(fixtureDir, {recursive: true, force: true})
    } catch {}
  })

  it('skips when no rules', async () => {
    const {client} = makeMockClient()
    const result = await reinjectMatchingTabsViaAddonRuntime(client as any, {
      outPath: fixtureDir,
      rules: [],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: () => true
    })
    expect(result.reinjectedTabs).toBe(0)
    expect(result.report.phase).toBe('skipped')
    expect(result.report.reason).toBe('no_rules')
  })

  it('skips when no tab URL matches the rule', async () => {
    const {client} = makeMockClient({targets: [{url: 'https://other.test/p'}]})
    const result = await reinjectMatchingTabsViaAddonRuntime(client as any, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'])],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: (url) => url.includes('example.com')
    })
    expect(result.reinjectedTabs).toBe(0)
    expect(result.report.phase).toBe('skipped')
    expect(result.report.reason).toBe('no_payload')
  })

  it('reports unavailable when no addon descriptor matches addonId', async () => {
    const {client} = makeMockClient({addons: []})
    const result = await reinjectMatchingTabsViaAddonRuntime(client as any, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'])],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: () => true
    })
    expect(result.reinjectedTabs).toBe(0)
    expect(result.report.phase).toBe('unavailable')
    expect(result.report.reason).toBe('no_runtime_target')
  })

  it('reports unavailable when watcher emits no frame target', async () => {
    const {client} = makeMockClient({capturedTargets: []})
    const result = await reinjectMatchingTabsViaAddonRuntime(client as any, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'])],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: () => true
    })
    expect(result.reinjectedTabs).toBe(0)
    expect(result.report.phase).toBe('unavailable')
    expect(result.report.reason).toBe('no_runtime_target')
  })

  it('evaluates against addon background console (kickoff + poll, watcher-discovered)', async () => {
    const {client, evaluate} = makeMockClient()
    const result = await reinjectMatchingTabsViaAddonRuntime(client as any, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'])],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: () => true
    })
    expect(result.reinjectedTabs).toBe(1)
    expect(result.report.phase).toBe('evaluated')
    expect(result.report.hasRuntime).toBe(true)
    // First eval is the kickoff expression, then at least one poll.
    expect(evaluate).toHaveBeenCalled()
    expect(evaluate.mock.calls[0][0]).toBe('bg-console')
  })

  it('reports runtime_threw when the runtime sets the error key', async () => {
    const {client} = makeMockClient({runtimeError: 'browser.scripting denied'})
    const result = await reinjectMatchingTabsViaAddonRuntime(client as any, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'])],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: () => true
    })
    expect(result.reinjectedTabs).toBe(0)
    expect(result.report.phase).toBe('unavailable')
    expect(String(result.report.reason || '')).toContain('runtime_threw')
  })

  it('skips world:"main" rules (Firefox does not support MAIN world via scripting until FF 128)', async () => {
    const {client} = makeMockClient()
    const result = await reinjectMatchingTabsViaAddonRuntime(client as any, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'], 'main')],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: () => true
    })
    expect(result.reinjectedTabs).toBe(0)
    expect(result.report.phase).toBe('skipped')
    expect(result.report.reason).toBe('no_payload')
  })
})

describe('RemoteFirefox.registerContentScriptsForFutureNavigations (F2)', () => {
  let fixtureDir: string

  beforeEach(() => {
    vi.restoreAllMocks()
    fixtureDir = setupFixture().fixtureDir
  })

  afterEach(() => {
    try {
      fs.rmSync(fixtureDir, {recursive: true, force: true})
    } catch {}
  })

  it('subscribes to message events when registered with active rules', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client} = makeMockClient()
    const onSpy = vi.spyOn(client, 'on')
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])

    expect(onSpy).toHaveBeenCalledWith('message', expect.any(Function))
  })

  it('runs runtime reinject when a matching tabNavigated stop event fires', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true})
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client, evaluate} = makeMockClient()
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])

    client.emit('message', {
      type: 'tabNavigated',
      state: 'stop',
      url: 'https://docs.example.com/new-page'
    })

    await vi.advanceTimersByTimeAsync(2000)
    expect(evaluate).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('ignores non-matching tabNavigated events', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true})
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client, evaluate} = makeMockClient()
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])
    client.emit('message', {
      type: 'tabNavigated',
      state: 'stop',
      url: 'https://other.test/page'
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(evaluate).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('coalesces a burst of navigations into a single reinject pass', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true})
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client, request} = makeMockClient()
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])
    for (let i = 0; i < 5; i++) {
      client.emit('message', {
        type: 'tabNavigated',
        state: 'stop',
        url: `https://docs.example.com/p${i}`
      })
    }
    await vi.advanceTimersByTimeAsync(2000)
    // listAddons should only fire once across the coalesced burst.
    const listCalls = request.mock.calls.filter(
      (call: any[]) => call[0]?.type === 'listAddons'
    )
    expect(listCalls.length).toBe(1)
    vi.useRealTimers()
  })

  it('only installs the message listener once across re-registrations', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client} = makeMockClient()
    const onSpy = vi.spyOn(client, 'on')
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])
    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*']),
      makeRule(1, ['https://api.example.com/*'])
    ])
    const messageListeners = onSpy.mock.calls.filter(
      (call: any[]) => call[0] === 'message'
    )
    expect(messageListeners.length).toBe(1)
  })
})

describe('RemoteFirefox.probeRuntimeCapability (F3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('caches scripting availability when the addon background reports it', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client} = makeMockClient()
    // probeRuntimeCapability calls evaluate directly with a small probe
    // expression — return a JSON string.
    client.evaluate = vi.fn(async () =>
      JSON.stringify({hasScripting: true})
    ) as any
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'

    const result = await rf.probeRuntimeCapability()
    expect(result?.hasScripting).toBe(true)
    expect(rf.getRuntimeCapability()?.hasScripting).toBe(true)
  })

  it('returns null when the addon descriptor has no matching id', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client} = makeMockClient({addons: []})
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'

    const result = await rf.probeRuntimeCapability()
    expect(result).toBeNull()
  })

  it('does not re-probe once a result is cached', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    ;(rf as any).cachedRuntimeCapability = {
      hasScripting: false,
      probedAt: 12345
    }
    const result = await rf.probeRuntimeCapability()
    expect(result?.hasScripting).toBe(false)
    expect(result?.probedAt).toBe(12345)
  })
})

describe('RemoteFirefox.reloadMatchingTabsForContentScripts (runtime-first)', () => {
  let fixtureDir: string

  beforeEach(() => {
    vi.restoreAllMocks()
    fixtureDir = setupFixture().fixtureDir
  })

  afterEach(() => {
    try {
      fs.rmSync(fixtureDir, {recursive: true, force: true})
    } catch {}
  })

  it('prefers runtime reinjection and never navigates tabs when it succeeds', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client, navigate, navigateViaScript} = makeMockClient()
    ;(rf as any).client = client
    mockClientFactory = () => client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    const reloaded = await rf.reloadMatchingTabsForContentScripts([
      makeRule(0, ['https://*.example.com/*'])
    ])

    expect(reloaded).toBe(1)
    expect(navigate).not.toHaveBeenCalled()
    expect(navigateViaScript).not.toHaveBeenCalled()
    const report = rf.getLastRuntimeReinjectionReport()
    expect(report?.phase).toBe('evaluated')
  })

  it('falls back to reinstall+navigate when runtime path is unavailable', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const navigate = vi.fn(async () => {})
    const client: any = Object.assign(new EventEmitter(), {
      getTargets: vi.fn(async () => [
        {
          actor: 'tab-1',
          consoleActor: 'console-1',
          url: 'https://docs.example.com/page'
        }
      ]),
      navigate,
      waitForLoadEvent: vi.fn(async () => {}),
      navigateViaScript: vi.fn(async () => {}),
      attach: vi.fn(async () => {}),
      getTargetFromDescriptor: vi.fn(async () => ({}))
    })

    ;(rf as any).client = client
    mockClientFactory = () => client
    // No cachedAddonsActor / derivedExtensionId / lastInstalledAddonPath →
    // runtime path is skipped immediately, legacy fallback runs.

    const reloaded = await rf.reloadMatchingTabsForContentScripts([
      makeRule(0, ['https://*.example.com/*'])
    ])

    expect(reloaded).toBe(1)
    expect(navigate).toHaveBeenCalledWith('tab-1', 'https://docs.example.com/page')
    const report = rf.getLastRuntimeReinjectionReport()
    expect(report?.phase).toBe('skipped')
  })
})
