// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {fmt, prefix} from '../lib/messaging'
import type {AssetCategory} from './categorize'

function fmtKiB(bytes: number): string {
  const kib = bytes / 1024
  if (kib >= 1024) return `${(kib / 1024).toFixed(2)} MiB`

  return `${kib.toFixed(1)} KiB`
}

export interface OversizedAsset {
  name: string
  size: number
  budget: number
  category: AssetCategory
}

// A build that vendors thousands of files would otherwise print them all.
export const MAX_LISTED_ASSETS = 20

// Which budget a wasm file fell under, in the words its role line uses.
const WASM_BUDGET_REASON: Partial<Record<AssetCategory, string>> = {
  runtime: 'a file a content script or the service worker reaches',
  wasm: 'a file only pages and workers reach',
  public: 'a file copied from public/'
}

function wasmBudgetRemedy(categories: AssetCategory[]): string {
  if (categories.length === 1) {
    return `raise perfBudgets.${categories[0]} in extension.config.js when this size is intended`
  }

  const keys = categories
    .map(
      (category) =>
        `perfBudgets.${category} for ${WASM_BUDGET_REASON[category] || 'the rest'}`
    )
    .join(', ')

  return `raise the budget that applied in extension.config.js when this size is intended (${keys})`
}

export function perfBudgetWarning(assets: OversizedAsset[]): string {
  const count = assets.length
  const header =
    `${count === 1 ? 'One asset exceeds' : `${count} assets exceed`} the ` +
    'extension performance budget. Browser extensions inject content ' +
    'scripts on every navigation and wake service workers from cold, so ' +
    'Extension.js budgets each file by the surface that loads it.'

  const lines = assets.slice(0, MAX_LISTED_ASSETS).map((a) => {
    const over = ((a.size / a.budget) * 100 - 100).toFixed(0)

    return (
      `  ${a.name}\n` +
      `    size:   ${fmtKiB(a.size)}\n` +
      `    budget: ${fmtKiB(a.budget)}  (over by ${over}%)\n` +
      `    role:   ${categoryRole(a.category)}`
    )
  })

  if (count > MAX_LISTED_ASSETS) {
    lines.push(`  and ${count - MAX_LISTED_ASSETS} more`)
  }

  // A copied file never met the bundler, so code splitting is no answer
  // for it: the remedy names the public/ source instead. A wasm runtime is
  // one file by nature, so its remedy is a smaller build, a remote fetch or
  // the budget that applied to it, which is not always perfBudgets.wasm.
  const isWasm = (a: OversizedAsset) => /\.wasm$/i.test(a.name)
  const wasmCategories = Array.from(
    new Set(assets.filter(isWasm).map((a) => a.category))
  )
  const remediation = [
    ...(assets.some((a) => a.category !== 'public' && !isWasm(a))
      ? [
          'Lazy-load with dynamic import(), code-split per route, or replace ' +
            'large SDKs with thin fetch wrappers.\n' +
            'See https://rspack.rs/guide/optimization/code-splitting'
        ]
      : []),
    ...(assets.some((a) => a.category === 'public')
      ? [
          'A public/ file ships as authored: minify or trim it at its source, ' +
            'or fetch it on demand instead of shipping it in the package.'
        ]
      : []),
    ...(wasmCategories.length > 0
      ? [
          'A .wasm runtime cannot be code-split: pick a smaller build of the ' +
            'library when it offers one (no threads, no SIMD), fetch it from ' +
            `your own server on demand, ${wasmBudgetRemedy(wasmCategories)}, ` +
            'or list the file under perfBudgets.ignore.'
        ]
      : [])
  ].join('\n')

  return `${header}\n\n${lines.join('\n')}\n\n${remediation}`
}

// The same facts as the warning, plus the setting that made them fatal and
// the way back to a warning.
export function perfBudgetError(assets: OversizedAsset[]): string {
  return (
    `${perfBudgetWarning(assets)}\n\n` +
    "The build failed because perfBudgets.onExceed is 'error' in " +
    "extension.config.js. Remove it or set it to 'warn' to report an " +
    'overrun without failing.'
  )
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`
  if (typeof value === 'number') return `the number ${String(value)}`
  if (typeof value === 'object') return 'an object'

  return `a ${typeof value}`
}

function pathLine(configPath?: string): string {
  return configPath ? `\n${fmt.label('PATH')} ${fmt.val(configPath)}` : ''
}

export function perfBudgetsWrongShape(value: unknown, configPath?: string) {
  return (
    `${prefix('error')} ${colors.blue('perfBudgets')} in ${colors.blue('extension.config.js')} must be an object, found ${describeValue(value)}.` +
    `${pathLine(configPath)}\n` +
    `Write one budget in bytes per category, for example ${colors.blue('perfBudgets: {wasm: 48 * 1024 * 1024}')}.`
  )
}

export function perfBudgetsIgnoreInvalid(value: unknown, configPath?: string) {
  return (
    `${prefix('error')} ${colors.blue('perfBudgets.ignore')} in ${colors.blue('extension.config.js')} must be an array of strings, found ${describeValue(value)}.` +
    `${pathLine(configPath)}\n` +
    `List each output path or glob as its own entry, for example ${colors.blue("ignore: ['assets/*.wasm']")}.`
  )
}

export function perfBudgetInvalid(
  key: string,
  value: unknown,
  configPath?: string
) {
  return (
    `${prefix('error')} ${colors.blue(`perfBudgets.${key}`)} in ${colors.blue('extension.config.js')} must be a finite number of bytes above 0, found ${describeValue(value)}.` +
    `${pathLine(configPath)}\n` +
    `Write the budget in bytes, for example ${colors.blue(`'${key}': 2 * 1024 * 1024`)}. To stop budgeting a file, list it under ${colors.blue('perfBudgets.ignore')}.`
  )
}

export function perfBudgetsOnExceedInvalid(
  value: unknown,
  accepted: readonly string[],
  configPath?: string
) {
  const choices = accepted.map((choice) => `'${choice}'`).join(' or ')

  return (
    `${prefix('error')} ${colors.blue('perfBudgets.onExceed')} in ${colors.blue('extension.config.js')} must be ${choices}, found ${describeValue(value)}.` +
    `${pathLine(configPath)}\n` +
    `Write ${colors.blue("onExceed: 'error'")} to fail the build when a file is over its budget, or leave it out to keep the warning.`
  )
}

export function perfBudgetsUnknownKeys(
  keys: string[],
  accepted: readonly string[],
  configPath?: string
) {
  return (
    `${prefix('warn')} ${colors.blue('perfBudgets')} in ${colors.blue('extension.config.js')} declares ${keys.length === 1 ? 'a key' : 'keys'} nothing reads: ${colors.yellow(keys.join(', '))}.` +
    `${pathLine(configPath)}\n` +
    `Accepted keys are ${colors.blue(accepted.join(', '))}.`
  )
}

export function perfBudgetsNoEffectInDev(configPath?: string) {
  return (
    `${prefix('warn')} ${colors.blue('commands.dev.perfBudgets')} in ${colors.blue('extension.config.js')} has no effect: size budgets are checked on a production build only.` +
    `${pathLine(configPath)}\n` +
    `Move it to ${colors.blue('commands.build.perfBudgets')} or to the top-level ${colors.blue('perfBudgets')}.`
  )
}

export function perfBudgetsReferrersUnreadable(files: string[]) {
  return `${prefix('debug')} budgets  wasm=runtime reason=chunk-graph-unreadable files=${files.join(',')}`
}

function categoryRole(c: AssetCategory): string {
  switch (c) {
    case 'content-script':
      return 'content script, injected on every page navigation'
    case 'service-worker':
      return 'service worker / background, wakes from cold each session'
    case 'page':
      return 'UI page, opened on demand'
    case 'shared':
      return 'shared chunk, loaded by every page that imports it'
    case 'public':
      return 'copied public file, shipped as authored'
    case 'runtime':
      return 'runtime payload, reached by a content script or the service worker, or shipped at the output root'
    case 'wasm':
      return 'WebAssembly runtime, fetched when its feature runs'
    default:
      return 'asset'
  }
}
