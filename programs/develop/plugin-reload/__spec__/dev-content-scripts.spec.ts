import {describe, expect, it} from 'vitest'
import {getCurrentManifestContent} from '../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {
  buildDevContentScriptMarkerPrelude,
  buildDevContentScriptStubSource,
  contentScriptEntryForAsset,
  DEV_CONTENT_SCRIPT_MARKER_KEY,
  DEV_CONTENT_SCRIPT_REGISTRY_ASSET,
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

// A fake worker: chrome.scripting, chrome.tabs and fetch of the registry.
function worker(opts: {
  registry?: unknown
  registered?: Array<{id: string}>
  tabs?: Array<{id: number; url: string; status?: string}>
  excludedTabs?: Array<{id: number; url: string}>
  markers?: Record<string, Record<string, string>>
}) {
  const calls: Record<string, unknown[]> = {
    register: [],
    update: [],
    unregister: [],
    execute: [],
    insertCSS: [],
    reload: []
  }
  const markers = opts.markers || {}
  let listener: ((msg: unknown, sender: unknown) => void) | undefined
  const chrome: any = {
    runtime: {
      getURL: (p: string) => `chrome-extension://abc/${p}`,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn
        }
      }
    },
    scripting: {
      getRegisteredContentScripts: (cb: (s: unknown[]) => void) =>
        cb(opts.registered || []),
      registerContentScripts: (s: unknown[], cb?: () => void) => {
        calls.register.push(...s)
        cb?.()
      },
      updateContentScripts: (s: unknown[], cb?: () => void) => {
        calls.update.push(...s)
        cb?.()
      },
      unregisterContentScripts: (f: unknown, cb?: () => void) => {
        calls.unregister.push(f)
        cb?.()
      },
      insertCSS: (o: unknown, cb?: () => void) => {
        calls.insertCSS.push(o)
        cb?.()
      },
      executeScript: (o: any, cb?: (r: unknown[]) => void) => {
        calls.execute.push(o)
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

  // The probe reads globalThis[MARKER] in the injected frame; the fake looks
  // the marker up per frame id instead, through the same function body.
  const probeWorld = (frameId: number) => markers[String(frameId)] || {}
  chrome.scripting.executeScript = (
    (original) => (o: any, cb?: (r: unknown[]) => void) => {
      if (typeof o.func === 'function') {
        const frames: number[] = o.target.frameIds || [0]
        cb?.(
          frames.map((frameId) => {
            const scope = {[DEV_CONTENT_SCRIPT_MARKER_KEY]: probeWorld(frameId)}
            const fn = new Function(
              'globalThis',
              `return (${o.func.toString()}).apply(null, arguments[1])`
            )

            return {frameId, result: fn(scope, o.args)}
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
    stub: (entry: string, tabId: number, frameId = 0) =>
      listener?.({__extjsDevCsStub: {entry}}, {tab: {id: tabId}, frameId}),
    hooks: () => g.__extjsDevContentScripts,
    settle: () => new Promise((r) => setTimeout(r, 20))
  }
}

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
