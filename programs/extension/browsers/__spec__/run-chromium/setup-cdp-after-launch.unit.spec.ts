import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

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
const loadCompanionsSpy = vi.fn(async (_paths: string[]) => [])
const ensurePageTargetSpy = vi.fn(async (_url: string) => 'created' as string)

vi.mock('../../run-chromium/cdp/cdp-extension-controller', async () => {
  const actual = (await vi.importActual(
    '../../run-chromium/cdp/cdp-extension-controller'
  )) as Record<string, unknown>

  class CDPExtensionController {
    constructor(args: any) {
      ctorSpy(args)
    }
    connect = connectSpy
    ensureLoaded = ensureLoadedSpy
    getInfoBestEffort = getInfoBestEffortSpy
    openTab = openTabSpy
    ensureDeveloperMode = ensureDeveloperModeSpy
    loadCompanions = loadCompanionsSpy
    ensurePageTarget = ensurePageTargetSpy
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
  const actual = (await vi.importActual(
    '../../browsers-lib/banner'
  )) as Record<string, unknown>

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
import * as controllerModule from '../../run-chromium/cdp/cdp-extension-controller'
import {setupCdpAfterLaunch} from '../../run-chromium/chromium-launch/setup-cdp-after-launch'

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
    loadCompanionsSpy.mockClear()
    ensurePageTargetSpy.mockClear()
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

    const plugin: any = {
      browser: 'chromium',
      port: 9333,
      instanceId: 'test-instance',
      browserVersionLine: 'Chromium 123'
    }

    const userExtensionPath = '/workspace/templates/react/dist/chromium'
    const chromiumArgs = [
      '--load-extension=/workspace/programs/develop/dist/extension-js-devtools/chromium,/workspace/programs/develop/dist/extension-js-theme/chromium,/workspace/templates/react/dist/chromium',
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/extension-profile'
    ]

    const compilation: any = {
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
      profilePath: '/tmp/extension-profile'
    })

    for (const [callArgs] of printDevBannerOnceSpy.mock.calls) {
      await (callArgs as {getInfo?: () => Promise<unknown>})?.getInfo?.()
    }

    expect(getInfoBestEffortSpy).toHaveBeenCalled()
  })

  it('turns developer mode on for the profile it launched', async () => {
    const plugin: any = {
      browser: 'chromium',
      port: 9333,
      instanceId: 'dev-mode'
    }
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-mode-'))
    tempDirs.push(profileDir)

    await setupCdpAfterLaunch(
      {
        options: {
          mode: 'development',
          output: {path: '/workspace/dist/chromium'}
        }
      } as any,
      plugin,
      ['--remote-debugging-port=9333', `--user-data-dir=${profileDir}`]
    )

    expect(ensureDeveloperModeSpy).toHaveBeenCalledTimes(1)
  })

  it('leaves the toggle alone for a profile that already carries it', async () => {
    const plugin: any = {
      browser: 'chromium',
      port: 9333,
      instanceId: 'dev-mode'
    }
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
          output: {path: '/workspace/dist/chromium'}
        }
      } as any,
      plugin,
      ['--remote-debugging-port=9333', `--user-data-dir=${profileDir}`]
    )

    expect(ensureDeveloperModeSpy).not.toHaveBeenCalled()
  })

  it('never touches the user own profile or a windowless park', async () => {
    const plugin: any = {
      browser: 'chromium',
      port: 9333,
      instanceId: 'dev-mode'
    }
    const compilation: any = {
      options: {mode: 'development', output: {path: '/workspace/dist/chromium'}}
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

  it('passes only selected user extension path to controller from --load-extension', async () => {
    const plugin: any = {
      browser: 'chromium',
      port: 9333,
      instanceId: 'test-instance',
      browserVersionLine: 'Chromium 123'
    }

    const userExtensionPath = '/workspace/templates/react/dist/chromium'
    const chromiumArgs = [
      '--load-extension=/workspace/programs/develop/dist/extension-js-devtools/chromium,/workspace/programs/develop/dist/extension-js-theme/chromium,/workspace/templates/react/dist/chromium',
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/extension-profile'
    ]

    const compilation: any = {
      options: {mode: 'development', output: {path: userExtensionPath}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outPath: userExtensionPath,
        extensionPaths: [userExtensionPath],
        profilePath: '/tmp/extension-profile',
        cdpPort: 9333
      })
    )

    expect(plugin.cdpController).toBeDefined()
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
      '--user-data-dir=/tmp/extension-profile'
    ]
    const compilation: any = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      {browser: 'yandex', port: 9333, instanceId: 'i'} as any,
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
      '--user-data-dir=/tmp/extension-profile'
    ]
    const compilation: any = {
      options: {mode: 'development', output: {path: userDir}}
    }

    for (const browser of ['chromium', 'chrome', 'edge', 'opera']) {
      await setupCdpAfterLaunch(
        compilation,
        {browser, port: 9333, instanceId: 'i'} as any,
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
    const plugin: any = {browser: 'chromium', port: 9333, instanceId: 'i'}
    const chromiumArgs = [
      `--load-extension=${extDir}`,
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/extension-profile'
    ]
    const compilation: any = {
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
    const plugin: any = {browser: 'chromium', port: 9333, instanceId: 'i'}
    const chromiumArgs = [
      `--load-extension=${extDir}`,
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/extension-profile'
    ]
    const compilation: any = {
      options: {mode: 'development', output: {path: extDir}}
    }

    await setupCdpAfterLaunch(compilation, plugin, chromiumArgs)

    expect(openTabSpy).not.toHaveBeenCalled()
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
      '--user-data-dir=/tmp/extension-profile'
    ]
    const compilation: any = {
      options: {mode: 'development', output: {path: extDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      {
        browser: 'chromium',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com'
      } as any,
      chromiumArgs
    )

    expect(openTabSpy).not.toHaveBeenCalled()

    await setupCdpAfterLaunch(
      compilation,
      {browser: 'chromium', port: 9333, instanceId: 'i', noOpen: true} as any,
      chromiumArgs
    )

    expect(openTabSpy).not.toHaveBeenCalled()
  })

  it('keeps the mock in step with the controller the launch really builds', () => {
    const real = (controllerModule as any).__realController
    const mocked = new (controllerModule as any).CDPExtensionController({})

    expect(typeof real?.prototype?.ensurePageTarget).toBe('function')
    expect(typeof mocked.ensurePageTarget).toBe('function')
  })

  it('gives a headless session a page target, on the companion welcome page', async () => {
    const companionDir = makeCompanionDir()
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: any = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      {browser: 'yandex', port: 9333, instanceId: 'i'} as any,
      [
        `--load-extension=${[companionDir, userDir].join()}`,
        '--remote-debugging-port=9333',
        '--user-data-dir=/tmp/extension-profile',
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
    const compilation: any = {
      options: {mode: 'development', output: {path: userDir}}
    }

    for (const browser of ['yandex', 'chrome', 'edge', 'vivaldi']) {
      await setupCdpAfterLaunch(
        compilation,
        {browser, port: 9333, instanceId: 'i'} as any,
        [
          `--load-extension=${userDir}`,
          '--remote-debugging-port=9333',
          '--user-data-dir=/tmp/extension-profile'
        ]
      )
    }

    expect(ensurePageTargetSpy).not.toHaveBeenCalled()
  })

  it('leaves a headless --no-open session with no page, as asked', async () => {
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: any = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      {browser: 'yandex', port: 9333, instanceId: 'i', noOpen: true} as any,
      [
        `--load-extension=${userDir}`,
        '--remote-debugging-port=9333',
        '--user-data-dir=/tmp/extension-profile',
        '--headless=new'
      ]
    )

    expect(ensurePageTargetSpy).not.toHaveBeenCalled()
  })

  it('puts the requested starting url on the page it has to recreate', async () => {
    const companionDir = makeCompanionDir()
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: any = {
      options: {mode: 'development', output: {path: userDir}}
    }

    await setupCdpAfterLaunch(
      compilation,
      {
        browser: 'yandex',
        port: 9333,
        instanceId: 'i',
        startingUrl: 'https://example.com/'
      } as any,
      [
        `--load-extension=${[companionDir, userDir].join()}`,
        '--remote-debugging-port=9333',
        '--user-data-dir=/tmp/extension-profile',
        '--headless'
      ]
    )

    expect(ensurePageTargetSpy).toHaveBeenCalledWith('https://example.com/')
  })

  it('warns once when the browser will not take a replacement page', async () => {
    const userDir = makeExtensionDir({manifest_version: 3, name: 'User'})
    const compilation: any = {
      options: {mode: 'development', output: {path: userDir}}
    }
    ensurePageTargetSpy.mockResolvedValueOnce('refused')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await setupCdpAfterLaunch(
        compilation,
        {browser: 'yandex', port: 9333, instanceId: 'i'} as any,
        [
          `--load-extension=${userDir}`,
          '--remote-debugging-port=9333',
          '--user-data-dir=/tmp/extension-profile',
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
        {options: {mode: 'development', output: {path: extDir}}} as any,
        {browser: 'chromium', port: 9333, instanceId: 'i'} as any,
        [
          `--load-extension=${extDir}`,
          '--remote-debugging-port=9333',
          '--user-data-dir=/tmp/extension-profile'
        ]
      )

      const output = logSpy.mock.calls
        .map((call) => String(call[0] || ''))
        .join('\n')
      expect(output).toContain('profile=chrome')
      expect(output).toContain('/tmp/extension-profile')
    } finally {
      logSpy.mockRestore()
      if (previousDebug === undefined) delete process.env.EXTENSION_DEBUG
      else process.env.EXTENSION_DEBUG = previousDebug
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
        {options: {mode: 'development', output: {path: extDir}}} as any,
        {browser: 'chromium', port: 9333, instanceId: 'i'} as any,
        [
          `--load-extension=${extDir}`,
          '--remote-debugging-port=9333',
          '--user-data-dir=/tmp/extension-profile'
        ]
      )

      const output = logSpy.mock.calls
        .map((call) => String(call[0] || ''))
        .join('\n')
      expect(output).not.toContain('profile=chrome')

      const devCalls = vi.mocked(banner.printDevBannerOnce).mock.calls
      expect(devCalls.length).toBeGreaterThan(0)

      for (const [callArgs] of devCalls) {
        expect(callArgs).toMatchObject({
          profilePath: '/tmp/extension-profile'
        })
      }
    } finally {
      logSpy.mockRestore()
      if (previousDebug === undefined) delete process.env.EXTENSION_DEBUG
      else process.env.EXTENSION_DEBUG = previousDebug
      if (previousCardKeys === undefined) {
        delete process.env.EXTENSION_CLI_CARD_KEYS
      } else process.env.EXTENSION_CLI_CARD_KEYS = previousCardKeys
    }
  })
})
