import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {getOriginalManifestContent} from '../manifest-lib/manifest'
import {EmitManifest} from '../steps/emit-manifest'

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

    const errors: any[] = []
    let tapRan = false
    const emitted: Record<string, string> = {}

    const compilation: any = {
      errors,
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => {
            tapRan = true
            fn()
          }
        }
      },
      emitAsset: (name: string, source: any) => {
        emitted[name] = source.source().toString()
      }
    }

    const compiler: any = {
      hooks: {
        thisCompilation: {tap: (_name: string, fn: any) => fn(compilation)}
      }
    }

    const plugin = new EmitManifest({manifestPath} as any)
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
    } as any).apply(compiler)

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
    const errors: any[] = []
    const compilation = (): any => ({
      errors,
      hooks: {processAssets: {tap: (_opts: any, fn: any) => fn()}},
      emitAsset: (_name: string, source: any) => {
        emitted.push(source.source().toString())
      }
    })
    const rebuilds: Array<(compilation: any) => void> = []
    const compiler: any = {
      hooks: {
        thisCompilation: {tap: (_name: string, fn: any) => rebuilds.push(fn)}
      }
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      new EmitManifest({manifestPath, browser: 'firefox'} as any).apply(
        compiler
      )

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
