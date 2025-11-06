import {describe, it, expect, vi} from 'vitest'

let mockScripts: Record<string, string | string[]> = {}
vi.mock('node:module', () => ({
  createRequire: () => (_: any) => ({
    getManifestFieldsData: (_opts: any) => ({
      scripts: mockScripts,
      html: {},
      icons: {},
      json: {}
    })
  })
}))

import {ThrowIfManifestScriptsChange} from '../steps/throw-if-manifest-scripts-change'

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

describe('ThrowIfManifestScriptsChange', () => {
  it('emits error when manifest script entries change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockScripts = {'background/scripts': ['/a.js']}

    const plugin = new ThrowIfManifestScriptsChange({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockScripts = {'background/scripts': ['/b.js']}

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })
})
