import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {
  asCompilation,
  asCompiler,
  type TapCallback
} from '../../__spec__/helpers/rspack-fakes'
import {getOriginalManifestContent} from '../manifest-lib/manifest'
import {EmitManifest} from '../steps/emit-manifest'
import type {FakeSource, StepDiagnostic} from './helpers/manifest-fakes'

const makeTempFolder = trackTempFolders()

describe('EmitManifest', () => {
  it('stores the sanitized source manifest and emits it unchanged', () => {
    const tempDir = makeTempFolder('emit-manifest-')
    const manifestPath = path.join(tempDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          name: 'x',
          side_panel: {default_path: 'src/sidebar/index.html'},
          $schema: 'ignore'
        },
        null,
        2
      )
    )

    const errors: StepDiagnostic[] = []
    let tapRan = false
    const emitted: Record<string, string> = {}

    const compilation = asCompilation({
      errors,
      hooks: {
        processAssets: {
          tap: (_opts: unknown, fn: TapCallback) => {
            tapRan = true
            fn()
          }
        }
      },
      emitAsset: (name: string, source: FakeSource) => {
        emitted[name] = source.source().toString()
      }
    })

    const compiler = asCompiler({
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: TapCallback) => fn(compilation)
        }
      }
    })

    const plugin = new EmitManifest({manifestPath})
    plugin.apply(compiler)

    expect(tapRan).toBe(true)
    expect(getOriginalManifestContent(compilation)).toBe(
      '{\n  "name": "x",\n  "side_panel": {\n    "default_path": "src/sidebar/index.html"\n  }\n}'
    )

    expect(JSON.parse(emitted['manifest.json'])).toEqual({
      name: 'x',
      side_panel: {default_path: 'src/sidebar/index.html'}
    })

    new EmitManifest({
      manifestPath: path.join(tempDir, 'missing.json')
    }).apply(compiler)

    expect(errors.length).toBeGreaterThan(0)
  })

  it('emits a commented manifest as plain JSON and says so once across rebuilds', () => {
    const tempDir = makeTempFolder('emit-manifest-comments-')
    const manifestPath = path.join(tempDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      '{\n  // kept in the source\n  "name": "x", // and here\n  "version": "1.0.0"\n}\n'
    )

    const emitted: string[] = []
    const errors: StepDiagnostic[] = []
    const compilation = () =>
      asCompilation({
        errors,
        hooks: {
          processAssets: {tap: (_opts: unknown, fn: TapCallback) => fn()}
        },
        emitAsset: (_name: string, source: FakeSource) => {
          emitted.push(source.source().toString())
        }
      })
    const rebuilds: Array<TapCallback> = []
    const compiler = asCompiler({
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: TapCallback) => rebuilds.push(fn)
        }
      }
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      new EmitManifest({manifestPath, browser: 'firefox'}).apply(compiler)

      rebuilds[0](compilation())
      rebuilds[0](compilation())

      const said = logSpy.mock.calls
        .map((call) => call.join(' '))
        .filter((line) => line.includes('Removed the comments'))

      expect(errors).toEqual([])
      expect(emitted).toHaveLength(2)
      expect(emitted[1]).toBe('{\n  "name": "x",\n  "version": "1.0.0"\n}')
      expect(said).toHaveLength(1)
    } finally {
      logSpy.mockRestore()
    }
  })
})
