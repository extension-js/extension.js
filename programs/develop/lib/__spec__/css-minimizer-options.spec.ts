import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {cssMinimizerOptions} from '../css-minimizer-options'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function minify(css: string, manifest: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-min-'))
  tempDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'page.css'), css, 'utf8')

  return new Promise<string>((resolve, reject) => {
    rspack({
      mode: 'production',
      context: dir,
      entry: {page: './page.css'},
      output: {path: path.join(dir, 'out')},
      experiments: {css: true},
      module: {rules: [{test: /\.css$/, type: 'css'}]},
      optimization: {
        minimize: true,
        minimizer: [
          new rspack.LightningCssMinimizerRspackPlugin({
            minimizerOptions: cssMinimizerOptions(manifest, 'chrome')
          })
        ]
      }
    }).run((error, stats) => {
      if (error || !stats) return reject(error)

      resolve(
        String(stats.compilation.getAsset('page.css')?.source.source() ?? '')
      )
    })
  })
}

describe('cssMinimizerOptions', () => {
  it('keeps :dir() and :lang() lists as written', async () => {
    const output = await minify(
      '.a:dir(rtl) { margin: 0 }\n.b:lang(en, fr) { color: red }\n',
      {manifest_version: 3, minimum_chrome_version: '88'}
    )

    expect(output).toContain('.a:dir(rtl)')
    expect(output).toContain(':lang(en,fr)')
    expect(output).not.toContain(':lang(ae)')
  })

  it('reads the browser floor from the manifest, like the script compiler', () => {
    expect(
      cssMinimizerOptions({minimum_chrome_version: '120'}, 'chrome').targets
    ).toEqual(['chrome >= 120'])

    expect(cssMinimizerOptions(undefined, 'chrome').targets).toEqual([
      'chrome >= 100'
    ])
  })
})
