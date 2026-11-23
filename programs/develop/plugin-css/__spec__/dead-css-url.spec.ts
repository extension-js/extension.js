import * as path from 'node:path'
import {type Compilation, type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CssPlugin} from '../index'
import {closeCompiler, cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

afterEach(() => {
  vi.unstubAllEnvs()
})

// A real compiler with CssPlugin applied. Production defers the CSS rules to
// beforeRun, which compile() skips, so a plain css rule stands in for them
// and the plugin's own hooks run against what the native parser requests.
function compilerFor(root: string, entry: string): Compiler {
  const compiler = rspack({
    context: root,
    mode: 'production',
    devtool: false,
    entry: {main: entry},
    output: {path: path.join(root, 'out')},
    module: {rules: [{test: /\.css$/, type: 'css'}]},
    optimization: {minimize: false}
  })

  void new CssPlugin({manifestPath: path.join(root, 'manifest.json')}).apply(
    compiler
  )

  return compiler
}

async function compile(root: string, entry = './entry.js') {
  const compiler = compilerFor(root, entry)

  try {
    const compilation = await new Promise<Compilation>((resolve, reject) =>
      compiler.compile((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
    )

    return {
      warnings: compilation.warnings.map((w) => ({
        name: w.name,
        message: unframed(w.message)
      })),
      errors: compilation.errors.map((e) => e.message)
    }
  } finally {
    await closeCompiler(compiler)
  }
}

// rspack hands a diagnostic back inside its own frame: a glyph on the first
// line and a bar on the others.
function unframed(message: string) {
  return message
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(/^\s*(?:⚠|×|│)\s?/, ''))
    .join('\n')
}

const deadRefText = (issuer: string, request: string) =>
  [
    `A url(${request}) reference points to a file that exists nowhere in the project.`,
    `PATH ${issuer}`,
    `NOT FOUND ${request}`,
    "Chrome applies the rest of the stylesheet and 404s this reference silently, so it's likely dead code."
  ].join('\n')

const deadRef = (issuer: string, request: string) => ({
  name: 'CssDeadRef',
  message: `${deadRefText(issuer, request)}\nSet EXTENSION_STRICT_REFS=true to make this a build error.`
})

describe('CssPlugin dead url() tolerance: Chrome silently 404s them', () => {
  it('cancels a root-absolute url() with no file anywhere and warns once', async () => {
    const root = makeProject({
      'entry.js': 'import "./cs.css"',
      // Two requests the parser makes apart, for one file.
      'cs.css':
        '.a{background:url(/img/missing.png)}\n.b{background:url(/img/missing.png?v=2)}\n'
    })

    const {warnings, errors} = await compile(root)

    // The parser resolves the two in an order of its own.
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect([
      deadRef('cs.css', '/img/missing.png'),
      deadRef('cs.css', '/img/missing.png?v=2')
    ]).toContainEqual(warnings[0])
  })

  it('warns again on a rebuild that still holds the dead url()', async () => {
    const root = makeProject({
      'entry.js': 'import "./cs.css"',
      'cs.css': '.a{background:url(/img/missing.png)}\n'
    })
    const compiler = compilerFor(root, './entry.js')
    const names: string[][] = []

    try {
      for (const _rebuild of [1, 2]) {
        const compilation = await new Promise<Compilation>((resolve, reject) =>
          compiler.compile((error, result) =>
            error || !result ? reject(error) : resolve(result)
          )
        )

        names.push(compilation.warnings.map((w) => w.name))
      }
    } finally {
      await closeCompiler(compiler)
    }

    expect(names).toEqual([['CssDeadRef'], ['CssDeadRef']])
  })

  it('leaves a url() to a file that exists to the bundler', async () => {
    const root = makeProject({
      'entry.js': 'import "./cs.css"',
      'cs.css': '.a{background:url(./img/real.png)}\n',
      'img/real.png': 'x'
    })

    expect(await compile(root)).toEqual({warnings: [], errors: []})
  })

  it.each([
    ['a script', {'entry.js': 'import "/img/missing.png"'}, '/img/missing.png'],
    [
      'a package sheet',
      {
        'entry.js': 'import "./cs.css"',
        'cs.css': '@import "some-pkg/styles.css";\n'
      },
      'some-pkg/styles.css'
    ]
  ])('leaves the request of %s to fail the way rspack fails it', async (_label, files, request) => {
    const root = makeProject(files)
    const {warnings, errors} = await compile(root)

    expect(warnings).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(`Can't resolve '${request}'`)
  })

  it('makes the missing file a build error under EXTENSION_STRICT_REFS=true', async () => {
    vi.stubEnv('EXTENSION_STRICT_REFS', 'true')
    const root = makeProject({
      'entry.js': 'import "./cs.css"',
      'cs.css': '.a{background:url(/img/missing.png)}\n'
    })
    const {warnings, errors} = await compile(root)

    // The same finding as an error, minus the hint to set the variable.
    expect(warnings).toEqual([])
    expect(errors.map(unframed)).toEqual([
      deadRefText('cs.css', '/img/missing.png')
    ])
  })

  // vue-loader re-issues each <style> block as an inline match resource
  // request from a `.vue.css` issuer. That is a module request, not a url(),
  // and cancelling it dropped every Vue style block from the built sheet.
  it('leaves a loader-built request alone even when no such file exists', async () => {
    const root = makeProject({'entry.js': ''})
    const compiler = compilerFor(root, './entry.js')
    const issuer = path.join(root, 'sidebar', 'SidebarApp.vue.css')
    let answers: Promise<unknown[]> = Promise.resolve([])

    // Ask the factory's real hook, after CssPlugin tapped it, the way
    // vue-loader's requests reach it.
    compiler.hooks.normalModuleFactory.tap('spec', (nmf) => {
      answers = Promise.all(
        [
          './SidebarApp.vue.css?vue&type=style&index=1&id=09c2&scoped=true&lang=css!=!-!/n/vue-loader/dist/stylePostLoader.js!./SidebarApp.vue?vue&type=style&index=1&id=09c2&scoped=true&lang=css',
          './probe.css.css?vue&type=style&index=2&lang=css&external!=!-!/n/vue-loader/dist/stylePostLoader.js!./probe.css?vue&type=style&index=2&lang=css&external',
          '!!raw-loader!./missing.css'
        ].map((request) =>
          nmf.hooks.beforeResolve.promise({
            request,
            context: path.dirname(issuer),
            contextInfo: {issuer}
          } as never)
        )
      )
    })

    try {
      await new Promise<void>((resolve, reject) =>
        compiler.compile((error) => (error ? reject(error) : resolve()))
      )
    } finally {
      await closeCompiler(compiler)
    }

    expect(await answers).toEqual([undefined, undefined, undefined])
  })
})
