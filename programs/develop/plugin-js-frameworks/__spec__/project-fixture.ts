import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  type Compiler,
  type Configuration,
  type RspackPluginInstance,
  type RuleSetRule,
  rspack,
  type Stats
} from '@rspack/core'
import {afterEach} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import type {DevOptions} from '../../types'
import {EXTENSIONJS_BACKGROUND_LAYER, JsFrameworksPlugin} from '../index'

type Files = Record<string, string | object>

const roots: string[] = []

// Every folder a case makes is removed after it, whatever the outcome.
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

export function writeFiles(root: string, files: Files) {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(
      target,
      typeof contents === 'string' ? contents : JSON.stringify(contents)
    )
  }
}

// A project folder in the run's temp folder, realpath'd so the paths the
// detectors return compare equal to the ones a case builds.
export function makeProject(files: Files = {}): string {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-frameworks-'))
  )
  roots.push(root)
  writeFiles(root, files)

  return root
}

// A package on disk under the project's node_modules: only its manifest and
// the files a case names, so every resolved path points inside the fixture.
export function fakePackage(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {}
): string {
  const dir = path.join(root, 'node_modules', ...name.split('/'))
  writeFiles(dir, {'package.json': {name, ...manifest}, ...files})

  return dir
}

export const MANIFEST = {manifest_version: 3, name: 'fixture', version: '1.0.0'}

export interface ConfigureOptions {
  mode?: 'development' | 'production'
  browser?: DevOptions['browser']
  transpilePackages?: string[]
  devtool?: Configuration['devtool']
  rules?: RuleSetRule[]
}

// A real compiler with only this plugin: the rule table, aliases and plugins
// are read back the way rspack holds them before the first compilation.
export async function configure(
  root: string,
  options: ConfigureOptions = {}
): Promise<Compiler> {
  const mode = options.mode || 'development'
  const compiler = rspack({
    mode,
    context: root,
    entry: {},
    ...(options.devtool === undefined ? {} : {devtool: options.devtool}),
    output: {path: path.join(root, 'dist')},
    module: {rules: options.rules || []}
  })

  await new JsFrameworksPlugin({
    manifestPath: path.join(root, 'manifest.json'),
    browser: options.browser,
    mode,
    transpilePackages: options.transpilePackages
  }).apply(compiler)

  if (mode === 'production') {
    await compiler.hooks.beforeRun.promise(compiler)
  }

  return compiler
}

// The project's own React from this workspace, linked so a real compile
// resolves it without an install.
export function linkWorkspaceReact(root: string) {
  const fromDevelop = createRequire(path.join(__dirname, '..', '..', 'x.js'))
  fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})

  for (const name of ['react', 'react-dom', 'scheduler']) {
    const source = fs.realpathSync(fromDevelop.resolve(`${name}/package.json`))
    fs.symlinkSync(path.dirname(source), path.join(root, 'node_modules', name))
  }
}

// A real build with the plugin in the config, the way a dev run applies it,
// into the project's own dist. Returns each emitted file's source by name.
export async function compileProject(
  root: string,
  entry: Record<string, string>,
  mode: 'development' | 'production' = 'development',
  browser?: DevOptions['browser']
) {
  const compiler = rspack({
    mode,
    context: root,
    devtool: false,
    entry: Object.fromEntries(
      Object.entries(entry).map(([name, file]) => [name, {import: [file]}])
    ),
    output: {path: path.join(root, 'dist')},
    optimization: {minimize: false},
    plugins: [
      new JsFrameworksPlugin({
        manifestPath: path.join(root, 'manifest.json'),
        browser,
        mode
      }) as unknown as RspackPluginInstance
    ]
  })

  const stats = await new Promise<Stats | undefined>((resolve, reject) => {
    compiler.run((error, result) => (error ? reject(error) : resolve(result)))
  })
  await new Promise((resolve) => compiler.close(resolve))

  const errors = stats?.toJson({all: false, errors: true}).errors || []
  const read = (name: string) =>
    fs.readFileSync(path.join(root, 'dist', `${name}.js`), 'utf-8')

  return {errors: errors.map((error) => error.message), read}
}

// The rule fields the cases read, without rspack's falsy-rule union.
export interface LooseRule {
  test?: unknown
  type?: string
  loader?: unknown
  options?: unknown
  oneOf?: LooseRule[]
  use?: unknown
  include?: unknown
  exclude?: unknown
  issuerLayer?: unknown
  layer?: string
}

export function rulesOf(compiler: Compiler): LooseRule[] {
  return compiler.options.module.rules as unknown as LooseRule[]
}

function usesSwc(rule: LooseRule) {
  return (rule.oneOf || []).some(
    (variant) => loaderOf(variant) === 'builtin:swc-loader'
  )
}

// The SWC rules by role: content scripts by path, the rest of what they
// import by issuer, every other script, the platform-declared modules, and
// the background's own copies of the last two where it has its own layer.
export function swcRules(compiler: Compiler) {
  const rules = rulesOf(compiler).filter(usesSwc)
  const notContent = (rule: LooseRule) =>
    [(rule.issuerLayer as {not?: string | string[]} | undefined)?.not]
      .flat()
      .includes(EXTENSIONJS_CONTENT_SCRIPT_LAYER)
  const background = (rule: LooseRule) =>
    rule.issuerLayer === EXTENSIONJS_BACKGROUND_LAYER

  return {
    all: rules,
    contentByPath: rules.find(
      (rule) =>
        rule.layer === EXTENSIONJS_CONTENT_SCRIPT_LAYER &&
        typeof rule.include === 'function'
    ),
    contentByIssuer: rules.find(
      (rule) => rule.issuerLayer === EXTENSIONJS_CONTENT_SCRIPT_LAYER
    ),
    pages: rules.find(
      (rule) => notContent(rule) && rule.type === 'javascript/auto'
    ),
    modules: rules.find(
      (rule) => notContent(rule) && rule.type === 'javascript/esm'
    ),
    background: rules.find(
      (rule) => background(rule) && rule.type === 'javascript/auto'
    ),
    backgroundModules: rules.find(
      (rule) => background(rule) && rule.type === 'javascript/esm'
    )
  }
}

export interface SwcLoaderOptions {
  isModule: boolean | 'unknown'
  sourceMaps: boolean
  minify?: boolean
  env: {targets: string[]}
  module: {type: string}
  jsc: {
    parser: Record<string, unknown>
    transform: Record<string, unknown> & {
      react: Record<string, unknown>
    }
  }
}

// The loader entry a resource lands on, the way rspack walks a oneOf.
export function swcOptionsFor(
  rule: LooseRule | undefined,
  resource: string
): SwcLoaderOptions {
  const variant = (rule?.oneOf || []).find(
    (candidate) => !candidate.test || (candidate.test as RegExp).test(resource)
  )

  const use = Array.isArray(variant?.use) ? variant.use[0] : variant?.use

  return (use as {options: SwcLoaderOptions}).options
}

// VueLoaderPlugin rewrites every rule's loader into `use` and clones each
// rule without its test, so a rule is read the same way in either shape.
export function loaderOf(rule: LooseRule): string {
  if (typeof rule.loader === 'string') return rule.loader

  const use = Array.isArray(rule.use) ? rule.use[0] : rule.use

  return String(
    typeof use === 'string' ? use : (use as {loader?: string})?.loader || ''
  )
}

export function callable(condition: unknown): (resource: string) => boolean {
  return condition as (resource: string) => boolean
}
