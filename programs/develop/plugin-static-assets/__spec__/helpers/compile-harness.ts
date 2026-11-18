import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {
  type Compiler,
  type Configuration,
  type RspackPluginInstance,
  rspack,
  type Stats
} from '@rspack/core'

// Bare rspack and the plugins under test, on a fixture project in a temp
// folder. No compiled dist, no loader from another plugin, no browser.

export const ORIGIN = 'chrome-extension://id/'

export type FixtureFiles = Record<string, string | Buffer>

export interface CompileFixtureOptions {
  files: FixtureFiles
  plugins: RspackPluginInstance[]
  mode?: 'development' | 'production'
  // Merged over the harness defaults. `output.path` must stay in the fixture.
  config?: (root: string) => Configuration
}

export interface FixtureBuild {
  root: string
  outputPath: string
  compiler: Compiler
  stats: Stats
  errors: string[]
  rawErrors: unknown[]
  warnings: string[]
  // Every emitted file, by its path relative to `outputPath`, with POSIX slashes.
  emitted: Record<string, Buffer>
  main: string
  // Runs main.js the way a worker would and returns what it put on `out`.
  evaluate: () => Promise<Record<string, unknown>>
}

const roots: string[] = []

export function makeFixtureRoot(files: FixtureFiles): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-assets-harness-'))
  )
  roots.push(root)

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  return root
}

export function removeFixtureRoots() {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
}

// An rspack build with no output.path writes into process.cwd()/dist, which
// would land in the repository. Refuse anything outside the fixture.
export function assertOutputInside(root: string, outputPath: unknown): string {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw new Error(
      `compile harness: output.path must be an absolute path inside ${root}, got ${String(outputPath)}`
    )
  }

  const relative = path.relative(root, outputPath)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `compile harness: output.path ${outputPath} is not inside the fixture ${root}`
    )
  }

  return outputPath
}

function listFiles(dir: string, prefix = ''): Record<string, Buffer> {
  const out: Record<string, Buffer> = {}
  if (!fs.existsSync(dir)) return out

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    const name = `${prefix}${entry.name}`

    if (entry.isDirectory()) Object.assign(out, listFiles(full, `${name}/`))
    else out[name] = fs.readFileSync(full)
  }

  return out
}

function evaluateIn(outputPath: string, main: string) {
  const fileFor = (url: string) =>
    path.join(outputPath, new URL(url, ORIGIN).pathname.replace(/^\//, ''))

  const sandbox: Record<string, unknown> = {
    console: {log() {}, warn() {}, error() {}, info() {}, debug() {}},
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    // The spec typings carry no DOM lib, so WebAssembly is read off the global.
    WebAssembly: (globalThis as Record<string, unknown>).WebAssembly,
    Response,
    location: new URL(`${ORIGIN}main.js`),
    fetch: async (url: string) =>
      new Response(fs.readFileSync(fileFor(String(url))), {
        headers: {
          'content-type': String(url).endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream'
        }
      })
  }

  sandbox.self = sandbox
  sandbox.globalThis = sandbox

  sandbox.importScripts = (...urls: string[]) => {
    for (const url of urls) {
      vm.runInContext(fs.readFileSync(fileFor(url), 'utf-8'), sandbox)
    }
  }

  vm.createContext(sandbox)
  vm.runInContext(main, sandbox)

  return sandbox
}

export async function compileFixture(
  options: CompileFixtureOptions
): Promise<FixtureBuild> {
  const root = makeFixtureRoot(options.files)
  const outputPath = path.join(root, 'dist')
  const extra = options.config?.(root) || {}

  const config: Configuration = {
    context: root,
    mode: options.mode || 'production',
    entry: {main: './index.js'},
    target: 'webworker',
    devtool: false,
    stats: false,
    infrastructureLogging: {level: 'none'},
    optimization: {minimize: false},
    plugins: options.plugins,
    ...extra,
    output: {
      publicPath: '/',
      ...(extra.output || {}),
      path: assertOutputInside(root, extra.output?.path || outputPath)
    }
  }

  const compiler = rspack(config)
  // Defaults are applied by now: check the path rspack will really write to.
  assertOutputInside(root, compiler.options.output.path)

  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('compile harness: no stats'))

      resolve(result)
    })
  })

  const json = stats.toJson({errors: true, warnings: true})
  const rawErrors = [...stats.compilation.errors]

  await new Promise<void>((resolve) => compiler.close(() => resolve()))

  const finalOutput = String(compiler.options.output.path)
  const emitted = listFiles(finalOutput)
  const main = emitted['main.js']?.toString('utf-8') || ''

  return {
    root,
    outputPath: finalOutput,
    compiler,
    stats,
    errors: (json.errors || []).map((e) => e.message),
    rawErrors,
    warnings: (json.warnings || []).map((w) => w.message),
    emitted,
    main,
    evaluate: async () => {
      const sandbox = evaluateIn(finalOutput, main)
      const out = sandbox.out as Record<string, unknown>
      const settled: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(out || {})) {
        settled[key] = await value
      }

      return settled
    }
  }
}
