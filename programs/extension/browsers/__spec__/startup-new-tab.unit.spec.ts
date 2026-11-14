import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  ensureStartupNewTab,
  startupSeedWasDropped
} from '../run-chromium/cdp/ensure-startup-new-tab'

interface Call {
  method: string
  params?: Record<string, unknown>
  sessionId?: string
  timeoutMs?: number
}

// The settings bindings land a beat after the target exists: an answer that
// is not a boolean, or no answer at all until the page is navigated.
function transportFor(options: {
  answers?: Array<boolean | undefined>
  silentUntilNavigate?: boolean
  alwaysSilent?: boolean
  targetId?: string | null
  sessionId?: string | null
}) {
  const calls: Call[] = []
  const answers = [...(options.answers ?? [])]
  let navigated = false

  const transport = {
    async sendCommand(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
      timeoutMs?: number
    ) {
      calls.push({method, params, sessionId, timeoutMs})

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

      if (method === 'Page.navigate') {
        navigated = true

        return {frameId: 'f1'}
      }

      if (method === 'Runtime.evaluate') {
        const silent =
          options.alwaysSilent || (options.silentUntilNavigate && !navigated)

        if (silent) {
          throw Object.assign(
            new Error(`CDP command timed out (${timeoutMs}ms): ${method}`),
            {code: 'E_CDP_TIMEOUT'}
          )
        }

        return {result: {value: answers.length ? answers.shift() : true}}
      }

      return {}
    }
  }

  return {transport, calls}
}

const noSleep = async () => {}

const methods = (calls: Call[]) => calls.map((call) => call.method)

describe('the startup choice the profile seed cannot reach', () => {
  it('asks for a new tab on startup through the settings page and closes the tab it opened', async () => {
    const {transport, calls} = transportFor({answers: [true]})

    await expect(
      ensureStartupNewTab({transport, sleep: noSleep})
    ).resolves.toBe('set')

    expect(methods(calls)).toEqual([
      'Target.createTarget',
      'Target.attachToTarget',
      'Runtime.evaluate',
      'Target.closeTarget'
    ])

    expect(calls[0].params).toMatchObject({
      url: 'chrome://settings',
      background: true
    })

    expect(String(calls[2].params?.expression)).toContain(
      "setPref('session.restore_on_startup', 5)"
    )

    expect(calls[2].sessionId).toBe('s1')
    expect(calls[3].params).toEqual({targetId: 't1'})
  })

  it('asks again while the settings bindings are not there yet', async () => {
    const {transport, calls} = transportFor({
      answers: [undefined, undefined, true]
    })
    const slept: number[] = []

    await expect(
      ensureStartupNewTab({
        transport,
        sleep: async (ms) => {
          slept.push(ms)
        }
      })
    ).resolves.toBe('set')

    expect(methods(calls).filter((m) => m === 'Runtime.evaluate')).toHaveLength(
      3
    )

    expect(slept).toEqual([200, 200])
  })

  it('navigates a target that answers nothing, once, and asks again', async () => {
    const {transport, calls} = transportFor({silentUntilNavigate: true})

    await expect(
      ensureStartupNewTab({transport, sleep: noSleep})
    ).resolves.toBe('set')

    expect(methods(calls).filter((m) => m === 'Page.navigate')).toHaveLength(1)
    expect(methods(calls).at(-1)).toBe('Target.closeTarget')
  })

  // Four reads at the answer timeout each is the most a launch ever pays.
  it('gives up on a target that never answers and still closes its tab', async () => {
    const {transport, calls} = transportFor({alwaysSilent: true})

    await expect(
      ensureStartupNewTab({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')

    expect(methods(calls).filter((m) => m === 'Runtime.evaluate')).toHaveLength(
      4
    )

    expect(methods(calls).at(-1)).toBe('Target.closeTarget')
  })

  it('answers unavailable when the browser refuses the write', async () => {
    const {transport, calls} = transportFor({answers: [false]})

    await expect(
      ensureStartupNewTab({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')

    expect(methods(calls).at(-1)).toBe('Target.closeTarget')
  })

  it('answers unavailable, with no tab left to close, when no target opens', async () => {
    const {transport, calls} = transportFor({targetId: null})

    await expect(
      ensureStartupNewTab({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')

    expect(methods(calls)).toEqual(['Target.createTarget'])
  })

  it('closes the tab when the target cannot be attached', async () => {
    const {transport, calls} = transportFor({sessionId: null})

    await expect(
      ensureStartupNewTab({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')

    expect(methods(calls).at(-1)).toBe('Target.closeTarget')
  })

  it('never throws when the wire breaks', async () => {
    const transport = {
      async sendCommand() {
        throw new Error('pipe closed')
      }
    }

    await expect(
      ensureStartupNewTab({transport, sleep: noSleep})
    ).resolves.toBe('unavailable')
  })
})

describe('reading whether the browser dropped the seeded startup choice', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) {
      fs.rmSync(dirs.pop() as string, {recursive: true, force: true})
    }
  })

  function profile(files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-seed-'))
    dirs.push(dir)
    fs.mkdirSync(path.join(dir, 'Default'), {recursive: true})

    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, 'Default', name), text)
    }

    return dir
  }

  const seeded = JSON.stringify({session: {restore_on_startup: 5}})

  it('says dropped when the seed is there and the browser holds no value', () => {
    expect(startupSeedWasDropped(profile({Preferences: seeded}))).toBe(true)

    expect(
      startupSeedWasDropped(
        profile({Preferences: seeded, 'Secure Preferences': '{"session":{}}'})
      )
    ).toBe(true)
  })

  // Whatever the browser holds is a choice made in it, and it is kept.
  it('says kept when the browser holds any value of its own', () => {
    for (const value of [1, 4, 5]) {
      const kept = JSON.stringify({session: {restore_on_startup: value}})

      expect(
        startupSeedWasDropped(
          profile({Preferences: seeded, 'Secure Preferences': kept})
        )
      ).toBe(false)
    }
  })

  it('says nothing was dropped on a profile this CLI did not seed', () => {
    expect(startupSeedWasDropped(profile({}))).toBe(false)
    expect(startupSeedWasDropped(profile({Preferences: '{}'}))).toBe(false)
    expect(startupSeedWasDropped(profile({Preferences: 'not json'}))).toBe(
      false
    )

    expect(
      startupSeedWasDropped(
        profile({
          Preferences: JSON.stringify({session: {restore_on_startup: 1}})
        })
      )
    ).toBe(false)

    expect(
      startupSeedWasDropped(path.join(os.tmpdir(), 'no-such-profile'))
    ).toBe(false)
  })
})
