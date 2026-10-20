import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {getProjectStructure} from '../../lib/project'
import {
  buildSourceFeatureIndex,
  type ChangedSourcesTracker,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  readContentScriptCount
} from '../../plugin-reload'
import webpackConfig from '../../rspack-config'
import {devWatchOptions} from './dev-watch-options'

export interface DevWatchSession {
  compiler: Compiler
  tracker: ChangedSourcesTracker
  distPath: string
  doneAfter: (seen: number, timeoutMs?: number) => Promise<Stats>
  settle: () => Promise<number>
  quietFor: (ms: number) => Promise<number>
  close: () => Promise<void>
}

// A real rspack watch over a project, minus the browser plugins, so a spec
// can write files and observe which of them the dev session rebuilds for.
export async function openDevWatchSession(
  root: string,
  browser = 'chrome'
): Promise<DevWatchSession> {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', browser)
  const config = webpackConfig(projectStructure, {
    browser,
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  const compiler: Compiler = rspack(config)
  const tracker = createChangedSourcesTracker(compiler)

  // Every finished compile lands here; a test waits for the one after the
  // count it last saw, so a startup invalidation never masquerades as the edit.
  const dones: Stats[] = []
  let lastDoneAt = 0
  compiler.hooks.done.tap('spec-dev-watch-session', (stats) => {
    dones.push(stats)
    lastDoneAt = Date.now()
  })

  const doneAfter = (seen: number, timeoutMs = 15000) =>
    new Promise<Stats>((resolve, reject) => {
      const startedAt = Date.now()

      const poll = () => {
        if (dones.length > seen) return resolve(dones[seen])

        if (Date.now() - startedAt > timeoutMs) {
          return reject(new Error('no rebuild observed within 15s'))
        }

        setTimeout(poll, 25)
      }

      poll()
    })
  // Quiet for a full second: the watcher has finished any startup churn.
  const settle = () =>
    new Promise<number>((resolve) => {
      const poll = () => {
        if (dones.length > 0 && Date.now() - lastDoneAt > 1000) {
          return resolve(dones.length)
        }

        setTimeout(poll, 50)
      }

      poll()
    })
  const quietFor = (ms: number) =>
    new Promise<number>((resolve) => {
      setTimeout(() => resolve(dones.length), ms)
    })

  const watching = compiler.watch(
    devWatchOptions(compiler, {aggregateTimeout: 50}),
    () => {}
  )

  return {
    compiler,
    tracker,
    distPath,
    doneAfter,
    settle,
    quietFor,
    close: () =>
      new Promise<void>((resolve) => {
        watching.close(() => resolve())
      })
  }
}

// The same classification the launched and --no-browser paths perform.
export function classifyFromSession(session: DevWatchSession, stats: Stats) {
  const compilation = stats.compilation
  const outputPath = String(compilation.options?.output?.path || '')
  const contextDir = String(compilation.options?.context || '')
  const {forcedFull, changedSources} = session.tracker.snapshot()

  return classifyReloadFromSources({
    changedSources,
    forcedFull,
    getContentScriptCount: () =>
      readContentScriptCount(compilation, outputPath),
    getSourceFeatureIndex: () =>
      buildSourceFeatureIndex(compilation, contextDir),
    outputPath
  })
}

export const errorsOf = (stats: Stats) =>
  Array.from(stats.compilation.errors || []).map((error) =>
    String((error as Error)?.message || error)
  )
