import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {getCurrentManifestContent} from '../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {
  buildDevContentScriptMarkerPrelude,
  buildDevContentScriptStubSource,
  contentScriptEntryForAsset,
  DEV_CONTENT_SCRIPT_MARKER_KEY,
  DEV_CONTENT_SCRIPT_REGISTRY_ASSET,
  DEV_CONTENT_SCRIPT_STATIC_BUNDLES_KEY,
  DEV_CONTENT_SCRIPT_STATIC_RELOAD_KEY,
  DEV_CONTENT_SCRIPTS_RUNTIME_SOURCE,
  planDevContentScripts
} from '../reload-lib/dev-content-scripts'
import {SetupDevContentScripts} from '../steps/setup-dev-content-scripts'

describe('planDevContentScripts', () => {
  const manifest = (content_scripts: unknown, manifest_version = 3) =>
    ({manifest_version, name: 'x', version: '1', content_scripts}) as any

  it('replaces each compiled entry with a signalling stub and records the real files in the registry', () => {
    const plan = planDevContentScripts(
      manifest([
        {
          matches: ['https://a.test/*'],
          exclude_matches: ['https://a.test/skip*'],
          js: ['content_scripts/content-0.abcdef12.js'],
          css: ['content_scripts/content-0.abcdef12.css'],
          run_at: 'document_start',
          all_frames: true,
          world: 'MAIN',
          match_origin_as_fallback: true
        }
      ])
    )

    expect(plan).toBeDefined()
    expect(plan!.manifest.content_scripts).toEqual([
      {
        matches: ['https://a.test/*'],
        exclude_matches: ['https://a.test/skip*'],
        js: ['content_scripts/dev-stub-0.js'],
        run_at: 'document_start',
        all_frames: true,
        match_origin_as_fallback: true
      }
    ])

    expect(plan!.registry).toEqual({
      version: 1,
      entries: [
        {
          id: 'extjs-dev-cs-0',
          entry: 'content_scripts/content-0',
          matches: ['https://a.test/*'],
          excludeMatches: ['https://a.test/skip*'],
          js: ['content_scripts/content-0.abcdef12.js'],
          css: ['content_scripts/content-0.abcdef12.css'],
          runAt: 'document_start',
          allFrames: true,
          world: 'MAIN',
          matchOriginAsFallback: true,
          stubOnly: false
        }
      ]
    })

    expect(Object.keys(plan!.stubs)).toEqual(['content_scripts/dev-stub-0.js'])
    expect(plan!.stubs['content_scripts/dev-stub-0.js']).toBe(
      buildDevContentScriptStubSource('content_scripts/content-0')
    )
  })

  it('reads the canonical index from the file, not the array position, and marks glob entries stub-only', () => {
    const plan = planDevContentScripts(
      manifest([
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-3.js'],
          include_globs: ['*docs*']
        },
        {matches: ['<all_urls>'], js: ['vendor/untouched.js']}
      ])
    )

    expect(plan!.registry.entries).toHaveLength(1)
    expect(plan!.registry.entries[0]).toMatchObject({
      id: 'extjs-dev-cs-3',
      entry: 'content_scripts/content-3',
      stubOnly: true
    })

    expect(plan!.manifest.content_scripts).toEqual([
      {
        matches: ['<all_urls>'],
        js: ['content_scripts/dev-stub-3.js'],
        include_globs: ['*docs*']
      },
      {matches: ['<all_urls>'], js: ['vendor/untouched.js']}
    ])
  })

  it('gives a CSS-only group a marker script that stands in for its bundle', () => {
    const plan = planDevContentScripts(
      manifest([
        {
          matches: ['https://a.test/*'],
          css: ['content_scripts/content-2.aaaaaaaa.css']
        }
      ])
    )!

    expect(plan.manifest.content_scripts).toEqual([
      {matches: ['https://a.test/*'], js: ['content_scripts/dev-stub-2.js']}
    ])

    expect(plan.registry.entries[0]).toMatchObject({
      id: 'extjs-dev-cs-2',
      entry: 'content_scripts/content-2',
      js: ['content_scripts/dev-css-2.js'],
      css: ['content_scripts/content-2.aaaaaaaa.css'],
      stubOnly: false
    })

    expect(Object.keys(plan.stubs).sort()).toEqual([
      'content_scripts/dev-css-2.js',
      'content_scripts/dev-stub-2.js'
    ])

    const world: any = {}
    new Function('globalThis', plan.stubs['content_scripts/dev-css-2.js'])(
      world
    )

    expect(world[DEV_CONTENT_SCRIPT_MARKER_KEY]).toEqual({
      'content_scripts/content-2': 'content_scripts/dev-css-2.js'
    })
  })

  it('keeps a document_start isolated group as emitted and marks it static in the registry', () => {
    const group = {
      matches: ['https://a.test/*'],
      exclude_matches: ['https://a.test/skip*'],
      js: ['content_scripts/content-0.abcdef12.js'],
      css: ['content_scripts/content-0.abcdef12.css'],
      run_at: 'document_start',
      all_frames: true
    }
    const plan = planDevContentScripts(manifest([group]))!

    expect(plan.manifest.content_scripts).toEqual([group])
    expect(plan.stubs).toEqual({})
    expect(plan.registry.entries).toEqual([
      {
        id: 'extjs-dev-cs-0',
        entry: 'content_scripts/content-0',
        matches: ['https://a.test/*'],
        excludeMatches: ['https://a.test/skip*'],
        js: ['content_scripts/content-0.abcdef12.js'],
        css: ['content_scripts/content-0.abcdef12.css'],
        runAt: 'document_start',
        allFrames: true,
        world: 'ISOLATED',
        stubOnly: false,
        static: true
      }
    ])
  })

  it('still stubs a document_start MAIN group and a document_idle isolated group', () => {
    const plan = planDevContentScripts(
      manifest([
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-0.abcdef12.js'],
          run_at: 'document_start',
          world: 'MAIN'
        },
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-1.abcdef12.js'],
          run_at: 'document_idle'
        },
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-2.abcdef12.js']
        }
      ])
    )!

    expect(
      (plan.manifest.content_scripts as Array<{js: string[]}>).map((g) => g.js)
    ).toEqual([
      ['content_scripts/dev-stub-0.js'],
      ['content_scripts/dev-stub-1.js'],
      ['content_scripts/dev-stub-2.js']
    ])

    expect(
      plan.registry.entries.map((e) => [e.world, e.runAt, e.static])
    ).toEqual([
      ['MAIN', 'document_start', undefined],
      ['ISOLATED', 'document_idle', undefined],
      ['ISOLATED', 'document_idle', undefined]
    ])
  })

  it('leaves MV2 manifests and manifests without compiled entries alone', () => {
    expect(
      planDevContentScripts(
        manifest(
          [{matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}],
          2
        )
      )
    ).toBeUndefined()

    expect(planDevContentScripts(manifest(undefined))).toBeUndefined()
    expect(
      planDevContentScripts(manifest([{matches: ['<all_urls>'], js: ['x.js']}]))
    ).toBeUndefined()
  })

  it('names the entry of an emitted bundle, hashed or plain, and nothing else', () => {
    expect(
      contentScriptEntryForAsset('content_scripts/content-2.1a2b3c4d.js')
    ).toBe('content_scripts/content-2')

    expect(contentScriptEntryForAsset('content_scripts/content-2.js')).toBe(
      'content_scripts/content-2'
    )

    expect(
      contentScriptEntryForAsset('content_scripts/dev-stub-2.js')
    ).toBeUndefined()

    expect(
      contentScriptEntryForAsset('content_scripts/content-2.css')
    ).toBeUndefined()

    expect(
      contentScriptEntryForAsset('content_scripts/content-2.1a2b3c4d.js.map')
    ).toBeUndefined()
  })

  it('the marker prelude and the stub are plain scripts that set and send what the worker reads', () => {
    const world: any = {}
    new Function(
      'globalThis',
      buildDevContentScriptMarkerPrelude(
        'content_scripts/content-0',
        'content_scripts/content-0.abc.js'
      )
    )(world)

    expect(world[DEV_CONTENT_SCRIPT_MARKER_KEY]).toEqual({
      'content_scripts/content-0': 'content_scripts/content-0.abc.js'
    })

    const sent: unknown[] = []
    const page: any = {
      chrome: {runtime: {sendMessage: (msg: unknown) => sent.push(msg)}}
    }
    new Function(
      'globalThis',
      buildDevContentScriptStubSource('content_scripts/content-0')
    )(page)

    expect(sent).toEqual([
      {__extjsDevCsStub: {entry: 'content_scripts/content-0'}}
    ])
  })
})

type Registration = Record<string, unknown> & {id: string}

function worker(opts: {
  registry?: unknown
  registered?: Registration[]
  tabs?: Array<{id: number; url: string; status?: string}>
  excludedTabs?: Array<{id: number; url: string}>
  markers?: Record<string, Record<string, string>>
  worlds?: Record<string, any>
  assets?: Record<string, string>
  storage?: Record<string, unknown>
}) {
  const calls: Record<string, unknown[]> = {
    register: [],
    update: [],
    unregister: [],
    execute: [],
    insertCSS: [],
    reload: [],
    runtimeReload: []
  }
  const storage: Record<string, unknown> = opts.storage || {}
  const registrations: Registration[] = (opts.registered || []).map((r) => ({
    ...r
  }))
  const worlds: Record<string, any> = opts.worlds || {}

  for (const [frameId, marker] of Object.entries(opts.markers || {})) {
    worlds[frameId] = {[DEV_CONTENT_SCRIPT_MARKER_KEY]: {...marker}}
  }

  const worldOf = (frameId: number) => {
    worlds[String(frameId)] = worlds[String(frameId)] || {}

    return worlds[String(frameId)]
  }

  let listener: ((msg: unknown, sender: unknown) => void) | undefined
  const chrome: any = {
    runtime: {
      getURL: (p: string) => `chrome-extension://abc/${p}`,
      reload: () => {
        calls.runtimeReload.push(Date.now())
      },
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn
        }
      }
    },
    storage: {
      local: {
        get: (
          keys: string | string[],
          cb: (r: Record<string, unknown>) => void
        ) =>
          cb(
            Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys]).map((key) => [
                key,
                storage[key]
              ])
            )
          ),
        set: (items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(storage, items)
          cb?.()
        },
        remove: (key: string, cb?: () => void) => {
          delete storage[key]
          cb?.()
        }
      }
    },
    scripting: {
      getRegisteredContentScripts: (cb: (s: unknown[]) => void) =>
        cb(registrations.map((r) => ({...r}))),
      registerContentScripts: (s: Registration[], cb?: () => void) => {
        calls.register.push(...s)
        registrations.push(...s.map((r) => ({...r})))
        cb?.()
      },
      updateContentScripts: (s: Registration[], cb?: () => void) => {
        calls.update.push(...s)

        for (const patch of s) {
          const current = registrations.find((r) => r.id === patch.id)
          if (current) Object.assign(current, patch)
        }

        cb?.()
      },
      unregisterContentScripts: (f: {ids: string[]}, cb?: () => void) => {
        calls.unregister.push(f)

        for (const id of f.ids) {
          const at = registrations.findIndex((r) => r.id === id)
          if (at >= 0) registrations.splice(at, 1)
        }

        cb?.()
      },
      insertCSS: (o: unknown, cb?: () => void) => {
        calls.insertCSS.push(o)
        cb?.()
      },
      executeScript: (o: any, cb?: (r: unknown[]) => void) => {
        calls.execute.push(o)

        for (const frameId of o.target.frameIds || [0]) {
          for (const file of o.files || []) {
            const text = opts.assets?.[file]
            if (text) new Function('globalThis', text)(worldOf(frameId))
          }
        }

        cb?.([])
      }
    },
    tabs: {
      query: (q: {url?: string[]}, cb: (t: unknown[]) => void) => {
        const urls = q.url || []
        const excluded = opts.excludedTabs || []

        if (excluded.length && urls.some((u) => u.includes('skip'))) {
          cb(excluded)
        } else {
          cb(opts.tabs || [])
        }
      },
      reload: (id: number, _p: unknown, cb?: () => void) => {
        calls.reload.push(id)
        cb?.()
      }
    }
  }

  chrome.scripting.executeScript = (
    (original) => (o: any, cb?: (r: unknown[]) => void) => {
      if (typeof o.func === 'function') {
        const frames: number[] = o.target.frameIds || [0]
        cb?.(
          frames.map((frameId) => {
            const fn = new Function(
              'globalThis',
              `return (${o.func.toString()}).apply(null, arguments[1])`
            )

            return {frameId, result: fn(worldOf(frameId), o.args)}
          })
        )

        return
      }

      original(o, cb)
    }
  )(chrome.scripting.executeScript)

  const g: any = {
    chrome,
    fetch: (url: string) =>
      Promise.resolve({
        ok:
          url.endsWith(DEV_CONTENT_SCRIPT_REGISTRY_ASSET) &&
          opts.registry !== undefined,
        json: () => Promise.resolve(opts.registry)
      })
  }
  new Function('globalThis', DEV_CONTENT_SCRIPTS_RUNTIME_SOURCE)(g)

  return {
    g,
    calls,
    registrations,
    worlds,
    storage,
    stub: (entry: string, tabId: number, frameId = 0) =>
      listener?.({__extjsDevCsStub: {entry}}, {tab: {id: tabId}, frameId}),
    hooks: () => g.__extjsDevContentScripts,
    settle: () => new Promise((r) => setTimeout(r, 20))
  }
}

const fileInjections = (calls: Record<string, unknown[]>) =>
  calls.execute.filter((o: any) => Array.isArray(o.files))

const registry = {
  version: 1,
  entries: [
    {
      id: 'extjs-dev-cs-0',
      entry: 'content_scripts/content-0',
      matches: ['https://a.test/*'],
      excludeMatches: ['https://a.test/skip*'],
      js: ['content_scripts/content-0.NEW.js'],
      css: ['content_scripts/content-0.NEW.css'],
      runAt: 'document_idle',
      allFrames: false,
      world: 'ISOLATED',
      stubOnly: false
    }
  ]
}

const withStatic = {
  version: 1,
  entries: [
    {...registry.entries[0], excludeMatches: []},
    {
      id: 'extjs-dev-cs-1',
      entry: 'content_scripts/content-1',
      matches: ['https://a.test/*'],
      js: ['content_scripts/content-1.NEW.js'],
      css: [],
      runAt: 'document_start',
      allFrames: false,
      world: 'ISOLATED',
      stubOnly: false,
      static: true
    }
  ]
}

describe('dev content scripts runtime', () => {
  it('registers the registry at boot without session persistence and drops dev registrations it no longer names', async () => {
    const w = worker({
      registry,
      registered: [{id: 'extjs-dev-cs-7'}, {id: 'user-owned'}]
    })
    await w.settle()

    expect(w.calls.register).toEqual([
      {
        id: 'extjs-dev-cs-0',
        matches: ['https://a.test/*'],
        excludeMatches: ['https://a.test/skip*'],
        js: ['content_scripts/content-0.NEW.js'],
        css: ['content_scripts/content-0.NEW.css'],
        runAt: 'document_idle',
        allFrames: false,
        world: 'ISOLATED',
        matchOriginAsFallback: false,
        persistAcrossSessions: false
      }
    ])

    expect(w.calls.unregister).toEqual([{ids: ['extjs-dev-cs-7']}])
    expect(w.calls.update).toEqual([])
    expect(w.hooks().isReady()).toBe(true)
  })

  it('updates an entry that is already registered instead of registering it twice', async () => {
    const w = worker({registry, registered: [{id: 'extjs-dev-cs-0'}]})
    await w.settle()
    expect(w.calls.register).toEqual([])
    expect(w.calls.update).toHaveLength(1)
  })

  it('a registration that lost exclude_matches, css or the origin fallback sheds them through the partial update', async () => {
    const wide = worker({
      registry: {
        ...registry,
        entries: [{...registry.entries[0], matchOriginAsFallback: true}]
      }
    })
    await wide.settle()
    expect(wide.registrations[0]).toMatchObject({
      excludeMatches: ['https://a.test/skip*'],
      css: ['content_scripts/content-0.NEW.css'],
      matchOriginAsFallback: true
    })

    const shrunk = worker({
      registry: {
        version: 1,
        entries: [
          {
            id: 'extjs-dev-cs-0',
            entry: 'content_scripts/content-0',
            matches: ['https://a.test/*'],
            js: ['content_scripts/content-0.NEWER.js'],
            css: [],
            runAt: 'document_idle',
            allFrames: false,
            world: 'ISOLATED',
            stubOnly: false
          }
        ]
      },
      registered: wide.registrations
    })
    await shrunk.settle()

    expect(shrunk.calls.register).toEqual([])
    expect(shrunk.calls.update).toHaveLength(1)
    expect(shrunk.registrations).toEqual([
      {
        id: 'extjs-dev-cs-0',
        matches: ['https://a.test/*'],
        excludeMatches: [],
        js: ['content_scripts/content-0.NEWER.js'],
        css: [],
        runAt: 'document_idle',
        allFrames: false,
        world: 'ISOLATED',
        matchOriginAsFallback: false,
        persistAcrossSessions: false
      }
    ])
  })

  it('a stub signal injects the current file into that frame only when its world does not run it yet', async () => {
    const w = worker({
      registry,
      markers: {
        '2': {'content_scripts/content-0': 'content_scripts/content-0.NEW.js'}
      }
    })
    await w.settle()

    w.stub('content_scripts/content-0', 5, 2)
    await w.settle()
    expect(w.calls.execute).toEqual([])

    w.stub('content_scripts/content-0', 5, 0)
    await w.settle()
    expect(w.calls.insertCSS).toEqual([
      {
        target: {tabId: 5, frameIds: [0]},
        files: ['content_scripts/content-0.NEW.css']
      }
    ])

    expect(w.calls.execute).toEqual([
      {
        target: {tabId: 5, frameIds: [0]},
        files: ['content_scripts/content-0.NEW.js'],
        world: 'ISOLATED',
        injectImmediately: true
      }
    ])
  })

  it('a stub signal that arrives before registration finished is served once the registry is ready', async () => {
    let release: (() => void) | undefined
    const w = worker({registry})

    // Stall the boot registration by replacing the API before the fetch lands.
    w.g.chrome.scripting.registerContentScripts = (
      _s: unknown,
      cb: () => void
    ) => {
      release = cb
    }

    w.stub('content_scripts/content-0', 9)
    await w.settle()
    expect(w.calls.execute).toEqual([])
    release!()
    await w.settle()
    expect(w.calls.execute).toHaveLength(1)
    expect((w.calls.execute[0] as any).target).toEqual({
      tabId: 9,
      frameIds: [0]
    })
  })

  it('heal reaches the complete tabs an entry matches, honors exclude_matches, and skips a frame already on the current file', async () => {
    const w = worker({
      registry,
      tabs: [
        {id: 1, url: 'https://a.test/one', status: 'complete'},
        {id: 2, url: 'https://a.test/loading', status: 'loading'},
        {id: 3, url: 'https://a.test/skip/me', status: 'complete'},
        {id: 4, url: 'chrome://extensions', status: 'complete'}
      ],
      excludedTabs: [{id: 3, url: 'https://a.test/skip/me'}]
    })
    await w.settle()

    let healed = false
    w.hooks().heal(() => {
      healed = true
    })

    await w.settle()
    expect(healed).toBe(true)
    expect(w.calls.execute.map((o: any) => o.target)).toEqual([
      {tabId: 1, frameIds: [0]}
    ])
  })

  it('heal re-injects a frame that runs the same file for a previous extension generation, and only once per generation', async () => {
    const worlds: Record<string, any> = {}
    const tabs = [{id: 1, url: 'https://a.test/one', status: 'complete'}]
    const excludedTabs = [{id: 3, url: 'https://a.test/skip/me'}]
    const first = worker({
      registry,
      tabs,
      excludedTabs,
      worlds,
      markers: {
        '0': {'content_scripts/content-0': 'content_scripts/content-0.NEW.js'}
      }
    })
    await first.settle()

    first.hooks().heal()
    await first.settle()
    expect(fileInjections(first.calls)).toHaveLength(1)
    expect(first.calls.insertCSS).toHaveLength(1)

    first.hooks().heal()
    await first.settle()
    expect(fileInjections(first.calls)).toHaveLength(1)
    expect(first.calls.insertCSS).toHaveLength(1)

    const second = worker({registry, tabs, excludedTabs, worlds})
    await second.settle()
    second.hooks().heal()
    await second.settle()
    expect(fileInjections(second.calls)).toHaveLength(1)
    expect(second.calls.insertCSS).toHaveLength(1)
  })

  it('a frame Chromium covered since boot is left alone by its stub signal and by the heal that follows', async () => {
    const worlds: Record<string, any> = {}
    const w = worker({
      registry,
      worlds,
      tabs: [{id: 1, url: 'https://a.test/one', status: 'complete'}],
      excludedTabs: [{id: 3, url: 'https://a.test/skip/me'}],
      markers: {
        '0': {'content_scripts/content-0': 'content_scripts/content-0.NEW.js'}
      }
    })
    await w.settle()

    w.stub('content_scripts/content-0', 1, 0)
    await w.settle()
    expect(fileInjections(w.calls)).toEqual([])

    w.hooks().heal()
    await w.settle()
    expect(fileInjections(w.calls)).toEqual([])
    expect(w.calls.insertCSS).toEqual([])
  })

  it('a CSS-only entry lands its stylesheet once per frame per load and a heal in the same generation adds nothing', async () => {
    const plan = planDevContentScripts({
      manifest_version: 3,
      name: 'x',
      version: '1',
      content_scripts: [
        {
          matches: ['https://a.test/*'],
          css: ['content_scripts/content-0.aaaaaaaa.css']
        }
      ]
    } as any)!
    const w = worker({
      registry: plan.registry,
      assets: plan.stubs,
      tabs: [{id: 5, url: 'https://a.test/one', status: 'complete'}]
    })
    await w.settle()

    expect(w.registrations).toEqual([
      expect.objectContaining({
        id: 'extjs-dev-cs-0',
        js: ['content_scripts/dev-css-0.js'],
        css: ['content_scripts/content-0.aaaaaaaa.css']
      })
    ])

    w.stub('content_scripts/content-0', 5, 0)
    await w.settle()
    expect(w.calls.insertCSS).toEqual([
      {
        target: {tabId: 5, frameIds: [0]},
        files: ['content_scripts/content-0.aaaaaaaa.css']
      }
    ])

    expect(fileInjections(w.calls)).toEqual([
      expect.objectContaining({files: ['content_scripts/dev-css-0.js']})
    ])

    expect(w.worlds['0'][DEV_CONTENT_SCRIPT_MARKER_KEY]).toMatchObject({
      'content_scripts/content-0': 'content_scripts/dev-css-0.js'
    })

    w.stub('content_scripts/content-0', 5, 0)
    await w.settle()
    w.hooks().heal()
    await w.settle()
    expect(w.calls.insertCSS).toHaveLength(1)
    expect(fileInjections(w.calls)).toHaveLength(1)
  })

  it('reload re-reads the registry, re-registers, and reloads each matching tab once', async () => {
    const w = worker({
      registry,
      registered: [{id: 'extjs-dev-cs-0'}],
      tabs: [
        {id: 1, url: 'https://a.test/one'},
        {id: 3, url: 'https://a.test/skip/me'},
        {id: 8, url: 'https://a.test/two'}
      ],
      excludedTabs: [{id: 3, url: 'https://a.test/skip/me'}]
    })
    await w.settle()
    w.calls.update.length = 0

    let handled: boolean | undefined
    w.hooks().reload(['content_scripts/content-0'], (h: boolean) => {
      handled = h
    })

    await w.settle()
    expect(handled).toBe(true)
    expect(w.calls.update).toHaveLength(1)
    expect(w.calls.reload).toEqual([1, 8])
    expect(w.calls.execute).toEqual([])
  })

  it('a static entry is never registered, healed or served on a stub signal', async () => {
    const w = worker({
      registry: withStatic,
      tabs: [{id: 1, url: 'https://a.test/one', status: 'complete'}]
    })
    await w.settle()
    expect(w.calls.register.map((r: any) => r.id)).toEqual(['extjs-dev-cs-0'])

    w.stub('content_scripts/content-1', 1)
    w.hooks().heal()
    await w.settle()
    expect(fileInjections(w.calls).map((o: any) => o.files)).toEqual([
      ['content_scripts/content-0.NEW.js']
    ])
  })

  it('reload of a static entry reloads the extension instead of its tabs, and the next boot reloads those tabs', async () => {
    const w = worker({
      registry: withStatic,
      tabs: [{id: 1, url: 'https://a.test/one'}]
    })
    await w.settle()

    let handled: boolean | undefined
    w.hooks().reload(['content_scripts/content-1'], (h: boolean) => {
      handled = h
    })

    await new Promise((r) => setTimeout(r, 250))

    expect(handled).toBe(true)
    expect(w.calls.reload).toEqual([])
    expect(w.calls.runtimeReload).toHaveLength(1)
    expect(w.storage).toMatchObject({
      __extjsDevPendingReinject: expect.any(Number),
      [DEV_CONTENT_SCRIPT_STATIC_RELOAD_KEY]: {
        entries: ['content_scripts/content-1'],
        at: expect.any(Number)
      }
    })

    const next = worker({
      registry: withStatic,
      tabs: [{id: 1, url: 'https://a.test/one'}],
      storage: {...w.storage}
    })
    await next.settle()
    expect(next.calls.reload).toEqual([1])
    expect(next.calls.runtimeReload).toEqual([])
    expect(next.storage[DEV_CONTENT_SCRIPT_STATIC_RELOAD_KEY]).toBeUndefined()
  })

  it('reload of a stubbed entry beside a static one still reloads its tabs in place', async () => {
    const w = worker({
      registry: withStatic,
      registered: [{id: 'extjs-dev-cs-0'}],
      tabs: [{id: 1, url: 'https://a.test/one'}]
    })
    await w.settle()

    w.hooks().reload(['content_scripts/content-0'], () => {})
    await new Promise((r) => setTimeout(r, 250))

    expect(w.calls.reload).toEqual([1])
    expect(w.calls.runtimeReload).toEqual([])
    expect(w.storage.__extjsDevPendingReinject).toBeUndefined()
    expect(w.storage[DEV_CONTENT_SCRIPT_STATIC_RELOAD_KEY]).toBeUndefined()
  })

  it('a boot records the static bundle names and reloads the tabs of a static entry whose bundle changed', async () => {
    const first = worker({
      registry: withStatic,
      tabs: [{id: 1, url: 'https://a.test/one'}]
    })
    await first.settle()
    expect(first.calls.reload).toEqual([])
    expect(first.storage[DEV_CONTENT_SCRIPT_STATIC_BUNDLES_KEY]).toEqual({
      'content_scripts/content-1': 'content_scripts/content-1.NEW.js'
    })

    const sameBytes = worker({
      registry: withStatic,
      tabs: [{id: 1, url: 'https://a.test/one'}],
      storage: {...first.storage}
    })
    await sameBytes.settle()
    expect(sameBytes.calls.reload).toEqual([])

    const shared = {
      ...withStatic,
      entries: [
        withStatic.entries[0],
        {...withStatic.entries[1], js: ['content_scripts/content-1.SHARED.js']}
      ]
    }
    const next = worker({
      registry: shared,
      tabs: [
        {id: 1, url: 'https://a.test/one'},
        {id: 2, url: 'https://a.test/two'}
      ],
      storage: {...sameBytes.storage}
    })
    await next.settle()
    expect(next.calls.reload).toEqual([1, 2])
    expect(next.calls.runtimeReload).toEqual([])
    expect(next.storage[DEV_CONTENT_SCRIPT_STATIC_BUNDLES_KEY]).toEqual({
      'content_scripts/content-1': 'content_scripts/content-1.SHARED.js'
    })
  })

  it('a boot that both carries the reload flag and sees a new bundle reloads each tab once', async () => {
    const w = worker({
      registry: withStatic,
      tabs: [{id: 1, url: 'https://a.test/one'}],
      storage: {
        [DEV_CONTENT_SCRIPT_STATIC_RELOAD_KEY]: {
          entries: ['content_scripts/content-1'],
          at: Date.now()
        },
        [DEV_CONTENT_SCRIPT_STATIC_BUNDLES_KEY]: {
          'content_scripts/content-1': 'content_scripts/content-1.OLD.js'
        }
      }
    })
    await w.settle()
    expect(w.calls.reload).toEqual([1])
    expect(w.storage[DEV_CONTENT_SCRIPT_STATIC_RELOAD_KEY]).toBeUndefined()
  })

  it('reload of an entry the frame does not name leaves every tab alone', async () => {
    const w = worker({registry, tabs: [{id: 1, url: 'https://a.test/one'}]})
    await w.settle()
    w.hooks().reload(['content_scripts/content-4'], () => {})
    await w.settle()
    expect(w.calls.reload).toEqual([])
  })

  it('without a registry the hooks report unhandled and never touch a tab', async () => {
    const w = worker({tabs: [{id: 1, url: 'https://a.test/one'}]})
    await w.settle()
    let handled: boolean | undefined
    w.hooks().reload(undefined, (h: boolean) => {
      handled = h
    })

    let healed = false
    w.hooks().heal(() => {
      healed = true
    })

    await w.settle()
    expect(handled).toBe(false)
    expect(healed).toBe(true)
    expect(w.calls.register).toEqual([])
    expect(w.calls.reload).toEqual([])
    expect(w.calls.execute).toEqual([])
  })
})

describe('SetupDevContentScripts step', () => {
  function compilation(assets: Record<string, string>) {
    const store = new Map(
      Object.entries(assets).map(([name, text]) => [name, text])
    )
    const taps: Array<() => void> = []
    const asset = (name: string) =>
      store.has(name)
        ? {name, source: {source: () => store.get(name)!}}
        : undefined
    const comp: any = {
      errors: [],
      getAssets: () => [...store.keys()].map((name) => asset(name)!),
      getAsset: (name: string) => asset(name),
      emitAsset: (name: string, source: {source(): string}) => {
        if (store.has(name)) throw new Error(`conflict: ${name}`)

        store.set(name, source.source().toString())
      },
      updateAsset: (name: string, source: {source(): string}) => {
        store.set(name, source.source().toString())
      },
      hooks: {
        processAssets: {tap: (_o: unknown, fn: () => void) => taps.push(fn)}
      }
    }
    const compiler: any = {
      hooks: {
        thisCompilation: {
          tap: (_n: string, fn: (c: unknown) => void) => fn(comp)
        }
      }
    }

    const run = () => {
      for (const fn of taps) fn()
    }

    return {compiler, comp, run, store}
  }

  const manifest = JSON.stringify({
    manifest_version: 3,
    name: 'x',
    version: '1',
    background: {service_worker: 'background/service_worker.js'},
    content_scripts: [
      {matches: ['<all_urls>'], js: ['content_scripts/content-0.abc12345.js']}
    ]
  })

  it('rewrites the manifest, emits the registry and stubs, and prepends the marker and the runtime', () => {
    const c = compilation({
      'manifest.json': manifest,
      'background/service_worker.js': 'sw()',
      'content_scripts/content-0.abc12345.js': 'cs()',
      'content_scripts/content-0.abc12345.js.map': JSON.stringify({
        mappings: 'AAAA'
      })
    })
    new SetupDevContentScripts().apply(c.compiler)
    c.run()

    const written = JSON.parse(c.store.get('manifest.json')!)
    expect(written.content_scripts).toEqual([
      {matches: ['<all_urls>'], js: ['content_scripts/dev-stub-0.js']}
    ])

    // persist-manifest reads the shared slot before the asset.
    expect(getCurrentManifestContent(c.comp)).toBe(c.store.get('manifest.json'))
    const reg = JSON.parse(c.store.get(DEV_CONTENT_SCRIPT_REGISTRY_ASSET)!)
    expect(reg.entries[0].js).toEqual(['content_scripts/content-0.abc12345.js'])
    expect(c.store.get('content_scripts/dev-stub-0.js')).toContain(
      '__extjsDevCsStub'
    )

    expect(c.store.get('content_scripts/content-0.abc12345.js')).toBe(
      `${buildDevContentScriptMarkerPrelude('content_scripts/content-0', 'content_scripts/content-0.abc12345.js')}cs()`
    )

    expect(
      JSON.parse(c.store.get('content_scripts/content-0.abc12345.js.map')!)
        .mappings
    ).toBe(';AAAA')

    expect(
      c.store
        .get('background/service_worker.js')!
        .startsWith(DEV_CONTENT_SCRIPTS_RUNTIME_SOURCE)
    ).toBe(true)

    expect(c.store.get('background/service_worker.js')!.endsWith('sw()')).toBe(
      true
    )

    // A second pass over the same assets changes nothing.
    c.run()
    expect(
      c.store
        .get('content_scripts/content-0.abc12345.js')!
        .match(/__extjsDevContentScripts/g)
    ).toHaveLength(1)

    expect(
      c.store
        .get('background/service_worker.js')!
        .match(/__extjsDevContentScriptsInstalled/g)!.length
    ).toBe(
      DEV_CONTENT_SCRIPTS_RUNTIME_SOURCE.match(
        /__extjsDevContentScriptsInstalled/g
      )!.length
    )
  })

  it('leaves everything static when the build has no background worker', () => {
    const c = compilation({
      'manifest.json': manifest,
      'content_scripts/content-0.abc12345.js': 'cs()'
    })
    new SetupDevContentScripts().apply(c.compiler)
    c.run()
    expect(c.store.get('manifest.json')).toBe(manifest)
    expect(c.store.has(DEV_CONTENT_SCRIPT_REGISTRY_ASSET)).toBe(false)
    expect(c.store.get('content_scripts/content-0.abc12345.js')).toBe('cs()')
  })
})

describe('SetupDevContentScripts after an entry is removed', () => {
  const roots: string[] = []

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  const registryOf = (count: number) =>
    JSON.stringify({
      version: 1,
      entries: Array.from({length: count}, (_, index) => ({
        id: `extjs-dev-cs-${index}`
      }))
    })

  function output(stubsNamedByManifest: number[], files: string[]) {
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-cs-'))
    roots.push(outputPath)
    fs.mkdirSync(path.join(outputPath, 'content_scripts'))
    fs.writeFileSync(
      path.join(outputPath, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'x',
        version: '1',
        content_scripts: stubsNamedByManifest.map((index) => ({
          matches: ['<all_urls>'],
          js: [`content_scripts/dev-stub-${index}.js`]
        }))
      })
    )

    for (const file of files) {
      fs.writeFileSync(
        path.join(outputPath, 'content_scripts', file),
        file === 'dev-registry.json'
          ? registryOf(stubsNamedByManifest.length)
          : 'orphan-stub-token'
      )
    }

    return outputPath
  }

  function finish(outputPath: string, emitted: string[], errors: Error[] = []) {
    const done: Array<(stats: unknown) => void> = []
    const compiler: any = {
      options: {output: {path: outputPath}},
      hooks: {
        thisCompilation: {tap: () => {}},
        done: {
          tap: (_n: string, fn: (stats: unknown) => void) => done.push(fn)
        }
      }
    }
    new SetupDevContentScripts().apply(compiler)

    for (const fn of done) {
      fn({
        compilation: {
          errors,
          getAssets: () =>
            emitted.map((file) => ({name: `content_scripts/${file}`}))
        }
      })
    }
  }

  const filesIn = (outputPath: string) =>
    fs.readdirSync(path.join(outputPath, 'content_scripts')).sort()

  it('holds one stub per registry entry and leaves every other file alone', () => {
    const outputPath = output(
      [0],
      [
        'content-0.abc12345.js',
        'content-1.def67890.css',
        'dev-css-2.js',
        'dev-registry.json',
        'dev-stub-0.js',
        'dev-stub-1.js',
        'dev-stub-2.js',
        'dev-stubborn.js'
      ]
    )

    finish(outputPath, [
      'content-0.abc12345.js',
      'dev-registry.json',
      'dev-stub-0.js'
    ])

    expect(filesIn(outputPath)).toEqual([
      'content-0.abc12345.js',
      'content-1.def67890.css',
      'dev-registry.json',
      'dev-stub-0.js',
      'dev-stubborn.js'
    ])

    const registry = JSON.parse(
      fs.readFileSync(
        path.join(outputPath, DEV_CONTENT_SCRIPT_REGISTRY_ASSET),
        'utf8'
      )
    )
    expect(
      filesIn(outputPath).filter((file) => /^dev-stub-\d+\.js$/.test(file))
    ).toHaveLength(registry.entries.length)
  })

  it('removes every stub and the registry once no entry is left', () => {
    const outputPath = output(
      [],
      ['dev-css-1.js', 'dev-registry.json', 'dev-stub-0.js']
    )

    finish(outputPath, [])

    expect(filesIn(outputPath)).toEqual([])
  })

  it('keeps what a manifest kept on disk still names', () => {
    const outputPath = output(
      [0, 1],
      ['dev-registry.json', 'dev-stub-0.js', 'dev-stub-1.js', 'dev-stub-2.js']
    )

    finish(outputPath, [])

    expect(filesIn(outputPath)).toEqual([
      'dev-registry.json',
      'dev-stub-0.js',
      'dev-stub-1.js'
    ])
  })

  it('leaves the folder alone on a failed compile', () => {
    const files = ['dev-registry.json', 'dev-stub-0.js', 'dev-stub-1.js']
    const outputPath = output([0], files)

    finish(outputPath, [], [new Error('broken')])

    expect(filesIn(outputPath)).toEqual(files)
  })
})
