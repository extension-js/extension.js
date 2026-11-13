import {describe, expect, it} from 'vitest'
import {
  type CdpSession,
  evaluateChromiumTabDocument,
  evaluateThroughSession,
  pickPageTarget
} from '../run-chromium/cdp/evaluate-tab-document'

const DEMO =
  'chrome-extension://fddgkoildhakngagamnhmeehkmadmpaj/pages/demo.html'

const target = (url: string, type = 'page', n = 1) => ({
  type,
  url,
  webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${n}`
})

function fakeSession(
  answers: Record<string, Record<string, unknown>>,
  sent: Array<{method: string; params?: Record<string, unknown>}> = []
): CdpSession & {closed: number} {
  const session = {
    closed: 0,
    send: async (method: string, params?: Record<string, unknown>) => {
      sent.push({method, params})

      return answers[method] || {}
    },
    close: () => {
      session.closed++
    }
  }

  return session
}

describe('pickPageTarget', () => {
  it('takes the one page target on the url', () => {
    expect(
      pickPageTarget(
        [
          target('chrome://extensions/', 'page', 1),
          target(DEMO, 'page', 2),
          target(DEMO, 'service_worker', 3)
        ],
        DEMO
      )
    ).toBe('ws://127.0.0.1:9222/devtools/page/2')
  })

  it('refuses to guess between two tabs on one url, or with none', () => {
    expect(
      pickPageTarget([target(DEMO, 'page', 1), target(DEMO, 'page', 2)], DEMO)
    ).toBeUndefined()

    expect(pickPageTarget([target('about:blank')], DEMO)).toBeUndefined()
  })
})

describe('evaluateThroughSession', () => {
  it('answers a primitive as the protocol returned it', async () => {
    const sent: Array<{method: string; params?: Record<string, unknown>}> = []
    const outcome = await evaluateThroughSession(
      fakeSession(
        {'Runtime.evaluate': {result: {type: 'string', value: 'Probe Demo'}}},
        sent
      ),
      'document.title'
    )

    expect(outcome).toEqual({ok: true, value: 'Probe Demo'})
    // The expression goes as the protocol's own evaluation, never inside eval.
    expect(sent).toEqual([
      {
        method: 'Runtime.evaluate',
        params: {
          expression: 'document.title',
          awaitPromise: true,
          returnByValue: false
        }
      }
    ])
  })

  it('reads an object through its JSON form in the page', async () => {
    const sent: Array<{method: string; params?: Record<string, unknown>}> = []
    const outcome = await evaluateThroughSession(
      fakeSession(
        {
          'Runtime.evaluate': {result: {type: 'object', objectId: 'obj-1'}},
          'Runtime.callFunctionOn': {
            result: {type: 'string', value: '{"title":"Probe Demo","n":1}'}
          }
        },
        sent
      ),
      '({title: document.title, n: 1})'
    )

    expect(outcome).toEqual({ok: true, value: {title: 'Probe Demo', n: 1}})
    expect(sent[1].method).toBe('Runtime.callFunctionOn')
    expect(sent[1].params?.objectId).toBe('obj-1')
    expect(sent[1].params?.returnByValue).toBe(true)
  })

  it('tags a BigInt, nulls a NaN and answers undefined for a function', async () => {
    expect(
      await evaluateThroughSession(
        fakeSession({
          'Runtime.evaluate': {
            result: {type: 'bigint', unserializableValue: '12n'}
          }
        }),
        '12n'
      )
    ).toEqual({ok: true, value: {__type: 'bigint', value: '12'}})

    expect(
      await evaluateThroughSession(
        fakeSession({
          'Runtime.evaluate': {
            result: {type: 'number', unserializableValue: 'NaN'}
          }
        }),
        '0/0'
      )
    ).toEqual({ok: true, value: null})

    expect(
      await evaluateThroughSession(
        fakeSession({
          'Runtime.evaluate': {result: {type: 'function', objectId: 'fn-1'}}
        }),
        '() => 1'
      )
    ).toEqual({ok: true, value: undefined})
  })

  it('names what the expression threw', async () => {
    expect(
      await evaluateThroughSession(
        fakeSession({
          'Runtime.evaluate': {
            exceptionDetails: {
              text: 'Uncaught',
              exception: {
                className: 'ReferenceError',
                description:
                  'ReferenceError: nope is not defined\r\n    at <anonymous>:1:1'
              }
            }
          }
        }),
        'nope'
      )
    ).toEqual({
      ok: false,
      error: {
        name: 'ReferenceError',
        message: 'nope is not defined',
        engine: 'chromium'
      }
    })
  })
})

describe('evaluateChromiumTabDocument', () => {
  it('evaluates in the tab on that url and closes the session', async () => {
    const session = fakeSession({
      'Runtime.evaluate': {result: {type: 'number', value: 2}}
    })
    const dialed: string[] = []

    const outcome = await evaluateChromiumTabDocument({
      cdpPort: 9222,
      url: DEMO,
      expression: '1 + 1',
      timeoutMs: 1000,
      listTargets: async () => [target(DEMO, 'page', 7)],
      connect: async (webSocketUrl) => {
        dialed.push(webSocketUrl)

        return session
      }
    })

    expect(outcome).toEqual({ok: true, value: 2})
    expect(dialed).toEqual(['ws://127.0.0.1:9222/devtools/page/7'])
    expect(session.closed).toBe(1)
  })

  it('answers nothing when the port or the tab cannot be reached', async () => {
    expect(
      await evaluateChromiumTabDocument({
        cdpPort: 9222,
        url: DEMO,
        expression: '1',
        timeoutMs: 1000,
        listTargets: async () => {
          throw new Error('ECONNREFUSED')
        }
      })
    ).toBeUndefined()

    expect(
      await evaluateChromiumTabDocument({
        cdpPort: 9222,
        url: DEMO,
        expression: '1',
        timeoutMs: 1000,
        listTargets: async () => [target(DEMO, 'page', 1), target(DEMO)],
        connect: async () => {
          throw new Error('never dialed')
        }
      })
    ).toBeUndefined()
  })

  it('times out an expression that never settles', async () => {
    const session = {
      closed: 0,
      send: () => new Promise<Record<string, unknown>>(() => {}),
      close: () => {
        session.closed++
      }
    }

    const outcome = await evaluateChromiumTabDocument({
      cdpPort: 9222,
      url: DEMO,
      expression: 'new Promise(() => {})',
      timeoutMs: 20,
      listTargets: async () => [target(DEMO)],
      connect: async () => session
    })

    expect(outcome).toEqual({
      ok: false,
      error: {
        name: 'Timeout',
        message: 'the expression did not settle in the page within 20ms',
        engine: 'chromium'
      }
    })

    expect(session.closed).toBe(1)
  })
})
