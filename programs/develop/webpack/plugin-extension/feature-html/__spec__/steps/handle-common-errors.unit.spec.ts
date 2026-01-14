import {describe, it, expect} from 'vitest'
import {HandleCommonErrors} from '../../steps/handle-common-errors'

function makeCompiler(
  includeList: Record<string, string>,
  errorMessage: string
) {
  const compilation: any = {
    errors: [{message: errorMessage}],
    warnings: [],
    hooks: {afterSeal: {tapPromise: (_: any, fn: any) => fn()}}
  }
  return {
    hooks: {compilation: {tap: (_: any, fn: any) => fn(compilation)}},
    _compilation: compilation
  } as any
}

describe('HandleCommonErrors', () => {
  it("converts can't resolve errors into fileNotFound errors when asset is referenced in HTML", async () => {
    const compiler = makeCompiler(
      {'feature/index': __filename},
      "Module not found: Error: Can't resolve 'missing.js'"
    )
    new HandleCommonErrors({
      manifestPath: __filename,
      includeList: {'feature/index': __filename}
    } as any).apply(compiler as any)
    expect((compiler as any)._compilation.errors[0]).toBeTruthy()
  })
})

