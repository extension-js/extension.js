// Regression: AddContentScriptWrapper should NOT install its loader rule
// when the build mode is production OR when EXTENSION_NO_RELOAD is set.
// Production dists carried the wrapper for years (registry +
// __extjsGeneration tracking + data-extjs-reinject-* attributes baked
// into every content_script bundle), which was dead code in prod and
// caused flicker on `extension dev` rebuilds. The CLI's `--no-reload`
// surfaces the same opt-out for development.

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
vi.mock(
  '../steps/setup-reload-strategy/add-content-script-wrapper',
  () => ({AddContentScriptWrapper: wrapperCtor})
)
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

  it('installs the wrapper in development mode by default', () => {
    new ScriptsPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('development'))
    expect(AddContentScriptWrapper).toHaveBeenCalledTimes(1)
  })

  it('skips the wrapper in production mode (no dead reinject runtime in prod dists)', () => {
    new ScriptsPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('production'))
    expect(AddContentScriptWrapper).not.toHaveBeenCalled()
  })

  it('skips the wrapper in development when EXTENSION_NO_RELOAD=true (--no-reload)', () => {
    process.env.EXTENSION_NO_RELOAD = 'true'
    new ScriptsPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('development'))
    expect(AddContentScriptWrapper).not.toHaveBeenCalled()
  })

  it('still installs the wrapper in development when EXTENSION_NO_RELOAD is unset/other', () => {
    process.env.EXTENSION_NO_RELOAD = ''
    new ScriptsPlugin({
      manifestPath: fixtureManifest,
      browser: 'chromium'
    } as any).apply(makeCompiler('development'))
    expect(AddContentScriptWrapper).toHaveBeenCalledTimes(1)
  })
})
