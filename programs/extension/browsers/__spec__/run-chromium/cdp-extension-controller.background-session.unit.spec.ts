import {describe, expect, it, vi} from 'vitest'
import {CDPExtensionController} from '../../run-chromium/cdp/cdp-extension-controller'

const ID = 'abcdefghijklmnopabcdefghijklmnop'

type Target = {type: string; url: string; targetId: string}

function makeController(
  listings: Target[][],
  evaluate: () => Promise<unknown> = async () => ({result: {value: 7}})
) {
  const controller = new CDPExtensionController({
    outPath: '/nowhere/dist/chrome',
    browser: 'chrome',
    cdpPort: 9222
  }) as any
  let listing = 0
  const sendCommand = vi.fn(async (method: string) => {
    if (method === 'Runtime.evaluate') return evaluate()

    return {}
  })

  controller.extensionIdValue = ID
  controller.cdp = {
    getTargets: vi.fn(
      async () => listings[Math.min(listing++, listings.length - 1)]
    ),
    attachToTarget: vi.fn(async (targetId: string) => `session-${targetId}`),
    sendCommand
  }

  return {controller, sendCommand}
}

const worker: Target = {
  type: 'service_worker',
  url: `chrome-extension://${ID}/background/service_worker.js`,
  targetId: 'worker'
}

const detached = (sendCommand: ReturnType<typeof vi.fn>) =>
  sendCommand.mock.calls.filter((call) => call[0] === 'Target.detachFromTarget')

describe('a session on the background of a loaded extension', () => {
  it('attaches once to the worker of this extension and reads many times', async () => {
    const {controller, sendCommand} = makeController([
      [
        {type: 'page', url: 'about:blank', targetId: 'tab'},
        {
          type: 'service_worker',
          url: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/sw.js',
          targetId: 'companion'
        },
        {
          type: 'page',
          url: `chrome-extension://${ID}/options.html`,
          targetId: 'options'
        },
        worker
      ]
    ])

    const session = await controller.openBackgroundSession()

    await expect(session.evaluate('1 + 6', 5000)).resolves.toBe(7)
    await expect(session.evaluate('1 + 6', 2000)).resolves.toBe(7)

    expect(controller.cdp.attachToTarget).toHaveBeenCalledTimes(1)
    expect(controller.cdp.attachToTarget).toHaveBeenCalledWith('worker')
    expect(controller.cdp.getTargets).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      {expression: '1 + 6', returnByValue: true, awaitPromise: true},
      'session-worker',
      5200
    )

    expect(detached(sendCommand)).toHaveLength(0)
  })

  it('detaches once on release and reads nothing afterwards', async () => {
    const {controller, sendCommand} = makeController([[worker]])
    const session = await controller.openBackgroundSession()

    session.release()
    session.release()

    expect(detached(sendCommand)).toEqual([
      ['Target.detachFromTarget', {sessionId: 'session-worker'}]
    ])

    await expect(session.evaluate('1', 1000)).resolves.toBeUndefined()

    expect(
      sendCommand.mock.calls.filter((call) => call[0] === 'Runtime.evaluate')
    ).toHaveLength(0)
  })

  it('waits for a background that has not shown yet', async () => {
    const {controller} = makeController([[], [], [worker]])
    const session = await controller.openBackgroundSession({intervalMs: 1})

    await expect(session.evaluate('1', 1000)).resolves.toBe(7)

    expect(controller.cdp.getTargets).toHaveBeenCalledTimes(3)
  })

  it('opens nothing, attached to nothing, when no background shows', async () => {
    const {controller, sendCommand} = makeController([[]])

    await expect(
      controller.openBackgroundSession({attempts: 3, intervalMs: 1})
    ).resolves.toBeUndefined()

    expect(controller.cdp.attachToTarget).not.toHaveBeenCalled()
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('answers undefined for an expression that threw', async () => {
    const {controller} = makeController([[worker]], async () => ({
      result: {type: 'object', subtype: 'error'},
      exceptionDetails: {text: 'Uncaught'}
    }))
    const session = await controller.openBackgroundSession()

    await expect(session.evaluate('nope()', 1000)).resolves.toBeUndefined()
  })

  it('passes a failed command on, and stays open for the caller to release', async () => {
    const {controller, sendCommand} = makeController([[worker]], async () => {
      throw new Error('CDP command timed out')
    })
    const session = await controller.openBackgroundSession()

    await expect(session.evaluate('1', 1000)).rejects.toThrow('timed out')

    expect(detached(sendCommand)).toHaveLength(0)
  })

  it('opens nothing before the controller is connected', async () => {
    const controller = new CDPExtensionController({
      outPath: '/nowhere/dist/chrome',
      browser: 'chrome',
      cdpPort: 9222
    })

    await expect(controller.openBackgroundSession()).resolves.toBeUndefined()
  })
})
