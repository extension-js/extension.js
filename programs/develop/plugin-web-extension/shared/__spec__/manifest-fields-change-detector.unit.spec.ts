import {describe, it, expect, vi} from 'vitest'

let mockFields: any = {scripts: {}, html: {}, icons: {}, json: {}}

vi.mock('browser-extension-manifest-fields', () => ({
  getManifestFieldsData: () => mockFields
}))

vi.mock(
  '../../feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper',
  () => ({
    AddContentScriptWrapper: {
      getBridgeScripts: () => ({})
    }
  })
)

import {ManifestFieldsChangeDetector} from '../manifest-fields-change-detector'

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
    options: {mode: 'development'},
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

describe('ManifestFieldsChangeDetector', () => {
  it('emits error when scripts change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {bg: '/a.js'}, html: {}, icons: {}, json: {}}

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockFields = {scripts: {bg: '/b.js'}, html: {}, icons: {}, json: {}}
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })

  it('emits error when html entries change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {},
      html: {'options_ui/page': '/opts.html'},
      icons: {},
      json: {}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {},
      html: {'options_ui/page': '/new-opts.html'},
      icons: {},
      json: {}
    }
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })

  it('emits error when icons change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {}, html: {}, icons: {0: '/a.png'}, json: {}}

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockFields = {scripts: {}, html: {}, icons: {0: '/b.png'}, json: {}}
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })

  it('emits error when critical JSON entries change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {},
      html: {},
      icons: {},
      json: {'declarative_net_request/ruleset-0': '/a.json'}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {},
      html: {},
      icons: {},
      json: {'declarative_net_request/ruleset-0': '/b.json'}
    }
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })

  it('ignores non-critical JSON keys', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {},
      html: {},
      icons: {},
      json: {'some_other/key': '/a.json'}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {},
      html: {},
      icons: {},
      json: {'some_other/key': '/b.json'}
    }
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(0)
  })

  it('does not emit errors when nothing changes', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {bg: '/a.js'}, html: {}, icons: {}, json: {}}

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(0)
  })

  it('does not register hooks in production mode', () => {
    let registered = false
    const compiler: any = {
      options: {mode: 'production'},
      hooks: {
        watchRun: {
          tapAsync: () => {
            registered = true
          }
        },
        thisCompilation: {tap: () => {}}
      }
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler)
    expect(registered).toBe(false)
  })

  it('emits multiple category errors when multiple fields change', async () => {
    const errors: any[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {bg: '/a.js'},
      html: {'popup': '/popup.html'},
      icons: {0: '/icon.png'},
      json: {}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler as any)
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {bg: '/b.js'},
      html: {'popup': '/new-popup.html'},
      icons: {0: '/new-icon.png'},
      json: {}
    }
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(3)
  })
})
