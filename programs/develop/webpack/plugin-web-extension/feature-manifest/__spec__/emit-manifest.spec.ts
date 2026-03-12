import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect} from 'vitest'

import {EmitManifest} from '../steps/emit-manifest'
import {getOriginalManifestContent} from '../manifest-lib/manifest'

describe('EmitManifest', () => {
  it('stores the sanitized source manifest and emits it unchanged', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-manifest-'))
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

    // Now simulate read error
    new EmitManifest({
      manifestPath: path.join(tempDir, 'missing.json')
    } as any).apply(compiler)

    expect(errors.length).toBeGreaterThan(0)
  })
})
