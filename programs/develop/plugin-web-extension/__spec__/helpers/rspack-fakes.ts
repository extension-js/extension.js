import type {Compilation, Compiler, LoaderContext} from '@rspack/core'

// Specs build small fakes that carry only the fields a step reads. These
// name the one cast from such a fake to the full rspack type it stands in for.
export function asCompiler(fake: unknown): Compiler {
  return fake as Compiler
}

export function asCompilation(fake: unknown): Compilation {
  return fake as Compilation
}

export function asLoaderContext<Options = Record<string, unknown>>(
  fake: unknown
): LoaderContext<Options> {
  return fake as LoaderContext<Options>
}

// A tap callback as a fake hook receives it from the step under test.
export type TapCallback = (...args: unknown[]) => unknown
