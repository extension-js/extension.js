import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {type Compilation, rspack} from '@rspack/core'
import postcss from 'postcss'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {isDeadCssUrlRef} from '../../lib/dead-url-refs'
import {getOptionalDependencyContract} from '../../lib/optional-deps-contracts'
import webpackConfig from '../../rspack-config'
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

// Listed on purpose although no production file names them.
const KEPT_UNNAMED: Record<string, string> = {
  // A project's PostCSS config may name it as syntax or parser, and it then
  // resolves from the CLI folder.
  'postcss-scss': 'named by a user PostCSS config',
  'webpack-target-webextension': 'kept by maintainer decision'
}

// A listed dependency that no production file names is installed for nothing.
describe('the dependencies of this package', () => {
  it('are each named by a production file or kept on purpose', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(DEVELOP, 'package.json'), 'utf8')
    ) as {dependencies: Record<string, string>}
    const sources = productionSources(DEVELOP).map((file) =>
      fs.readFileSync(file, 'utf8')
    )
    const unnamed = Object.keys(pkg.dependencies)
      .filter((name) => !(name in KEPT_UNNAMED))
      .filter((name) => {
        const specifier = new RegExp(
          `['"]${name.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')}(/[^'"]*)?['"]`
        )

        return !sources.some((text) => specifier.test(text))
      })

    expect(unnamed).toEqual([])
    // A kept name that leaves package.json leaves this list too.
    expect(
      Object.keys(KEPT_UNNAMED).filter((name) => !(name in pkg.dependencies))
    ).toEqual([])
  })

  it('keep postcss-scss in the Sass contract, and import neither it nor postcss-preset-env', () => {
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

    expect(
      getOptionalDependencyContract('sass').installPackages.map((spec) =>
        spec.replace(/(.)@.*$/, '$1')
      )
    ).toEqual(['postcss-loader', 'postcss-scss', 'sass-loader'])

    expect(importers).toEqual([])
  })

  it('resolve postcss-scss from the CLI folder for a config that names it', async () => {
    const root = makeProject({
      '.postcssrc': JSON.stringify({
        plugins: {},
        syntax: 'postcss-scss',
        parser: 'postcss-scss'
      })
    })
    const {maybeUsePostCss} = await import('../css-tools/postcss')
    const rule = await maybeUsePostCss(root, {mode: 'production'} as never)
    const opts = (
      rule as {options?: {postcssOptions?: Record<string, unknown>}}
    ).options?.postcssOptions
    const shipped = createRequire(
      path.join(DEVELOP, 'plugin-css', 'css-tools', 'postcss.ts')
    )('postcss-scss')

    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false)
    expect(opts?.syntax).toBe(shipped)
    expect(opts?.parser).toBe(shipped)
  })
})

// An extensionless request whose file exists only with .css appended.
describe('the three dead url() checks and the .css sibling', () => {
  it('the two checks of this plugin try the .css sibling, the externals step does not', async () => {
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

    // 2. The check on an inlined content-script sheet keeps it too.
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

    expect(compilation.warnings.map((w) => w.name)).toEqual([])
    expect(compilation.errors.map((e) => e.message)).toEqual([])
    expect(inlined).toBe(false)
    // Pins today's behavior: the externals step has no .css sibling.
    expect(external).toEqual([null, './theme', 'asset'])
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
