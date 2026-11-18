import * as path from 'node:path'

// The compiler hooks the browser plugins and the reload tracker they build
// tap. Each fire runs the taps in registration order, the way rspack does.
const HOOKS = [
  'thisCompilation',
  'watchRun',
  'assetEmitted',
  'done',
  'watchClose',
  'shutdown'
] as const

type HookName = (typeof HOOKS)[number]
type Callback = (...args: any[]) => unknown

export interface FakeCompilationOptions {
  context: string
  output: string
  manifest?: Record<string, unknown>
  assets?: Record<string, string>
  errors?: unknown[]
}

// The slice of a compilation the done hooks read: options, errors and the
// emitted assets by name. The manifest is one more asset.
export function fakeCompilation(options: FakeCompilationOptions) {
  const assets: Record<string, string> = {
    ...options.assets,
    ...(options.manifest
      ? {'manifest.json': JSON.stringify(options.manifest)}
      : {})
  }

  return {
    errors: options.errors || [],
    warnings: [] as unknown[],
    options: {context: options.context, output: {path: options.output}},
    getAsset: (name: string) =>
      name in assets ? {source: {source: () => assets[name]}} : undefined
  }
}

// A watching compiler with no bundler under it. `owner` is the name the plugin
// under test taps `done` with: a compile that plugin never tapped throws, so a
// test that expects silence cannot pass because nothing ran.
export function fakeCompiler(options: {owner: string; context: string}) {
  const taps = new Map<HookName, Array<{name: string; run: Callback}>>()

  const hook = (hookName: HookName) => {
    const tap = (name: string, run: Callback) => {
      taps.set(hookName, [...(taps.get(hookName) || []), {name, run}])
    }

    return {tap, tapPromise: tap}
  }

  const compiler = {
    options: {mode: 'development', context: options.context},
    modifiedFiles: undefined as Set<string> | undefined,
    hooks: Object.fromEntries(HOOKS.map((name) => [name, hook(name)]))
  }

  const tapped = (hookName: HookName) => taps.get(hookName) || []

  const fire = (hookName: HookName) => {
    const runs = tapped(hookName)

    if (runs.length === 0) {
      throw new Error(`Nothing tapped ${hookName}, so firing it tests nothing`)
    }

    return runs
  }

  return {
    compiler: compiler as never,
    // The tap names on a hook, to show what a plugin does and does not hear.
    tappers: (hookName: HookName) => tapped(hookName).map(({name}) => name),
    // A watch rebuild starting after saves to these project-relative files.
    watchRun(files: string[] = []) {
      compiler.modifiedFiles = new Set(
        files.map((file) => path.join(options.context, file))
      )

      for (const {run} of fire('watchRun')) run(compiler)
    },
    emitAsset(file: string) {
      for (const {run} of fire('assetEmitted')) run(file)
    },
    thisCompilation(compilation: object) {
      for (const {run} of fire('thisCompilation')) run(compilation)
    },
    // Sync taps run at once and each async tap starts before this returns,
    // so a save fired right after it cannot slip in ahead of the snapshot.
    done(compilation: object): Promise<void> {
      const runs = fire('done')

      if (!runs.some(({name}) => name === options.owner)) {
        throw new Error(`${options.owner} never tapped done`)
      }

      const runAll = async () => {
        for (const {run} of runs) {
          const result = run({compilation})
          if (result instanceof Promise) await result
        }
      }

      return runAll()
    }
  }
}

export type FakeCompiler = ReturnType<typeof fakeCompiler>
