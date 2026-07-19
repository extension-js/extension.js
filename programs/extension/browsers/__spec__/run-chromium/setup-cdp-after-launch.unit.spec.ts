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

vi.mock(
  '../../run-chromium/cdp/cdp-extension-controller',
  () => {
    class CDPExtensionController {
      constructor(args: any) {
        ctorSpy(args)
      }
      connect = connectSpy
      ensureLoaded = ensureLoadedSpy
      getInfoBestEffort = getInfoBestEffortSpy
      openTab = openTabSpy
    }
    return {CDPExtensionController}
  }
)

vi.mock('../../browsers-lib/shared-utils', () => ({
  deriveDebugPortWithInstance: vi.fn(() => 9333)
}))

vi.mock('../../browsers-lib/banner', () => ({
  printDevBannerOnce: vi.fn(async () => true),
  printProdBannerOnce: vi.fn(async () => true)
}))

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {setupCdpAfterLaunch} from '../../run-chromium/chromium-launch/setup-cdp-after-launch'
import * as banner from '../../browsers-lib/banner'

const tempDirs: string[] = []

// A real on-disk extension dir whose manifest.json setupCdpAfterLaunch reads to
// decide whether to open the new-tab surface.
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

describe('setupCdpAfterLaunch', () => {
  beforeEach(() => {
    ctorSpy.mockClear()
    connectSpy.mockClear()
    ensureLoadedSpy.mockClear()
    getInfoBestEffortSpy.mockClear()
    openTabSpy.mockClear()
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
      outPath: userExtensionPath
    })
    for (const [callArgs] of printDevBannerOnceSpy.mock.calls) {
      await (callArgs as {getInfo?: () => Promise<unknown>})?.getInfo?.()
    }
    expect(getInfoBestEffortSpy).toHaveBeenCalled()
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
      {browser: 'chromium', port: 9333, instanceId: 'i', startingUrl: 'https://example.com'} as any,
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
})
