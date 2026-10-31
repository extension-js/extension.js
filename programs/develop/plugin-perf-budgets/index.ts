// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import {
  ASSET_CATEGORIES,
  type AssetCategory,
  BUDGET_BYTES,
  categorizeAsset
} from './categorize'
import {type OversizedAsset, perfBudgetWarning} from './messages'
import {collectAssetReferrers} from './referrers'

// The `perfBudgets` key of extension.config.js: a budget per category in
// bytes, plus the output paths no budget applies to.
export type PerfBudgetsConfig = Partial<Record<AssetCategory, number>> & {
  ignore?: string[]
}

interface PerfBudgetsPluginOptions {
  // Disable in dev: unminified bundles are 3-5x larger than prod and trip the
  // budgets even when the prod artifact is fine.
  enabled?: boolean
  // Per-category overrides (bytes). Useful for one-off projects that
  // legitimately need a bigger sidebar. Defaults live in BUDGET_BYTES.
  budgets?: PerfBudgetsConfig
  // Output paths excused from every budget, exact or with * and ** globs.
  ignore?: string[]
}

const CATEGORY_SET: ReadonlySet<string> = new Set(ASSET_CATEGORIES)

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

export class PerfBudgetsPlugin {
  static readonly name = 'plugin-perf-budgets'

  private readonly options: PerfBudgetsPluginOptions

  constructor(options: PerfBudgetsPluginOptions = {}) {
    this.options = options
  }

  apply(compiler: Compiler) {
    const enabled =
      typeof this.options.enabled === 'boolean'
        ? this.options.enabled
        : compiler.options.mode === 'production'

    if (!enabled) return

    const budgets: Record<AssetCategory, number> = {...BUDGET_BYTES}

    for (const [key, value] of Object.entries(this.options.budgets || {})) {
      if (CATEGORY_SET.has(key) && typeof value === 'number') {
        budgets[key as AssetCategory] = value
      }
    }

    const ignored = [
      ...(this.options.ignore || []),
      ...(this.options.budgets?.ignore || [])
    ]
      .filter((pattern) => typeof pattern === 'string' && pattern.trim())
      .map(ignorePatternToRegExp)

    const report = (compilation: Compilation) => {
      if (compilation.errors?.length) return

      const oversized: OversizedAsset[] = []
      const assets = compilation.assets || {}
      const referrers = collectAssetReferrers(compilation)

      for (const [name, source] of Object.entries(assets)) {
        const size = (source as {size?: () => number})?.size?.() ?? 0
        if (!size) continue

        const normalized = name.replace(/\\/g, '/')
        if (ignored.some((pattern) => pattern.test(normalized))) continue

        const category = categorizeAsset(
          name,
          compilation.getAsset?.(name)?.info,
          referrers.get(normalized)
        )
        if (category === 'ignored') continue

        const budget = budgets[category]
        if (!Number.isFinite(budget)) continue
        if (size <= budget) continue

        oversized.push({name, size, budget, category})
      }

      if (oversized.length === 0) return

      oversized.sort((a, b) => b.size - a.size)

      const ErrorConstructor = compiler?.rspack?.WebpackError || Error
      const warning = new ErrorConstructor(perfBudgetWarning(oversized))
      ;(warning as Error).name = 'PerfBudgetWarning'

      if (!compilation.warnings) {
        compilation.warnings = []
      }

      compilation.warnings.push(warning)
    }

    const REPORT_STAGE =
      compiler?.rspack?.Compilation?.PROCESS_ASSETS_STAGE_REPORT ?? 5000

    compiler.hooks.thisCompilation.tap(
      PerfBudgetsPlugin.name,
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {name: PerfBudgetsPlugin.name, stage: REPORT_STAGE},
          () => report(compilation)
        )
      }
    )
  }
}

export type {AssetCategory} from './categorize'
export {ASSET_CATEGORIES, BUDGET_BYTES, categorizeAsset} from './categorize'
export {type AssetReferrers, collectAssetReferrers} from './referrers'
