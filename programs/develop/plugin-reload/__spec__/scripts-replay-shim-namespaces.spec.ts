import {describe, expect, it} from 'vitest'
import {
  answeredAll,
  fakeEngine
} from '../../plugin-web-extension/feature-scripts/__spec__/scripting-calling-styles'
import {SCRIPTS_REPLAY_SHIM_SOURCE} from '../reload-lib/scripts-replay-shim'

const PAGE = 'https://a.example/page'
const hook = (tabId: number) => ({
  target: {tabId},
  files: ['scripts/hook.js'],
  world: 'MAIN'
})

// A Manifest V2 Firefox background: chrome.* answers a callback and hands
// nothing back, browser.* hands a promise back, and both name one extension.
function firefoxBackground() {
  const engine = fakeEngine()
  const chrome = engine.namespace('callback-only')
  const browser = engine.namespace('promise')
  const fakeGlobal: Record<string, any> = {
    chrome: {
      ...chrome,
      tabs: {
        get: (_tabId: number, done?: (tab: {url: string}) => void) => {
          done?.({url: PAGE})
        }
      }
    },
    browser: {
      ...browser,
      tabs: {get: async () => ({url: PAGE})}
    }
  }

  new Function('globalThis', SCRIPTS_REPLAY_SHIM_SOURCE)(fakeGlobal)

  const replay = (): Promise<
    Array<{ok: boolean; tabId: number; files: string[]; error?: string}>
  > => fakeGlobal.__extjsScriptsReplay(['scripts/hook.js'])

  return {engine, fakeGlobal, replay}
}

describe('scripts replay shim, with both namespaces of a Manifest V2 Firefox', () => {
  it('replays an injection the author made through browser.scripting', async () => {
    const h = firefoxBackground()

    await h.fakeGlobal.browser.scripting.executeScript(hook(3))
    await answeredAll()

    expect(await h.replay()).toEqual([
      {ok: true, tabId: 3, files: ['scripts/hook.js']}
    ])

    expect(h.engine.injections).toHaveLength(2)
  })

  it('replays an injection the author made through chrome.scripting, with and without a callback', async () => {
    const h = firefoxBackground()
    const frames: unknown[] = []

    expect(h.fakeGlobal.chrome.scripting.executeScript(hook(3))).toBeUndefined()
    expect(
      h.fakeGlobal.chrome.scripting.executeScript(hook(4), (list: unknown) =>
        frames.push(list)
      )
    ).toBeUndefined()

    await answeredAll()

    expect(frames).toEqual([[{frameId: 0, result: null}]])
    expect((await h.replay()).map((outcome) => outcome.tabId)).toEqual([3, 4])
    expect(h.engine.injections).toHaveLength(4)
    expect(h.engine.unread).toEqual([])
  })

  // A call that hands nothing back was counted as replayed before the
  // browser had answered it.
  it('reports a replay the browser refused', async () => {
    const h = firefoxBackground()

    h.fakeGlobal.chrome.scripting.executeScript(hook(-1), () => {
      void h.fakeGlobal.chrome.runtime.lastError
    })

    await answeredAll()

    expect(await h.replay()).toEqual([
      {
        ok: false,
        tabId: -1,
        files: ['scripts/hook.js'],
        error: 'Invalid tab ID'
      }
    ])

    expect(h.engine.unread).toEqual([])
  })
})
