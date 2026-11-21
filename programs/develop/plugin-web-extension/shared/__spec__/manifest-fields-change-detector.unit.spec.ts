import {afterEach, describe, expect, it, vi} from 'vitest'
import {asCompiler, type TapCallback} from '../../__spec__/helpers/rspack-fakes'

let mockFields: Record<string, Record<string, unknown>> = {
  scripts: {},
  html: {},
  icons: {},
  json: {}
}

vi.mock('browser-extension-manifest-fields', () => ({
  getManifestFieldsData: () => mockFields
}))

vi.mock('../../feature-scripts/steps/add-content-script-wrapper', () => ({
  AddContentScriptWrapper: {
    getBridgeScripts: () => ({})
  }
}))

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../../../dev-server/session-restart'
import {answerSessionRestarts} from '../../../lib/session-restart-signal'
import {ManifestFieldsChangeDetector} from '../manifest-fields-change-detector'

afterEach(() => {
  unbindDevSessionRestart()
})

function makeCompiler(modified: string[], errorsArr: Error[]) {
  let watchRunHandler: TapCallback | undefined
  let thisCompilationHandler: TapCallback | undefined
  const hooks = {
    watchRun: {
      tapAsync: (_name: string, fn: TapCallback) => {
        watchRunHandler = fn
      }
    },
    thisCompilation: {
      tap: (_name: string, cb: TapCallback) => {
        thisCompilationHandler = cb
      }
    }
  }
  const compiler = {
    modifiedFiles: new Set(modified),
    options: {mode: 'development'},
    hooks,
    _triggerWatchRun() {
      return new Promise<void>((resolve) =>
        (watchRunHandler as TapCallback)(compiler, () => resolve())
      )
    },
    _triggerThisCompilation() {
      const compilation = {
        errors: errorsArr,
        hooks: {
          processAssets: {
            tap: (_opts: unknown, runner: TapCallback) => runner()
          }
        }
      }
      ;(thisCompilationHandler as TapCallback)(compilation)
    }
  }

  return compiler
}

describe('the session restart signal', () => {
  it('is the only way the detector reaches a session', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'manifest-fields-change-detector.ts'),
      'utf8'
    )

    expect(source).not.toMatch(/dev-server|plugin-reload|plugin-browsers/)
    expect(source).toContain("from '../../lib/session-restart-signal'")
  })

  it('hands whoever answers the change and takes its answer', async () => {
    for (const carried of [true, false]) {
      const errors: Error[] = []
      const compiler = makeCompiler(['/root/manifest.json'], errors)
      const heard: unknown[] = []

      const before = answerSessionRestarts({
        request: (_compiler, change) => {
          heard.push(change)

          return carried
        },
        isRestarting: () => false
      })

      mockFields = {scripts: {bg: '/a.js'}, html: {}, icons: {}, json: {}}
      new ManifestFieldsChangeDetector({
        manifestPath: '/root/manifest.json',
        browser: 'chrome'
      } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0]).apply(
        asCompiler(compiler)
      )

      await compiler._triggerWatchRun()
      mockFields = {
        scripts: {bg: '/a.js', extra: '/b.js'},
        html: {},
        icons: {},
        json: {}
      }

      await compiler._triggerWatchRun()
      compiler._triggerThisCompilation()

      expect(heard).toEqual([
        expect.objectContaining({reason: 'scripts', pathAfter: '/b.js'})
      ])

      expect(errors).toHaveLength(carried ? 0 : 1)
      answerSessionRestarts(before)
    }
  })
})

describe('ManifestFieldsChangeDetector', () => {
  it('emits error when scripts change', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {bg: '/a.js'}, html: {}, icons: {}, json: {}}

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
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
    const errors: Error[] = []
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
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
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
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {}, html: {}, icons: {0: '/a.png'}, json: {}}

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
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
    const errors: Error[] = []
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
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
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
    const errors: Error[] = []
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
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
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
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {bg: '/a.js'}, html: {}, icons: {}, json: {}}

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(0)
  })

  it('does not register hooks in production mode', () => {
    let registered = false
    const compiler = asCompiler({
      options: {mode: 'production'},
      hooks: {
        watchRun: {
          tapAsync: () => {
            registered = true
          }
        },
        thisCompilation: {tap: () => {}}
      }
    })

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(compiler)
    expect(registered).toBe(false)
  })

  it('treats real-shape icons (Record<string, string[]>) as a flat list', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    const realShape = {
      icons: ['/a/16.png', '/a/32.png', '/a/48.png', '/a/64.png', '/a/128.png'],
      action: ['/a/16.png', '/a/32.png', '/a/48.png', '/a/64.png', '/a/128.png']
    }
    mockFields = {scripts: {}, html: {}, icons: realShape, json: {}}

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {},
      html: {},
      icons: {
        icons: [
          '/a/16.png',
          '/a/32.png',
          '/a/48.png',
          '/a/64.png',
          '/a/128.png'
        ],
        action: [
          '/a/16.png',
          '/a/32.png',
          '/a/48.png',
          '/a/64.png',
          '/a/128.png'
        ]
      },
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(0)
  })

  it('reports a single icon path (not a comma-joined dump) when icons actually change', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {},
      html: {},
      icons: {icons: ['/a/16.png', '/a/32.png']},
      json: {}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {},
      html: {},
      icons: {icons: ['/b/16.png', '/a/32.png']},
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    const message = String(errors[0].message || errors[0])
    expect(message).toContain('Entrypoint references changed')
    expect(message).not.toMatch(/PATH BEFORE\b[^\n]*,[^\n]*/)
  })

  it('does not misfire on theme_icons, whose entries are fresh objects per read', async () => {
    // browser-extension-manifest-fields rebuilds {light, dark} objects on
    // every call, so identity comparison flagged a change on each re-read.
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    const themeIconsFields = () => ({
      scripts: {},
      html: {},
      icons: {
        'browser_action/theme_icons': [
          {light: '/icons/light-16.png', dark: '/icons/dark-16.png'},
          {light: '/icons/light-32.png', dark: '/icons/dark-32.png'}
        ]
      },
      json: {}
    })
    mockFields = themeIconsFields()

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'firefox'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = themeIconsFields()
    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(0)
  })

  it('still reports a genuine theme_icons change', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {},
      html: {},
      icons: {
        'browser_action/theme_icons': [
          {light: '/icons/light-16.png', dark: '/icons/dark-16.png'}
        ]
      },
      json: {}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'firefox'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {},
      html: {},
      icons: {
        'browser_action/theme_icons': [
          {light: '/icons/other-16.png', dark: '/icons/dark-16.png'}
        ]
      },
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(1)
    expect(String(errors[0].message || errors[0])).toContain(
      'Entrypoint references changed'
    )
  })

  it('emits multiple category errors when multiple fields change', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {bg: '/a.js'},
      html: {popup: '/popup.html'},
      icons: {0: '/icon.png'},
      json: {}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])

    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {bg: '/b.js'},
      html: {popup: '/new-popup.html'},
      icons: {0: '/new-icon.png'},
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors.length).toBe(3)
  })

  it('asks a live session to restart instead of failing on a new script entry', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {bg: '/a.js'}, html: {}, icons: {}, json: {}}
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])
    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {bg: '/a.js', extra: '/content-2.js'},
      html: {},
      icons: {},
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()
    await new Promise((r) => setTimeout(r, 0))

    expect(errors).toHaveLength(0)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({reason: 'scripts', pathAfter: '/content-2.js'})
    )
  })

  it('restarts when a script keeps its path and moves to another entry', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {'background/scripts': ['/bg.js']},
      html: {},
      icons: {},
      json: {}
    }

    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])
    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {'background/service_worker': '/bg.js'},
      html: {},
      icons: {},
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()
    await new Promise((r) => setTimeout(r, 0))

    expect(errors).toHaveLength(0)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'scripts',
        pathChanged: '/bg.js',
        manifestFieldBefore: 'background.scripts',
        manifestField: 'background.service_worker'
      })
    )
  })

  it('names both manifest fields when no live session can restart for a moved script', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {
      scripts: {'content_scripts/content-0': ['/a.js', '/b.js']},
      html: {},
      icons: {},
      json: {}
    }

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])
    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {
        'content_scripts/content-0': ['/a.js'],
        'content_scripts/content-1': ['/b.js']
      },
      html: {},
      icons: {},
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()

    expect(errors).toHaveLength(1)
    expect(String(errors[0].message)).toContain('content_scripts[0].js')
    expect(String(errors[0].message)).toContain('content_scripts[1].js')
  })

  it('carries a new manifest icon through a restart instead of an error', async () => {
    const errors: Error[] = []
    const compiler = makeCompiler(['/root/manifest.json'], errors)
    mockFields = {scripts: {}, html: {}, icons: {}, json: {}}
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    const plugin = new ManifestFieldsChangeDetector({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as ConstructorParameters<typeof ManifestFieldsChangeDetector>[0])
    plugin.apply(asCompiler(compiler))
    await compiler._triggerWatchRun()

    mockFields = {
      scripts: {},
      html: {},
      icons: {action: ['/icons/toolbar.png']},
      json: {}
    }

    await compiler._triggerWatchRun()
    compiler._triggerThisCompilation()
    await new Promise((r) => setTimeout(r, 0))

    expect(errors).toHaveLength(0)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'icons',
        pathAfter: '/icons/toolbar.png'
      })
    )
  })
})
