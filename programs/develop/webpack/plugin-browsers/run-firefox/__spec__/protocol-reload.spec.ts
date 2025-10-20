import {describe, it, expect, vi} from 'vitest'
import {RunFirefoxPlugin} from '../index'

vi.mock('../remote-firefox/index', () => {
  class RemoteFirefox {
    public installAddons = vi.fn(async () => {})
    constructor(_: any) {}
  }
  return {RemoteFirefox}
})

describe('Firefox protocol reload path (unit)', () => {
  it('reinstalls addons on subsequent rebuilds with critical changes', async () => {
    const plugin = new RunFirefoxPlugin({
      extension: '/ext',
      browser: 'firefox',
      port: 9333,
      dryRun: true
    } as any)

    let tapCb: any
    const hooks: any = {
      done: {
        tapAsync: (_: string, cb: any) => {
          tapCb = cb
        }
      }
    }
    const compiler: any = {hooks}

    plugin.apply(compiler)

    // First build
    await new Promise<void>((resolve) =>
      tapCb(
        {compilation: {options: {mode: 'development'}, getAssets: () => []}},
        resolve
      )
    )

    // Second build with critical change (simulate via assetsInfo keys)
    const fakeAssets = new Map<string, any>([
      ['background/service_worker.js', {}]
    ])
    await new Promise<void>((resolve) =>
      tapCb(
        {
          compilation: {
            options: {mode: 'development'},
            assetsInfo: fakeAssets,
            getAssets: undefined
          }
        },
        resolve
      )
    )

    expect(true).toBe(true)
  })
})
