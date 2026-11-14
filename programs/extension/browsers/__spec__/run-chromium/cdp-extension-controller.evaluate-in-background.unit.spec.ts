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

describe('evaluating in the background of a loaded extension', () => {
  it('evaluates in the worker of this extension and lets the session go', async () => {
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

    await expect(controller.evaluateInBackground('1 + 6', 5000)).resolves.toBe(
      7
    )

    expect(controller.cdp.attachToTarget).toHaveBeenCalledWith('worker')
    expect(sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      {expression: '1 + 6', returnByValue: true, awaitPromise: true},
      'session-worker',
      5200
    )

    expect(sendCommand).toHaveBeenCalledWith('Target.detachFromTarget', {
      sessionId: 'session-worker'
    })
  })

  it('waits for a background that has not shown yet', async () => {
    const {controller} = makeController([[], [], [worker]])

    await expect(
      controller.evaluateInBackground('1', 1000, {intervalMs: 1})
    ).resolves.toBe(7)

    expect(controller.cdp.getTargets).toHaveBeenCalledTimes(3)
  })

  it('answers undefined, attached to nothing, when no background shows', async () => {
    const {controller, sendCommand} = makeController([[]])

    await expect(
      controller.evaluateInBackground('1', 1000, {attempts: 3, intervalMs: 1})
    ).resolves.toBeUndefined()

    expect(controller.cdp.attachToTarget).not.toHaveBeenCalled()
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('answers undefined for an expression that threw', async () => {
    const {controller, sendCommand} = makeController([[worker]], async () => ({
      result: {type: 'object', subtype: 'error'},
      exceptionDetails: {text: 'Uncaught'}
    }))

    await expect(
      controller.evaluateInBackground('nope()', 1000)
    ).resolves.toBeUndefined()

    expect(sendCommand).toHaveBeenCalledWith('Target.detachFromTarget', {
      sessionId: 'session-worker'
    })
  })

  it('lets the session go when the command fails, and passes the failure on', async () => {
    const {controller, sendCommand} = makeController([[worker]], async () => {
      throw new Error('CDP command timed out')
    })

    await expect(controller.evaluateInBackground('1', 1000)).rejects.toThrow(
      'timed out'
    )

    expect(sendCommand).toHaveBeenCalledWith('Target.detachFromTarget', {
      sessionId: 'session-worker'
    })
  })

  it('answers undefined before the controller is connected', async () => {
    const controller = new CDPExtensionController({
      outPath: '/nowhere/dist/chrome',
      browser: 'chrome',
      cdpPort: 9222
    })

    await expect(
      controller.evaluateInBackground('1', 1000)
    ).resolves.toBeUndefined()
  })
})
