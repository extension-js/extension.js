import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
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
    const client = {} as any
    const result = await reinjectMatchingTabsViaAddonRuntime(client, {
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
    const client = {
      getTargets: vi.fn(async () => [{url: 'https://other.test/page'}])
    } as any
    const result = await reinjectMatchingTabsViaAddonRuntime(client, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'])],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: (url, rule) =>
        rule.matches.some((m) =>
          url.includes(m.replace('*.', '').replace('*', ''))
        )
    })
    expect(result.reinjectedTabs).toBe(0)
    expect(result.report.phase).toBe('skipped')
    expect(result.report.reason).toBe('no_payload')
  })

  it('reports unavailable when addon descriptor is missing', async () => {
    const client = {
      getTargets: vi.fn(async () => [{url: 'https://docs.example.com/page'}]),
      request: vi.fn(async () => ({addons: []})),
      getTargetFromDescriptor: vi.fn(async () => ({}))
    } as any
    const result = await reinjectMatchingTabsViaAddonRuntime(client, {
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

  it('evaluates against addon background console when descriptor resolves', async () => {
    const evaluate = vi.fn(async () => ({
      value: {
        reinjectedTabs: 2,
        hasRuntime: true,
        hasScripting: true,
        entries: 1,
        matches: [{index: 0, queriedTabs: 2, matchingTabs: 2}]
      }
    }))
    const client = {
      getTargets: vi.fn(async () => [
        {url: 'https://docs.example.com/page'},
        {url: 'https://api.example.com/v1'}
      ]),
      request: vi.fn(async (req: any) => {
        if (req.type === 'listAddons') {
          return {addons: [{id: 'ext@example', actor: 'webExt-1'}]}
        }
        return {}
      }),
      getTargetFromDescriptor: vi.fn(async () => ({
        targetActor: 'bg-target',
        consoleActor: 'bg-console'
      })),
      evaluate
    } as any
    const result = await reinjectMatchingTabsViaAddonRuntime(client, {
      outPath: fixtureDir,
      rules: [makeRule(0, ['https://*.example.com/*'])],
      addonsActor: 'addonsActor',
      addonId: 'ext@example',
      matchUrl: () => true
    })
    expect(result.reinjectedTabs).toBe(2)
    expect(result.report.phase).toBe('evaluated')
    expect(result.report.hasRuntime).toBe(true)
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate.mock.calls[0][0]).toBe('bg-console')
  })

  it('skips world:"main" rules (Firefox does not support MAIN world via scripting until FF 128)', async () => {
    const client = {
      getTargets: vi.fn(async () => [{url: 'https://docs.example.com/page'}])
    } as any
    const result = await reinjectMatchingTabsViaAddonRuntime(client, {
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

  function makeListenerClient() {
    const handlers: Array<(msg: unknown) => void> = []
    const evaluate = vi.fn(async () => ({
      value: {
        reinjectedTabs: 1,
        hasRuntime: true,
        hasScripting: true,
        entries: 1,
        matches: [{index: 0, queriedTabs: 1, matchingTabs: 1}]
      }
    }))
    const client = {
      on: vi.fn((event: string, cb: (msg: unknown) => void) => {
        if (event === 'message') handlers.push(cb)
      }),
      getTargets: vi.fn(async () => [{url: 'https://docs.example.com/page'}]),
      request: vi.fn(async (req: any) => {
        if (req.type === 'listAddons') {
          return {addons: [{id: 'ext@example', actor: 'webExt-1'}]}
        }
        return {}
      }),
      getTargetFromDescriptor: vi.fn(async () => ({
        targetActor: 'bg-target',
        consoleActor: 'bg-console'
      })),
      evaluate
    }
    return {client, handlers, evaluate}
  }

  it('subscribes to message events when registered with active rules', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client} = makeListenerClient()
    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])

    expect(client.on).toHaveBeenCalledTimes(1)
    expect((client.on as any).mock.calls[0][0]).toBe('message')
  })

  it('runs runtime reinject when a matching tabNavigated stop event fires', async () => {
    vi.useFakeTimers()
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client, handlers, evaluate} = makeListenerClient()
    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])
    expect(handlers.length).toBe(1)

    handlers[0]({
      type: 'tabNavigated',
      state: 'stop',
      url: 'https://docs.example.com/new-page'
    })

    expect(evaluate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(evaluate).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('ignores non-matching tabNavigated events', async () => {
    vi.useFakeTimers()
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client, handlers, evaluate} = makeListenerClient()
    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])
    handlers[0]({
      type: 'tabNavigated',
      state: 'stop',
      url: 'https://other.test/page'
    })
    await vi.advanceTimersByTimeAsync(150)
    expect(evaluate).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('coalesces a burst of navigations into a single reinject pass', async () => {
    vi.useFakeTimers()
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client, handlers, evaluate} = makeListenerClient()
    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'
    ;(rf as any).lastInstalledAddonPath = fixtureDir

    await rf.registerContentScriptsForFutureNavigations([
      makeRule(0, ['https://*.example.com/*'])
    ])
    for (let i = 0; i < 5; i++) {
      handlers[0]({
        type: 'tabNavigated',
        state: 'stop',
        url: `https://docs.example.com/p${i}`
      })
    }
    await vi.advanceTimersByTimeAsync(150)
    expect(evaluate).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('only installs the message listener once across re-registrations', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const {client} = makeListenerClient()
    ;(rf as any).client = client
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
    expect(client.on).toHaveBeenCalledTimes(1)
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
    const client = {
      request: vi.fn(async () => ({
        addons: [{id: 'ext@example', actor: 'webExt-1'}]
      })),
      getTargetFromDescriptor: vi.fn(async () => ({
        targetActor: 'bg-target',
        consoleActor: 'bg-console'
      })),
      evaluate: vi.fn(async () => JSON.stringify({hasScripting: true}))
    }
    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'

    const result = await rf.probeRuntimeCapability()
    expect(result?.hasScripting).toBe(true)
    expect(rf.getRuntimeCapability()?.hasScripting).toBe(true)
  })

  it('returns null when the addon background descriptor is unreachable', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)
    const client = {
      request: vi.fn(async () => ({addons: []})),
      getTargetFromDescriptor: vi.fn(async () => ({})),
      evaluate: vi.fn()
    }
    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).derivedExtensionId = 'ext@example'

    const result = await rf.probeRuntimeCapability()
    expect(result).toBeNull()
    expect(client.evaluate).not.toHaveBeenCalled()
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

    const navigate = vi.fn(async () => {})
    const navigateViaScript = vi.fn(async () => {})
    const client = {
      getTargets: vi.fn(async () => [{url: 'https://docs.example.com/page'}]),
      request: vi.fn(async (req: any) => {
        if (req.type === 'listAddons') {
          return {addons: [{id: 'ext@example', actor: 'webExt-1'}]}
        }
        return {}
      }),
      getTargetFromDescriptor: vi.fn(async () => ({
        targetActor: 'bg-target',
        consoleActor: 'bg-console'
      })),
      evaluate: vi.fn(async () => ({
        value: {
          reinjectedTabs: 1,
          hasRuntime: true,
          hasScripting: true,
          entries: 1,
          matches: [{index: 0, queriedTabs: 1, matchingTabs: 1}]
        }
      })),
      navigate,
      waitForLoadEvent: vi.fn(async () => {}),
      navigateViaScript
    }

    ;(rf as any).client = client
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
    const client = {
      getTargets: vi.fn(async () => [
        {
          actor: 'tab-1',
          consoleActor: 'console-1',
          url: 'https://docs.example.com/page'
        }
      ]),
      navigate,
      waitForLoadEvent: vi.fn(async () => {}),
      navigateViaScript: vi.fn(async () => {})
    }

    ;(rf as any).client = client
    // No cachedAddonsActor / derivedExtensionId / lastInstalledAddonPath →
    // runtime path is skipped immediately, legacy fallback runs.

    const reloaded = await rf.reloadMatchingTabsForContentScripts([
      makeRule(0, ['https://*.example.com/*'])
    ])

    expect(reloaded).toBe(1)
    expect(navigate).toHaveBeenCalledWith(
      'tab-1',
      'https://docs.example.com/page'
    )
    const report = rf.getLastRuntimeReinjectionReport()
    expect(report?.phase).toBe('skipped')
  })
})
