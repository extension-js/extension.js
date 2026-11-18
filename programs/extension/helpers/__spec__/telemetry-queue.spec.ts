import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {Telemetry, TelemetryEnv, TelemetryProps} from '../telemetry'
import {readRows, type Sandbox, useTelemetrySandbox} from './telemetry-sandbox'

const sandbox = useTelemetrySandbox()

function track(
  telemetry: Telemetry,
  props: Partial<TelemetryProps> = {},
  event: 'command_executed' | 'command_failed' = 'command_executed'
) {
  telemetry.track(event, {
    command: 'build',
    success: event === 'command_executed',
    version: '9.9.9',
    ...props
  })
}

function audited(box: Sandbox): string[] {
  const file = path.join(box.configDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []

  return readRows(file).map((row) => String(row.properties.command))
}

async function sentCommands(box: Sandbox, telemetry: Telemetry) {
  await telemetry.flush()

  return box.sentRows().map((row) => String(row.properties.command))
}

describe('sampling', () => {
  it.each<[string, TelemetryEnv, number, boolean]>([
    ['the default rate keeps a roll at the rate', {}, 0.2, true],
    ['the default rate drops a roll above it', {}, 0.21, false],
    [
      'a rate of 1 keeps every roll',
      {EXTENSION_TELEMETRY_SAMPLE_RATE: '1'},
      0.99,
      true
    ],
    [
      'a rate of 0 drops every roll',
      {EXTENSION_TELEMETRY_SAMPLE_RATE: '0'},
      0.01,
      false
    ],
    [
      'a rate above 1 is held at 1',
      {EXTENSION_TELEMETRY_SAMPLE_RATE: '7'},
      0.99,
      true
    ],
    [
      'a rate below 0 is held at 0',
      {EXTENSION_TELEMETRY_SAMPLE_RATE: '-1'},
      0,
      true
    ]
  ])('%s', async (_name, env, roll, kept) => {
    const box = sandbox({env, deps: {random: () => roll}})
    const telemetry = box.telemetry({})

    track(telemetry)

    // The audit line is written before the roll, kept or not.
    expect(audited(box)).toEqual(['build'])
    expect(await sentCommands(box, telemetry)).toEqual(kept ? ['build'] : [])
  })

  it('drops every success row when the rate is not a number', async () => {
    const box = sandbox({
      env: {EXTENSION_TELEMETRY_SAMPLE_RATE: '20%'},
      deps: {random: () => 0.0001}
    })
    const telemetry = box.telemetry({})

    track(telemetry)

    // Pins today's behavior. Ledger 1372 D33.
    expect(await sentCommands(box, telemetry)).toEqual([])
  })

  it.each<
    [string, Partial<TelemetryProps>, 'command_executed' | 'command_failed']
  >([
    ['a failure', {}, 'command_failed'],
    ['a create', {command: 'create'}, 'command_executed'],
    ['a session start', {session: 'started'}, 'command_executed'],
    ['a session ready', {session: 'ready'}, 'command_executed']
  ])('never samples away %s', async (_name, props, event) => {
    const box = sandbox({
      env: {EXTENSION_TELEMETRY_SAMPLE_RATE: '0'},
      deps: {random: () => 0.99}
    })
    const telemetry = box.telemetry({})

    track(telemetry, props, event)

    expect(await sentCommands(box, telemetry)).toHaveLength(1)
  })
})

describe('repeats inside the debounce window', () => {
  it.each<[string, TelemetryEnv, number, number]>([
    ['the default window drops a repeat at 59,999 ms', {}, 59_999, 1],
    ['the default window keeps a repeat at 60,000 ms', {}, 60_000, 2],
    [
      'a 10 ms window keeps a repeat at 10 ms',
      {EXTENSION_TELEMETRY_DEBOUNCE_MS: '10'},
      10,
      2
    ],
    [
      'a 0 ms window keeps every repeat',
      {EXTENSION_TELEMETRY_DEBOUNCE_MS: '0'},
      0,
      2
    ]
  ])('%s', (_name, env, gap, rows) => {
    const box = sandbox({env})
    const telemetry = box.telemetry({})

    track(telemetry)
    box.clock.now += gap
    track(telemetry)

    expect(audited(box)).toHaveLength(rows)
  })

  it('keeps every repeat when the window is not a number', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY_DEBOUNCE_MS: '1m'}})
    const telemetry = box.telemetry({})

    track(telemetry)
    track(telemetry)

    // Pins today's behavior. Ledger 1372 D33.
    expect(audited(box)).toHaveLength(2)
  })

  it('counts the command, outcome and session state as what repeats', () => {
    const box = sandbox()
    const telemetry = box.telemetry({})

    track(telemetry, {command: 'build'})
    track(telemetry, {command: 'dev'})
    track(telemetry, {command: 'build'}, 'command_failed')
    track(telemetry, {command: 'dev', session: 'started'})
    track(telemetry, {command: 'dev', session: 'ready'})
    track(telemetry, {command: 'dev', session: 'ready'})

    expect(audited(box)).toEqual(['build', 'dev', 'build'])
  })
})

describe('a full queue', () => {
  it.each<[string, TelemetryEnv, number]>([
    ['the default holds three rows a run', {}, 3],
    [
      'EXTENSION_TELEMETRY_MAX_EVENTS=1 holds one',
      {EXTENSION_TELEMETRY_MAX_EVENTS: '1'},
      1
    ],
    [
      'EXTENSION_TELEMETRY_MAX_EVENTS=0 holds none',
      {EXTENSION_TELEMETRY_MAX_EVENTS: '0'},
      0
    ]
  ])('%s, and audits only what it holds', async (_name, env, held) => {
    const box = sandbox({env})
    const telemetry = box.telemetry({debounceMs: 0, sampleRate: 1})

    for (let i = 0; i < 5; i++) track(telemetry, {command: `c${i}`})

    const expected = ['c0', 'c1', 'c2', 'c3', 'c4'].slice(0, held)
    expect(audited(box)).toEqual(expected)
    expect(await sentCommands(box, telemetry)).toEqual(expected)
  })

  it('counts sampled-away rows against nothing', async () => {
    const box = sandbox({deps: {random: () => 0.9}})
    const telemetry = box.telemetry({debounceMs: 0})

    for (let i = 0; i < 5; i++) track(telemetry, {command: `c${i}`})
    track(telemetry, {command: 'create'})

    expect(audited(box)).toHaveLength(6)
    expect(await sentCommands(box, telemetry)).toEqual(['create'])
  })

  it('holds no limit when the cap is not a number', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY_MAX_EVENTS: 'three'}})
    const telemetry = box.telemetry({debounceMs: 0, sampleRate: 1})

    for (let i = 0; i < 10; i++) track(telemetry, {command: `c${i}`})

    // Pins today's behavior. Ledger 1372 D33.
    expect(audited(box)).toHaveLength(10)
  })
})

describe('turning a run off', () => {
  it('drops what it queued and records nothing more', async () => {
    const box = sandbox()
    const telemetry = box.telemetry({sampleRate: 1})

    track(telemetry, {command: 'queued'})
    telemetry.disable()
    track(telemetry, {command: 'after'})
    await telemetry.flush()

    expect(telemetry.isEnabled).toBe(false)
    expect(audited(box)).toEqual(['queued'])
    expect(box.sent).toEqual([])
    expect(telemetry.flushSync(1000)).toBe(false)
  })

  it('creates no storage at all for a run that starts disabled', () => {
    const box = sandbox()
    const telemetry = box.telemetry({disabled: true})

    track(telemetry)

    expect(telemetry.isEnabled).toBe(false)
    expect(fs.readdirSync(box.root).sort()).toEqual(['home', 'project', 'tmp'])
  })

  it('never throws out of track, whatever the props hold', () => {
    const box = sandbox()
    const telemetry = box.telemetry({})
    const hostile = {
      get command(): string {
        throw new Error('boom')
      }
    }

    expect(() =>
      telemetry.track('command_executed', hostile as unknown as TelemetryProps)
    ).not.toThrow()

    expect(audited(box)).toEqual([])
  })
})
