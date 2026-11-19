import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {project} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'
import {build} from './helpers/private-files-project'

// The shipped bytes of a page whose markup the env step fills and whose
// scripts carry a content hash. A move of the page rewrite to another asset
// stage must leave every byte as it is here.

const TIMEOUT = 120_000

const POPUP = `<!doctype html>
<html><head><title>$EXTENSION_PUBLIC_TITLE</title><link rel="stylesheet" href="./popup.css"></head>
<body><div title='$EXTENSION_PUBLIC_TITLE' data-mode="$EXTENSION_MODE">$EXTENSION_PUBLIC_TITLE</div>
<img src="./logo.png">
<script src="./popup.js"></script>
</body></html>
`

const CONFIG = `export default {
  config: (config) => {
    config.output.filename = '[name].[contenthash:8].js'
    config.output.chunkFilename = '[name].[contenthash:8].js'
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          big: {test: /big\\.js/, name: 'shared-big', chunks: 'all', enforce: true}
        }
      }
    }
    return config
  }
}
`

describe('a templated page with content-hashed scripts', () => {
  it(
    'ships the same bytes the page rewrite and the env step make today',
    async () => {
      const root = project({
        '.env': `EXTENSION_PUBLIC_TITLE=Hello & <b> "q" it's\n`,
        'extension.config.js': CONFIG,
        'manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'page-bytes',
          version: '1.0.0',
          action: {default_popup: 'popup.html'},
          options_page: 'options.html'
        }),
        'popup.html': POPUP,
        'options.html':
          '<!doctype html><html><head></head><body><script src="./options.js"></script></body></html>',
        'popup.js': 'import {big} from "./big.js"\nconsole.log(big.length)\n',
        'options.js': 'import {big} from "./big.js"\nconsole.log(big)\n',
        'big.js': `export const big = "${'x'.repeat(2000)}"\n`,
        'popup.css': 'body{color:red}\n',
        'logo.png': 'png'
      })
      const result = await build(root)
      const html = fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'action', 'index.html'),
        'utf8'
      )

      expect(result.errors).toBe(0)
      expect(html.replace(/\.[0-9a-f]{8}\./g, '.HASH.')).toBe(
        [
          `<!DOCTYPE html><html><head><title>Hello &amp; &lt;b&gt; "q" it's</title><link rel="stylesheet" href="/action/index.css"></head>`,
          `<body><div title="Hello &amp; <b> &quot;q&quot; it's" data-mode="production">Hello &amp; &lt;b&gt; "q" it's</div>`,
          `<img src="/assets/logo.HASH.png">`,
          `<script src="/shared-big.HASH.js"></script><script src="/action/index.HASH.js"></script>`,
          '',
          `</body></html>`
        ].join('\n')
      )

      // Each hashed name the page asks for is a file the output holds.
      for (const [, ref] of html.matchAll(/(?:src|href)="\/([^"]+)"/g)) {
        expect(fs.existsSync(path.join(root, 'dist', 'chrome', ref)), ref).toBe(
          true
        )
      }
    },
    TIMEOUT
  )
})
