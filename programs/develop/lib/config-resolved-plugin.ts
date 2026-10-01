// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler, Configuration} from '@rspack/core'
import type {FileConfig} from '../types'

// Options the bundler reads at construction: a change here after the fact
// goes nowhere, so the hook's copy of them is ignored and `config` is the
// place for those.
const FIXED_AT_CONSTRUCTION = new Set(['entry', 'plugins', 'context', 'mode'])

export type ConfigResolvedHook = NonNullable<FileConfig['configResolved']>

// Runs the user's `configResolved` once every plugin has attached its rules,
// in the same hooks the framework and css plugins use for theirs, and folds
// the returned config back onto the compiler. Applied last so it sees them.
export class ConfigResolvedPlugin {
  public static readonly name: string = 'plugin-config-resolved'
  private applied = false

  constructor(private readonly hook: ConfigResolvedHook) {}

  apply(compiler: Compiler) {
    const run = async () => {
      if (this.applied) return

      this.applied = true

      const next = await this.hook(compiler.options as Configuration)
      if (!next || next === compiler.options) return

      for (const [key, value] of Object.entries(next)) {
        if (FIXED_AT_CONSTRUCTION.has(key)) continue
        ;(compiler.options as unknown as Record<string, unknown>)[key] = value
      }
    }

    compiler.hooks.beforeRun.tapPromise(ConfigResolvedPlugin.name, run)
    compiler.hooks.watchRun.tapPromise(ConfigResolvedPlugin.name, run)
  }
}
