import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  developerModeFlipIsSafe,
  ensureDeveloperMode,
  readGuestDisableReasons
} from '../../run-chromium/cdp/ensure-developer-mode'

interface Call {
  method: string
  params?: Record<string, unknown>
  sessionId?: string
}

function transportFor(options: {
  reads: Array<boolean | undefined>
  write?: boolean | undefined
  targetId?: string | null
  sessionId?: string | null
}) {
  const calls: Call[] = []
  const reads = [...options.reads]

  const transport = {
    async sendCommand(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string
    ) {
      calls.push({method, params, sessionId})

      if (method === 'Target.createTarget') {
        return options.targetId === null
          ? {}
          : {targetId: options.targetId ?? 't1'}
      }

      if (method === 'Target.attachToTarget') {
        return options.sessionId === null
          ? {}
          : {sessionId: options.sessionId ?? 's1'}
      }

      if (method === 'Runtime.evaluate') {
        const expression = String(params?.expression ?? '')

        if (expression.includes('updateProfileConfiguration')) {
          return {result: {value: options.write}}
        }

        return {result: {value: reads.shift()}}
      }

      return {}
    }
  }

  return {transport, calls}
}

// Vivaldi 8.3: the created target keeps an empty url and every evaluate on
// it runs into the command timeout until the page is navigated by hand.
function silentTransport(options: {answersAfterNavigate: boolean}) {
  const calls: Array<Call & {timeoutMs?: number}> = []
  let navigated = false

  const transport = {
    async sendCommand(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
      timeoutMs?: number
    ) {
      calls.push({method, params, sessionId, timeoutMs})

      if (method === 'Target.createTarget') return {targetId: 't1'}
      if (method === 'Target.attachToTarget') return {sessionId: 's1'}

      if (method === 'Page.navigate') {
        navigated = true

        return {frameId: 'f1'}
      }

      if (method === 'Runtime.evaluate') {
        if (!navigated || !options.answersAfterNavigate) {
          throw Object.assign(
            new Error(`CDP command timed out (${timeoutMs}ms): ${method}`),
            {code: 'E_CDP_TIMEOUT'}
          )
        }

        const expression = String(params?.expression ?? '')

        return {
          result: {value: expression.includes('updateProfileConfiguration')}
        }
      }

      return {}
    }
  }

  return {transport, calls}
}

const noSleep = async () => {}

describe('the developer-mode toggle the profile seed cannot reach', () => {
  it('turns it on through the extensions page and closes the tab it opened', async () => {
    const {transport, calls} = transportFor({reads: [false], write: true})

    await expect(
      ensureDeveloperMode({transport, sleep: noSleep})
    ).resolves.toBe('enabled')

    expect(calls.map((call) => call.method)).toEqual([
      'Target.createTarget',
      'Target.attachToTarget',
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Target.getTargets',
      'Target.closeTarget'
    ])

    expect(calls[0].params).toMatchObject({
      url: 'chrome://extensions',
      background: true
    })

    expect(calls.at(-1)?.params).toEqual({targetId: 't1'})
  })

  it('leaves a profile that is already in developer mode alone', async () => {
    const {transport, calls} = transportFor({reads: [true]})

    await expect(
      ensureDeveloperMode({transport, sleep: noSleep})
    ).resolves.toBe('already-on')

    const evaluations = calls.filter(
      (call) => call.method === 'Runtime.evaluate'
    )
    expect(evaluations).toHaveLength(1)
    expect(String(evaluations[0].params?.expression)).not.toContain(
      'updateProfileConfiguration'
    )
  })

  it('retries while the WebUI bindings are still landing', async () => {
    const {transport, calls} = transportFor({
      reads: [undefined, undefined, false],
      write: true
    })

    await expect(
      ensureDeveloperMode({transport, sleep: noSleep})
    ).resolves.toBe('enabled')

    expect(
      calls.filter((call) => call.method === 'Runtime.evaluate')
    ).toHaveLength(4)
  })

  it('gives up quietly when the page never answers, and still closes the tab', async () => {
    const {transport, calls} = transportFor({reads: []})

    await expect(
      ensureDeveloperMode({transport, attempts: 3, sleep: noSleep})
    ).resolves.toBe('unavailable')

    expect(calls.at(-1)?.method).toBe('Target.closeTarget')
  })

  it('navigates a target that never committed its url, then flips the toggle', async () => {
    const {transport, calls} = silentTransport({answersAfterNavigate: true})

    await expect(
      ensureDeveloperMode({transport, sleep: noSleep})
    ).resolves.toBe('enabled')

    expect(calls.map((call) => call.method)).toEqual([
      'Target.createTarget',
      'Target.attachToTarget',
      'Runtime.evaluate',
      'Page.navigate',
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Target.getTargets',
      'Target.closeTarget'
    ])

    expect(calls[3]).toMatchObject({
      params: {url: 'chrome://extensions'},
      sessionId: 's1'
    })
  })

  it('stops after a few unanswered reads instead of outlasting the launch watchdog', async () => {
    const {transport, calls} = silentTransport({answersAfterNavigate: false})

    await expect(
      ensureDeveloperMode({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')

    const reads = calls.filter((call) => call.method === 'Runtime.evaluate')

    expect(reads).toHaveLength(4)
    // Every read carries its own short budget, never the 12s command default.
    expect(reads.every((call) => call.timeoutMs === 2000)).toBe(true)
    expect(
      calls.filter((call) => call.method === 'Page.navigate')
    ).toHaveLength(1)

    expect(calls.at(-1)?.method).toBe('Target.closeTarget')
  })

  it('opens no tab at all when the browser refuses the target', async () => {
    const {transport, calls} = transportFor({reads: [false], targetId: null})

    await expect(
      ensureDeveloperMode({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')

    expect(calls.map((call) => call.method)).toEqual(['Target.createTarget'])
  })

  it('reports unavailable when the toggle itself is refused', async () => {
    const {transport} = transportFor({reads: [false], write: false})

    await expect(
      ensureDeveloperMode({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')
  })
})

describe('the check that decides whether to flip it', () => {
  it('does not flip it when the browser was parked without a window', () => {
    expect(developerModeFlipIsSafe(['--user-data-dir=/p'])).toBe(true)
    expect(
      developerModeFlipIsSafe(['--user-data-dir=/p', '--no-startup-window'])
    ).toBe(false)
  })
})

describe('why the browser holds the guest turned off', () => {
  const GUEST = path.join(os.tmpdir(), 'guest', 'dist', 'chrome')

  function pageAnswering(answers: unknown[]) {
    const calls: Call[] = []
    const left = [...answers]

    const transport = {
      async sendCommand(
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string
      ) {
        calls.push({method, params, sessionId})

        if (method === 'Target.createTarget') return {targetId: 't1'}
        if (method === 'Target.attachToTarget') return {sessionId: 's1'}

        if (method === 'Runtime.evaluate') {
          return {result: {value: left.shift()}}
        }

        return {}
      }
    }

    return {transport, calls}
  }

  const states = (entries: unknown[]) => JSON.stringify(entries)
  const read = (transport: ReturnType<typeof pageAnswering>['transport']) =>
    readGuestDisableReasons({
      transport,
      extensionPath: GUEST,
      sleep: async () => {}
    })

  it('names the reasons of a guest the browser turned off', async () => {
    const {transport, calls} = pageAnswering([
      states([
        {path: '/elsewhere', state: 'ENABLED', reasons: []},
        {
          path: `${GUEST}${path.sep}`,
          state: 'DISABLED',
          reasons: ['unsupportedDeveloperExtension']
        }
      ])
    ])

    expect(await read(transport)).toEqual(['unsupportedDeveloperExtension'])
    expect(calls.at(-1)?.method).toBe('Target.closeTarget')
  })

  it('answers no reasons for a guest that is on', async () => {
    const {transport} = pageAnswering([
      states([{path: GUEST, state: 'ENABLED', reasons: []}])
    ])

    expect(await read(transport)).toEqual([])
  })

  it('asks again while the page has no answer yet', async () => {
    const {transport} = pageAnswering([
      undefined,
      states([{path: GUEST, state: 'DISABLED', reasons: ['userAction']}])
    ])

    expect(await read(transport)).toEqual(['userAction'])
  })

  it('answers nothing for a guest the browser does not list', async () => {
    const {transport} = pageAnswering([
      states([{path: '/elsewhere', state: 'DISABLED', reasons: ['userAction']}])
    ])

    expect(await read(transport)).toBeUndefined()
  })
})
