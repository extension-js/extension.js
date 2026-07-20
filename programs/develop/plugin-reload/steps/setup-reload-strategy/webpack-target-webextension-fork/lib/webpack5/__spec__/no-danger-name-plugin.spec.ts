import {describe, expect, it} from 'vitest'
import NoDangerNamePlugin from '../NoDangerNamePlugin'

// Minimal webpack stand-in: capture the processAssets tap the plugin registers
// and drive it with a fake asset map, so we can assert exactly which output
// names it rejects without spinning up a real compilation.
function runPluginOn(assetNames: string[]): string[] {
  const errors: Array<{message: string}> = []
  let processAssetsCb: ((assets: Record<string, unknown>) => void) | undefined

  const compilation = {
    errors,
    hooks: {
      processAssets: {
        tap: (
          _opts: unknown,
          cb: (assets: Record<string, unknown>) => void
        ) => {
          processAssetsCb = cb
        }
      }
    }
  }

  const compiler = {
    webpack: {
      Compilation: {PROCESS_ASSETS_STAGE_ADDITIONS: 0},
      WebpackError: class {
        message: string
        stack = ''
        constructor(message: string) {
          this.message = message
        }
      }
    },
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (c: typeof compilation) => void) =>
          cb(compilation)
      }
    }
  }

  new NoDangerNamePlugin().apply(compiler)
  const assets: Record<string, unknown> = {}
  for (const name of assetNames) assets[name] = {}
  processAssetsCb?.(assets)
  return errors.map((e) => e.message)
}

describe('NoDangerNamePlugin', () => {
  it('rejects a genuinely reserved "_"-prefixed output name', () => {
    const errs = runPluginOn(['_runtime.js'])
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('_runtime.js')
    expect(errs[0]).toContain('prohibited')
  })

  it('allows the reserved WebExtensions _locales/ i18n directory', () => {
    // Regression: `dev` failed to compile any internationalized extension
    // because `_locales/<lang>/messages.json` tripped the "_"-prefix guard,
    // even though `build` emits it fine and the platform requires it.
    const errs = runPluginOn([
      '_locales/en/messages.json',
      '_locales/de/messages.json'
    ])
    expect(errs).toEqual([])
  })

  it('allows the reserved _metadata/ directory', () => {
    expect(runPluginOn(['_metadata/verified_contents.json'])).toEqual([])
  })

  it('leaves ordinary output names untouched', () => {
    expect(
      runPluginOn(['manifest.json', 'content_scripts/content-0.js'])
    ).toEqual([])
  })

  it('still catches a dangerous name emitted alongside allowed reserved dirs', () => {
    const errs = runPluginOn(['_locales/en/messages.json', '_danger.js'])
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('_danger.js')
  })
})
