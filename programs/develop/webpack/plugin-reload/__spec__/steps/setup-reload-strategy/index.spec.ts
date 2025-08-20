import {describe, it, expect, vi} from 'vitest'
import {Compiler} from '@rspack/core'

vi.mock('../../../../lib/constants', () => ({
  CHROMIUM_BASED_BROWSERS: ['chrome', 'edge', 'chromium-based']
}))

vi.mock('../../../steps/setup-chromium-reload-client', () => ({
  SetupChromiumReloadClient: vi.fn()
}))

vi.mock('../../../steps/setup-firefox-reload-client', () => ({
  SetupFirefoxReloadClient: vi.fn()
}))

vi.mock('../apply-manifest-dev-defaults', () => ({
  ApplyManifestDevDefaults: class {
    constructor(_: any) {}
    apply(compiler: any) {
      // simulate minimal hook presence so code under test can tap into it without error
      compiler.hooks = compiler.hooks || {}
      compiler.hooks.thisCompilation = compiler.hooks.thisCompilation || {
        tap: (_name: string, fn: (compilation: any) => void) =>
          fn({
            hooks: {
              processAssets: {
                tap: () => {}
              }
            },
            updateAsset: () => {}
          })
      }
    }
  }
}))

vi.mock('../target-web-extension-plugin', () => ({
  TargetWebExtensionPlugin: class {
    constructor(_: any) {}
    apply(compiler: any) {
      // no-op guard to avoid fs access
      compiler.hooks = compiler.hooks || {}
      compiler.hooks.thisCompilation = compiler.hooks.thisCompilation || {
        tap: () => {}
      }
    }
  }
}))

import SetupReloadStrategy from '../../../steps/setup-reload-strategy'
import {SetupChromiumReloadClient} from '../../../steps/setup-chromium-reload-client'
import {SetupFirefoxReloadClient} from '../../../steps/setup-firefox-reload-client'

function makeCompiler(): Compiler {
  return {
    options: {
      context: '/project',
      resolve: {alias: {}},
      module: {rules: []}
    },
    hooks: {
      thisCompilation: {
        tap: (_name: string, fn: (compilation: any) => void) =>
          fn({
            hooks: {
              processAssets: {tap: () => {}}
            },
            updateAsset: () => {}
          })
      }
    }
  } as any
}

describe('SetupReloadStrategy', () => {
  it('sets up chromium reload client when browser is chromium-based', () => {
    const step = new (SetupReloadStrategy as any)({
      manifestPath: '',
      browser: 'chrome'
    })
    const compiler = makeCompiler()
    step.apply(compiler)
    expect(SetupChromiumReloadClient).toHaveBeenCalled()
  })

  it('sets up firefox reload client when browser is firefox', () => {
    const step = new (SetupReloadStrategy as any)({
      manifestPath: '',
      browser: 'firefox'
    })
    const compiler = makeCompiler()
    step.apply(compiler)
    expect(SetupFirefoxReloadClient).toHaveBeenCalled()
  })
})
