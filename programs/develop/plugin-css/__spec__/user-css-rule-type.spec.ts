import * as path from 'node:path'
import {type RuleSetRule, rspack, type Stats} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {CssPlugin} from '../index'
import {closeCompiler, cssProjects, type Mode} from './helpers/css-project'

const makeProject = cssProjects()

async function setupWarnings(rules: RuleSetRule[], mode: Mode) {
  const root = makeProject({
    'page.js': "import './page.css'\n",
    'page.css': '.page { color: red }\n'
  })
  const compiler = rspack({
    context: root,
    mode,
    devtool: false,
    optimization: {minimize: false},
    entry: {page: './page.js'},
    output: {path: path.join(root, 'out')},
    module: {rules}
  })

  await new CssPlugin({manifestPath: path.join(root, 'manifest.json')}).apply(
    compiler
  )

  try {
    const stats = await new Promise<Stats>((resolve, reject) =>
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
    )

    return {
      errors: stats.compilation.errors.map((error) => error.message),
      warnings: stats.compilation.warnings
        .filter((warning) => warning.name === 'CssSetupNotApplied')
        .map((warning) => warning.message),
      sheet: String(stats.compilation.getAsset('page.css')?.source.source())
    }
  } finally {
    await closeCompiler(compiler)
  }
}

// The build's own stylesheet rules come last, so their type is the one a
// sheet gets. A type the project set for stylesheets is said once, not lost.
describe('a project rule that sets a type for stylesheets', () => {
  it.each([
    [
      'development',
      [{test: /\.css$/, type: 'asset/resource'}],
      ['.css'],
      'asset/resource'
    ],
    [
      'production',
      [{test: /\.css$/, type: 'asset/resource'}],
      ['.css'],
      'asset/resource'
    ],
    [
      'production',
      [{test: /\.(scss|sass)$/, type: 'javascript/auto'}],
      ['.scss', '.sass'],
      'javascript/auto'
    ],
    [
      'production',
      [{oneOf: [{test: /\.less$/, type: 'asset/source'}]}],
      ['.less'],
      'asset/source'
    ],
    [
      'production',
      [{test: /\.css$/, rules: [{type: 'asset/inline'}]}],
      ['.css'],
      'asset/inline'
    ]
  ] as Array<
    [Mode, RuleSetRule[], string[], string]
  >)('%s: says the type is not applied, and the sheet still compiles', async (mode, rules, extensions, type) => {
    const {errors, warnings, sheet} = await setupWarnings(rules, mode)

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(type)
    for (const extension of extensions) expect(warnings[0]).toContain(extension)
    expect(sheet).toContain('.page')
  })

  it.each([
    ['a CSS type, the one the build sets', {test: /\.css$/, type: 'css'}],
    ['css/auto', {test: /\.css$/, type: 'css/auto'}],
    ['no type', {test: /\.css$/, sideEffects: true}],
    [
      'a query of its own',
      {test: /\.css$/, resourceQuery: /inline/, type: 'asset/source'}
    ],
    ['a test for every file', {test: /./, type: 'javascript/auto'}],
    ['a test for other files', {test: /\.svg$/, type: 'asset/resource'}]
  ] as Array<
    [string, RuleSetRule]
  >)('says nothing for %s', async (_label, rule) => {
    const {warnings} = await setupWarnings([rule], 'production')

    expect(warnings).toEqual([])
  })
})
