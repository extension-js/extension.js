import {describe, expect, it, vi, afterEach} from 'vitest'
import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'

type Handler = (message: Record<string, unknown>) => void

function createControllerWithFakeCdp() {
  const controller = new CDPExtensionController({
    outPath: '/tmp/extension.js-fake-out',
    browser: 'chrome',
    cdpPort: 0
  }) as any

  const handlers = new Set<Handler>()
  const enableCalls: string[] = []

  controller.cdp = {
    onProtocolEvent(handler: Handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    sendCommand: vi.fn(async (method: string, _params: unknown, sessionId?: string) => {
      if (method === 'Runtime.enable') {
        enableCalls.push(String(sessionId || ''))
      }
      return {}
    })
  }
  controller.extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  const emit = (sessionId: string, message: Record<string, unknown>) => {
    for (const handler of handlers) handler({sessionId, ...message})
  }

  return {controller, emit, handlers, enableCalls}
}

describe('CDPExtensionController execution-context cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reuses contexts across rule iterations on the same session without re-enabling Runtime', async () => {
    const {controller, emit, enableCalls} = createControllerWithFakeCdp()
    const sessionId = 'session-A'

    // First call should subscribe and Runtime.enable. Emit two contexts during
    // the 100ms window so they land in the cache.
    setTimeout(() => {
      emit(sessionId, {
        method: 'Runtime.executionContextCreated',
        params: {
          context: {
            id: 1,
            origin: 'https://example.com',
            auxData: {type: 'default', isDefault: true}
          }
        }
      })
      emit(sessionId, {
        method: 'Runtime.executionContextCreated',
        params: {
          context: {
            id: 2,
            origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            auxData: {type: 'isolated'}
          }
        }
      })
    }, 5)

    const first = await controller.collectExecutionContexts(sessionId)
    expect(first).toHaveLength(2)
    expect(enableCalls).toEqual([sessionId])

    // Second call must return cached values *without* re-enabling Runtime —
    // CDP only re-emits executionContextCreated once per session, so a second
    // enable+wait would yield zero events and silently fail.
    const second = await controller.collectExecutionContexts(sessionId)
    expect(second).toHaveLength(2)
    expect(enableCalls).toEqual([sessionId])
  })

  it('drops cached contexts on Runtime.executionContextDestroyed and clears on executionContextsCleared', async () => {
    const {controller, emit} = createControllerWithFakeCdp()
    const sessionId = 'session-B'

    setTimeout(() => {
      emit(sessionId, {
        method: 'Runtime.executionContextCreated',
        params: {context: {id: 10, auxData: {type: 'isolated'}}}
      })
      emit(sessionId, {
        method: 'Runtime.executionContextCreated',
        params: {context: {id: 11, auxData: {type: 'isolated'}}}
      })
    }, 5)

    expect(await controller.collectExecutionContexts(sessionId)).toHaveLength(2)

    emit(sessionId, {
      method: 'Runtime.executionContextDestroyed',
      params: {executionContextId: 10}
    })
    expect(await controller.collectExecutionContexts(sessionId)).toHaveLength(1)

    emit(sessionId, {
      method: 'Runtime.executionContextsCleared',
      params: {}
    })
    expect(await controller.collectExecutionContexts(sessionId)).toHaveLength(0)
  })

  it('isolates cache per session and releases listener on detach', async () => {
    const {controller, emit, handlers} = createControllerWithFakeCdp()

    // Cross-session sanity: session-X must not see events tagged for session-Y
    // and vice versa. Emit the events after each call attaches its listener.
    setTimeout(() => {
      emit('session-X', {
        method: 'Runtime.executionContextCreated',
        params: {context: {id: 100, auxData: {type: 'isolated'}}}
      })
      // session-Y emit lands during X's listener window but should be ignored
      // because X's listener filters on sessionId.
      emit('session-Y', {
        method: 'Runtime.executionContextCreated',
        params: {context: {id: 999, auxData: {type: 'isolated'}}}
      })
    }, 5)

    const xContexts = await controller.collectExecutionContexts('session-X')
    expect(xContexts.map((c: any) => c.id)).toEqual([100])

    setTimeout(() => {
      emit('session-Y', {
        method: 'Runtime.executionContextCreated',
        params: {context: {id: 200, auxData: {type: 'isolated'}}}
      })
    }, 5)
    const yContexts = await controller.collectExecutionContexts('session-Y')
    expect(yContexts.map((c: any) => c.id)).toEqual([200])

    const handlerCountBefore = handlers.size
    controller.releaseSessionContexts('session-X')
    // releasing one session's listener removes exactly one handler from the cdp.
    expect(handlers.size).toBe(handlerCountBefore - 1)

    // Released session starts fresh: a new collect call re-installs the
    // listener and re-runs Runtime.enable for that session.
    setTimeout(() => {
      emit('session-X', {
        method: 'Runtime.executionContextCreated',
        params: {context: {id: 101, auxData: {type: 'isolated'}}}
      })
    }, 5)
    const xRefetched = await controller.collectExecutionContexts('session-X')
    expect(xRefetched.map((c: any) => c.id)).toEqual([101])
  })
})
