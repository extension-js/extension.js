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

const roots: string[] = []

// Every folder lives under the run's temp folder, so nothing lands in the repo.
export function makeTempRoot(prefix: string): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-${prefix}-`))
  )
  roots.push(root)

  return root
}

export function removeTempRoots(): void {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }
}

export interface CompileOptions {
  context: string
  // Required: an rspack build with no output.path writes into cwd/dist.
  outputPath: string
  mode?: 'development' | 'production'
  entry?: Record<string, string>
  plugins?: RspackPluginInstance[]
  outputClean?: boolean
  // Copied verbatim from context, so the asset hooks see real .json and .html.
  copy?: string[]
  nodeEnv?: string | false
  // Last word on the config, for a spec that needs what the real config sets.
  configure?: (config: Configuration) => void
}

export function createCompiler(options: CompileOptions): Compiler {
  const config: Configuration = {
    context: options.context,
    mode: options.mode || 'development',
    devtool: false,
    target: 'web',
    entry: options.entry || {},
    output: {clean: options.outputClean ?? false, path: options.outputPath},
    optimization: {
      emitOnErrors: false,
      minimize: false,
      ...(options.nodeEnv === undefined ? {} : {nodeEnv: options.nodeEnv})
    },
    plugins: [
      ...(options.copy?.length
        ? [
            new rspack.CopyRspackPlugin({
              patterns: options.copy.map((from) => ({from, to: from}))
            })
          ]
        : []),
      ...(options.plugins || [])
    ],
    stats: false,
    infrastructureLogging: {level: 'none'}
  }

  options.configure?.(config)

  return rspack(config)
}

export async function runCompiler(compiler: Compiler): Promise<Stats> {
  try {
    return await new Promise<Stats>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) return reject(error)
        if (!stats) return reject(new Error('rspack returned no stats'))

        resolve(stats)
      })
    })
  } finally {
    await new Promise<void>((resolve) => compiler.close(() => resolve()))
  }
}

export async function compile(options: CompileOptions): Promise<Stats> {
  return runCompiler(createCompiler(options))
}

export function messagesOf(stats: Stats, kind: 'errors' | 'warnings') {
  return (stats.toJson({all: false, [kind]: true})[kind] || []).map(
    (entry) => entry.message
  )
}

// Runs an emitted script and returns what it logged, one line per call.
export function runScript(
  file: string,
  globals: Record<string, unknown> = {}
): string[] {
  const logs: string[] = []
  const context = vm.createContext({
    ...globals,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' '))
    }
  })
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file})

  return logs
}
