import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import {rspack} from '@rspack/core'

import {cssInContentScriptLoader} from '../css-in-content-script-loader'

// End-to-end regression guard for `./styles.css?url` in content scripts.
//
// Before the loader fix, `resourceQuery: {not: [/url/]}` on every content-
// script CSS rule meant a `?url` import silently bypassed the CSS pipeline,
// shipping the raw source verbatim (including `@import "tailwindcss"` left
// uncompiled). After the fix, the rules must apply regardless of query
// string — `?url` imports go through the same PostCSS chain as plain ones,
// and the URL exported to JS points at the compiled stylesheet.
//
// This spec runs a real rspack build on a minimal fixture and asserts that
// the emitted CSS asset is the PostCSS output (a CSS custom property added
// by a dedicated postcss plugin) rather than the raw source bytes.

const FIXTURE_RAW_MARKER = '/* RAW_CSS_MARKER */'
const FIXTURE_PROCESSED_MARKER = '--regression-marker: processed;'

function writeFixture(dir: string) {
  fs.mkdirSync(path.join(dir, 'src', 'content'), {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({name: 'url-query-regression-fixture', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(dir, 'src', 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'fixture',
      version: '0.0.1',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/scripts.js']}
      ]
    })
  )
  fs.writeFileSync(
    path.join(dir, 'src', 'content', 'scripts.js'),
    `import cssHref from './styles.css?url'\nconsole.log(cssHref)\n`
  )
  fs.writeFileSync(
    path.join(dir, 'src', 'content', 'styles.css'),
    `${FIXTURE_RAW_MARKER}\n.widget { color: red }\n`
  )
  // Bespoke postcss plugin: injects a marker custom property into every rule.
  // Used below to detect whether PostCSS actually ran on the `?url` import.
  fs.writeFileSync(
    path.join(dir, 'postcss.config.cjs'),
    `module.exports = {
  plugins: [
    {
      postcssPlugin: 'regression-marker',
      Rule(rule) {
        rule.prepend({prop: '--regression-marker', value: 'processed'})
      }
    }
  ]
}
`
  )
}

function findEmittedCss(distDir: string): string | null {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else hits.push(p)
    }
  }
  if (!fs.existsSync(distDir)) return null
  walk(distDir)
  for (const f of hits) {
    if (f.endsWith('.css')) return fs.readFileSync(f, 'utf8')
  }
  // Small CSS may be inlined as a data URI inside a JS bundle.
  for (const f of hits) {
    if (!f.endsWith('.js')) continue
    const js = fs.readFileSync(f, 'utf8')
    const m = js.match(/"data:text\/css;base64,([A-Za-z0-9+/=]+)"/)
    if (m) return Buffer.from(m[1], 'base64').toString('utf8')
  }
  return null
}

describe('css-url-query regression (end-to-end)', () => {
  let fixtureDir: string

  beforeAll(() => {
    // realpathSync resolves macOS /var → /private/var so the manifest-derived
    // content-script paths match the absolute paths rspack reports as issuers.
    fixtureDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-url-query-regression-'))
    )
    writeFixture(fixtureDir)
  })

  afterAll(() => {
    if (!process.env.KEEP_FIXTURE) {
      fs.rmSync(fixtureDir, {recursive: true, force: true})
    } else {
      // eslint-disable-next-line no-console
      console.log('KEPT fixture at', fixtureDir)
    }
  })

  it('emits PostCSS-processed CSS for a `?url` import', async () => {
    const manifestPath = path.join(fixtureDir, 'src', 'manifest.json')
    const rules = await cssInContentScriptLoader(
      fixtureDir,
      manifestPath,
      'development'
    )
    const distDir = path.join(fixtureDir, 'dist')

    await new Promise<void>((resolve, reject) => {
      const compiler = rspack({
        context: fixtureDir,
        mode: 'development',
        devtool: false,
        entry: {
          'content/scripts': path.join(
            fixtureDir,
            'src',
            'content',
            'scripts.js'
          )
        },
        output: {
          path: distDir,
          clean: true,
          filename: '[name].js'
        },
        module: {rules: rules as any}
      } as any)
      compiler.run((err, stats) => {
        if (err) return reject(err)
        if (stats?.hasErrors()) {
          return reject(new Error(stats.toString({errors: true})))
        }
        compiler.close(() => resolve())
      })
    })

    const emitted = findEmittedCss(distDir)
    expect(emitted, 'no CSS asset emitted under dist/content_scripts/').not.toBe(
      null
    )
    // If `?url` still bypassed the CSS pipeline, the raw marker comment
    // would survive and PostCSS would never have run.
    expect(
      emitted!.includes(FIXTURE_PROCESSED_MARKER),
      'emitted CSS missing PostCSS-injected marker — `?url` import bypassed the CSS pipeline'
    ).toBe(true)
  }, 60_000)
})
