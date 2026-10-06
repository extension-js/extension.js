import type {Compiler} from '@rspack/core'

type WatchOptions = NonNullable<Compiler['options']['watchOptions']>

export function devWatchOptions(
  compiler: Compiler,
  overrides: WatchOptions = {}
): WatchOptions {
  return {...compiler.options.watchOptions, ...overrides}
}
