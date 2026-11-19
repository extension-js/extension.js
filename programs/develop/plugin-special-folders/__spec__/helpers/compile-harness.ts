import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  type Compilation,
  type Compiler,
  type Configuration,
  type RspackPluginInstance,
  rspack,
  type Stats
} from '@rspack/core'
import {FileEventAssistPlugin} from '../../../dev-server/file-event-assist'

// Bare rspack and the plugins under test, on a fixture project in a temp
// folder. No compiled dist, no loader from another plugin, no browser.

export type FixtureFiles = Record<string, string | Buffer>

export interface Diagnostic {
  name: string
  message: string
  file?: string
}

export interface FixtureBuild {
  root: string
  outputPath: string
  errors: Diagnostic[]
  warnings: Diagnostic[]
  // Every file in the output folder, by its path relative to it, POSIX slashes.
  emitted: Record<string, string>
  // What the compilation holds, written or not (a production build with an
  // error writes nothing). The value says whether a copier shipped it.
  assets: Record<string, {copied: boolean}>
  contextDependencies: string[]
  missingDependencies: string[]
}

const roots: string[] = []

export function makeFixtureRoot(files: FixtureFiles = {}): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-folders-harness-'))
  )
  roots.push(root)
  writeFixtureFiles(root, files)

  return root
}

export function writeFixtureFiles(root: string, files: FixtureFiles) {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }
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

export function listOutput(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(dir)) return out

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    const name = `${prefix}${entry.name}`

    if (entry.isDirectory()) Object.assign(out, listOutput(full, `${name}/`))
    else out[name] = fs.readFileSync(full, 'utf-8')
  }

  return out
}

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

function toDiagnostics(list: unknown[]): Diagnostic[] {
  return list.map((item) => {
    const issue = item as {name?: unknown; message?: unknown; file?: unknown}

    // rspack frames each line with a glyph or a gutter bar; the text is ours.
    const message = String(issue.message || '')
      .replace(ANSI, '')
      .split('\n')
      .map((line) => line.replace(/^\s*(?:[⚠×│] ?)?/, ''))
      .join('\n')
      .trim()

    return {
      name: String(issue.name || ''),
      message,
      ...(issue.file ? {file: String(issue.file)} : {})
    }
  })
}

export interface FixtureConfigOptions {
  root: string
  plugins: RspackPluginInstance[]
  mode?: 'development' | 'production'
  entry?: Configuration['entry']
}

export function fixtureCompiler(options: FixtureConfigOptions): Compiler {
  const {root} = options
  const config: Configuration = {
    context: root,
    mode: options.mode || 'production',
    entry: options.entry || {main: './index.js'},
    target: 'webworker',
    devtool: false,
    stats: false,
    infrastructureLogging: {level: 'none'},
    optimization: {minimize: false},
    plugins: options.plugins,
    output: {
      publicPath: '/',
      path: assertOutputInside(root, path.join(root, 'dist'))
    }
  }

  const compiler = rspack(config)
  // Defaults are applied by now: check the path rspack will really write to.
  assertOutputInside(root, compiler.options.output.path)

  return compiler
}

export function readBuild(
  root: string,
  compilation: Compilation
): FixtureBuild {
  const outputPath = assertOutputInside(root, compilation.outputOptions.path)

  return {
    root,
    outputPath,
    errors: toDiagnostics([...compilation.errors]),
    warnings: toDiagnostics([...compilation.warnings]),
    emitted: listOutput(outputPath),
    assets: Object.fromEntries(
      compilation
        .getAssets()
        .map((asset) => [
          asset.name.replace(/\\/g, '/'),
          {copied: asset.info.copied === true}
        ])
    ),
    contextDependencies: [...compilation.contextDependencies],
    missingDependencies: [...compilation.missingDependencies]
  }
}

export async function runCompiler(
  root: string,
  compiler: Compiler
): Promise<FixtureBuild> {
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('compile harness: no stats'))

      resolve(result)
    })
  })

  return readBuild(root, stats.compilation)
}

export function closeCompiler(compiler: Compiler): Promise<void> {
  return new Promise((resolve) => compiler.close(() => resolve()))
}

export async function compileFixture(
  options: Omit<FixtureConfigOptions, 'root'> & {files: FixtureFiles}
): Promise<FixtureBuild> {
  const root = makeFixtureRoot(options.files)
  const compiler = fixtureCompiler({...options, root})

  try {
    return await runCompiler(root, compiler)
  } finally {
    await closeCompiler(compiler)
  }
}

export interface FixtureWatch {
  builds: FixtureBuild[]
  // Resolves with the build numbered `count` (1-based), or undefined when
  // none arrives within the timeout.
  waitForBuild: (
    count: number,
    timeoutMs: number
  ) => Promise<FixtureBuild | undefined>
  close: () => Promise<void>
}

export function watchFixture(root: string, compiler: Compiler): FixtureWatch {
  const builds: FixtureBuild[] = []
  const waiters = new Set<() => void>()

  // The dev config watches with this beside it. Without it a macOS folder
  // event can be lost for good, and the session never rebuilds.
  new FileEventAssistPlugin().apply(compiler)

  const watching = compiler.watch({aggregateTimeout: 50}, (error, stats) => {
    if (!error && stats) builds.push(readBuild(root, stats.compilation))

    for (const wake of [...waiters]) wake()
  })

  return {
    builds,
    waitForBuild(count, timeoutMs) {
      return new Promise((resolve) => {
        const check = () => {
          if (builds.length < count) return false

          waiters.delete(check)
          clearTimeout(timer)
          resolve(builds[count - 1])

          return true
        }

        const timer = setTimeout(() => {
          waiters.delete(check)
          resolve(undefined)
        }, timeoutMs)

        if (!check()) waiters.add(check)
      })
    },
    close: () => new Promise<void>((resolve) => watching.close(() => resolve()))
  }
}

// Two writes can land in one build or in two, so wait for the build that
// shows the last of them.
export async function buildWith(
  watch: FixtureWatch,
  from: number,
  shows: (result: FixtureBuild) => boolean,
  timeoutMs = 10_000
): Promise<FixtureBuild> {
  for (let count = from; ; count += 1) {
    const result = await watch.waitForBuild(count, timeoutMs)
    if (!result) throw new Error(`no build number ${count} arrived`)
    if (shows(result)) return result
  }
}
