import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {type RuleSetRule, rspack, type Stats} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  type PostCssLoaderRule,
  postCssReaderForOneCompiler
} from '../css-tools/postcss'
import {CssPlugin} from '../index'
import {
  closeCompiler,
  configureCss,
  cssProjects,
  type Mode
} from './helpers/css-project'

const makeProject = cssProjects()

// The config writes one line when Node evaluates the file and one when the
// build calls the function it exports.
function countingConfig(log: string) {
  return [
    "const fs = require('fs')",
    `fs.appendFileSync(${JSON.stringify(log)}, 'evaluated\\n')`,
    'module.exports = () => {',
    `  fs.appendFileSync(${JSON.stringify(log)}, 'called\\n')`,
    '  return {plugins: []}',
    '}',
    ''
  ].join('\n')
}

function counts(log: string) {
  const lines = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
    : []

  return {
    evaluated: lines.filter((line) => line === 'evaluated').length,
    called: lines.filter((line) => line === 'called').length
  }
}

// One compiler builds 24 style rules and reads the config for the first.
describe('how often one compiler reads the PostCSS config', () => {
  it.each([
    ['development', 'postcss.config.cjs', {evaluated: 1, called: 1}],
    ['production', 'postcss.config.cjs', {evaluated: 1, called: 1}],
    ['development', 'postcss.config.js', {evaluated: 1, called: 1}],
    ['production', 'postcss.config.js', {evaluated: 1, called: 1}]
  ] as Array<
    [Mode, string, ReturnType<typeof counts>]
  >)('%s build, %s', async (mode, configFile, expected) => {
    const root = makeProject({}, 'extjs-postcss-loads-')
    const log = path.join(root, 'loads.log')
    fs.writeFileSync(path.join(root, configFile), countingConfig(log))

    await configureCss(root, mode)

    expect(counts(log)).toEqual(expected)
  })

  it('reads once per mode, and hands each mode its own rule', async () => {
    const root = makeProject({}, 'extjs-postcss-modes-')
    const log = path.join(root, 'loads.log')
    fs.writeFileSync(path.join(root, 'postcss.config.cjs'), countingConfig(log))
    const read = postCssReaderForOneCompiler()

    const dev = await read(root, {mode: 'development'})
    const again = await read(root, {mode: 'development'})
    const prod = await read(root, {mode: 'production'})

    expect(again).toBe(dev)
    expect((dev as PostCssLoaderRule).options.sourceMap).toBe(true)
    expect((prod as PostCssLoaderRule).options.sourceMap).toBe(false)
    expect(counts(log)).toEqual({evaluated: 2, called: 2})
  })
})

function postCssPluginNames(rules: RuleSetRule[]): string[] {
  const names = new Set<string>()

  for (const rule of rules) {
    for (const use of (Array.isArray(rule.use) ? rule.use : []) as Array<{
      loader?: string
      options?: {postcssOptions?: {plugins?: Array<{postcssPlugin?: string}>}}
    }>) {
      if (!String(use.loader).includes('postcss-loader')) continue

      for (const plugin of use.options?.postcssOptions?.plugins || []) {
        // The build's own plugin, which names the config files to watch.
        if (plugin.postcssPlugin === 'extension-js-postcss-setup-files') {
          continue
        }

        names.add(String(plugin.postcssPlugin))
      }
    }
  }

  return [...names]
}

// Node keeps every module it imports, so each read asks for the file anew.
// A compiler built after an edit, which a session restart does, reads the edit.
describe('a PostCSS config edit between two compilers', () => {
  it.each([
    ['development', 'postcss.config.cjs', ['second']],
    ['production', 'postcss.config.cjs', ['second']],
    ['development', 'postcss.config.js', ['second']],
    ['production', 'postcss.config.js', ['second']]
  ] as Array<
    [Mode, string, string[]]
  >)('%s, %s', async (mode, configFile, after) => {
    const root = makeProject({}, 'extjs-postcss-edit-')
    const config = path.join(root, configFile)
    const write = (name: string) =>
      fs.writeFileSync(
        config,
        `module.exports = {plugins: [{postcssPlugin: '${name}'}]}\n`
      )

    write('first')
    const before = await configureCss(root, mode)
    write('second')
    const next = await configureCss(root, mode)

    expect(postCssPluginNames(before)).toEqual(['first'])
    expect(postCssPluginNames(next)).toEqual(after)
  })
})

// The syntax a config names reads the sheet, not only its plugins: here one
// that drops // line comments, which plain CSS keeps as part of a selector.
describe('a PostCSS config that names a syntax', () => {
  it('compiles the sheet with that syntax', async () => {
    const postcssEntry = createRequire(import.meta.url).resolve('postcss')
    const root = makeProject(
      {
        'node_modules/line-comment-syntax/package.json': JSON.stringify({
          name: 'line-comment-syntax',
          main: 'index.js'
        }),
        'node_modules/line-comment-syntax/index.js': [
          `const postcss = require(${JSON.stringify(postcssEntry)})`,
          'module.exports = {',
          "  parse: (css, opts) => postcss.parse(css.replace(/^\\/\\/.*$/gm, ''), opts),",
          '  stringify: postcss.stringify',
          '}',
          ''
        ].join('\n'),
        'postcss.config.cjs':
          "module.exports = {plugins: [{postcssPlugin: 'noop'}], syntax: 'line-comment-syntax'}\n",
        'page.js': "import './page.css'\n",
        'page.css': '// a line comment\n.kept { color: red }\n'
      },
      'extjs-postcss-syntax-'
    )
    const compiler = rspack({
      context: root,
      mode: 'production',
      devtool: false,
      optimization: {minimize: false},
      entry: {page: './page.js'},
      output: {path: path.join(root, 'out')}
    })
    const css = new CssPlugin({manifestPath: path.join(root, 'manifest.json')})
    css.apply(compiler)

    try {
      const stats = await new Promise<Stats>((resolve, reject) =>
        compiler.run((error, result) =>
          error || !result ? reject(error) : resolve(result)
        )
      )
      const sheet = String(
        stats.compilation.getAsset('page.css')?.source.source()
      )

      expect(stats.compilation.errors).toHaveLength(0)
      expect(sheet).toContain('.kept')
      expect(sheet).not.toContain('line comment')
    } finally {
      await closeCompiler(compiler)
    }
  }, 60_000)
})
