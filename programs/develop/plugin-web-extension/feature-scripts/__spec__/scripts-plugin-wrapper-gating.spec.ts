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

const wrapperCtor = vi.hoisted(() =>
  vi.fn(function (this: any) {
    this.apply = () => {}
  })
)
vi.mock('../steps/add-content-script-wrapper', () => ({
  AddContentScriptWrapper: wrapperCtor
}))
vi.mock('../steps/add-scripts', () => ({
  AddScripts: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/add-public-path-runtime-module', () => ({
  AddPublicPathRuntimeModule: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))
vi.mock('../steps/trace-runtime-loaded-files', () => ({
  TraceRuntimeLoadedFiles: vi.fn(function (this: any) {
    this.apply = () => {}
  })
}))

import {ScriptsPlugin} from '../index'
import {AddContentScriptWrapper} from '../steps/add-content-script-wrapper'

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
