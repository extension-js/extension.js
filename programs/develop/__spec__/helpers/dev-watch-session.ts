import * as fs from 'node:fs'
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

const SETTLE_QUIET_MS = 300

export interface DevWatchSession {
  compiler: Compiler
  tracker: ChangedSourcesTracker
  distPath: string
  doneAfter: (seen: number, timeoutMs?: number) => Promise<Stats>
  settle: () => Promise<number>
  quietFor: (ms: number) => Promise<number>
  close: () => Promise<void>
}

// The watcher counts a file written within its accuracy margin (up to 2s) of
// the first compile as changed and compiles again, so fixtures start older.
export function ageProjectFiles(dir: string) {
  const past = new Date(Date.now() - 60000)

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') ageProjectFiles(full)
    } else if (entry.isFile()) {
      fs.utimesSync(full, past, past)
    }
  }
}

// A real rspack watch over a project, minus the browser plugins, so a spec
// can write files and observe which of them the dev session rebuilds for.
export async function openDevWatchSession(
  root: string,
  browser = 'chrome',
  onCompiler?: (compiler: Compiler) => void,
  devOptions: Record<string, unknown> = {}
): Promise<DevWatchSession> {
  ageProjectFiles(root)

  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', browser)
  const config = webpackConfig(projectStructure, {
    browser,
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath},
    ...devOptions
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

  const doneAfter = (seen: number, timeoutMs = 30000) =>
    new Promise<Stats>((resolve, reject) => {
      const startedAt = Date.now()

      const poll = () => {
        if (dones.length > seen) return resolve(dones[seen])

        if (Date.now() - startedAt > timeoutMs) {
          return reject(
            new Error(`no rebuild observed within ${timeoutMs / 1000}s`)
          )
        }

        setTimeout(poll, 25)
      }

      poll()
    })
  // Aged fixtures leave no startup churn, so a short quiet after the first
  // compile is enough to know the watcher is idle.
  const settle = () =>
    new Promise<number>((resolve) => {
      const poll = () => {
        if (dones.length > 0 && Date.now() - lastDoneAt > SETTLE_QUIET_MS) {
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

  onCompiler?.(compiler)

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
    close: () => closeWatching(watching)
  }
}

const CLOSE_BOUND_MS = 10000

// A close waits for a compile in flight, which on a loaded machine running
// several watch sessions can outlast the hook. The spec has asserted by then.
export function closeWatching(watching: {
  close: (callback: () => void) => void
  running?: boolean
}): Promise<void> {
  return new Promise<void>((resolve) => {
    const bound = setTimeout(() => {
      console.warn(
        `watch session still closing after ${CLOSE_BOUND_MS / 1000}s (running: ${String(watching.running)})`
      )

      resolve()
    }, CLOSE_BOUND_MS)

    watching.close(() => {
      clearTimeout(bound)
      resolve()
    })
  })
}

// One edit can reach the watcher as several rebuilds, so a spec reads the
// output until it shows the state it expects and asserts after the deadline.
export async function waitUntil(
  check: () => boolean,
  deadlineMs = 60000
): Promise<void> {
  const giveUpAt = Date.now() + deadlineMs

  while (!check() && Date.now() < giveUpAt) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
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
