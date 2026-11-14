import {sources} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildDeclaredSheetSignalSource} from '../../dev-server/control-bridge/producer-runtime'
import {DEV_BUILD_GLOBAL} from '../reload-dispatch'
import {
  InjectBridgeProducer,
  readDevBuild
} from '../steps/inject-bridge-producer'
import {InjectBridgeRelay} from '../steps/inject-bridge-relay'

function makeCompiler() {
  const processAssetsTaps: Array<{cb: () => void; opts: any}> = []
  let compilation: any
  const compiler: any = {
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (c: any) => void) => {
          compilation = {
            getAssets: vi.fn(() => Object.values(compilation.__assets)),
            getAsset: vi.fn((name: string) => compilation.__assets[name]),
            emitAsset: vi.fn((name: string, src: any) => {
              compilation.__assets[name] = {name, source: src}
            }),
            updateAsset: vi.fn((name: string, src: any) => {
              compilation.__assets[name] = {name, source: src}
            }),
            hooks: {
              processAssets: {
                tap: (opts: any, fn: () => void) => {
                  processAssetsTaps.push({opts, cb: fn})
                }
              }
            },
            __assets: {}
          }

          cb(compilation)
        }
      }
    }
  }

  return {
    compiler,
    taps: processAssetsTaps,
    runProcessAssets: () => {
      for (const entry of processAssetsTaps) entry.cb()
    },
    compilation: () => compilation,
    setHash: (hash: string | undefined) => {
      compilation.hash = hash
    },
    setAsset: (name: string, body: string) => {
      compilation.__assets[name] = {
        name,
        source: new sources.RawSource(body)
      }
    },
    getAssetSource: (name: string): string =>
      compilation.__assets[name]?.source.source().toString()
  }
}

const ENV_KEYS = [
  'EXTENSION_CONTROL_PORT',
  'EXTENSION_INSTANCE_ID',
  'EXTENSION_DEV_SERVER_CONNECTABLE_HOST'
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('InjectBridgeProducer', () => {
  it('prepends the producer to the background service_worker bundle', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    process.env.EXTENSION_INSTANCE_ID = 'abc123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('background/service_worker.js', '/* user sw */ console.log(1);')
    runProcessAssets()
    const out = getAssetSource('background/service_worker.js')
    expect(out).toContain('__extjsBridgeProducerInstalled')
    expect(out.indexOf('__extjsBridgeProducerInstalled')).toBeLessThan(
      out.indexOf('/* user sw */')
    )
  })

  // A browser keeps the worker file of a profile that outlives the session,
  // and runs that copy first when the file on disk has other bytes.
  it('writes the same background bytes in every session of unchanged code', () => {
    const built = (port: string, instance: string) => {
      process.env.EXTENSION_CONTROL_PORT = port
      process.env.EXTENSION_INSTANCE_ID = instance
      const {compiler, runProcessAssets, setAsset, getAssetSource} =
        makeCompiler()
      new InjectBridgeProducer().apply(compiler)
      setAsset('background/service_worker.js', '/* user sw */ console.log(1);')
      setAsset('content_scripts/content-0.js', '/* content */')
      runProcessAssets()

      return {
        worker: getAssetSource('background/service_worker.js'),
        control: JSON.parse(getAssetSource('extension-js-control.json'))
      }
    }

    const first = built('8123', 'session-one')
    const second = built('9456', 'session-two')

    expect(second.worker).toBe(first.worker)
    expect(first.worker).not.toContain('session-one')
    expect(first.worker).not.toContain('8123')
    expect(first.worker).toContain('__extjsDevBuild')
    expect(first.control).toMatchObject({port: 8123, instanceId: 'session-one'})
    expect(second.control).toMatchObject({
      port: 9456,
      instanceId: 'session-two'
    })
  })

  it('names another build once a file of the extension changed', () => {
    const built = (content: string) => {
      process.env.EXTENSION_CONTROL_PORT = '8123'
      process.env.EXTENSION_INSTANCE_ID = 'session-one'
      const {compiler, runProcessAssets, setAsset, getAssetSource} =
        makeCompiler()
      new InjectBridgeProducer().apply(compiler)
      setAsset('background/service_worker.js', '/* user sw */ console.log(1);')
      setAsset('content_scripts/content-0.js', content)
      runProcessAssets()

      return getAssetSource('background/service_worker.js')
    }

    expect(built('/* one */')).not.toBe(built('/* two */'))
  })

  // A stale control file is fatal and silent: the producer fetches it at runtime
  // to learn the live port and instance, and the instance id gates every hello.
  it('rewrites a control file an earlier session left behind', () => {
    process.env.EXTENSION_CONTROL_PORT = '9001'
    process.env.EXTENSION_INSTANCE_ID = 'this-session'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset(
      'extension-js-control.json',
      JSON.stringify({port: 55350, instanceId: 'a-previous-session'})
    )

    setAsset('background/service_worker.js', '/* sw */')

    runProcessAssets()

    expect(JSON.parse(getAssetSource('extension-js-control.json'))).toEqual({
      port: 9001,
      instanceId: 'this-session',
      buildType: 'development'
    })
  })

  it('writes the control file when the build has none yet', () => {
    process.env.EXTENSION_CONTROL_PORT = '9002'
    process.env.EXTENSION_INSTANCE_ID = 'fresh-session'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('background/service_worker.js', '/* sw */')

    runProcessAssets()

    expect(JSON.parse(getAssetSource('extension-js-control.json'))).toEqual({
      port: 9002,
      instanceId: 'fresh-session',
      buildType: 'development'
    })
  })

  it('stamps the control file as a development build', () => {
    process.env.EXTENSION_CONTROL_PORT = '9003'
    process.env.EXTENSION_INSTANCE_ID = 'stamped-session'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('background/service_worker.js', '/* sw */')

    runProcessAssets()

    const control = JSON.parse(getAssetSource('extension-js-control.json'))
    expect(control.buildType).toBe('development')
  })

  it('keeps port and instanceId first and unchanged beside the stamp', () => {
    process.env.EXTENSION_CONTROL_PORT = '9004'
    process.env.EXTENSION_INSTANCE_ID = 'kept-session'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('background/service_worker.js', '/* sw */')

    runProcessAssets()

    const raw = getAssetSource('extension-js-control.json')
    const {port, instanceId} = JSON.parse(raw)
    expect({port, instanceId}).toEqual({port: 9004, instanceId: 'kept-session'})
    expect(Object.keys(JSON.parse(raw))).toEqual([
      'port',
      'instanceId',
      'buildType'
    ])
  })

  const builtWith = (
    hash: string | undefined,
    assets: Record<string, string>
  ) => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const made = makeCompiler()
    new InjectBridgeProducer().apply(made.compiler)
    made.setHash(hash)
    for (const [name, body] of Object.entries(assets)) made.setAsset(name, body)
    made.runProcessAssets()

    const out = made.getAssetSource('background/service_worker.js')
    const world: Record<string, unknown> = {}
    // eslint-disable-next-line no-new-func
    new Function('globalThis', out.slice(0, out.indexOf('\n')))(world)

    return {
      out,
      named: world[DEV_BUILD_GLOBAL],
      read: readDevBuild(made.compilation())
    }
  }

  // The broker compares this with the build of a reload, so a worker that
  // already read the newest build from disk is not restarted a second time.
  it('names the build ahead of the producer, by the value the reload dispatch reads', () => {
    const built = builtWith('740f373fe7ae6fc4', {
      'background/service_worker.js': '/* user sw */'
    })

    expect(built.named).toMatch(/^[0-9a-f]{16}$/)
    expect(built.read).toBe(built.named)
    expect(built.out.indexOf(DEV_BUILD_GLOBAL)).toBeLessThan(
      built.out.indexOf('__extjsBridgeProducerInstalled')
    )
  })

  // The compilation hash moves on every compile and is written into each
  // script, so a compile that changed no byte must still name the same build.
  it('names the same build for the same bytes under another compilation hash', () => {
    const sw = (hash: string) => `h = () => ("${hash}"); /* user sw */`
    const first = builtWith('aaaaaaaaaaaaaaaa', {
      'background/service_worker.js': sw('aaaaaaaaaaaaaaaa'),
      'background/service_worker.js.map': '{"first":1}',
      'hot/169.aaaaaaaaaaaaaaaa.js': '/* one */',
      'hot/background/service_worker.aaaaaaaaaaaaaaaa.json': '{"c":[169]}',
      'background.aaaaaaaaaaaaaaaa.hot-update.js': '/* one */'
    })
    const second = builtWith('bbbbbbbbbbbbbbbb', {
      'background/service_worker.js': sw('bbbbbbbbbbbbbbbb'),
      'background/service_worker.js.map': '{"second":2}',
      'hot/169.bbbbbbbbbbbbbbbb.js': '/* two */',
      'hot/background/service_worker.bbbbbbbbbbbbbbbb.json': '{"c":[170]}',
      'background.bbbbbbbbbbbbbbbb.hot-update.js': '/* two */'
    })

    expect(second.named).toBe(first.named)
  })

  it('names another build once any file the extension reads changed', () => {
    const base = {
      'background/service_worker.js': '/* user sw */',
      'background/chunk.js': '/* lazy */',
      'assets/model.wasm': 'wasm-1'
    }
    const first = builtWith('aaaaaaaaaaaaaaaa', base).named
    const names = [
      builtWith('aaaaaaaaaaaaaaaa', {
        ...base,
        'background/service_worker.js': '/* user sw 2 */'
      }).named,
      builtWith('aaaaaaaaaaaaaaaa', {
        ...base,
        'background/chunk.js': '/* lazy 2 */'
      }).named,
      builtWith('aaaaaaaaaaaaaaaa', {...base, 'assets/model.wasm': 'wasm-2'})
        .named,
      builtWith('aaaaaaaaaaaaaaaa', {...base, 'assets/extra.txt': 'x'}).named
    ]

    expect(new Set([first, ...names]).size).toBe(5)
  })

  it('reads no build from a compilation it did not name', () => {
    expect(readDevBuild({})).toBe('')
    expect(readDevBuild(undefined)).toBe('')
  })

  it('covers the Firefox background/scripts.js and MV2 background/script.js forms', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('background/scripts.js', '/* firefox bg */')
    setAsset('background/script.js', '/* mv2 bg */')
    runProcessAssets()
    expect(getAssetSource('background/scripts.js')).toContain(
      '__extjsBridgeProducerInstalled'
    )

    expect(getAssetSource('background/script.js')).toContain(
      '__extjsBridgeProducerInstalled'
    )
  })

  // An MV2 background.page compiles to background/index.js, and that bundle is
  // the only background context the built manifest actually loads.
  it('covers the compiled background page bundle', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('background/index.js', '/* mv2 background page */')
    runProcessAssets()
    expect(getAssetSource('background/index.js')).toContain(
      '__extjsBridgeProducerInstalled'
    )
  })

  it('leaves non-background assets alone', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('content_scripts/content-0.js', '/* content */')
    setAsset('action/index.js', '/* popup */')
    runProcessAssets()
    expect(getAssetSource('content_scripts/content-0.js')).toBe('/* content */')
    expect(getAssetSource('action/index.js')).toBe('/* popup */')
  })

  it('is idempotent when the producer marker is already present', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    const body = '/* __extjsBridgeProducerInstalled marker */ /* user sw */'
    setAsset('background/service_worker.js', body)
    runProcessAssets()
    expect(getAssetSource('background/service_worker.js')).toBe(body)
  })

  it('does nothing when the control port is unset or not a number', () => {
    for (const port of [undefined, 'not-a-number']) {
      if (port === undefined) delete process.env.EXTENSION_CONTROL_PORT
      else process.env.EXTENSION_CONTROL_PORT = port

      const {compiler, taps} = makeCompiler()
      new InjectBridgeProducer().apply(compiler)
      expect(taps).toHaveLength(0)
    }
  })

  it('emits the control-port file so a stale producer can re-resolve the live port', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    process.env.EXTENSION_INSTANCE_ID = 'abc123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    setAsset('background/service_worker.js', '/* sw */')
    runProcessAssets()
    const raw = getAssetSource('extension-js-control.json')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw)).toEqual({
      port: 8123,
      instanceId: 'abc123',
      buildType: 'development'
    })
  })

  it('does not emit the control-port file when the bridge is off', () => {
    const {compiler, taps} = makeCompiler()
    new InjectBridgeProducer().apply(compiler)
    expect(taps).toHaveLength(0)
  })

  it('bakes the connectable host, falling back to loopback when blank', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = 'devbox.example'
    const remote = makeCompiler()
    new InjectBridgeProducer().apply(remote.compiler)
    remote.setAsset('background/service_worker.js', '/* sw */')
    remote.runProcessAssets()
    expect(remote.getAssetSource('background/service_worker.js')).toContain(
      'devbox.example'
    )

    process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = '   '
    const local = makeCompiler()
    new InjectBridgeProducer().apply(local.compiler)
    local.setAsset('background/service_worker.js', '/* sw */')
    local.runProcessAssets()
    expect(local.getAssetSource('background/service_worker.js')).toContain(
      '127.0.0.1'
    )
  })
})

describe('InjectBridgeRelay', () => {
  it('prepends the relay to every surface with its own context baked in', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeRelay().apply(compiler)
    const surfaces: Array<[string, string]> = [
      ['content_scripts/content-0.js', 'content'],
      ['action/index.js', 'popup'],
      ['options/index.js', 'options'],
      ['sidebar/index.js', 'sidebar'],
      ['devtools/index.js', 'devtools'],
      ['chrome_url_overrides/newtab.js', 'newtab'],
      ['chrome_url_overrides/history.js', 'history'],
      ['chrome_url_overrides/bookmarks.js', 'bookmarks']
    ]
    for (const [name] of surfaces) setAsset(name, `/* user ${name} */`)
    runProcessAssets()

    for (const [name, context] of surfaces) {
      const out = getAssetSource(name)
      expect(out).toContain('__extjsBridgeRelayInstalled')
      expect(out).toContain(`var CONTEXT = "${context}"`)
      expect(out.indexOf('__extjsBridgeRelayInstalled')).toBeLessThan(
        out.indexOf(`/* user ${name} */`)
      )
    }
  })

  // The background asks each frame which declared bundles ran in it, so only
  // a content script bundle names itself, and by the name the manifest uses.
  it('makes a content script bundle name itself to its frame, and no other surface', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeRelay().apply(compiler)
    setAsset('content_scripts/content-0.11111111.js', '/* content */')
    setAsset('options/index.js', '/* options */')
    runProcessAssets()

    const content = getAssetSource('content_scripts/content-0.11111111.js')

    expect(
      content.startsWith(
        buildDeclaredSheetSignalSource('content_scripts/content-0.11111111.js')
      )
    ).toBe(true)

    expect(content).toContain('__extjsBridgeRelayInstalled')
    expect(getAssetSource('options/index.js')).not.toContain(
      '__extjsDevSheetEntries'
    )
  })

  it('excludes the background SW and HMR chunks from relay injection', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeRelay().apply(compiler)
    setAsset('background/service_worker.js', '/* sw */')
    setAsset('hot/background.abc.hot-update.js', '/* hmr */')
    runProcessAssets()
    expect(getAssetSource('background/service_worker.js')).toBe('/* sw */')
    expect(getAssetSource('hot/background.abc.hot-update.js')).toBe('/* hmr */')
  })

  it('is idempotent when the relay marker is already present', () => {
    process.env.EXTENSION_CONTROL_PORT = '8123'
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectBridgeRelay().apply(compiler)
    const body = '/* __extjsBridgeRelayInstalled marker */ /* content */'
    setAsset('content_scripts/content-0.js', body)
    runProcessAssets()
    expect(getAssetSource('content_scripts/content-0.js')).toBe(body)
  })

  it('does nothing when the bridge is off', () => {
    const {compiler, taps} = makeCompiler()
    new InjectBridgeRelay().apply(compiler)
    expect(taps).toHaveLength(0)
  })
})
