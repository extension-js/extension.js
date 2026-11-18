import * as path from 'node:path'
import {type Compilation, rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import deadCssUrlLoader from '../dead-css-url-loader'
import {CssPlugin} from '../index'
import publicCssUrlLoader from '../public-css-url-loader'
import {closeCompiler, cssProjects} from './helpers/css-project'

const makeProject = cssProjects()
const WARN = '⏵⏵⏵'

// A Tailwind v4 project whose @tailwindcss/postcss refuses to start, the way
// a missing native binding makes it throw.
function brokenTailwindProject() {
  return makeProject({
    'package.json': JSON.stringify({
      name: 'css-fixture',
      devDependencies: {tailwindcss: '^4.0.0'}
    }),
    'node_modules/@tailwindcss/postcss/package.json': JSON.stringify({
      name: '@tailwindcss/postcss',
      version: '4.0.0',
      main: 'index.js'
    }),
    'node_modules/@tailwindcss/postcss/index.js':
      "module.exports = () => { throw new Error('Cannot find native binding') }",
    'entry.js': 'import "./styles.css"',
    'styles.css': '.a{color:red}\n'
  })
}

describe('a Tailwind plugin that fails to start', () => {
  it('is said once as a compilation warning, and the build still succeeds', async () => {
    const root = brokenTailwindProject()
    const compiler = rspack({
      context: root,
      mode: 'production',
      devtool: false,
      entry: {main: './entry.js'},
      output: {path: path.join(root, 'out')},
      optimization: {minimize: false}
    })
    const compiled: Array<{warnings: string[]; errors: string[]}> = []

    try {
      await new CssPlugin({
        manifestPath: path.join(root, 'manifest.json')
      }).apply(compiler)

      await compiler.hooks.beforeRun.promise(compiler)
      // The rules just built name loaders from the compiled package. A plain
      // css rule compiles the sheet, so only the setup report is under test.
      compiler.options.module.rules = [{test: /\.css$/, type: 'css'}]

      for (const _rebuild of [1, 2]) {
        const compilation = await new Promise<Compilation>((resolve, reject) =>
          compiler.compile((error, result) =>
            error || !result ? reject(error) : resolve(result)
          )
        )

        compiled.push({
          warnings: compilation.warnings
            .filter((w) => w.name === 'CssSetupWarning')
            .map((w) => w.message.replace(/^\s*(?:⚠|│)\s?/gm, '').trimEnd()),
          errors: compilation.errors.map((e) => e.message)
        })
      }
    } finally {
      await closeCompiler(compiler)
    }

    expect(compiled).toEqual([
      {
        warnings: [
          [
            `${WARN} Couldn't start the Tailwind PostCSS plugin @tailwindcss/postcss, so the build ran without it.`,
            `PATH ${root}`,
            'REASON Cannot find native binding',
            'Tailwind classes are missing from the output CSS.',
            'Install tailwindcss and @tailwindcss/postcss at the same major version, or name the plugin in your PostCSS config.'
          ].join('\n')
        ],
        errors: []
      },
      {warnings: [], errors: []}
    ])
  })
})

// A path no option resolves: the rewrite throws inside its own guard.
const UNREADABLE = {manifestPath: 42, projectPath: 42} as never

const rewriteSkipped = (file: string, reason: string) =>
  [
    `${WARN} Couldn't rewrite the url() references in this stylesheet, so they shipped as written.`,
    `PATH ${file}`,
    `REASON ${reason}`,
    "A url() here may point at a path the extension can't load.",
    'Check each url() in this file resolves from the file itself or from public/.'
  ].join('\n')

describe('a url() rewrite that fails', () => {
  const source = '.a{background:url(/img/a.png)}\n'

  it('in a content-script sheet is said once, and the sheet ships as written', () => {
    const warnings: Error[] = []
    const output = deadCssUrlLoader.call(
      {
        resourcePath: '/p/content/styles.css',
        getOptions: () => UNREADABLE,
        emitWarning: (warning: Error) => warnings.push(warning),
        emitError: (error: Error) => warnings.push(error)
      } as never,
      source
    )
    const [first] = warnings

    expect(output).toContain(JSON.stringify(source))
    expect(warnings.map((w) => w.name)).toEqual(['CssUrlRewriteWarning'])
    expect(first.message).toBe(
      rewriteSkipped(
        '/p/content/styles.css',
        'The "path" argument must be of type string. Received type number (42)'
      )
    )
  })

  it('in a page sheet is said once, and the sheet ships as written', () => {
    const warnings: Error[] = []
    let output: unknown

    publicCssUrlLoader.call(
      {
        resourcePath: '/p/pages/styles.css',
        getOptions: () => UNREADABLE,
        emitWarning: (warning: Error) => warnings.push(warning),
        callback: (_error: null, content: string) => {
          output = content
        }
      } as never,
      source
    )

    const [first] = warnings

    expect(output).toBe(source)
    expect(warnings.map((w) => w.name)).toEqual(['CssUrlRewriteWarning'])
    expect(first.message).toBe(
      rewriteSkipped(
        '/p/pages/styles.css',
        'The "paths[0]" argument must be of type string. Received type number (42)'
      )
    )
  })
})
