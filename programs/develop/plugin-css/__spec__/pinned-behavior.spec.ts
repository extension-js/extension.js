import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, rspack} from '@rspack/core'
import postcss from 'postcss'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {getOptionalDependencyContract} from '../../lib/optional-deps-contracts'
import webpackConfig from '../../rspack-config'
import {isDeadCssUrlRef} from '../css-lib/dead-url-refs'
import * as messages from '../css-lib/messages'
import {maybeUsePostCss} from '../css-tools/postcss'
import deadCssUrlLoader from '../dead-css-url-loader'
import {CssPlugin} from '../index'
import {closeCompiler, cssProjects} from './helpers/css-project'

const makeProject = cssProjects()
const DEVELOP = path.join(__dirname, '..', '..')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function runInlineLoader(root: string, resourcePath: string, source: string) {
  const warnings: Error[] = []
  const errors: Error[] = []
  const output = deadCssUrlLoader.call(
    {
      resourcePath,
      getOptions: () => ({
        manifestPath: path.join(root, 'manifest.json'),
        projectPath: root
      }),
      emitWarning: (warning: Error) => warnings.push(warning),
      emitError: (error: Error) => errors.push(error),
      _compilation: {warnings, errors}
    } as never,
    source
  )

  return {output, warnings, errors}
}

describe('a content-script sheet that imports another', () => {
  it('keeps the @import as text and never brings in the imported rules', () => {
    const root = makeProject({'content/other.css': '.imported{color:green}\n'})
    const source = '@import "./other.css";\n.own{color:red}\n'

    const {output, warnings} = runInlineLoader(
      root,
      path.join(root, 'content', 'styles.css'),
      source
    )

    // Pins today's behavior.
    expect(output).toContain(JSON.stringify(source))
    expect(output).not.toContain('.imported')
    expect(warnings).toEqual([])
  })
})

describe('a url() inside a CSS comment', () => {
  const source = '/* .x{background:url(./gone.png)} */\n.a{color:red}\n'

  it('is not reported, and leaves a strict build alone', () => {
    const root = makeProject({})
    const sheet = path.join(root, 'content', 'styles.css')

    const loose = runInlineLoader(root, sheet, source)
    vi.stubEnv('EXTENSION_STRICT_REFS', 'true')
    const strict = runInlineLoader(root, sheet, source)

    expect(loose.warnings).toEqual([])
    expect(strict.errors).toEqual([])
  })
})

// Every file of this package that is not a spec or a build config.
function productionSources(dir: string): string[] {
  const found: string[] = []

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '__spec__'].includes(entry.name)) continue

      found.push(...productionSources(file))
    } else if (
      /\.(c|m)?(j|t)sx?$/.test(entry.name) &&
      !/\.spec\./.test(entry.name) &&
      !/\.config\.(c|m)?(j|t)s$/.test(entry.name)
    ) {
      found.push(file)
    }
  }

  return found
}

describe('postcss-preset-env and postcss-scss', () => {
  it('are listed by the sass contract and imported by no production file', () => {
    const importOf = (name: string) =>
      new RegExp(
        `(from\\s*|require\\(\\s*|import\\(\\s*)['"]${name}(/[^'"]*)?['"]`
      )
    const importers = productionSources(DEVELOP).filter((file) => {
      const text = fs.readFileSync(file, 'utf8')

      return (
        importOf('postcss-preset-env').test(text) ||
        importOf('postcss-scss').test(text)
      )
    })

    // Pins today's behavior.
    expect(
      getOptionalDependencyContract('sass').installPackages.map((spec) =>
        spec.replace(/(.)@.*$/, '$1')
      )
    ).toEqual([
      'postcss-loader',
      'postcss-scss',
      'postcss-preset-env',
      'sass-loader'
    ])

    expect(importers).toEqual([])
  })
})

// An extensionless request whose file exists only with .css appended.
describe('the three dead url() checks and the .css sibling', () => {
  it('only the module graph check tries the .css sibling', async () => {
    const root = makeProject({
      'entry.js': 'import "./cs.css"',
      'cs.css': '@import "./theme";\n.a{color:red}\n',
      'theme.css': '.theme{color:blue}\n'
    })

    // 1. The CssPlugin hook on the module graph keeps the request.
    const compiler = rspack({
      context: root,
      mode: 'production',
      devtool: false,
      entry: {main: './entry.js'},
      output: {path: path.join(root, 'out')},
      module: {rules: [{test: /\.css$/, type: 'css'}]}
    })
    void new CssPlugin({manifestPath: path.join(root, 'manifest.json')}).apply(
      compiler
    )

    let compilation: Compilation | undefined

    try {
      compilation = await new Promise<Compilation>((resolve, reject) =>
        compiler.compile((error, result) =>
          error || !result ? reject(error) : resolve(result)
        )
      )
    } finally {
      await closeCompiler(compiler)
    }

    // 2. The check on an inlined content-script sheet calls it dead.
    const inlined = isDeadCssUrlRef('./theme', {issuerDir: root, roots: [root]})

    // 3. The externals step for a url() leaves it unresolved.
    const config = webpackConfig(
      {
        manifestPath: path.join(root, 'manifest.json'),
        packageJsonPath: path.join(root, 'package.json')
      } as never,
      {
        browser: 'chrome',
        mode: 'production',
        output: {clean: false, path: path.join(root, 'out')}
      } as never
    )
    const externals = (
      config.externals as Array<
        (data: object, callback: (...answer: unknown[]) => void) => void
      >
    )[0]
    const external = await new Promise<unknown[]>((resolve) =>
      externals(
        {request: './theme', dependencyType: 'url', context: root},
        (...answer: unknown[]) => resolve(answer)
      )
    )

    // Pins today's behavior.
    expect(compilation.warnings.map((w) => w.name)).toEqual([])
    expect(compilation.errors.map((e) => e.message)).toEqual([])
    expect(inlined).toBe(true)
    expect(external).toEqual([null, './theme', 'asset'])
  })
})

describe('the install commands in three CSS messages', () => {
  it('name npm in a pnpm project', async () => {
    const root = makeProject({
      'package.json': JSON.stringify({
        name: 'css-fixture',
        packageManager: 'pnpm@10.0.0'
      }),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      '.postcssrc.json': JSON.stringify({
        plugins: {'postcss-plugin-nowhere': {}}
      })
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await maybeUsePostCss(root, {mode: 'development'})

    // Pins today's behavior.
    expect(error.mock.calls[0][0].split('\n').at(-1)).toBe(
      'Install it in your project to re-enable it: npm install --save-dev postcss-plugin-nowhere'
    )

    expect(
      messages
        .preprocessorShippedUncompiled('styles.scss', 'sass')
        .split('\n')
        .at(-1)
    ).toBe('Install it to compile this file: npm install --save-dev sass')

    expect(messages.missingSassDependency().split('\n').slice(-2)).toEqual([
      '- npm install --save-dev sass',
      '- pnpm add -D sass'
    ])
  })
})

// The native parser error-recovers where PostCSS stops, so the parse guard
// runs PostCSS's parser to find the sheets a browser would recover.
describe('a sheet PostCSS rejects', () => {
  const broken = '.a{color:red}\n.b{color:blue\n.c{color:green}\n'

  it('is rejected by the PostCSS parser', () => {
    expect(() => postcss.parse(broken, {from: 'broken.css'})).toThrow(
      'broken.css:2:1: Unclosed block'
    )
  })

  it.each([
    ['css', 'broken.css'],
    ['css/module', 'broken.module.css']
  ])('compiles with no error as %s in the installed rspack', async (type, file) => {
    const root = makeProject({
      'entry.js': `import "./${file}"`,
      [file]: broken
    })
    const compiler = rspack({
      context: root,
      mode: 'production',
      devtool: false,
      entry: {main: './entry.js'},
      output: {path: path.join(root, 'out')},
      module: {rules: [{test: /\.css$/, type}]},
      optimization: {minimize: false}
    })

    try {
      const stats = await new Promise<{errors: unknown[]; warnings: unknown[]}>(
        (resolve, reject) =>
          compiler.run((error, result) =>
            error || !result
              ? reject(error)
              : resolve(
                  result.toJson({
                    all: false,
                    errors: true,
                    warnings: true
                  }) as never
                )
          )
      )

      expect({errors: stats.errors, warnings: stats.warnings}).toEqual({
        errors: [],
        warnings: []
      })
    } finally {
      await closeCompiler(compiler)
    }
  })
})
