import {describe, it, expect} from 'vitest'
import type {RuntimeModule} from 'webpack'
import LoadScriptRuntimeModule from '../webpack-target-webextension-fork/lib/webpack5/RuntimeModules/LoadScript'

const makeWebpackStub = () => {
  const captured: {generated?: string} = {}

  const Template = {
    asString(chunks: any[]) {
      const flat = chunks.filter(Boolean).join('\n')
      captured.generated = flat
      return flat
    },
    indent(lines: any) {
      const value = Array.isArray(lines) ? lines.join('\n') : String(lines)
      return value
        .split('\n')
        .map((l) => (l ? `  ${l}` : l))
        .join('\n')
    }
  }

  const RuntimeGlobals = {
    ensureChunkHandlers: {j: '__ensureChunkHandlers'},
    loadScript: '__webpack_require__.l',
    publicPath: '__webpack_require__.p'
  }

  class StubRuntimeModule {
    static STAGE_BASIC = 0
    constructor(
      public name: string,
      public stage: number
    ) {}
  }

  const webpack: any = {
    Template,
    RuntimeGlobals,
    RuntimeModule: StubRuntimeModule,
    javascript: {JavascriptModulesPlugin: {getChunkFilenameTemplate: () => ''}},
    HotUpdateChunk: function HotUpdateChunk() {}
  }

  return {webpack, captured}
}

const makeCompilation = (chunkName: string | undefined) => {
  const outputOptions = {environment: {const: true, optionalChaining: true}}
  const chunk = {name: chunkName}
  return {outputOptions, chunk}
}

function getGeneratedCode(
  chunkName: string | undefined,
  contentScriptsMeta: any
) {
  const {webpack, captured} = makeWebpackStub()
  const module: RuntimeModule = LoadScriptRuntimeModule(
    webpack as any,
    true,
    true,
    contentScriptsMeta
  ) as any
  ;(module as any).compilation = makeCompilation(chunkName)
  // generate() writes into captured.generated via Template.asString
  ;(module as any).generate()
  return captured.generated || ''
}

describe('LoadScriptRuntimeModule world-aware loader selection', () => {
  it('uses DOM loader for MAIN world content scripts', () => {
    const code = getGeneratedCode('content_scripts/content-0', {
      'content_scripts/content-0.js': {
        index: 0,
        bundleId: 'content_scripts/content-0.js',
        world: 'main'
      }
    })

    // MAIN world: should not rely on extension runtime classic loader path.
    expect(code).toContain('const scriptLoader')
    expect(code).toContain("location.protocol.includes('-extension:')")
    expect(code).toContain('EXTJS_WTW_LOAD')
  })

  it('keeps classic loader path for extension-world content scripts', () => {
    const code = getGeneratedCode('content_scripts/content-1', {
      'content_scripts/content-1.js': {
        index: 1,
        bundleId: 'content_scripts/content-1.js',
        world: 'extension'
      }
    })

    // Extension world: retain classic loader branch when runtime is available,
    // with DOM loader as fallback when no runtime is detected.
    expect(code).toContain(
      'else if (!isWorker && hasExtensionRuntime) __webpack_require__.l = classicLoader;'
    )
    expect(code).toContain(
      'else if (!isWorker) __webpack_require__.l = scriptLoader;'
    )
  })

  it('defaults to extension world behavior when no metadata is present', () => {
    const code = getGeneratedCode('content_scripts/content-2', {})

    // Without explicit metadata, behavior should match extension world.
    expect(code).toContain(
      'else if (!isWorker && hasExtensionRuntime) __webpack_require__.l = classicLoader;'
    )
  })
})
