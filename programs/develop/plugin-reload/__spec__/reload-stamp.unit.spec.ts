import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BridgeBroker} from '../../dev-server/control-bridge/broker'
import {SafariDevPlugin} from '../../plugin-browsers/safari-dev-plugin'
import {createPlaywrightMetadataWriter} from '../../plugin-playwright'
import type {ReloadBroker, ReloadInstruction} from '../index'
import {dispatchReload, reloadKindFor} from '../reload-dispatch'

// A tool waiting for "the rebuild is live" reads ready.json. Without a stamp
// it could only guess from the background reconnecting, which a content,
// page or Safari reload never does.

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function broker(notified: number, ack: 'acked' | 'unacked' | 'not-expected') {
  const applied: Array<[string, string | undefined]> = []
  const b: ReloadBroker = {
    broadcastReload: () => notified,
    awaitReloadAck: async () => ack as never,
    noteReloadApplied: (kind, label) => {
      applied.push([kind, label])
    }
  }

  return {b, applied}
}

describe('the reload kind a dispatch stamps', () => {
  const cases: Array<[ReloadInstruction['type'], string]> = [
    ['full', 'full'],
    ['service-worker', 'background'],
    ['content-scripts', 'content'],
    ['page', 'page']
  ]

  for (const [type, kind] of cases) {
    it(`stamps ${kind} once a ${type} reload is applied`, async () => {
      const {b, applied} = broker(1, 'acked')
      await dispatchReload({type, label: `${type} (x)`}, {broker: b})

      expect(reloadKindFor(type)).toBe(kind)
      expect(applied).toEqual([[kind, `${type} (x)`]])
    })
  }

  it('stamps a reload a producer that cannot ack received', async () => {
    const {b, applied} = broker(1, 'not-expected')
    await dispatchReload({type: 'full', label: 'extension'}, {broker: b})

    expect(applied).toEqual([['full', 'extension']])
  })

  it('stamps nothing the extension never confirmed or never received', async () => {
    const unacked = broker(1, 'unacked')
    await dispatchReload({type: 'full', label: 'x'}, {broker: unacked.b})
    const nobody = broker(0, 'not-expected')
    await dispatchReload({type: 'full', label: 'x'}, {broker: nobody.b})

    expect(unacked.applied).toEqual([])
    expect(nobody.applied).toEqual([])
  })
})

describe('the broker hands the stamp to the session', () => {
  it('passes a noted reload to onReloadApplied', () => {
    const onReloadApplied = vi.fn()
    const b = new BridgeBroker({
      instanceId: 'inst-1',
      runId: 'run-1',
      allowControl: true,
      onReloadApplied
    } as never)

    b.noteReloadApplied('content', 'content_script (a.ts)')

    expect(onReloadApplied).toHaveBeenCalledWith(
      'content',
      'content_script (a.ts)'
    )
  })
})

describe('a Safari resync stamps its own kind', () => {
  it('stamps safari-resync after each rebuild, not after the first package', async () => {
    const noted: string[] = []
    const plugin = new SafariDevPlugin(async () => {})
    plugin.setReloadBroker({
      broadcastReload: () => 0,
      noteReloadApplied: (kind) => {
        noted.push(kind)
      }
    })

    let done: (stats: unknown) => Promise<void> = async () => {}

    plugin.apply({
      hooks: {done: {tapPromise: (_n: string, f: typeof done) => (done = f)}},
      options: {context: 'ctx'}
    } as never)

    const stats = (out: string) => ({
      compilation: {
        errors: [],
        options: {output: {path: out}, context: 'ctx'}
      }
    })

    await done(stats('/first'))
    expect(noted).toEqual([])

    await done(stats('/second'))
    await plugin.idle()

    expect(noted).toEqual(['safari-resync'])
  })
})

describe('ready.json carries the reload stamp', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-stamp-'))
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(tmp, 'src', 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const read = () =>
    JSON.parse(
      fs.readFileSync(
        path.join(tmp, 'dist', 'extension-js', 'chromium', 'ready.json'),
        'utf-8'
      )
    )

  it('stamps reloadedAt and reloadKind, and a later compile keeps them', () => {
    const writer = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'dev',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    writer.writeReady()
    const before = read()

    writer.stampReload('content', 'content_script (a.ts)')
    const stamped = read()

    expect(stamped).toMatchObject({
      reloadKind: 'content',
      reloadLabel: 'content_script (a.ts)',
      status: before.status,
      runId: before.runId
    })

    expect(Date.parse(stamped.reloadedAt)).not.toBeNaN()

    writer.writeReady()
    expect(read()).toMatchObject({
      reloadKind: 'content',
      reloadedAt: stamped.reloadedAt
    })
  })
})
