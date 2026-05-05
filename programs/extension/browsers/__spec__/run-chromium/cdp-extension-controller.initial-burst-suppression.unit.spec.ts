import {describe, expect, it, vi, afterEach} from 'vitest'
import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'

type Handler = (message: Record<string, unknown>) => void

function setupController() {
  const controller = new CDPExtensionController({
    outPath: '/tmp/extension.js-fake-out',
    browser: 'chrome',
    cdpPort: 0
  }) as any

  const handlers = new Set<Handler>()
  let nextSessionId = 0
  let attachCalls = 0

  controller.cdp = {
    onProtocolEvent(handler: Handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    sendCommand: vi.fn(async (_method: string) => ({})),
    attachToTarget: vi.fn(async () => {
      attachCalls += 1
      return `session-${nextSessionId++}`
    }),
    getTargets: vi.fn(async () => [
      {type: 'page', targetId: 'page-1', url: 'https://example.com/'}
    ])
  }
  controller.extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  controller.evaluateContentScriptOnNewContext = vi.fn(async () => {})

  const emit = (sessionId: string, message: Record<string, unknown>) => {
    for (const handler of handlers) handler({sessionId, ...message})
  }

  return {controller, emit, getAttachCalls: () => attachCalls}
}

describe('CDPExtensionController initial-burst suppression', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('ignores executionContextCreated events that arrive during the suppression window of a freshly-attached watched session', async () => {
    vi.useFakeTimers()
    const {controller, emit} = setupController()

    // Mark a single rule as active so urlMatchesAnyActiveRule returns true.
    controller.activeContentScriptRules = [
      {
        index: 0,
        world: 'extension',
        matches: ['<all_urls>'],
        excludeMatches: [],
        includeGlobs: [],
        excludeGlobs: []
      }
    ]
    controller.contentScriptTargetListenerInstalled = true
    controller.installContentScriptTargetListener()

    await controller.registerContentScriptsForFutureNavigations(
      controller.activeContentScriptRules
    )

    // Simulate Runtime.enable's re-emission burst right after attach.
    const sessionId = Array.from(controller.watchedPageSessions.keys())[0] as string
    expect(sessionId).toBeTruthy()
    expect(controller.suppressInitialContextBurst.has(sessionId)).toBe(true)

    emit(sessionId, {
      method: 'Runtime.executionContextCreated',
      params: {
        context: {
          id: 1,
          origin: 'https://example.com',
          auxData: {type: 'default', isDefault: true, frameId: 'frame-A'}
        }
      }
    })
    emit(sessionId, {
      method: 'Runtime.executionContextCreated',
      params: {
        context: {
          id: 2,
          origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          auxData: {type: 'isolated', frameId: 'frame-A'}
        }
      }
    })

    expect(controller.evaluateContentScriptOnNewContext).not.toHaveBeenCalled()

    // After the suppression window elapses, future context creations are
    // genuine new contexts (e.g. page navigation) and DO fire eval.
    await vi.advanceTimersByTimeAsync(260)
    expect(controller.suppressInitialContextBurst.has(sessionId)).toBe(false)

    emit(sessionId, {
      method: 'Runtime.executionContextCreated',
      params: {
        context: {
          id: 3,
          origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          auxData: {type: 'isolated', frameId: 'frame-A'}
        }
      }
    })

    expect(controller.evaluateContentScriptOnNewContext).toHaveBeenCalledTimes(1)
  })

  it('clears the suppression entry when the watched session detaches', async () => {
    const {controller, emit} = setupController()
    controller.activeContentScriptRules = [
      {
        index: 0,
        world: 'extension',
        matches: ['<all_urls>'],
        excludeMatches: [],
        includeGlobs: [],
        excludeGlobs: []
      }
    ]
    controller.contentScriptTargetListenerInstalled = true
    controller.installContentScriptTargetListener()

    await controller.registerContentScriptsForFutureNavigations(
      controller.activeContentScriptRules
    )
    const sessionId = Array.from(controller.watchedPageSessions.keys())[0] as string
    expect(controller.suppressInitialContextBurst.has(sessionId)).toBe(true)

    emit(sessionId, {method: 'Target.detachedFromTarget', params: {}})

    expect(controller.suppressInitialContextBurst.has(sessionId)).toBe(false)
    expect(controller.watchedPageSessions.has(sessionId)).toBe(false)
  })
})
