import * as path from 'node:path'
import {beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')

  return {
    ...actual,
    existsSync: vi.fn(() => true),
    lstatSync: vi.fn(() => ({isFile: () => true}))
  }
})

const producerCtor = vi.hoisted(() =>
  vi.fn(function (this: any) {
    this.apply = () => {}
  })
)
const relayCtor = vi.hoisted(() =>
  vi.fn(function (this: any) {
    this.apply = () => {}
  })
)
const inert = vi.hoisted(
  () => () =>
    vi.fn(function (this: any) {
      this.apply = () => {}
    })
)

vi.mock('../steps/setup-reload-strategy', () => ({
  SetupReloadStrategy: inert()
}))

vi.mock('../steps/strip-content-script-dev-server-runtime', () => ({
  StripContentScriptDevServerRuntime: inert()
}))

vi.mock('../steps/inject-scripts-replay-shim', () => ({
  InjectScriptsReplayShim: inert()
}))

vi.mock('../steps/prune-stale-hot-updates', () => ({
  PruneStaleHotUpdates: inert()
}))

vi.mock('../steps/inject-bridge-producer', () => ({
  InjectBridgeProducer: producerCtor
}))

vi.mock('../steps/inject-bridge-relay', () => ({
  InjectBridgeRelay: relayCtor
}))

import {ReloadPlugin} from '../index'

const manifestPath = path.join(__dirname, '__fixtures__', 'manifest.json')
const compiler = {options: {mode: 'development', module: {rules: []}}} as any

describe('ReloadPlugin producer injection per engine', () => {
  beforeEach(() => {
    producerCtor.mockClear()
    relayCtor.mockClear()
  })

  it('injects the reload producer and relay for chromium', () => {
    new ReloadPlugin({manifestPath, browser: 'chromium'} as any).apply(compiler)
    expect(producerCtor).toHaveBeenCalledTimes(1)
    expect(relayCtor).toHaveBeenCalledTimes(1)
  })

  it('never injects them into the user background for chromium-emulator', () => {
    new ReloadPlugin({manifestPath, browser: 'chromium-emulator'} as any).apply(
      compiler
    )

    expect(producerCtor).not.toHaveBeenCalled()
    expect(relayCtor).not.toHaveBeenCalled()
  })
})
