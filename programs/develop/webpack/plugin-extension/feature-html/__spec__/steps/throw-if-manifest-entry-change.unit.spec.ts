import {describe, it, expect, vi} from 'vitest'
let mockHtml: string[] = []
vi.mock('browser-extension-manifest-fields', () => ({
  getManifestFieldsData: (_opts: any) => ({
    html: mockHtml.reduce((acc, v, idx) => ({...acc, [String(idx)]: v}), {}),
    scripts: {}
  })
}))

import {ThrowIfManifestEntryChange} from '../../steps/throw-if-manifest-entry-change'

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
          processAssets: {
            tap: (_opts: any, runner: any) => runner()
          }
        }
      }
      thisCompilationHandler(compilation)
    }
  }
  return compiler
}

describe('ThrowIfManifestEntryChange', () => {
  it('emits single error when manifest HTML entries change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockHtml = ['/a.html']

    const plugin = new ThrowIfManifestEntryChange({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    // Initialize snapshot on apply and simulate first watchRun
    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    // Change set for next watch run
    mockHtml = ['/b.html']

    // Simulate second watchRun and compilation cycle
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })
})

