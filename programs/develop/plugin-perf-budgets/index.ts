// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import {codedError} from '../lib/coded-error'
import {findConfigFile, loadCommandConfig} from '../lib/config-loader'
import {CODES, debugLine, isDebug} from '../lib/messaging'
import {
  type AssetCategory,
  BUDGET_BYTES,
  BUDGET_CATEGORIES,
  type BudgetCategory,
  categorizeAsset,
  manifestEntriesOf
} from './categorize'
import {
  type OversizedAsset,
  perfBudgetError,
  perfBudgetInvalid,
  perfBudgetsIgnoreInvalid,
  perfBudgetsNoEffectInDev,
  perfBudgetsOnExceedInvalid,
  perfBudgetsReferrersUnreadable,
  perfBudgetsUnknownKeys,
  perfBudgetsWrongShape,
  perfBudgetWarning
} from './messages'
import {collectAssetReferrers} from './referrers'

export const ON_EXCEED_VALUES = ['warn', 'error'] as const

export type PerfBudgetsOnExceed = (typeof ON_EXCEED_VALUES)[number]

// The `perfBudgets` key of extension.config.js: a budget per category in
// bytes, the output paths no budget applies to, and what an overrun does.
export type PerfBudgetsConfig = Partial<Record<BudgetCategory, number>> & {
  ignore?: string[]
  onExceed?: PerfBudgetsOnExceed
}

interface PerfBudgetsPluginOptions {
  // Disable in dev: unminified bundles are 3-5x larger than prod and trip the
  // budgets even when the prod artifact is fine.
  enabled?: boolean
  // Per-category overrides (bytes). Useful for one-off projects that
  // legitimately need a bigger sidebar. Defaults live in BUDGET_BYTES.
  budgets?: PerfBudgetsConfig
}

const BUDGET_KEYS: ReadonlySet<string> = new Set(BUDGET_CATEGORIES)

export const PERF_BUDGETS_KEYS: readonly string[] = [
  ...BUDGET_CATEGORIES,
  'ignore',
  'onExceed'
]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A pattern names an output path the way the warning prints it: `**` spans
// folders, `*` stays inside one, anything else is literal.
export function ignorePatternToRegExp(pattern: string): RegExp {
  const normalized = String(pattern || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
  const source = normalized
    .split('**')
    .map((span) => span.split('*').map(escapeRegExp).join('[^/]*'))
    .join('.*')

  return new RegExp(`^${source}$`, 'i')
}

export interface ResolvedPerfBudgets {
  budgets: Record<AssetCategory, number>
  ignore: string[]
  onExceed: PerfBudgetsOnExceed
  unknownKeys: string[]
}

// A value of the wrong type used to be dropped or misread in silence, so a
// typed budget is refused here and a key nothing reads is handed back.
export function resolvePerfBudgets(
  config: unknown,
  configPath?: string
): ResolvedPerfBudgets {
  const budgets: Record<AssetCategory, number> = {...BUDGET_BYTES}

  if (config === undefined || config === null) {
    return {budgets, ignore: [], onExceed: 'warn', unknownKeys: []}
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    throw codedError(
      CODES.E_CONFIG_LOAD,
      perfBudgetsWrongShape(config, configPath)
    )
  }

  const unknownKeys: string[] = []
  let ignore: string[] = []
  let onExceed: PerfBudgetsOnExceed = 'warn'

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue

    if (key === 'ignore') {
      if (
        !Array.isArray(value) ||
        value.some((pattern) => typeof pattern !== 'string')
      ) {
        throw codedError(
          CODES.E_CONFIG_LOAD,
          perfBudgetsIgnoreInvalid(value, configPath)
        )
      }

      ignore = value.filter((pattern) => pattern.trim())
      continue
    }

    if (key === 'onExceed') {
      if (!ON_EXCEED_VALUES.includes(value as PerfBudgetsOnExceed)) {
        throw codedError(
          CODES.E_CONFIG_LOAD,
          perfBudgetsOnExceedInvalid(value, ON_EXCEED_VALUES, configPath)
        )
      }

      onExceed = value as PerfBudgetsOnExceed
      continue
    }

    if (!BUDGET_KEYS.has(key)) {
      unknownKeys.push(key)
      continue
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw codedError(
        CODES.E_CONFIG_LOAD,
        perfBudgetInvalid(key, value, configPath)
      )
    }

    budgets[key as BudgetCategory] = value
  }

  return {budgets, ignore, onExceed, unknownKeys}
}

// One notice per config file per process: a dev restart builds again.
const noticed = new Set<string>()

function noticeOnce(key: string, text: string): void {
  if (noticed.has(key)) return

  noticed.add(key)
  // eslint-disable-next-line no-console
  console.error(text)
}

export function resetPerfBudgetNotices(): void {
  noticed.clear()
}

export class PerfBudgetsPlugin {
  static readonly name = 'plugin-perf-budgets'

  private readonly options: PerfBudgetsPluginOptions

  constructor(options: PerfBudgetsPluginOptions = {}) {
    this.options = options
  }

  // Budgets are a production check, so a dev-only budget block is told so
  // once instead of being accepted and never read.
  private warnDevBudgets(compiler: Compiler) {
    const projectPath = String(compiler.options.context || '')
    if (!projectPath) return

    compiler.hooks.watchRun.tapPromise(PerfBudgetsPlugin.name, async () => {
      const configPath = findConfigFile(projectPath)
      if (!configPath || noticed.has(`dev:${configPath}`)) return

      try {
        const dev = await loadCommandConfig(projectPath, 'dev')

        if (dev?.perfBudgets !== undefined) {
          noticeOnce(`dev:${configPath}`, perfBudgetsNoEffectInDev(configPath))
        }
      } catch {
        // The command that loaded this config first reports why it failed
      }
    })
  }

  apply(compiler: Compiler) {
    const enabled =
      typeof this.options.enabled === 'boolean'
        ? this.options.enabled
        : compiler.options.mode === 'production'

    if (!enabled) {
      if (compiler.options.mode === 'development') this.warnDevBudgets(compiler)

      return
    }

    const projectPath = String(compiler.options.context || '')
    const configPath = projectPath ? findConfigFile(projectPath) : undefined
    const {budgets, ignore, onExceed, unknownKeys} = resolvePerfBudgets(
      this.options.budgets,
      configPath
    )

    if (unknownKeys.length > 0) {
      noticeOnce(
        `keys:${configPath || ''}:${unknownKeys.join(',')}`,
        perfBudgetsUnknownKeys(unknownKeys, PERF_BUDGETS_KEYS, configPath)
      )
    }

    const ignored = ignore.map(ignorePatternToRegExp)

    const report = (compilation: Compilation) => {
      if (compilation.errors.length) return

      const oversized: OversizedAsset[] = []
      const assets = compilation.assets
      let unreadable = false
      const referrers = collectAssetReferrers(compilation, () => {
        unreadable = true
      })
      const manifestEntries = manifestEntriesOf(
        String(assets['manifest.json']?.source() ?? '')
      )
      const tightened: string[] = []

      for (const [name, source] of Object.entries(assets)) {
        const size = source.size()
        if (!size) continue

        const normalized = name.replace(/\\/g, '/')
        if (ignored.some((pattern) => pattern.test(normalized))) continue

        let category = categorizeAsset(
          name,
          compilation.getAsset(name)?.info,
          referrers.get(normalized),
          manifestEntries
        )
        if (category === 'ignored') continue

        // An unreadable graph may have lost the content script that reaches
        // this file, so it keeps the tighter of the two budgets it could get.
        if (category === 'wasm' && unreadable) {
          category = 'runtime'
          tightened.push(normalized)
        }

        const budget = budgets[category]
        if (size <= budget) continue

        oversized.push({name, size, budget, category})
      }

      if (tightened.length > 0 && isDebug()) {
        debugLine(perfBudgetsReferrersUnreadable(tightened))
      }

      if (oversized.length === 0) return

      oversized.sort((a, b) => b.size - a.size)

      const ErrorConstructor = compiler.rspack.WebpackError

      // The author asked for an overrun to stop the build, so it is an error
      // of the compilation and nothing is written over the last good output.
      if (onExceed === 'error') {
        const error = new ErrorConstructor(perfBudgetError(oversized))
        ;(error as Error).name = 'PerfBudgetError'

        compilation.errors.push(error)

        return
      }

      const warning = new ErrorConstructor(perfBudgetWarning(oversized))
      ;(warning as Error).name = 'PerfBudgetWarning'

      compilation.warnings.push(warning)
    }

    // After every asset stage, so a shim, a pruned bridge or a byte order
    // mark another plugin adds at a late stage is in the size that is read.
    compiler.hooks.thisCompilation.tap(
      PerfBudgetsPlugin.name,
      (compilation: Compilation) => {
        compilation.hooks.afterProcessAssets.tap(PerfBudgetsPlugin.name, () =>
          report(compilation)
        )
      }
    )
  }
}

export type {AssetCategory, BudgetCategory} from './categorize'
export {
  ASSET_CATEGORIES,
  BUDGET_BYTES,
  BUDGET_CATEGORIES,
  categorizeAsset
} from './categorize'
export {collectAssetReferrers} from './referrers'
