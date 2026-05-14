// Regression: AddContentScriptWrapper must install its loader rule in every
// build mode. The wrapper rewrites `export default fn` into
// `__EXTENSIONJS_default__` and emits the `__EXTENSIONJS_mount(...)` call
// that actually invokes the user's default export. Without it, rspack treats
// the entry chunk as a side-effect-free module exporting an unused default
// and tree-shakes the entire body — content scripts ship empty in
// production. EXTENSION_NO_RELOAD opts out of the dev reload strategy
// (SetupReloadStrategy + StripContentScriptDevServerRuntime), not the
// wrapper itself.

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    lstatSync: vi.fn(() => ({isFile: () => true}))
  }
})

// Constructable mocks: `new ScriptsPlugin(...).apply(compiler)` instantiates
// the inner plugins via `new`, so each mock must be a real constructor.
// vi.fn().mockImplementation(...) is a callable but not a constructor.
const wrapperCtor = vi.hoisted(() =>
  vi.fn(function (this: any) {
    this.apply = () => {}
  })
)
vi.mock('../steps/setup-reload-strategy/add-content-script-wrapper', () => ({
  AddContentScriptWrapper: wrapperCtor
}))
vi.mock('../steps/add-scripts', () => ({
  AddScripts: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/setup-reload-strategy', () => ({
  SetupReloadStrategy: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/strip-content-script-dev-server-runtime', () => ({
  StripContentScriptDevServerRuntime: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/add-public-path-runtime-module', () => ({
  AddPublicPathRuntimeModule: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/setup-reload-strategy/inject-scripts-replay-shim', () => ({
  InjectScriptsReplayShim: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))

import {ScriptsPlugin} from '../index'
import {AddContentScriptWrapper} from '../steps/setup-reload-strategy/add-content-script-wrapper'

function makeCompiler(mode: 'development' | 'production' | 'none') {
  return {
    options: {
      mode,
      module: {rules: []}
    }
  } as any
}

const fixtureManifest = path.join(__dirname, '__fixtures__', 'manifest.json')

describe('ScriptsPlugin content-script wrapper gating', () => {
  beforeEach(() => {
    ;(AddContentScriptWrapper as any).mockClear()
  })

  afterEach(() => {
    delete process.env.EXTENSION_NO_RELOAD
    vi.restoreAllMocks()
  })

  it('installs the wrapper in development mode', () => {
    new ScriptsPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('development'))
    expect(AddContentScriptWrapper).toHaveBeenCalledTimes(1)
  })

  it('installs the wrapper in production mode (mount call must run in prod)', () => {
    new ScriptsPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('production'))
    expect(AddContentScriptWrapper).toHaveBeenCalledTimes(1)
  })

  it('still installs the wrapper when EXTENSION_NO_RELOAD=true (--no-reload)', () => {
    process.env.EXTENSION_NO_RELOAD = 'true'
    new ScriptsPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('development'))
    expect(AddContentScriptWrapper).toHaveBeenCalledTimes(1)
  })
})
