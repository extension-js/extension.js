import {describe, it, expect, vi} from 'vitest'

let mockJson: Record<string, string | string[]> = {}
vi.mock('node:module', () => ({
  createRequire: () => (_: any) => ({
    getManifestFieldsData: (_opts: any) => ({
      json: mockJson,
      html: {},
      scripts: {},
      icons: {}
    })
  })
}))

import {ThrowIfManifestJsonChange} from '../steps/throw-if-manifest-json-change'

function makeCompiler(modified: string[], errorsArr: any[]) {
  let watchRunHandler: any
  let thisCompilationHandler: any
  const hooks: any = {
    watchRun: {tapAsync: (_: string, fn: any) => (watchRunHandler = fn)},
    thisCompilation: {
      tap: (_: string, cb: any) => (thisCompilationHandler = cb)
    }
  }
  const compiler: any = {
    modifiedFiles: new Set(modified),
    hooks,
    _triggerWatchRun() {
      return new Promise<void>((resolve) =>
        watchRunHandler(compiler, () => resolve())
      )
    },
    _triggerThisCompilation() {
      const compilation: any = {
        errors: errorsArr,
        hooks: {processAssets: {tap: (_opts: any, runner: any) => runner()}}
      }
      thisCompilationHandler(compilation)
    }
  }
  return compiler
}

describe('ThrowIfManifestJsonChange', () => {
  it('emits error when critical JSON entries change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockJson = {'declarative_net_request/ruleset-0': '/a.json'}

    const plugin = new ThrowIfManifestJsonChange({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockJson = {'declarative_net_request/ruleset-0': '/b.json'}

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })
})
