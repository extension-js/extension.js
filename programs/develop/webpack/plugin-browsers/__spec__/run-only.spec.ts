import {describe, expect, it, vi, beforeEach} from 'vitest'

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
    expect(printProdBannerOnce).toHaveBeenCalledWith({
      browser: 'chromium',
      outPath: '/tmp/ext',
      includeExtensionId: true,
      includeRunId: false,
      readyPath: undefined
    })
  })

  it('prints production banner for firefox preview', async () => {
    await runOnlyPreviewBrowser({
      browser: 'firefox',
      outPath: '/tmp/ext-firefox',
      contextDir: '/tmp',
      extensionsToLoad: ['/tmp/ext-firefox']
    })

    expect(firefoxRunOnce).toHaveBeenCalledTimes(1)
    expect(printProdBannerOnce).toHaveBeenCalledWith({
      browser: 'firefox',
      outPath: '/tmp/ext-firefox',
      includeExtensionId: true,
      includeRunId: false,
      readyPath: undefined
    })
  })
})
