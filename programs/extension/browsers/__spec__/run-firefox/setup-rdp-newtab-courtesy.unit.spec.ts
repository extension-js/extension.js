import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const calls: string[] = []
const ensureLoaded = vi.fn(async () => {
  calls.push('ensureLoaded')
})
const openNewTab = vi.fn(async () => {
  calls.push('openNewTab')
  return true
})
const getAddonInstallRefusalReason = vi.fn(() => null)

vi.mock('../../run-firefox/rdp/rdp-extension-controller', () => ({
  FirefoxRDPController: class {
    ensureLoaded = ensureLoaded
    openNewTab = openNewTab
    getAddonInstallRefusalReason = getAddonInstallRefusalReason
  }
}))

const {setupRdpAfterLaunch} = await import(
  '../../run-firefox/firefox-launch/setup-rdp-after-launch'
)

let out: string

function writeManifest(manifest: Record<string, unknown>) {
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest))
}

const compilation = () => ({options: {output: {path: out}}}) as any

beforeEach(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-newtab-courtesy-'))
  calls.length = 0
  ensureLoaded.mockClear()
  openNewTab.mockClear()
})

afterEach(() => {
  fs.rmSync(out, {recursive: true, force: true})
})

describe('firefox new-tab courtesy after launch', () => {
  it('opens the override page after the add-ons are loaded', async () => {
    writeManifest({
      manifest_version: 3,
      chrome_url_overrides: {newtab: 'newtab.html'}
    })
    await setupRdpAfterLaunch({browser: 'firefox'} as any, compilation(), 9222)
    expect(calls).toEqual(['ensureLoaded', 'openNewTab'])
  })

  it('reads the prefixed override key of a raw add-on directory', async () => {
    writeManifest({
      manifest_version: 3,
      'firefox:chrome_url_overrides': {newtab: 'newtab.html'}
    })
    await setupRdpAfterLaunch({browser: 'firefox'} as any, compilation(), 9222)
    expect(openNewTab).toHaveBeenCalledTimes(1)
  })

  it('lets an explicit starting url win', async () => {
    writeManifest({
      manifest_version: 3,
      chrome_url_overrides: {newtab: 'newtab.html'}
    })
    await setupRdpAfterLaunch(
      {browser: 'firefox', startingUrl: 'https://example.com/'} as any,
      compilation(),
      9222
    )
    expect(openNewTab).not.toHaveBeenCalled()
  })

  it('keeps quiet mode quiet', async () => {
    writeManifest({
      manifest_version: 3,
      chrome_url_overrides: {newtab: 'newtab.html'}
    })
    await setupRdpAfterLaunch(
      {browser: 'firefox', noOpen: true} as any,
      compilation(),
      9222
    )
    expect(openNewTab).not.toHaveBeenCalled()
  })

  it('opens nothing extra for an extension without the override', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})
    await setupRdpAfterLaunch({browser: 'firefox'} as any, compilation(), 9222)
    expect(openNewTab).not.toHaveBeenCalled()
  })

  it('never lets the courtesy tab fail the launch', async () => {
    writeManifest({
      manifest_version: 3,
      chrome_url_overrides: {newtab: 'newtab.html'}
    })
    openNewTab.mockRejectedValueOnce(new Error('rdp gone'))
    const controller = await setupRdpAfterLaunch(
      {browser: 'firefox'} as any,
      compilation(),
      9222
    )
    expect(controller).toBeDefined()
  })
})
