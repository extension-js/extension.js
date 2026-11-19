import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../../plugin-static-assets'
import {CssPlugin} from '../index'
import {closeCompiler, cssProjects, type Mode} from './helpers/css-project'

const makeProject = cssProjects()

async function build(root: string, mode: Mode) {
  const css = new CssPlugin({manifestPath: path.join(root, 'manifest.json')})
  const compiler = rspack({
    context: root,
    mode,
    devtool: false,
    optimization: {minimize: false},
    entry: {page: './page.js'},
    output: {path: path.join(root, 'out'), publicPath: '/'},
    plugins: [new StaticAssetsPlugin()]
  })

  await css.apply(compiler)

  try {
    const stats = await new Promise<Stats>((resolve, reject) =>
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
    )
    const assets = Object.fromEntries(
      stats.compilation
        .getAssets()
        .map((asset) => [asset.name, String(asset.source.source())])
    )

    return {
      assets,
      errors: stats.compilation.errors.map((error) => error.message),
      warnings: stats.compilation.warnings.map((warning) => warning.message)
    }
  } finally {
    await closeCompiler(compiler)
  }
}

// ?url is a file URL for every other type, and a page or a service worker
// asks for a sheet that way to hand it to <link> or scripting.insertCSS.
describe('a stylesheet imported with ?url outside a content script', () => {
  it.each([
    'development',
    'production'
  ] as const)('%s: ships the compiled sheet as its own file and imports its URL', async (mode) => {
    const root = makeProject({
      'page.js': [
        "import href from './linked.css?url'",
        "import './bundled.css'",
        'globalThis.href = href',
        ''
      ].join('\n'),
      'linked.css': '.linked { color: red }\n',
      'bundled.css': '.bundled { color: blue }\n',
      'postcss.config.cjs': [
        'module.exports = {plugins: [{',
        "  postcssPlugin: 'marker',",
        "  Rule(rule) { rule.prepend({prop: '--compiled', value: '1'}) }",
        '}]}',
        ''
      ].join('\n')
    })
    const {assets, errors} = await build(root, mode)
    const linked = Object.keys(assets).find((name) =>
      /^assets\/linked\.[0-9a-f]{8}\.css$/.test(name)
    )

    expect(errors).toEqual([])
    expect(linked).toBeDefined()
    const sheet = assets[String(linked)]
    expect(sheet).toContain('.linked')
    expect(sheet).toContain('--compiled')
    expect(assets['page.css']).toContain('.bundled')
    expect(assets['page.css']).not.toContain('.linked')
    expect(assets['page.js']).toContain(`"${linked}"`)
  })

  it('says which url() of such a sheet cannot follow it, and leaves public/ alone', async () => {
    const root = makeProject({
      'page.js':
        "import href from './linked.css?url'\nglobalThis.href = href\n",
      'linked.css': [
        '.a { background: url(./icon.png) }',
        '.b { background: url(/logo.png) }',
        '.c { background: url(data:image/png;base64,AAAA) }',
        ''
      ].join('\n'),
      'icon.png': 'png',
      'public/logo.png': 'png'
    })
    const {errors, warnings} = await build(root, 'production')
    const told = warnings.filter((warning) => warning.includes('?url'))

    expect(errors).toEqual([])
    expect(told).toHaveLength(1)
    expect(told[0]).toContain('./icon.png')
    expect(told[0]).not.toContain('logo.png')
    expect(told[0]).not.toContain('data:')
  })
})
