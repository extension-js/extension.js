import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
const FS = vi.hoisted(() => ({
  existsSync: vi.fn()
}))
vi.mock('fs', () => ({
  ...FS
}))
import * as fs from 'fs'

vi.mock('@rspack/core', () => {
  class RawSource {
    private _content: string
    constructor(content: string) {
      this._content = content
    }
    source() {
      return this._content
    }
  }
  return {
    DefinePlugin: class {
      apply() {}
    },
    Compilation: {PROCESS_ASSETS_STAGE_SUMMARIZE: 0},
    sources: {RawSource}
  }
})

describe('EnvPlugin', () => {
  const originalEnv = {...process.env}

  beforeEach(() => {
    vi.restoreAllMocks()
    // Avoid reading any real .env files
    ;(fs.existsSync as any).mockImplementation(() => false)
    process.env = {...originalEnv}
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('replaces $EXTENSION_PUBLIC_* and $EXTENSION_* placeholders in .html and .json assets', async () => {
    process.env.EXTENSION_PUBLIC_FOO = 'foo-public'
    process.env.EXTENSION_BAR = 'bar-private'

    const {EnvPlugin} = await import('../env')
    const plugin = new EnvPlugin({
      manifestPath:
        '/abs/path/to/examples/content/manifest.json' /* unused in this test but required */,
      browser: 'chrome'
    } as any)

    let processAssetsCallback: (() => void) | undefined

    const updated: Record<string, string> = {}
    const compilation: any = {
      assets: {
        'index.html': {
          source: () => '<div>$EXTENSION_PUBLIC_FOO - $EXTENSION_BAR</div>'
        },
        'data.json': {
          source: () => '{"k":"$EXTENSION_PUBLIC_FOO|$EXTENSION_BAR"}'
        }
      },
      hooks: {
        processAssets: {
          tap: (_: any, cb: any) => {
            processAssetsCallback = () => cb(Object.create(null))
          }
        }
      },
      updateAsset: (filename: string, raw: any) => {
        updated[filename] = raw.source().toString()
      }
    }

    const compiler: any = {
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: any) => fn(compilation)
        }
      }
    }

    plugin.apply(compiler)
    // Trigger inner processAssets tap
    processAssetsCallback && processAssetsCallback()

    expect(updated['index.html']).toBe('<div>foo-public - bar-private</div>')
    expect(updated['data.json']).toBe('{"k":"foo-public|bar-private"}')
  })
})
