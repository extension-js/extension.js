import {describe, expect, it, vi} from 'vitest'
import {
  MANAGER_ADDON_ID,
  OPEN_NEW_TAB_EXPRESSION,
  openManagerNewTab
} from '../../../../run-firefox/rdp/remote-firefox/manager-tab'

type Listener = (message: unknown) => void

// A fake RDP client shaped like the live Firefox 154 exchange: the descriptor
// only offers getWatcher, and watchTargets announces documents as events.
function fakeClient(addons: unknown[], targets: unknown[] = []) {
  const listeners = new Set<Listener>()
  const request = vi.fn(async (payload: unknown) => {
    const {type} = payload as {type: string}
    if (type === 'listAddons') return {addons}
    if (type === 'getWatcher') return {actor: 'watcher1'}
    if (type === 'watchTargets') {
      const [first, ...rest] = targets
      setTimeout(() => {
        for (const target of rest) {
          for (const listener of listeners) {
            listener({type: 'target-available-form', target})
          }
        }
      }, 0)
      return first ? {type: 'target-available-form', target: first} : {}
    }
    return {}
  })
  const evaluate = vi.fn(async () => true)
  return {
    request,
    evaluate,
    on: (_event: string, listener: Listener) => listeners.add(listener),
    off: (_event: string, listener: Listener) => listeners.delete(listener),
    listeners
  }
}

describe('openManagerNewTab', () => {
  it('runs tabs.create in the manager background page through its watcher', async () => {
    const client = fakeClient(
      [
        {actor: 'desc1', id: 'user@example.com'},
        {actor: 'desc2', id: MANAGER_ADDON_ID}
      ],
      [
        {
          actor: 't1',
          consoleActor: 'c-welcome',
          url: 'moz-extension://x/pages/welcome.html'
        },
        {
          actor: 't2',
          consoleActor: 'c-bg',
          url: 'moz-extension://x/_generated_background_page.html'
        }
      ]
    )

    expect(await openManagerNewTab(client)).toBe(true)
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({to: 'desc2', type: 'getWatcher'})
    )
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({to: 'watcher1', type: 'watchTargets'})
    )
    expect(client.evaluate).toHaveBeenCalledWith(
      'c-bg',
      OPEN_NEW_TAB_EXPRESSION
    )
    expect(OPEN_NEW_TAB_EXPRESSION).toContain('tabs.create({active: true})')
    expect(OPEN_NEW_TAB_EXPRESSION).not.toContain('url')
    expect(client.listeners.size).toBe(0)
  })

  it('accepts the older addon shape that carries its console actor', async () => {
    const client = fakeClient([{id: MANAGER_ADDON_ID, consoleActor: 'c1'}])
    expect(await openManagerNewTab(client)).toBe(true)
    expect(client.evaluate).toHaveBeenCalledWith('c1', OPEN_NEW_TAB_EXPRESSION)
  })

  it('reports false when the manager add-on is not installed', async () => {
    const client = fakeClient([{actor: 'a', id: 'user@example.com'}])
    expect(await openManagerNewTab(client)).toBe(false)
    expect(client.evaluate).not.toHaveBeenCalled()
  })

  it('reports false instead of throwing on a protocol failure', async () => {
    const broken = {
      request: vi.fn(async () => {
        throw new Error('socket closed')
      }),
      evaluate: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    }
    expect(await openManagerNewTab(broken)).toBe(false)
  })
})
