// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Compiler, Compilation} from '@rspack/core'
import {BUDGET_BYTES, categorizeAsset, type AssetCategory} from './categorize'
import {perfBudgetWarning, type OversizedAsset} from './messages'

interface PerfBudgetsPluginOptions {
  // Disable in dev: unminified bundles are 3–5× larger than prod and trip
  // the budgets even when the prod artifact is fine. Default: enabled only
  // for `compiler.options.mode === 'production'`.
  enabled?: boolean
  // Per-category overrides (bytes). Useful for one-off projects that
  // legitimately need a bigger sidebar. Defaults live in BUDGET_BYTES.
  budgets?: Partial<Record<AssetCategory, number>>
}

/**
 * PerfBudgetsPlugin — extension-aware performance budgets.
 *
 * Replaces rspack's stock single-threshold `performance.hints` with a
 * per-asset-category budget tuned to how browser extensions actually
 * load code:
 *
 *   content_scripts/*    → 256 KiB  (injected on every navigation)
 *   background / SW      → 200 KiB  (wakes from cold each session)
 *   pages / sidebar / …  → 500 KiB  (opened on demand)
 *   images, fonts, etc.  → silenced (not a code-splitting concern)
 *
 * Set `compiler.options.performance.hints = false` when this plugin is
 * registered to avoid double-warnings.
 */
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

    const budgets: Record<AssetCategory, number> = {
      ...BUDGET_BYTES,
      ...(this.options.budgets || {})
    }

    compiler.hooks.afterCompile.tap(
      PerfBudgetsPlugin.name,
      (compilation: Compilation) => {
        if (compilation.errors?.length) return

        const oversized: OversizedAsset[] = []
        const assets = compilation.assets || {}

        for (const [name, source] of Object.entries(assets)) {
          const size = (source as {size?: () => number})?.size?.() ?? 0
          if (!size) continue

          const category = categorizeAsset(name)
          if (category === 'ignored') continue

          const budget = budgets[category]
          if (!isFinite(budget)) continue
          if (size <= budget) continue

          oversized.push({name, size, budget, category})
        }

        if (oversized.length === 0) return

        oversized.sort((a, b) => b.size - a.size)

        const ErrorConstructor =
          (compiler as any)?.rspack?.WebpackError || Error
        const warning = new ErrorConstructor(perfBudgetWarning(oversized))
        ;(warning as any).name = 'PerfBudgetWarning'
        if (!compilation.warnings) {
          ;(compilation as any).warnings = []
        }
        compilation.warnings.push(warning)
      }
    )
  }
}

export {BUDGET_BYTES, categorizeAsset} from './categorize'
export type {AssetCategory} from './categorize'
