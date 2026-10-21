import {afterEach, describe, expect, it, vi} from 'vitest'

const located = {path: ''}

vi.mock('chrome-location2', () => ({
  default: () => located.path,
  getChromeVersion: () => '141.0.7390.54'
}))

vi.mock('../browsers-lib/output-binaries-resolver', () => ({
  resolveFromBinaries: () => null,
  sharedManagedCacheEnv: () => ({})
}))

vi.mock('../browsers-lib/wsl-support', () => ({
  isWslEnv: () => false,
  hasGuiDisplay: () => true,
  normalizeBinaryPathForWsl: (p: string) => p
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {...actual, existsSync: () => true}
})

const {resolveBrowserVersionLine} = await import('../browsers-lib/messages')

describe('resolveBrowserVersionLine with no managed Chrome', () => {
  afterEach(() => {
    located.path = ''
  })

  it('names no version for a system Chrome the launcher refuses', () => {
    located.path =
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

    expect(resolveBrowserVersionLine('chrome')).toBe('')
  })

  it('names no version for a Linux system Chrome', () => {
    located.path = '/opt/google/chrome/chrome'

    expect(resolveBrowserVersionLine('chrome')).toBe('')
  })

  it('keeps naming a Chrome for Testing build', () => {
    located.path =
      '/Users/me/.cache/extension.js/chrome/mac_arm-141/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

    expect(resolveBrowserVersionLine('chrome')).toBe('141.0.7390.54')
  })
})
