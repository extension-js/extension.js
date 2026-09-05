import {describe, expect, it} from 'vitest'
import {buildBridgeProducerSource} from '../../dev-server/control-bridge/producer-runtime'
import {SCRIPTS_REPLAY_SHIM_SOURCE} from '../reload-lib/scripts-replay-shim'

type Injection = {target: {tabId: number}; files: string[]; world?: string}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: {data: string}) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.onclose?.()
  }
  triggerOpen() {
    this.onopen?.()
  }
  triggerMessage(obj: unknown) {
    this.onmessage?.({data: JSON.stringify(obj)})
  }
}

function makeGlobal() {
  const calls: Injection[] = []
  const tabsQueries: unknown[] = []
  let reloads = 0
  const fakeGlobal: any = {
    chrome: {
      runtime: {
        id: 'ext',
        reload: () => {
          reloads++
        }
      },
      scripting: {
        executeScript: (injection: Injection) => {
          calls.push(injection)
          return Promise.resolve([])
        }
      },
      tabs: {
        query: (query: unknown) => {
          tabsQueries.push(query)
          return Promise.resolve([])
        }
      }
    }
  }
  return {fakeGlobal, calls, tabsQueries, reloads: () => reloads}
}

function installShim(fakeGlobal: any) {
  // The shim reads `globalThis` first; pass the fake as that parameter.
  // eslint-disable-next-line no-new-func
  new Function('globalThis', SCRIPTS_REPLAY_SHIM_SOURCE)(fakeGlobal)
}

const inject = (fakeGlobal: any, injection: Injection) =>
  fakeGlobal.chrome.scripting.executeScript(injection)

describe('scripts-replay shim runtime', () => {
  it('replays a changed scripts/ file only on the recorded tab and world, never via tabs.query', async () => {
    const {fakeGlobal, calls, tabsQueries} = makeGlobal()
    installShim(fakeGlobal)

    await inject(fakeGlobal, {
      target: {tabId: 7},
      files: ['/scripts/widget.js'],
      world: 'MAIN'
    })
    await inject(fakeGlobal, {target: {tabId: 9}, files: ['/scripts/other.js']})
    expect(calls).toHaveLength(2)

    const outcome = await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])

    expect(outcome).toEqual([
      {ok: true, tabId: 7, files: ['/scripts/widget.js']}
    ])
    expect(calls).toHaveLength(3)
    expect(calls[2]).toEqual({
      target: {tabId: 7},
      files: ['/scripts/widget.js'],
      world: 'MAIN'
    })
    expect(tabsQueries).toEqual([])
  })

  it('replays nothing for a changed file no injection named', async () => {
    const {fakeGlobal, calls} = makeGlobal()
    installShim(fakeGlobal)
    await inject(fakeGlobal, {
      target: {tabId: 7},
      files: ['/scripts/widget.js']
    })

    await fakeGlobal.__extjsScriptsReplay(['scripts/unrelated.js'])
    await fakeGlobal.__extjsScriptsReplay([])

    expect(calls).toHaveLength(1)
  })

  it('records an identical injection once so a repeated action click does not stack replays', async () => {
    const {fakeGlobal, calls} = makeGlobal()
    installShim(fakeGlobal)
    const injection: Injection = {
      target: {tabId: 7},
      files: ['scripts/widget.js'],
      world: 'ISOLATED'
    }
    await inject(fakeGlobal, injection)
    await inject(fakeGlobal, injection)
    expect(calls).toHaveLength(2)

    await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])

    expect(calls).toHaveLength(3)
    expect(calls[2].world).toBe('ISOLATED')
  })

  it('a second install is a no-op, so executeScript stays wrapped exactly once', async () => {
    const {fakeGlobal, calls} = makeGlobal()
    installShim(fakeGlobal)
    const afterFirst = fakeGlobal.chrome.scripting.executeScript
    const replayAfterFirst = fakeGlobal.__extjsScriptsReplay

    installShim(fakeGlobal)

    expect(fakeGlobal.chrome.scripting.executeScript).toBe(afterFirst)
    expect(fakeGlobal.__extjsScriptsReplay).toBe(replayAfterFirst)

    await inject(fakeGlobal, {
      target: {tabId: 7},
      files: ['/scripts/widget.js']
    })
    await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])
    await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])
    // One recorded injection replays once per edit: two edits, two replays.
    expect(calls).toHaveLength(3)
  })

  it('a reload frame carrying changedScriptFiles replays through the bridge producer in the same global', async () => {
    FakeWebSocket.instances = []
    const {fakeGlobal, calls, tabsQueries, reloads} = makeGlobal()
    fakeGlobal.WebSocket = FakeWebSocket
    fakeGlobal.console = {
      log() {},
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    }
    fakeGlobal.navigator = {userAgent: 'Chrome'}
    fakeGlobal.setTimeout = (fn: () => void) => {
      fn()
      return 0
    }

    // Emitted order is producer first, then the shim, then the user's SW.
    // eslint-disable-next-line no-new-func
    new Function(
      'globalThis',
      buildBridgeProducerSource({
        controlPort: 9999,
        instanceId: 'inst-replay',
        context: 'background'
      })
    )(fakeGlobal)
    installShim(fakeGlobal)
    const ws = FakeWebSocket.instances[0]
    ws.triggerOpen()

    await inject(fakeGlobal, {
      target: {tabId: 7},
      files: ['/scripts/widget.js'],
      world: 'MAIN'
    })
    await inject(fakeGlobal, {target: {tabId: 9}, files: ['/scripts/other.js']})
    ws.sent = []

    ws.triggerMessage({
      type: 'reload',
      reloadType: 'page',
      label: 'page (scripts/widget.ts)',
      changedFiles: ['scripts/widget.ts'],
      changedScriptFiles: ['scripts/widget.js']
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(calls).toHaveLength(3)
    expect(calls[2]).toEqual({
      target: {tabId: 7},
      files: ['/scripts/widget.js'],
      world: 'MAIN'
    })
    expect(tabsQueries).toEqual([])
    expect(reloads()).toBe(0)
  })
})
