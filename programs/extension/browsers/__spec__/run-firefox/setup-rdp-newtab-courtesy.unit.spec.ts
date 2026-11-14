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
const openStartingUrl = vi.fn(async (url: string) => {
  calls.push(`openStartingUrl ${url}`)

  return 'navigated'
})

const evaluateInBackground = vi.fn(
  async (_expression: string, _timeoutMs: number): Promise<unknown> => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    calls.push('asked')

    return {outcome: 'settled', count: 2, looks: 3, waitedMs: 50}
  }
)

const releaseSession = vi.fn(() => {
  calls.push('released')
})
const openBackgroundSession = vi.fn(async () => ({
  evaluate: evaluateInBackground,
  release: releaseSession
}))

vi.mock('../../run-firefox/rdp/rdp-extension-controller', () => ({
  FirefoxRDPController: class {
    ensureLoaded = ensureLoaded
    openNewTab = openNewTab
    getAddonInstallRefusalReason = getAddonInstallRefusalReason
    openStartingUrl = openStartingUrl
    openBackgroundSession = openBackgroundSession
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
  openStartingUrl.mockClear()
  evaluateInBackground.mockClear()
  releaseSession.mockClear()
  openBackgroundSession.mockClear()
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

  // The launch opens about:blank, so the starting page loads once the add-on
  // is installed and its document_start content scripts can reach it.
  it('opens the starting url after the add-on is loaded', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})

    await setupRdpAfterLaunch(
      {browser: 'firefox', startingUrl: 'https://example.com/'} as any,
      compilation(),
      9222
    )

    expect(calls).toEqual([
      'ensureLoaded',
      'openStartingUrl https://example.com/'
    ])
  })

  // Firefox reads the background as running before its registry calls
  // answered, so the page waits for the dev server to say they have.
  it('opens the starting url only after the boot registrations settle', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})
    const awaitBootRegistrations = vi.fn(async (_timeoutMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      calls.push('settled')

      return 'settled' as const
    })

    await setupRdpAfterLaunch(
      {
        browser: 'firefox',
        startingUrl: 'https://example.com/',
        awaitBootRegistrations
      } as any,
      compilation(),
      9222
    )

    expect(awaitBootRegistrations).toHaveBeenCalledWith(5000)
    expect(calls).toEqual([
      'ensureLoaded',
      'settled',
      'openStartingUrl https://example.com/'
    ])
  })

  // A production build has no dev server to ask, so the background is.
  it('asks the background for its boot registrations before the starting url', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})

    await setupRdpAfterLaunch(
      {
        browser: 'firefox',
        startingUrl: 'https://example.com/',
        bootRegistrationsFromBackground: true
      } as any,
      compilation(),
      9222
    )

    expect(evaluateInBackground).toHaveBeenCalledTimes(1)
    expect(evaluateInBackground.mock.calls[0][0]).toContain(
      'getRegisteredContentScripts'
    )

    expect(evaluateInBackground.mock.calls[0][1]).toBe(5000)
    expect(openBackgroundSession).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      'ensureLoaded',
      'asked',
      'released',
      'openStartingUrl https://example.com/'
    ])
  })

  // The page opened on an empty registry, so the same session keeps reading
  // and says so when a registration follows.
  it('says so in one line when a registration lands after the starting url', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    evaluateInBackground
      .mockResolvedValueOnce({outcome: 'none', count: 0, looks: 2, ageMs: 160})
      .mockResolvedValueOnce({count: 0, ageMs: 200})
      .mockResolvedValueOnce({count: 2, ageMs: 430})

    await setupRdpAfterLaunch(
      {
        browser: 'firefox',
        startingUrl: 'https://example.com/',
        bootRegistrationsFromBackground: true
      } as any,
      compilation(),
      9222
    )

    await vi.waitFor(() => expect(releaseSession).toHaveBeenCalledTimes(1))

    const printed = [...warnSpy.mock.calls, ...logSpy.mock.calls]
      .map((call) => String(call[0]))
      .filter((line) => line.includes('registered a content script'))

    warnSpy.mockRestore()
    logSpy.mockRestore()

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('0.4s after it started')
    expect(openBackgroundSession).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      'ensureLoaded',
      'openStartingUrl https://example.com/',
      'released'
    ])
  })

  it('asks the background nothing when its files name no registration', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})

    await setupRdpAfterLaunch(
      {browser: 'firefox', startingUrl: 'https://example.com/'} as any,
      compilation(),
      9222
    )

    expect(openBackgroundSession).not.toHaveBeenCalled()
    expect(evaluateInBackground).not.toHaveBeenCalled()
    expect(calls).toEqual([
      'ensureLoaded',
      'openStartingUrl https://example.com/'
    ])
  })

  it('lets the dev server answer when it hands a wait over', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})
    const awaitBootRegistrations = vi.fn(async () => 'settled' as const)

    await setupRdpAfterLaunch(
      {
        browser: 'firefox',
        startingUrl: 'https://example.com/',
        awaitBootRegistrations,
        bootRegistrationsFromBackground: true
      } as any,
      compilation(),
      9222
    )

    expect(awaitBootRegistrations).toHaveBeenCalledTimes(1)
    expect(openBackgroundSession).not.toHaveBeenCalled()
    expect(evaluateInBackground).not.toHaveBeenCalled()
  })

  it('asks for no hold when the session opens no page', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})
    const awaitBootRegistrations = vi.fn(async () => 'settled' as const)

    await setupRdpAfterLaunch(
      {browser: 'firefox', awaitBootRegistrations} as any,
      compilation(),
      9222
    )

    expect(awaitBootRegistrations).not.toHaveBeenCalled()
  })

  it('opens no starting url under --no-open', async () => {
    writeManifest({manifest_version: 3, name: 'plain'})

    await setupRdpAfterLaunch(
      {
        browser: 'firefox',
        startingUrl: 'https://example.com/',
        noOpen: true
      } as any,
      compilation(),
      9222
    )

    expect(openStartingUrl).not.toHaveBeenCalled()
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

  it('says so when the override page could not be opened', async () => {
    writeManifest({
      manifest_version: 3,
      chrome_url_overrides: {newtab: 'newtab.html'}
    })

    openNewTab.mockResolvedValueOnce(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const previousDebug = process.env.EXTENSION_DEBUG
    process.env.EXTENSION_DEBUG = '1'

    try {
      await setupRdpAfterLaunch(
        {browser: 'firefox'} as any,
        compilation(),
        9222
      )

      const printed = warn.mock.calls.map((c) => c.map(String).join(' '))
      expect(
        printed.some((line) =>
          line.includes('could not open the new-tab override page')
        )
      ).toBe(true)
    } finally {
      warn.mockRestore()

      if (previousDebug === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
      } else process.env.EXTENSION_DEBUG = previousDebug
    }
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
