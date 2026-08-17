import {beforeEach, describe, expect, it, vi} from 'vitest'

const {chromiumRunOnce, firefoxRunOnce, printProdBannerOnce} = vi.hoisted(
  () => ({
    chromiumRunOnce: vi.fn(async () => {}),
    firefoxRunOnce: vi.fn(async () => {}),
    printProdBannerOnce: vi.fn(async () => true)
  })
)

vi.mock('../run-chromium/chromium-context', () => ({
  createChromiumContext: vi.fn(() => ({}))
}))

vi.mock('../run-firefox/firefox-context', () => ({
  createFirefoxContext: vi.fn(() => ({}))
}))

vi.mock('../run-chromium/chromium-launch', () => ({
  ChromiumLaunchPlugin: class {
    runOnce = chromiumRunOnce
  }
}))

vi.mock('../run-firefox/firefox-launch', () => ({
  FirefoxLaunchPlugin: class {
    runOnce = firefoxRunOnce
  }
}))

vi.mock('../browsers-lib/banner', () => ({
  printProdBannerOnce
}))

import {runOnlyPreviewBrowser} from '../run-only'

describe('runOnlyPreviewBrowser', () => {
  beforeEach(() => {
    chromiumRunOnce.mockClear()
    firefoxRunOnce.mockClear()
    printProdBannerOnce.mockClear()
  })

  it('prints production banner for chromium preview', async () => {
    await runOnlyPreviewBrowser({
      browser: 'chromium',
      outPath: '/tmp/ext',
      contextDir: '/tmp',
      extensionsToLoad: ['/tmp/ext']
    })

    expect(chromiumRunOnce).toHaveBeenCalledTimes(1)
    expect(chromiumRunOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mode: 'production',
          context: '/tmp',
          output: {path: '/tmp/ext'}
        }),
        errors: []
      }),
      {enableCdpPostLaunch: false}
    )
    expect(printProdBannerOnce).toHaveBeenCalledWith({
      browser: 'chromium',
      outPath: '/tmp/ext',
      includeExtensionId: true,
      includeRunId: false,
      readyPath: undefined,
      browserVersionLine: undefined
    })
  })

  // Shell-script fixture: not executable on Windows, posix-only case.
  it.skipIf(process.platform === 'win32')(
    'describes a chrome-target pin on the card, not the system chrome',
    async () => {
      const {chmodSync, mkdtempSync, rmSync, writeFileSync} = await import(
        'node:fs'
      )
      const {tmpdir} = await import('node:os')
      const {join} = await import('node:path')
      const dir = mkdtempSync(join(tmpdir(), 'extjs-run-only-pin-'))
      const pin = join(dir, 'canary')
      writeFileSync(pin, '#!/bin/sh\necho "Canary 999.0.1234.5"\n')
      chmodSync(pin, 0o755)

      try {
        await runOnlyPreviewBrowser({
          browser: 'chrome',
          outPath: '/tmp/ext',
          contextDir: '/tmp',
          extensionsToLoad: ['/tmp/ext'],
          chromiumBinary: pin
        })

        expect(printProdBannerOnce).toHaveBeenCalledWith(
          expect.objectContaining({
            browser: 'chrome',
            binaryPath: pin,
            binaryProvenance: 'pinned',
            browserVersionLine: '999.0.1234.5'
          })
        )
      } finally {
        rmSync(dir, {recursive: true, force: true})
      }
    }
  )

  it('prints the card before it launches chromium', async () => {
    await runOnlyPreviewBrowser({
      browser: 'chromium',
      outPath: '/tmp/ext',
      contextDir: '/tmp',
      extensionsToLoad: ['/tmp/ext']
    })

    expect(printProdBannerOnce.mock.invocationCallOrder[0]).toBeLessThan(
      chromiumRunOnce.mock.invocationCallOrder[0]
    )
  })

  // The gecko install verifies through the banner's nameability verdict, so
  // printing the card first no longer reports a healthy install as failed.
  it('prints the card before it launches firefox', async () => {
    await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: '/tmp/ext-firefox',
      contextDir: '/tmp',
      extensionsToLoad: ['/tmp/ext-firefox']
    })

    expect(printProdBannerOnce.mock.invocationCallOrder[0]).toBeLessThan(
      firefoxRunOnce.mock.invocationCallOrder[0]
    )
  })

  it('prints production banner for firefox preview', async () => {
    await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: '/tmp/ext-firefox',
      contextDir: '/tmp',
      extensionsToLoad: ['/tmp/ext-firefox']
    })

    expect(firefoxRunOnce).toHaveBeenCalledTimes(1)
    expect(firefoxRunOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mode: 'production',
          context: '/tmp',
          output: {path: '/tmp/ext-firefox'}
        }),
        errors: []
      }),
      expect.objectContaining({
        browser: 'firefox',
        mode: 'production',
        profile: undefined,
        persistProfile: undefined,
        geckoBinary: undefined
      })
    )
    expect(printProdBannerOnce).toHaveBeenCalledWith({
      browser: 'firefox',
      outPath: '/tmp/ext-firefox',
      includeExtensionId: true,
      includeRunId: false,
      readyPath: undefined,
      browserVersionLine: undefined
    })
  })

  for (const browser of ['brave', 'opera', 'vivaldi', 'yandex'] as const) {
    it(`routes the chromium fork ${browser} to the chromium launcher`, async () => {
      await runOnlyPreviewBrowser({
        browser,
        outPath: '/tmp/ext',
        contextDir: '/tmp',
        extensionsToLoad: ['/tmp/ext']
      })

      expect(chromiumRunOnce).toHaveBeenCalledTimes(1)
      expect(firefoxRunOnce).not.toHaveBeenCalled()
    })
  }

  for (const browser of ['waterfox', 'librewolf'] as const) {
    it(`routes the gecko fork ${browser} to the firefox launcher`, async () => {
      await runOnlyPreviewBrowser({
        browser,
        outPath: '/tmp/ext',
        contextDir: '/tmp',
        extensionsToLoad: ['/tmp/ext']
      })

      expect(firefoxRunOnce).toHaveBeenCalledTimes(1)
      expect(chromiumRunOnce).not.toHaveBeenCalled()
    })
  }
})
