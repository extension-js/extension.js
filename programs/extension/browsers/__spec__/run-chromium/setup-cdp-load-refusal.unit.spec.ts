import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const verifyGuestLoadedSpy = vi.fn()
const ensureLoadedSpy = vi.fn(async () => ({
  extensionId: 'user-ext-id',
  name: 'User Extension',
  version: '1.0.0'
}))

vi.mock('../../run-chromium/cdp/cdp-extension-controller', () => {
  class CDPExtensionController {
    connect = vi.fn(async () => {})
    verifyGuestLoaded = verifyGuestLoadedSpy
    ensureLoaded = ensureLoadedSpy
    getInfoBestEffort = vi.fn(async () => null)
    openTab = vi.fn(async () => {})
  }
  return {CDPExtensionController}
})

vi.mock('../../browsers-lib/shared-utils', () => ({
  deriveDebugPortWithInstance: vi.fn(() => 9333)
}))

vi.mock('../../browsers-lib/banner', () => ({
  printDevBannerOnce: vi.fn(async () => true),
  printProdBannerOnce: vi.fn(async () => true)
}))

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as banner from '../../browsers-lib/banner'
import {setupCdpAfterLaunch} from '../../run-chromium/chromium-launch/setup-cdp-after-launch'

const tempDirs: string[] = []

function makeSession(): {outPath: string; readyPath: string} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-setup-'))
  tempDirs.push(root)
  const outPath = path.join(root, 'chrome')
  const readyPath = path.join(root, 'extension-js', 'chrome', 'ready.json')
  fs.mkdirSync(outPath, {recursive: true})
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(
    path.join(outPath, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'x', version: '1.0.0'})
  )
  fs.writeFileSync(
    readyPath,
    JSON.stringify({status: 'ready', command: 'dev', browser: 'chrome'})
  )
  return {outPath, readyPath}
}

const runSetup = async (outPath: string, plugin: Record<string, unknown>) =>
  setupCdpAfterLaunch(
    {options: {mode: 'development'}} as any,
    plugin as any,
    [`--load-extension=${outPath}`, '--remote-debugging-port=9333'],
    undefined
  )

describe('setupCdpAfterLaunch load-refusal differential (§83)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    verifyGuestLoadedSpy.mockReset()
    ensureLoadedSpy.mockClear()
    ;(banner.printDevBannerOnce as any).mockClear()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop() as string, {recursive: true, force: true})
    }
  })

  it('reports a refusal instead of a banner, and reddens the contract', async () => {
    const {outPath, readyPath} = makeSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'refused',
      reason: 'Variable $2$ used but not defined.'
    })
    const logSink = vi.fn()
    const plugin: Record<string, unknown> = {browser: 'chrome', logSink}

    await runSetup(outPath, plugin)

    // The path-derived id must never be announced for an absent guest.
    expect(banner.printDevBannerOnce).not.toHaveBeenCalled()
    expect(plugin.extensionLoadRefused).toBe(
      'Variable $2$ used but not defined.'
    )
    expect(
      errorSpy.mock.calls.some((c) =>
        /refused to load this extension/i.test(String(c[0]))
      )
    ).toBe(true)
    expect(
      logSink.mock.calls.some((c) =>
        String(c[0]?.text || '').startsWith('extension_load_refused:')
      )
    ).toBe(true)

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('extension_load_refused')
  })

  // The same run on a healthy guest: this is the half that must not change.
  it('leaves a loaded guest on the normal banner path', async () => {
    const {outPath, readyPath} = makeSession()
    verifyGuestLoadedSpy.mockResolvedValue({
      status: 'loaded',
      extensionId: 'user-ext-id'
    })
    const plugin: Record<string, unknown> = {browser: 'chrome'}

    await runSetup(outPath, plugin)

    expect(banner.printDevBannerOnce).toHaveBeenCalled()
    expect(plugin.extensionLoadRefused).toBeUndefined()

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('ready')
    expect(ready.code).toBeUndefined()
  })

  // Old Chrome / no Extensions domain: an unanswerable question is not a
  // refusal, so the session proceeds exactly as it did before §83.
  it('proceeds normally when the verdict is unknown', async () => {
    const {outPath, readyPath} = makeSession()
    verifyGuestLoadedSpy.mockResolvedValue({status: 'unknown'})
    const plugin: Record<string, unknown> = {browser: 'chrome'}

    await runSetup(outPath, plugin)

    expect(banner.printDevBannerOnce).toHaveBeenCalled()
    expect(plugin.extensionLoadRefused).toBeUndefined()
    expect(JSON.parse(fs.readFileSync(readyPath, 'utf-8')).status).toBe('ready')
  })
})
