import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  developerModeFlipIsSafe,
  developerModeFromProfile,
  ensureDeveloperMode
} from '../run-chromium/cdp/ensure-developer-mode'

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
      'Target.closeTarget'
    ])

    expect(calls[0].params).toMatchObject({
      url: 'chrome://extensions',
      background: true
    })

    expect(calls[4].params).toEqual({targetId: 't1'})
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

describe('the two checks that decide whether to flip it', () => {
  const made: string[] = []

  afterEach(() => {
    for (const dir of made.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  function profileWith(securePreferences: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devmode-profile-'))
    made.push(dir)
    fs.mkdirSync(path.join(dir, 'Default'), {recursive: true})

    if (securePreferences !== undefined) {
      fs.writeFileSync(
        path.join(dir, 'Default', 'Secure Preferences'),
        JSON.stringify(securePreferences)
      )
    }

    return dir
  }

  it('reads the toggle back from Secure Preferences, where Chromium keeps it', () => {
    const on = profileWith({extensions: {ui: {developer_mode: true}}})
    const off = profileWith({extensions: {ui: {developer_mode: false}}})

    expect(developerModeFromProfile(on)).toBe(true)
    expect(developerModeFromProfile(off)).toBe(false)
  })

  it('treats a fresh profile with no Secure Preferences as off', () => {
    expect(developerModeFromProfile(profileWith(undefined))).toBe(false)
  })

  it('ignores the plain Preferences copy, which Chromium drops on load', () => {
    const dir = profileWith(undefined)
    fs.writeFileSync(
      path.join(dir, 'Default', 'Preferences'),
      JSON.stringify({extensions: {ui: {developer_mode: true}}})
    )

    expect(developerModeFromProfile(dir)).toBe(false)
  })

  it('does not flip it when the browser was parked without a window', () => {
    expect(developerModeFlipIsSafe(['--user-data-dir=/p'])).toBe(true)
    expect(
      developerModeFlipIsSafe(['--user-data-dir=/p', '--no-startup-window'])
    ).toBe(false)
  })
})
