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
import type {BrowserType, WebpackConfigOptions} from '../../types'
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
  browser: BrowserType = 'chrome',
  onCompiler?: (compiler: Compiler) => void,
  devOptions: Partial<WebpackConfigOptions> = {}
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
  })
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-ready-contract'
  )

  config.stats = false
  const compiler: Compiler = rspack(config)
  const tracker = createChangedSourcesTracker(compiler)

  // Every finished compile lands here; a test waits for the one after the
  // count it last saw, so a startup invalidation never masquerades as the edit.
  const dones: Stats[] = []
  let lastDoneAt = 0
  // A change the watcher saw and a build that started are both a rebuild on
  // its way, and the watcher is not idle until that one is done.
  let rebuilding = false
  compiler.hooks.invalid.tap('spec-dev-watch-session', () => {
    rebuilding = true
  })

  compiler.hooks.watchRun.tap('spec-dev-watch-session', () => {
    rebuilding = true
  })

  compiler.hooks.failed.tap('spec-dev-watch-session', () => {
    rebuilding = false
  })

  compiler.hooks.done.tap('spec-dev-watch-session', (stats) => {
    dones.push(stats)
    lastDoneAt = Date.now()
    rebuilding = false
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
        if (
          dones.length > 0 &&
          !rebuilding &&
          Date.now() - lastDoneAt > SETTLE_QUIET_MS
        ) {
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
    close: () =>
      new Promise<void>((resolve) => {
        watching.close(() => resolve())
      })
  }
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
