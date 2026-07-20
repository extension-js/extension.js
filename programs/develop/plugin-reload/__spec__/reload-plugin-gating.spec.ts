import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    lstatSync: vi.fn(() => ({isFile: () => true}))
  }
})

const setupReloadStrategyCtor = vi.hoisted(() =>
  vi.fn(function (this: any) {
    this.apply = () => {}
  })
)
const stripCtor = vi.hoisted(() =>
  vi.fn(function (this: any) {
    this.apply = () => {}
  })
)
vi.mock('../steps/setup-reload-strategy', () => ({
  SetupReloadStrategy: setupReloadStrategyCtor
}))
vi.mock('../steps/strip-content-script-dev-server-runtime', () => ({
  StripContentScriptDevServerRuntime: stripCtor
}))
vi.mock('../steps/inject-scripts-replay-shim', () => ({
  InjectScriptsReplayShim: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/inject-bridge-producer', () => ({
  InjectBridgeProducer: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/inject-bridge-relay', () => ({
  InjectBridgeRelay: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))

import {ReloadPlugin} from '../index'

function makeCompiler(mode: 'development' | 'production' | 'none') {
  return {
    options: {
      mode,
      module: {rules: []}
    }
  } as any
}

const fixtureManifest = path.join(__dirname, '__fixtures__', 'manifest.json')

describe('ReloadPlugin dev-only gating', () => {
  beforeEach(() => {
    setupReloadStrategyCtor.mockClear()
    stripCtor.mockClear()
  })

  afterEach(() => {
    delete process.env.EXTENSION_NO_RELOAD
    vi.restoreAllMocks()
  })

  it('applies the reload strategy in development mode', () => {
    new ReloadPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('development'))
    expect(setupReloadStrategyCtor).toHaveBeenCalledTimes(1)
    expect(stripCtor).toHaveBeenCalledTimes(1)
  })

  it('applies nothing in production mode', () => {
    new ReloadPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('production'))
    expect(setupReloadStrategyCtor).not.toHaveBeenCalled()
    expect(stripCtor).not.toHaveBeenCalled()
  })

  it('applies nothing when EXTENSION_NO_RELOAD=true (--no-reload)', () => {
    process.env.EXTENSION_NO_RELOAD = 'true'
    new ReloadPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('development'))
    expect(setupReloadStrategyCtor).not.toHaveBeenCalled()
    expect(stripCtor).not.toHaveBeenCalled()
  })
})
