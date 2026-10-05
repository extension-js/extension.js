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

function makeTabbedGlobal(initialTabs: Record<number, string>) {
  const calls: Injection[] = []
  const tabGets: number[] = []
  const removedListeners: Array<(tabId: number) => void> = []
  const tabs = new Map<number, string>(
    Object.entries(initialTabs).map(([id, url]) => [Number(id), url])
  )
  const fakeGlobal: any = {
    chrome: {
      scripting: {
        executeScript: (injection: Injection) => {
          calls.push(injection)

          return Promise.resolve([])
        }
      },
      tabs: {
        get: (tabId: number) => {
          tabGets.push(tabId)

          if (!tabs.has(tabId)) {
            return Promise.reject(new Error(`No tab with id: ${tabId}.`))
          }

          return Promise.resolve({id: tabId, url: tabs.get(tabId)})
        },
        onRemoved: {
          addListener: (listener: (tabId: number) => void) => {
            removedListeners.push(listener)
          }
        }
      }
    }
  }
  const navigate = (tabId: number, url: string) => tabs.set(tabId, url)

  const close = (tabId: number) => {
    tabs.delete(tabId)
    for (const listener of removedListeners) listener(tabId)
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  return {fakeGlobal, calls, tabGets, navigate, close, settle}
}

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

  it('skips the replay for a tab that navigated to another page and drops its record', async () => {
    const {fakeGlobal, calls, navigate, settle} = makeTabbedGlobal({
      7: 'https://example.com/docs',
      9: 'https://example.com/docs'
    })
    installShim(fakeGlobal)
    await inject(fakeGlobal, {target: {tabId: 7}, files: ['scripts/widget.js']})
    await inject(fakeGlobal, {target: {tabId: 9}, files: ['scripts/widget.js']})
    await settle()
    expect(calls).toHaveLength(2)

    navigate(7, 'https://other.test/')
    navigate(9, 'https://example.com/docs?page=2#top')

    const outcome = await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])

    expect(outcome).toEqual([
      {ok: true, tabId: 9, files: ['scripts/widget.js']}
    ])

    expect(calls).toHaveLength(3)
    expect(calls[2].target).toEqual({tabId: 9})

    navigate(7, 'https://example.com/docs')
    await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])

    expect(calls).toHaveLength(4)
    expect(calls[3].target).toEqual({tabId: 9})
  })

  it('a new injection after a navigation replays on the page it was recorded on', async () => {
    const {fakeGlobal, calls, navigate, settle} = makeTabbedGlobal({
      7: 'https://example.com/a'
    })
    installShim(fakeGlobal)
    await inject(fakeGlobal, {target: {tabId: 7}, files: ['scripts/widget.js']})
    await settle()
    navigate(7, 'https://example.com/b')
    await inject(fakeGlobal, {target: {tabId: 7}, files: ['scripts/widget.js']})
    await settle()
    expect(calls).toHaveLength(2)

    await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])

    expect(calls).toHaveLength(3)
    expect(calls[2].target).toEqual({tabId: 7})
  })

  it('evicts a closed tab so a later edit neither looks it up nor injects into it', async () => {
    const {fakeGlobal, calls, tabGets, close, settle} = makeTabbedGlobal({
      7: 'https://example.com/',
      9: 'https://example.com/'
    })
    installShim(fakeGlobal)
    await inject(fakeGlobal, {target: {tabId: 7}, files: ['scripts/widget.js']})
    await inject(fakeGlobal, {target: {tabId: 9}, files: ['scripts/widget.js']})
    await settle()
    tabGets.length = 0

    close(7)
    const outcome = await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])

    expect(outcome).toEqual([
      {ok: true, tabId: 9, files: ['scripts/widget.js']}
    ])

    expect(calls).toHaveLength(3)
    expect(tabGets).toEqual([9])
  })

  it('evicts a tab whose lookup fails instead of retrying it on the next edit', async () => {
    const {fakeGlobal, calls, tabGets, navigate, settle} = makeTabbedGlobal({
      7: 'https://example.com/'
    })
    installShim(fakeGlobal)
    await inject(fakeGlobal, {target: {tabId: 7}, files: ['scripts/widget.js']})
    await settle()

    fakeGlobal.chrome.tabs.get = (tabId: number) => {
      tabGets.push(tabId)

      return Promise.reject(new Error(`No tab with id: ${tabId}.`))
    }

    tabGets.length = 0

    expect(
      await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])
    ).toEqual([])

    navigate(7, 'https://example.com/')
    expect(
      await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])
    ).toEqual([])

    expect(tabGets).toEqual([7])
    expect(calls).toHaveLength(1)
  })

  it('tracks at most 50 tabs and forgets the ones injected longest ago', async () => {
    const tabUrls: Record<number, string> = {}

    for (let tabId = 1; tabId <= 60; tabId++) {
      tabUrls[tabId] = `https://example.com/${tabId}`
    }

    const {fakeGlobal, calls, settle} = makeTabbedGlobal(tabUrls)
    installShim(fakeGlobal)

    for (let tabId = 1; tabId <= 60; tabId++) {
      await inject(fakeGlobal, {target: {tabId}, files: ['scripts/widget.js']})
    }

    await settle()
    expect(calls).toHaveLength(60)

    await fakeGlobal.__extjsScriptsReplay(['scripts/widget.js'])

    const replayed = calls.slice(60).map((call) => call.target.tabId)
    expect(replayed).toHaveLength(50)
    expect(Math.min(...replayed)).toBe(11)
    expect(Math.max(...replayed)).toBe(60)
  })
})
