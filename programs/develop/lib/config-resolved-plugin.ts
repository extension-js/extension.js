// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isDeepStrictEqual} from 'node:util'
import type {Compiler, Configuration} from '@rspack/core'
import type {FileConfig} from '../types'
import * as messages from './messages'

type Options = Record<string, unknown>

// What the hook can still change: the bundler reads these when the build
// starts. Every other top-level key was consumed while the compiler was built.
const OPEN_AT_TOP = new Set([
  'module',
  'resolve',
  'resolveLoader',
  'node',
  'optimization',
  'output'
])

// The part of `optimization` the hook still decides: this plugin holds the
// minimizers back until the hook has run. The rest is plugins by then.
const OPEN_IN_OPTIMIZATION = new Set(['minimize', 'minimizer'])

// `output` is read when the build starts, except the path the staging swap
// already planned around and the keys the bundler turned into plugins.
const FIXED_IN_OUTPUT = new Set([
  'path',
  'module',
  'library',
  'enabledLibraryTypes',
  'chunkFormat',
  'chunkLoading',
  'enabledChunkLoadingTypes',
  'wasmLoading',
  'enabledWasmLoadingTypes',
  'workerChunkLoading',
  'workerWasmLoading',
  'workerPublicPath',
  'pathinfo',
  'sourceMapFilename',
  'devtoolModuleFilenameTemplate',
  'devtoolFallbackModuleFilenameTemplate',
  'devtoolNamespace',
  'bundlerInfo'
])

export type ConfigResolvedHook = NonNullable<FileConfig['configResolved']>

function isPlainObject(value: unknown): value is Options {
  if (typeof value !== 'object' || value === null) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

// A copy deep enough to notice an edit made in place. Plain objects and
// arrays are copied, class instances and functions stay as they are.
function snapshot(value: unknown, seen = new Map<unknown, unknown>()): unknown {
  if (seen.has(value)) return seen.get(value)

  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)

    for (const item of value) copy.push(snapshot(item, seen))

    return copy
  }

  if (!isPlainObject(value)) return value

  const copy: Options = Object.create(Object.getPrototypeOf(value))
  seen.set(value, copy)

  for (const key of Object.keys(value)) copy[key] = snapshot(value[key], seen)

  return copy
}

// The paths at or under `path` that differ from the snapshot. An added or
// edited key is named by its own path, an object that lost a key as a whole.
function changedPaths(now: unknown, before: unknown, path: string): string[] {
  if (isDeepStrictEqual(now, before)) return []
  if (!isPlainObject(now) || !isPlainObject(before)) return [path]
  if (Object.keys(before).some((key) => !(key in now))) return [path]

  return Object.keys(now).flatMap((key) =>
    changedPaths(now[key], before[key], `${path}.${key}`)
  )
}

interface FixedKeys {
  // `optimization` or `output`, or nothing for the top level.
  name?: string
  isFixed: (key: string) => boolean
}

const FIXED_KEYS: FixedKeys[] = [
  {isFixed: (key) => !OPEN_AT_TOP.has(key)},
  {name: 'optimization', isFixed: (key) => !OPEN_IN_OPTIMIZATION.has(key)},
  {name: 'output', isFixed: (key) => FIXED_IN_OUTPUT.has(key)}
]

function snapshotFixedKeys(holder: Options, {isFixed}: FixedKeys): Options {
  const before: Options = {}

  for (const key of Object.keys(holder)) {
    if (isFixed(key)) before[key] = snapshot(holder[key])
  }

  return before
}

// Puts back every fixed key the hook changed and returns the paths it set.
// Under `optimization` and `output` a key only left out of a new object is
// not a change, so it comes back without a word.
function restoreFixedKeys(
  holder: Options,
  before: Options,
  {name, isFixed}: FixedKeys
): string[] {
  const ignored: string[] = []

  for (const key of new Set([...Object.keys(before), ...Object.keys(holder)])) {
    if (!isFixed(key)) continue

    const path = name ? `${name}.${key}` : key
    const changed = changedPaths(holder[key], before[key], path)

    if (changed.length === 0) continue
    if (!name || holder[key] !== undefined) ignored.push(...changed)

    if (key in before) holder[key] = before[key]
    else delete holder[key]
  }

  return ignored
}

// Runs the user's `configResolved` once every plugin has attached its rules,
// in the same hooks the framework and css plugins use for theirs, and folds
// the returned config back onto the compiler. Applied last so it sees them.
export class ConfigResolvedPlugin {
  public static readonly name: string = 'plugin-config-resolved'
  private applied = false

  constructor(private readonly hook: ConfigResolvedHook) {}

  apply(compiler: Compiler) {
    const options = compiler.options as unknown as Options
    const optimization = () => options.optimization as Options
    let minimize: unknown

    // The bundler applies the minimizers while it builds the compiler, so
    // they are switched off for that step and applied after the hook.
    compiler.hooks.environment.tap(ConfigResolvedPlugin.name, () => {
      minimize = optimization().minimize
      optimization().minimize = false
    })

    compiler.hooks.afterPlugins.tap(ConfigResolvedPlugin.name, () => {
      optimization().minimize = minimize
    })

    const run = async () => {
      if (this.applied) return

      this.applied = true

      const holders = FIXED_KEYS.map((fixed) => {
        const holder = (fixed.name ? options[fixed.name] : options) as Options

        return {fixed, holder, before: snapshotFixedKeys(holder, fixed)}
      })

      const next = await this.hook(compiler.options as Configuration)

      if (next && next !== compiler.options) {
        for (const [key, value] of Object.entries(next)) options[key] = value
      }

      const ignored: string[] = []

      for (const {fixed, holder, before} of holders) {
        let current = holder

        if (fixed.name) {
          // Anything but an object in place of `optimization` or `output`
          // leaves the bundler nothing to read, so the old one goes back.
          if (isPlainObject(options[fixed.name])) {
            current = options[fixed.name] as Options
          } else {
            options[fixed.name] = holder
            ignored.push(fixed.name)
          }
        }

        ignored.push(...restoreFixedKeys(current, before, fixed))
      }

      if (ignored.length > 0) {
        console.warn(messages.configResolvedChangeIgnored(ignored))
      }

      const minimizers = optimization().minimize ? optimization().minimizer : []

      for (const minimizer of Array.isArray(minimizers) ? minimizers : []) {
        if (typeof minimizer === 'function') minimizer.call(compiler, compiler)
        else if (minimizer && typeof minimizer === 'object') {
          ;(minimizer as {apply: (compiler: Compiler) => void}).apply(compiler)
        }
      }
    }

    compiler.hooks.beforeRun.tapPromise(ConfigResolvedPlugin.name, run)
    compiler.hooks.watchRun.tapPromise(ConfigResolvedPlugin.name, run)
  }
}
