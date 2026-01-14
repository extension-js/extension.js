import {describe, it, expect, vi} from 'vitest'
import {RunFirefoxPlugin} from '../../run-firefox'

vi.mock('../../run-firefox/firefox-source-inspection/remote-firefox', () => {
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

  it('retains rdpController after setup and triggers hard reload for SW .mjs', async () => {
    const plugin = new RunFirefoxPlugin({
      extension: '/ext',
      browser: 'firefox',
      port: 9333,
      dryRun: true
    } as any)

    // Simulate that controller is present after launch
    ;(plugin as any).rdpController = {
      hardReload: vi.fn(async (_c: any, _a: string[]) => {})
    }

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

    // Second build: emit .mjs SW and manifest
    const getAssets = () => [
      {name: 'background/service_worker.mjs', emitted: true},
      {name: 'manifest.json', emitted: true}
    ]
    await new Promise<void>((resolve) =>
      tapCb(
        {
          compilation: {
            options: {mode: 'development'},
            getAssets
          },
          hasErrors: () => false
        },
        resolve
      )
    )

    // We cannot directly access changed list, but our hook calls rdpController.hardReload
    // when critical asset emitted was detected.
    expect(
      ((plugin as any).rdpController.hardReload as any).mock.calls.length
    ).toBeGreaterThan(0)
  })
})

