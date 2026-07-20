// InjectBridgeProducer prepends the agent-bridge producer to the compiled
// background bundle; InjectBridgeRelay prepends the relay to the other
// extension surfaces (content scripts, popup, options, sidebar, devtools).
// Both read the control port from process.env and must stay inert when the
// bridge is off, and idempotent when the bundle already carries the marker.

import {sources} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {InjectBridgeProducer} from '../steps/inject-bridge-producer'
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
    // Port and instanceId are baked into the injected source.
    expect(out).toContain('8123')
    expect(out).toContain('abc123')
    // User code must still be present, preceded by the producer.
    expect(out.indexOf('__extjsBridgeProducerInstalled')).toBeLessThan(
      out.indexOf('/* user sw */')
    )
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
      // No compilation hook registered means no asset is ever rewritten.
      expect(taps).toHaveLength(0)
    }
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
      ['devtools/index.js', 'devtools']
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
