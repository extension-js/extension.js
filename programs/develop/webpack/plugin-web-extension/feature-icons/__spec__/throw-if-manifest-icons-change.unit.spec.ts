import {describe, it, expect, vi} from 'vitest'

let mockIcons: string[] = []
vi.mock('node:module', () => ({
  createRequire: () => (_: any) => ({
    getManifestFieldsData: (_opts: any) => ({
      icons: mockIcons.reduce(
        (acc, v, idx) => ({...acc, [String(idx)]: v}),
        {}
      ),
      html: {},
      scripts: {}
    })
  })
}))

import {ThrowIfManifestIconsChange} from '../steps/throw-if-manifest-icons-change'

function makeCompiler(modified: string[], errorsArr: any[]) {
  let watchRunHandler: any
  let thisCompilationHandler: any
  const hooks: any = {
    watchRun: {
      tapAsync: (_name: string, fn: any) => {
        watchRunHandler = fn
      }
    },
    thisCompilation: {
      tap: (_name: string, cb: any) => {
        thisCompilationHandler = cb
      }
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
        hooks: {
          processAssets: {tap: (_opts: any, runner: any) => runner()}
        }
      }
      thisCompilationHandler(compilation)
    }
  }
  return compiler
}

describe('ThrowIfManifestIconsChange', () => {
  it('emits error when manifest icons change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockIcons = ['/a.png']

    const plugin = new ThrowIfManifestIconsChange({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockIcons = ['/b.png']

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })
})
