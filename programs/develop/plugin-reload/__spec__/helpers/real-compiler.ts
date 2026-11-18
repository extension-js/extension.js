import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, type RspackOptions, rspack, sources} from '@rspack/core'
import {CONTROL_PORT_ASSET_NAME} from '../../../dev-server/control-bridge/producer-runtime'

// Writes each file under the project root, a manifest object as JSON.
export function writeProject(
  root: string,
  files: Record<string, string | object>
): string {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(
      file,
      typeof contents === 'string' ? contents : JSON.stringify(contents)
    )
  }

  return root
}

// A real compiler that is created and never run, so a spec reads what a
// plugin registered on it rather than what a stand-in recorded.
export function idleCompiler(
  root: string,
  mode: 'development' | 'production',
  entry: RspackOptions['entry'] = {}
): Compiler {
  return rspack({
    mode,
    context: root,
    entry,
    output: {path: path.join(root, 'dist')}
  })
}

// Runs a compile with readable output and returns every emitted JavaScript
// file by name, or none when the compile reported an error.
export async function compileFiles(
  root: string,
  entry: Record<string, string>,
  plugin: {apply(compiler: Compiler): void},
  mode: 'development' | 'production' = 'production'
): Promise<{errors: string[]; files: Record<string, string>}> {
  const compiler = rspack({
    mode,
    context: root,
    devtool: false,
    optimization: {minimize: false},
    entry: Object.fromEntries(
      Object.entries(entry).map(([name, file]) => [
        name,
        {import: [file.startsWith('data:') ? file : path.join(root, file)]}
      ])
    ),
    output: {path: path.join(root, 'dist')},
    plugins: [plugin]
  })
  const stats = await new Promise<import('@rspack/core').Stats>(
    (resolve, reject) =>
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
  )
  await new Promise((resolve) => compiler.close(resolve))
  const errors = stats.compilation.errors.map((error) => error.message)
  const files: Record<string, string> = {}

  if (!stats.hasErrors()) {
    for (const asset of stats.compilation.getAssets()) {
      if (asset.name.endsWith('.js')) {
        files[asset.name] = String(asset.source.source())
      }
    }
  }

  return {errors, files}
}

export interface CompileIssue {
  name: string
  file?: string
  message: string
}

// Runs a compile and returns what it reported, with the bundler's own
// severity mark and padding taken off each message.
export async function compileIssues(
  root: string,
  mode: 'development' | 'production',
  entry: Record<string, string>,
  plugins: Array<{apply(compiler: Compiler): void}>
): Promise<{errors: CompileIssue[]; warnings: CompileIssue[]}> {
  const compiler = rspack({
    mode,
    context: root,
    devtool: false,
    entry: Object.fromEntries(
      Object.entries(entry).map(([name, file]) => [
        name,
        {import: [path.join(root, file)]}
      ])
    ),
    output: {path: path.join(root, 'dist')},
    plugins
  })
  const stats = await new Promise<import('@rspack/core').Stats>(
    (resolve, reject) =>
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
  )
  await new Promise((resolve) => compiler.close(resolve))
  const plain = (issue: Error & {file?: string}): CompileIssue => ({
    name: issue.name,
    ...(issue.file ? {file: issue.file} : {}),
    message: issue.message.replace(/^\s*[×⚠]\s*/, '').trimEnd()
  })

  return {
    errors: stats.compilation.errors.map(plain),
    warnings: stats.compilation.warnings.map(plain)
  }
}

function tapNames(compiler: Compiler): Map<string, string[]> {
  return new Map(
    Object.entries(compiler.hooks).map(([hook, value]) => [
      hook,
      ((value as {taps?: Array<{name: string}>}).taps ?? []).map(
        (tap) => tap.name
      )
    ])
  )
}

// Every tap a call added, by compiler hook, in the order they were added.
export function tapsAddedBy(
  compiler: Compiler,
  act: () => void
): Record<string, string[]> {
  const before = tapNames(compiler)
  act()
  const added: Record<string, string[]> = {}

  for (const [hook, names] of tapNames(compiler)) {
    const extra = names.slice(before.get(hook)?.length ?? 0)
    if (extra.length > 0) added[hook] = extra
  }

  return added
}

// The fork's service worker plugin names its entry only inside the tap it
// adds to entryOption, so the entry is read by handing that tap a set.
export function workerEntryFromFork(compiler: Compiler): string | undefined {
  const taps = (
    compiler.hooks.entryOption as unknown as {
      taps: Array<{
        name: string
        fn: (context: string, entries: object) => void
      }>
    }
  ).taps.filter((tap) => tap.name === 'WebExtensionServiceWorkerEntryPlugin')

  if (taps.length === 0) return undefined
  if (taps.length > 1) throw new Error('the fork tapped entryOption twice')

  const entries = new Proxy<Record<string, {chunkLoading?: string}>>(
    {},
    {get: (seen, name: string) => (seen[name] ??= {})}
  )
  taps[0].fn(String(compiler.options.context), entries)
  const named = Object.entries(entries).find(
    ([, entry]) => entry.chunkLoading === 'import-scripts'
  )

  return named?.[0]
}

type Tap = {name: string; fn: (compilation: unknown) => void}

// The control file the bridge producer applied to this compiler writes, from
// its own tap, for a compilation that holds one worker. Null when none.
export function bakedBridgeControl(
  compiler: Compiler
): Record<string, unknown> | null {
  const tap = (
    compiler.hooks.thisCompilation as unknown as {taps: Tap[]}
  ).taps.find(({name}) => name === 'InjectBridgeProducer')

  if (!tap) return null

  const assets: Record<string, {name: string; source: sources.Source}> = {
    'background/service_worker.js': {
      name: 'background/service_worker.js',
      source: new sources.RawSource('/* worker */')
    }
  }
  const processAssets: Array<() => void> = []

  const put = (name: string, source: sources.Source) => {
    assets[name] = {name, source}
  }

  tap.fn({
    hooks: {
      processAssets: {
        tap: (_options: unknown, fn: () => void) => processAssets.push(fn)
      }
    },
    getAssets: () => Object.values(assets),
    getAsset: (name: string) => assets[name],
    emitAsset: put,
    updateAsset: put
  })

  for (const run of processAssets) run()

  const control = assets[CONTROL_PORT_ASSET_NAME]

  return control ? JSON.parse(String(control.source.source())) : null
}
