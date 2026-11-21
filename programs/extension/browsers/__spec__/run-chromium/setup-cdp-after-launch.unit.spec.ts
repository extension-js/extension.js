import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const ctorSpy = vi.fn()
const connectSpy = vi.fn(async () => {})
const ensureLoadedSpy = vi.fn(async () => ({
  extensionId: 'user-ext-id',
  name: 'User Extension',
  version: '1.0.0'
}))
const getInfoBestEffortSpy = vi.fn(async () => ({
  extensionId: 'user-ext-id',
  name: 'User Extension',
  version: '1.0.0'
}))
const openTabSpy = vi.fn(async () => {})
const ensureDeveloperModeSpy = vi.fn(async () => 'enabled' as const)
const ensureStartupNewTabSpy = vi.fn(async () => 'set' as const)
const loadCompanionsSpy = vi.fn(async (_paths: string[]) => [])
const ensurePageTargetSpy = vi.fn(async (_url: string) => 'created' as string)
const openStartingUrlSpy = vi.fn(async (_url: string) => 'navigated')
const debugPortOwnerSpy = vi.fn(async () => 'this-browser' as string)

vi.mock('../../run-chromium/cdp/cdp-extension-controller', async () => {
  const actual = (await vi.importActual(
    '../../run-chromium/cdp/cdp-extension-controller'
  )) as Record<string, unknown>

  class CDPExtensionController {
    constructor(args: unknown) {
      ctorSpy(args)
    }
    connect = connectSpy
    ensureLoaded = ensureLoadedSpy
    getInfoBestEffort = getInfoBestEffortSpy
    openTab = openTabSpy
    ensureDeveloperMode = ensureDeveloperModeSpy
    ensureStartupNewTab = ensureStartupNewTabSpy
    loadCompanions = loadCompanionsSpy
    ensurePageTarget = ensurePageTargetSpy
    openStartingUrl = openStartingUrlSpy
    debugPortOwner = debugPortOwnerSpy
  }

  return {
    ...actual,
    CDPExtensionController,
    __realController: actual.CDPExtensionController
  }
})

vi.mock('../../browsers-lib/shared-utils', async () => {
  const actual = (await vi.importActual(
    '../../browsers-lib/shared-utils'
  )) as Record<string, unknown>

  return {...actual, deriveDebugPortWithInstance: vi.fn(() => 9333)}
})

vi.mock('../../browsers-lib/banner', async () => {
  const actual = (await vi.importActual('../../browsers-lib/banner')) as Record<
    string,
    unknown
  >

  return {
    ...actual,
    printDevBannerOnce: vi.fn(async () => true),
    printProdBannerOnce: vi.fn(async () => true)
  }
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {claimCardKey} from '../../../helpers/messaging'
import * as banner from '../../browsers-lib/banner'
import {setInstancePorts} from '../../browsers-lib/instance-registry'
import {readyPathFor} from '../../browsers-lib/ready-stamp'
import type {CompilationLike} from '../../browsers-types'
import * as controllerModule from '../../run-chromium/cdp/cdp-extension-controller'
import {setupCdpAfterLaunch} from '../../run-chromium/chromium-launch/setup-cdp-after-launch'
import type {ChromiumPluginRuntime} from '../../run-chromium/chromium-types'

// The specs drive only the fields the post-launch flow reads, so the runtime
// is built partial once here instead of at every call.
function runtime(
  fields: Partial<ChromiumPluginRuntime>
): ChromiumPluginRuntime {
  return fields as ChromiumPluginRuntime
}

type ControllerModuleWithReal = typeof controllerModule & {
  __realController?: {prototype?: Record<string, unknown>}
  CDPExtensionController: new (args: unknown) => Record<string, unknown>
}

// Folders of the spec's own: /workspace and /tmp/extension-profile can exist
// on a shared machine, and the code under test reads and writes a profile.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-setup-cdp-'))
const WORKSPACE = path.join(SCRATCH, 'workspace')
const PROFILE = path.join(SCRATCH, 'extension-profile')

afterAll(() => {
  fs.rmSync(SCRATCH, {recursive: true, force: true})
})

const tempDirs: string[] = []

function makeExtensionDir(manifest: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-newtab-'))
  tempDirs.push(dir)
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest),
    'utf-8'
  )

  return dir
}

// The launch recognizes the companion by its directory name, so a fixture that
// stands in for it has to carry that name too.
function makeCompanionDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-companion-'))
  tempDirs.push(root)
  const dir = path.join(root, 'extension-js-devtools', 'chromium')
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'Extension.js', version: '1.0'}),
    'utf-8'
  )

  return dir
}

describe('setupCdpAfterLaunch', () => {
  beforeEach(() => {
    ctorSpy.mockClear()
    connectSpy.mockClear()
    ensureLoadedSpy.mockClear()
    getInfoBestEffortSpy.mockClear()
    openTabSpy.mockClear()
    ensureDeveloperModeSpy.mockClear()
    ensureStartupNewTabSpy.mockClear()
    loadCompanionsSpy.mockClear()
    ensurePageTargetSpy.mockClear()
    openStartingUrlSpy.mockClear()
    debugPortOwnerSpy.mockClear()
    vi.mocked(banner.printDevBannerOnce).mockClear()
    vi.mocked(banner.printProdBannerOnce).mockClear()
  })

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop()
      if (dir) fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('prints development banner early using best-effort info lookup', async () => {
    const printDevBannerOnceSpy = vi.mocked(banner.printDevBannerOnce)

    const plugin = runtime({
      browser: 'chromium',
      port: 9333,
      instanceId: 'test-instance',
      browserVersionLine: 'Chromium 123'
    })

    const userExtensionPath = `${WORKSPACE}/templates/react/dist/chromium`
    const chromiumArgs = [
      `--load-extension=${WORKSPACE}/programs/develop/dist/extension-js-devtools/chromium,${WORKSPACE}/programs/develop/dist/extension-js-theme/chromium,${WORKSPACE}/templates/react/dist/chromium`,
      '--remote-debugging-port=9333',
      `--user-data-dir=${PROFILE}`
    ]

    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userExtensionPath}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(printDevBannerOnceSpy).toHaveBeenCalled()
    const firstCallArgs = printDevBannerOnceSpy.mock.calls[0]?.[0] as
      | {browser?: string; outPath?: string; getInfo?: () => Promise<unknown>}
      | undefined
    expect(firstCallArgs).toMatchObject({
      browser: 'chromium',
      outPath: userExtensionPath,
      profilePath: PROFILE
    })

    for (const [callArgs] of printDevBannerOnceSpy.mock.calls) {
      await (callArgs as {getInfo?: () => Promise<unknown>})?.getInfo?.()
    }

    expect(getInfoBestEffortSpy).toHaveBeenCalled()
  })

  it('stamps a load that timed out as W_CDP_TIMEOUT on a contract that stays ready', async () => {
    vi.useFakeTimers()

    try {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-cdp-fault-'))
      tempDirs.push(root)
      const outPath = path.join(root, 'dist', 'chromium')
      fs.mkdirSync(outPath, {recursive: true})
      fs.writeFileSync(
        path.join(outPath, 'manifest.json'),
        JSON.stringify({manifest_version: 3, name: 'User', version: '1.0'}),
        'utf-8'
      )

      const readyPath = readyPathFor(outPath)
      fs.mkdirSync(path.dirname(readyPath), {recursive: true})
      fs.writeFileSync(
        readyPath,
        JSON.stringify({status: 'ready', browser: 'chromium', runId: 'run-A'})
      )

      ensureLoadedSpy.mockImplementationOnce(() => new Promise(() => {}))

      const plugin = runtime({
        browser: 'chromium',
        port: 9333,
        instanceId: 'test-instance',
        launchRunId: 'run-A'
      })
      const compilation: CompilationLike = {
        options: {mode: 'development', output: {path: outPath}}
      }

      const done = setupCdpAfterLaunch(compilation, plugin, [
        `--load-extension=${outPath}`,
        '--remote-debugging-port=9333'
      ])
      await vi.advanceTimersByTimeAsync(10_001)
      await done

      const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
      expect(ready.status).toBe('ready')
      expect(ready.cdpFaultCode).toBe('W_CDP_TIMEOUT')
      expect(ready.cdpFaultMessage).toBe('ensureLoaded timeout (10000ms)')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['answered', () => {}],
    [
      'failed',
      () => ensureLoadedSpy.mockRejectedValueOnce(new Error('load failed'))
    ]
  ])('clears the ten second load timer once the load has %s', async (_how, arrange) => {
    vi.useFakeTimers()

    try {
      arrange()

      const compilation: CompilationLike = {
        options: {
          mode: 'development',
          output: {path: `${WORKSPACE}/dist/chromium`}
        }
      }

      await setupCdpAfterLaunch(
        compilation,
        runtime({browser: 'chromium', port: 9333, instanceId: 'test-instance'}),
        [
          `--load-extension=${WORKSPACE}/dist/chromium`,
          '--remote-debugging-port=9333'
        ]
      )

      expect(ensureLoadedSpy).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns developer mode on for the profile it launched', async () => {
    const plugin = runtime({
      browser: 'chromium',
      port: 9333,
      instanceId: 'dev-mode'
    })
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-mode-'))
    tempDirs.push(profileDir)

    await setupCdpAfterLaunch(
      {
        options: {
          mode: 'development',
          output: {path: `${WORKSPACE}/dist/chromium`}
        }
      } satisfies CompilationLike,
      plugin,
      ['--remote-debugging-port=9333', `--user-data-dir=${profileDir}`]
    )

    expect(ensureDeveloperModeSpy).toHaveBeenCalledTimes(1)
  })

  it('leaves the toggle alone for a profile that already carries it', async () => {
    const plugin = runtime({
      browser: 'chromium',
      port: 9333,
      instanceId: 'dev-mode'
    })
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-mode-'))
    tempDirs.push(profileDir)
    fs.mkdirSync(path.join(profileDir, 'Default'), {recursive: true})
    fs.writeFileSync(
      path.join(profileDir, 'Default', 'Secure Preferences'),
      JSON.stringify({extensions: {ui: {developer_mode: true}}})
    )

    await setupCdpAfterLaunch(
      {
        options: {
          mode: 'development',
          output: {path: `${WORKSPACE}/dist/chromium`}
        }
      } satisfies CompilationLike,
      plugin,
      ['--remote-debugging-port=9333', `--user-data-dir=${profileDir}`]
    )

    expect(ensureDeveloperModeSpy).not.toHaveBeenCalled()
  })

  it('never touches the user own profile or a windowless park', async () => {
    const plugin = runtime({
      browser: 'chromium',
      port: 9333,
      instanceId: 'dev-mode'
    })
    const compilation: CompilationLike = {
      options: {
        mode: 'development',
        output: {path: `${WORKSPACE}/dist/chromium`}
      }
    }

    await setupCdpAfterLaunch(compilation, plugin, [
      '--remote-debugging-port=9333'
    ])

    expect(ensureDeveloperModeSpy).not.toHaveBeenCalled()

    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-mode-'))
    tempDirs.push(profileDir)

    await setupCdpAfterLaunch(compilation, plugin, [
      '--remote-debugging-port=9333',
      `--user-data-dir=${profileDir}`,
      '--no-startup-window'
    ])

    expect(ensureDeveloperModeSpy).not.toHaveBeenCalled()
  })

  describe('the startup choice of a profile that outlives the session', () => {
    const compilation: CompilationLike = {
      options: {
        mode: 'development',
        output: {path: `${WORKSPACE}/dist/chromium`}
      }
    }
    const plugin = () =>
      runtime({browser: 'chromium', port: 9333, instanceId: 'startup'})

    function profile(files: Record<string, unknown>) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-choice-'))
      tempDirs.push(dir)
      fs.mkdirSync(path.join(dir, 'Default'), {recursive: true})

      for (const [name, value] of Object.entries(files)) {
        const file = name.startsWith('.')
          ? path.join(dir, name)
          : path.join(dir, 'Default', name)

        fs.writeFileSync(file, JSON.stringify(value))
      }

      return dir
    }

    const seeded = {session: {restore_on_startup: 5}}

    // The browser dropped the seeded choice, so its next launch would reopen
    // this run's pages before the extension is there to run on them.
    it('is made through the browser when the seeded one was dropped', async () => {
      const dir = profile({Preferences: seeded, 'Secure Preferences': {}})

      await setupCdpAfterLaunch(
        compilation,
        {...plugin(), startingUrl: 'https://example.com/'},
        ['--remote-debugging-port=9333', `--user-data-dir=${dir}`]
      )

      expect(ensureStartupNewTabSpy).toHaveBeenCalledTimes(1)
      expect(openStartingUrlSpy).toHaveBeenCalledTimes(1)
      expect(openStartingUrlSpy.mock.invocationCallOrder[0]).toBeLessThan(
        ensureStartupNewTabSpy.mock.invocationCallOrder[0]
      )
    })

    // The card already said the write was coming.
    it('corrects the ready contract when the browser did not take it', async () => {
      const dir = profile({Preferences: seeded, 'Secure Preferences': {}})
      const outPath = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'startup-ready-')),
        'dist',
        'chromium'
      )
      tempDirs.push(path.dirname(path.dirname(outPath)))
      fs.mkdirSync(outPath, {recursive: true})

      const readyPath = readyPathFor(outPath)
      fs.mkdirSync(path.dirname(readyPath), {recursive: true})
      fs.writeFileSync(readyPath, JSON.stringify({status: 'ready'}))
      ensureStartupNewTabSpy.mockResolvedValueOnce('unavailable' as never)

      await setupCdpAfterLaunch(
        {options: {mode: 'development', output: {path: outPath}}},
        plugin(),
        ['--remote-debugging-port=9333', `--user-data-dir=${dir}`]
      )

      expect(
        JSON.parse(fs.readFileSync(readyPath, 'utf-8')).devAdditions
      ).toEqual([
        expect.objectContaining({
          kind: 'browser_preference',
          value: 'session.restore_on_startup=5',
          applied: false,
          cause: 'unavailable'
        })
      ])
    })

    it('is left alone once the browser holds a choice of its own', async () => {
      const dir = profile({
        Preferences: seeded,
        'Secure Preferences': {session: {restore_on_startup: 5}}
      })

      await setupCdpAfterLaunch(compilation, plugin(), [
        '--remote-debugging-port=9333',
        `--user-data-dir=${dir}`
      ])

      expect(ensureStartupNewTabSpy).not.toHaveBeenCalled()
    })

    it('is left alone on a profile the session deletes on exit', async () => {
      const dir = profile({
        Preferences: seeded,
        '.extension-js-managed-profile': {}
      })

      await setupCdpAfterLaunch(compilation, plugin(), [
        '--remote-debugging-port=9333',
        `--user-data-dir=${dir}`
      ])

      expect(ensureStartupNewTabSpy).not.toHaveBeenCalled()
    })

    it('is never touched on a profile this session did not seed', async () => {
      const dir = profile({Preferences: {}, 'Secure Preferences': {}})

      await setupCdpAfterLaunch(compilation, plugin(), [
        '--remote-debugging-port=9333',
        `--user-data-dir=${dir}`
      ])

      await setupCdpAfterLaunch(compilation, plugin(), [
        '--remote-debugging-port=9333'
      ])

      await setupCdpAfterLaunch(compilation, plugin(), [
        '--remote-debugging-port=9333',
        `--user-data-dir=${profile({Preferences: seeded})}`,
        '--no-startup-window'
      ])

      expect(ensureStartupNewTabSpy).not.toHaveBeenCalled()
    })
  })

  it('passes only selected user extension path to controller from --load-extension', async () => {
    const plugin = runtime({
      browser: 'chromium',
      port: 9333,
      instanceId: 'test-instance',
      browserVersionLine: 'Chromium 123'
    })

    const userExtensionPath = `${WORKSPACE}/templates/react/dist/chromium`
    const chromiumArgs = [
      `--load-extension=${WORKSPACE}/programs/develop/dist/extension-js-devtools/chromium,${WORKSPACE}/programs/develop/dist/extension-js-theme/chromium,${WORKSPACE}/templates/react/dist/chromium`,
      '--remote-debugging-port=9333',
      `--user-data-dir=${PROFILE}`
    ]

    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userExtensionPath}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outPath: userExtensionPath,
        extensionPaths: [userExtensionPath],
        profilePath: PROFILE,
        cdpPort: 9333
      })
    )

    expect(plugin.cdpController).toBeDefined()
  })

  // The launch claimed a port near the derived one and recorded it for this
  // session, so a flag the caller stripped must not send the client elsewhere.
  it('dials the port recorded for its own instance when no flag names one', async () => {
    setInstancePorts('port-moved-instance', {cdpPort: 9555})
    setInstancePorts('another-instance', {cdpPort: 9666})
    const plugin = runtime({
      browser: 'chromium',
      port: 9333,
      instanceId: 'port-moved-instance'
    })

    await setupCdpAfterLaunch(
      {
        options: {mode: 'development', output: {path: WORKSPACE}}
      } satisfies CompilationLike,
      plugin,
      [`--user-data-dir=${PROFILE}`]
    )

    expect(ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({cdpPort: 9555})
    )
  })

  it('hands the companions over CDP on a browser that ignores --load-extension', async () => {
    const companionDir = makeExtensionDir({
      manifest_version: 3,
      name: 'Extension.js'
    })
    const themeDir = makeExtensionDir({
      manifest_version: 3,
      name: 'Extension.js Theme',
      theme: {colors: {}}
    })
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const chromiumArgs = [
      `--load-extension=${[companionDir, themeDir, userDir].join()}`,
      '--remote-debugging-port=9333',
      `--user-data-dir=${PROFILE}`
    ]
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      runtime({browser: 'yandex', port: 9333, instanceId: 'i'}),
      chromiumArgs
    )

    expect(loadCompanionsSpy).toHaveBeenCalledTimes(1)
    expect(loadCompanionsSpy).toHaveBeenCalledWith([companionDir])
    expect(ensureLoadedSpy.mock.invocationCallOrder[0]).toBeLessThan(
      loadCompanionsSpy.mock.invocationCallOrder[0]
    )
  })

  it('leaves the companions to --load-extension on a browser that honours it', async () => {
    const companionDir = makeExtensionDir({
      manifest_version: 3,
      name: 'Extension.js'
    })
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const chromiumArgs = [
      `--load-extension=${[companionDir, userDir].join()}`,
      '--remote-debugging-port=9333',
      `--user-data-dir=${PROFILE}`
    ]
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userDir}}
    }

    for (const browser of ['chromium', 'chrome', 'edge', 'opera'] as const) {
      await setupCdpAfterLaunch(
        compilation,
        runtime({browser, port: 9333, instanceId: 'i'}),
        chromiumArgs
      )
    }

    expect(loadCompanionsSpy).not.toHaveBeenCalled()
  })

  it('opens a fresh new tab when the manifest overrides the new tab (#50)', async () => {
    const extDir = makeExtensionDir({
      manifest_version: 3,
      name: 'NewTab Ext',
      chrome_url_overrides: {newtab: 'newtab/index.html'}
    })
    const plugin = runtime({browser: 'chromium', port: 9333, instanceId: 'i'})
    const chromiumArgs = [
      `--load-extension=${extDir}`,
      '--remote-debugging-port=9333',
      `--user-data-dir=${PROFILE}`
    ]
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: extDir}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(openTabSpy).toHaveBeenCalledWith('chrome://newtab/')
  })

  it('does not open a new tab when there is no newtab override', async () => {
    const extDir = makeExtensionDir({
      manifest_version: 3,
      name: 'Plain Ext',
      action: {default_popup: 'popup.html'}
    })
    const plugin = runtime({browser: 'chromium', port: 9333, instanceId: 'i'})
    const chromiumArgs = [
      `--load-extension=${extDir}`,
      '--remote-debugging-port=9333',
      `--user-data-dir=${PROFILE}`
    ]
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: extDir}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(openTabSpy).not.toHaveBeenCalled()
  })

  // The launch tab opens on about:blank, so the starting page loads only
  // once the extension is installed and its document_start scripts apply.
  it('opens the starting url only after the guest is loaded', async () => {
    const extDir = makeExtensionDir({manifest_version: 3, name: 'Plain Ext'})
    const order: string[] = []
    ensureLoadedSpy.mockImplementationOnce(async () => {
      order.push('loaded')

      return {extensionId: 'user-ext-id', name: 'x', version: '1.0.0'}
    })

    openStartingUrlSpy.mockImplementationOnce(async (url: string) => {
      order.push(`open ${url}`)

      return 'navigated'
    })

    await setupCdpAfterLaunch(
      {options: {mode: 'development', output: {path: extDir}}},
      runtime({
        browser: 'chromium',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com/'
      }),
      [
        `--load-extension=${extDir}`,
        '--remote-debugging-port=9333',
        `--user-data-dir=${PROFILE}`
      ]
    )

    expect(order).toEqual(['loaded', 'open https://example.com/'])
  })

  // A page that loads before a registration the background made as it
  // started has answered never runs that script.
  it('opens the starting url only after the boot registrations settle', async () => {
    const extDir = makeExtensionDir({manifest_version: 3, name: 'Plain Ext'})
    const order: string[] = []
    const awaitBootRegistrations = vi.fn(async (_timeoutMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('settled')

      return 'settled' as const
    })

    openStartingUrlSpy.mockImplementationOnce(async (url: string) => {
      order.push(`open ${url}`)

      return 'navigated'
    })

    await setupCdpAfterLaunch(
      {options: {mode: 'development', output: {path: extDir}}},
      runtime({
        browser: 'chromium',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com/',
        awaitBootRegistrations
      }),
      [`--load-extension=${extDir}`, '--remote-debugging-port=9333']
    )

    expect(awaitBootRegistrations).toHaveBeenCalledWith(5000)
    expect(order).toEqual(['settled', 'open https://example.com/'])
  })

  it('asks for no hold when the session opens no page', async () => {
    const extDir = makeExtensionDir({manifest_version: 3, name: 'Plain Ext'})
    const awaitBootRegistrations = vi.fn(async () => 'settled' as const)

    await setupCdpAfterLaunch(
      {options: {mode: 'development', output: {path: extDir}}},
      runtime({
        browser: 'chromium',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com/',
        noOpen: true,
        awaitBootRegistrations
      }),
      [`--load-extension=${extDir}`, '--remote-debugging-port=9333']
    )

    expect(awaitBootRegistrations).not.toHaveBeenCalled()
  })

  it('opens no starting url under --no-open', async () => {
    const extDir = makeExtensionDir({manifest_version: 3, name: 'Plain Ext'})

    await setupCdpAfterLaunch(
      {options: {mode: 'development', output: {path: extDir}}},
      runtime({
        browser: 'chromium',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com/',
        noOpen: true
      }),
      [`--load-extension=${extDir}`, '--remote-debugging-port=9333']
    )

    expect(openStartingUrlSpy).not.toHaveBeenCalled()
  })

  it('respects an explicit startingUrl and --no-open (no courtesy tab)', async () => {
    const extDir = makeExtensionDir({
      manifest_version: 3,
      name: 'NewTab Ext',
      chrome_url_overrides: {newtab: 'newtab/index.html'}
    })
    const chromiumArgs = [
      `--load-extension=${extDir}`,
      '--remote-debugging-port=9333',
      `--user-data-dir=${PROFILE}`
    ]
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: extDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      runtime({
        browser: 'chromium',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com'
      }),
      chromiumArgs
    )

    expect(openTabSpy).not.toHaveBeenCalled()

    await setupCdpAfterLaunch(
      compilation,
      runtime({browser: 'chromium', port: 9333, instanceId: 'i', noOpen: true}),
      chromiumArgs
    )

    expect(openTabSpy).not.toHaveBeenCalled()
  })

  function sessionWithRecord(record: Record<string, unknown>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-cdp-port-'))
    tempDirs.push(root)
    const outPath = path.join(root, 'dist', 'chromium')
    fs.mkdirSync(outPath, {recursive: true})
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'User', version: '1.0'}),
      'utf-8'
    )

    const readyPath = readyPathFor(outPath)
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(readyPath, JSON.stringify(record))

    const plugin = runtime({
      browser: 'chromium',
      port: 9333,
      instanceId: 'test-instance',
      launchRunId: 'run-A'
    })
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: outPath}}
    }

    return {
      run: () =>
        setupCdpAfterLaunch(compilation, plugin, [
          `--load-extension=${outPath}`,
          '--remote-debugging-port=9333'
        ]),
      ready: () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    }
  }

  it('names the debugging port on the record once this browser answers on it', async () => {
    const session = sessionWithRecord({status: 'ready', runId: 'run-A'})

    await session.run()

    expect(debugPortOwnerSpy).toHaveBeenCalledTimes(1)
    expect(session.ready().cdpPort).toBe(9333)
  })

  it.each([
    'another-browser',
    'closed'
  ])('takes the debugging port off the record and says so when the port is %s', async (owner) => {
    const session = sessionWithRecord({
      status: 'ready',
      runId: 'run-A',
      cdpPort: 9333
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugPortOwnerSpy.mockResolvedValueOnce(owner)

    try {
      await session.run()

      const said = [...warn.mock.calls, ...error.mock.calls, ...log.mock.calls]
        .flat()
        .join('\n')

      expect('cdpPort' in session.ready()).toBe(false)
      expect(said).toContain('9333')
      expect(said).toContain('names no cdpPort')
    } finally {
      warn.mockRestore()
      error.mockRestore()
      log.mockRestore()
    }
  })

  it('keeps the mock in step with the controller the launch really builds', () => {
    const real = (controllerModule as unknown as ControllerModuleWithReal)
      .__realController
    const mocked = new (
      controllerModule as unknown as ControllerModuleWithReal
    ).CDPExtensionController({})

    expect(typeof real?.prototype?.ensurePageTarget).toBe('function')
    expect(typeof mocked.ensurePageTarget).toBe('function')
    expect(typeof real?.prototype?.ensureStartupNewTab).toBe('function')
    expect(typeof mocked.ensureStartupNewTab).toBe('function')
    expect(typeof real?.prototype?.debugPortOwner).toBe('function')
    expect(typeof mocked.debugPortOwner).toBe('function')
  })

  it('gives a headless session a page target, on the companion welcome page', async () => {
    const companionDir = makeCompanionDir()
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      runtime({browser: 'yandex', port: 9333, instanceId: 'i'}),
      [
        `--load-extension=${[companionDir, userDir].join()}`,
        '--remote-debugging-port=9333',
        `--user-data-dir=${PROFILE}`,
        '--headless=new'
      ]
    )

    expect(ensurePageTargetSpy).toHaveBeenCalledTimes(1)
    expect(String(ensurePageTargetSpy.mock.calls[0][0])).toMatch(
      /^chrome-extension:\/\/[a-p]{32}\/pages\/welcome\.html$/
    )
  })

  it('never reaches for a page target on a headed launch', async () => {
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userDir}}
    }

    for (const browser of ['yandex', 'chrome', 'edge', 'vivaldi'] as const) {
      await setupCdpAfterLaunch(
        compilation,
        runtime({browser, port: 9333, instanceId: 'i'}),
        [
          `--load-extension=${userDir}`,
          '--remote-debugging-port=9333',
          `--user-data-dir=${PROFILE}`
        ]
      )
    }

    expect(ensurePageTargetSpy).not.toHaveBeenCalled()
  })

  it('leaves a headless --no-open session with no page, as asked', async () => {
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      runtime({browser: 'yandex', port: 9333, instanceId: 'i', noOpen: true}),
      [
        `--load-extension=${userDir}`,
        '--remote-debugging-port=9333',
        `--user-data-dir=${PROFILE}`,
        '--headless=new'
      ]
    )

    expect(ensurePageTargetSpy).not.toHaveBeenCalled()
  })

  it('puts the requested starting url on the page it has to recreate', async () => {
    const companionDir = makeCompanionDir()
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      runtime({
        browser: 'yandex',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com/'
      }),
      [
        `--load-extension=${[companionDir, userDir].join()}`,
        '--remote-debugging-port=9333',
        `--user-data-dir=${PROFILE}`,
        '--headless'
      ]
    )

    expect(ensurePageTargetSpy).toHaveBeenCalledWith('https://example.com/')
  })

  it('warns once when the browser will not take a replacement page', async () => {
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: CompilationLike = {
      options: {mode: 'development', output: {path: userDir}}
    }
    ensurePageTargetSpy.mockResolvedValueOnce('refused')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await setupCdpAfterLaunch(
        compilation,
        runtime({browser: 'yandex', port: 9333, instanceId: 'i'}),
        [
          `--load-extension=${userDir}`,
          '--remote-debugging-port=9333',
          `--user-data-dir=${PROFILE}`,
          '--headless=new'
        ]
      )

      const printed = [...warnSpy.mock.calls, ...logSpy.mock.calls]
        .map((call) => String(call[0] || ''))
        .join('\n')

      expect(printed).toContain('yandex')
      expect(printed).toContain('--headless')
      expect(printed.match(/no page/g)?.length).toBe(1)
    } finally {
      warnSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  // The card carries the profile row now, so the standalone debug line only
  // survives where the card cannot: a pair whose key another card claimed.
  it('keeps the debug profile line when the card key is already claimed', async () => {
    const extDir = makeExtensionDir({
      manifest_version: 3,
      name: 'Claimed Ext'
    })
    const previousDebug = process.env.EXTENSION_DEBUG
    const previousCardKeys = process.env.EXTENSION_CLI_CARD_KEYS
    process.env.EXTENSION_DEBUG = '1'
    delete process.env.EXTENSION_CLI_CARD_KEYS
    claimCardKey(`chromium::${path.resolve(extDir)}`)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await setupCdpAfterLaunch(
        {options: {mode: 'development', output: {path: extDir}}},
        runtime({browser: 'chromium', port: 9333, instanceId: 'i'}),
        [
          `--load-extension=${extDir}`,
          '--remote-debugging-port=9333',
          `--user-data-dir=${PROFILE}`
        ]
      )

      const output = logSpy.mock.calls
        .map((call) => String(call[0] || ''))
        .join('\n')
      expect(output).toContain('profile=chrome')
      expect(output).toContain(PROFILE)
    } finally {
      logSpy.mockRestore()
      if (previousDebug === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
      } else process.env.EXTENSION_DEBUG = previousDebug
      if (previousCardKeys === undefined) {
        delete process.env.EXTENSION_CLI_CARD_KEYS
      } else process.env.EXTENSION_CLI_CARD_KEYS = previousCardKeys
    }
  })

  it('drops the debug profile line when the card can carry the row', async () => {
    const extDir = makeExtensionDir({
      manifest_version: 3,
      name: 'Unclaimed Ext'
    })
    const previousDebug = process.env.EXTENSION_DEBUG
    const previousCardKeys = process.env.EXTENSION_CLI_CARD_KEYS
    process.env.EXTENSION_DEBUG = '1'
    delete process.env.EXTENSION_CLI_CARD_KEYS

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await setupCdpAfterLaunch(
        {options: {mode: 'development', output: {path: extDir}}},
        runtime({browser: 'chromium', port: 9333, instanceId: 'i'}),
        [
          `--load-extension=${extDir}`,
          '--remote-debugging-port=9333',
          `--user-data-dir=${PROFILE}`
        ]
      )

      const output = logSpy.mock.calls
        .map((call) => String(call[0] || ''))
        .join('\n')
      expect(output).not.toContain('profile=chrome')

      const devCalls = vi.mocked(banner.printDevBannerOnce).mock.calls
      expect(devCalls).toHaveLength(2)

      for (const [callArgs] of devCalls) {
        expect(callArgs).toMatchObject({
          profilePath: PROFILE
        })
      }
    } finally {
      logSpy.mockRestore()
      if (previousDebug === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
      } else process.env.EXTENSION_DEBUG = previousDebug
      if (previousCardKeys === undefined) {
        delete process.env.EXTENSION_CLI_CARD_KEYS
      } else process.env.EXTENSION_CLI_CARD_KEYS = previousCardKeys
    }
  })
})
