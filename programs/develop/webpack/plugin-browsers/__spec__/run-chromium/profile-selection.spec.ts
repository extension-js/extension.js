import {beforeEach, describe, expect, it, vi} from 'vitest'

// Ensure the plugin believes a binary exists during tests
vi.mock('fs', async (orig) => {
  const mod = await (orig as any)()
  return {
    ...mod,
    existsSync: (p: string) => true
  }
})
vi.mock('chrome-location2', () => ({default: () => '/Applications/Chrome.app'}))
vi.mock('chromium-location', () => ({default: () => '/Applications/Chromium.app'}))
vi.mock('edge-location', () => ({default: () => '/Applications/Edge.app'}))

const browserConfigMock = vi.fn(() => ['--flagA'])
vi.mock('../../run-chromium/chromium-launch/browser-config', () => ({
  browserConfig: (...args: any[]) => browserConfigMock(...args)
}))

import {RunChromiumPlugin} from '../../run-chromium'

function mkCompiler() {
  return {
    hooks: {
      done: {
        tapAsync: (_: any, cb: any) =>
          cb(
            {compilation: {options: {output: {path: '/tmp/out/chrome'}}}},
            () => {}
          ),
        tapPromise: (_: any, fn: any) =>
          Promise.resolve(
            fn({compilation: {options: {output: {path: '/tmp/out/chrome'}}}})
          )
      }
    },
    options: {context: process.cwd()}
  } as any
}

describe('profile selection under concurrency', () => {
  beforeEach(() => {
    browserConfigMock.mockClear()
  })

  it('uses per-instance profile when another chromium instance is running', async () => {
    const plugin = new RunChromiumPlugin({
      extension: ['/path/to/user-ext'],
      browser: 'chrome'
    } as any)
    const compiler = mkCompiler()
    plugin.apply(compiler as any)

    // browserConfig called with profile: undefined (per-instance managed)
    const call = browserConfigMock.mock.calls[0]?.[1] || {}
    expect(call.profile).toBeUndefined()
  })
})
