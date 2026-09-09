import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// A killed `dev` session used to report nothing at all: the success mark ran
// after `parseAsync` resolved, which a watch loop never does, and Node emits no
// `beforeExit` for a signal death. These specs pin both halves of the fix, the
// event that leaves at session start and the flush that survives the signal.

type SentEvent = {
  event: string
  properties: Record<string, unknown>
  distinct_id: string
}

// Each load registers this module's own process hooks, and the specs load it
// many times on purpose. The cap is about leaks, and these are deliberate.
process.setMaxListeners(50)

const originalEnv = {...process.env}
const originalArgv = [...process.argv]
const sandboxes: string[] = []

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value
  }
}

function isolatedHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-session-'))
  sandboxes.push(home)
  return home
}

async function loadTelemetry(
  env: Record<string, string | undefined> = {},
  argv: string[] = ['node', 'extension', 'dev']
) {
  const home = isolatedHome()
  process.env.XDG_CONFIG_HOME = home
  process.env.XDG_CACHE_HOME = home
  // Explicit opt-in so a CI marker on the machine running the suite does not
  // decide the outcome of a test about consent.
  process.env.EXTENSION_TELEMETRY = '1'
  delete process.env.EXTENSION_TELEMETRY_DISABLED
  process.env.POSTHOG_HOST = 'http://127.0.0.1:1'
  process.env.POSTHOG_KEY = 'phc_test_key'
  // Zero, so anything that arrives proves it was never up for sampling.
  process.env.EXTENSION_TELEMETRY_SAMPLE_RATE = '0'
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  process.argv = argv

  vi.resetModules()
  const cli = await import('../telemetry-cli')
  const signals = await import('../telemetry-signals')
  return {cli, signals}
}

function captureSends(): SentEvent[] {
  const sent: SentEvent[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: {body?: string}) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        batch?: SentEvent[]
      }
      for (const event of body.batch ?? []) sent.push(event)
      return new Response('{"status":1}', {status: 200})
    })
  )
  return sent
}

function fakeDeps(
  overrides: Partial<{
    sessionStarted: boolean
    othersOwnTermination: boolean
    markInterrupted: (exitCode: number) => void
    flush: () => Promise<void>
  }> = {}
) {
  const exits: number[] = []
  const order: string[] = []
  const deps = {
    sessionStarted: () => Boolean(overrides.sessionStarted),
    markInterrupted:
      overrides.markInterrupted ??
      (() => {
        order.push('mark')
      }),
    flush:
      overrides.flush ??
      (async () => {
        order.push('flush')
      }),
    othersOwnTermination: () => Boolean(overrides.othersOwnTermination),
    exit: async (code: number) => {
      order.push('exit')
      exits.push(code)
    }
  }
  return {deps, exits, order}
}

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = isolatedHome()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  restoreEnv()
  process.argv = [...originalArgv]
  for (const dir of sandboxes.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('a watch session is counted when it starts', () => {
  it('sends command_executed for dev without waiting for an exit', async () => {
    const {cli} = await loadTelemetry()
    const sent = captureSends()

    cli.markCommandSessionStart('dev')

    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('command_executed')
    expect(sent[0].properties.command).toBe('dev')
    expect(sent[0].properties.success).toBe(true)
    expect(sent[0].properties.session).toBe('started')
  })

  it('keeps the markers that separate real users from this repo and from CI', async () => {
    const {cli} = await loadTelemetry()
    const sent = captureSends()

    cli.markCommandSessionStart('start')

    expect(typeof sent[0].properties.is_source_build).toBe('boolean')
    expect(typeof sent[0].properties.is_ci).toBe('boolean')
    expect(sent[0].properties.$ip).toBeNull()
  })

  it('is not sampled away, so the failure rate has a matching denominator', async () => {
    // Sampling is zero for this load: an ordinary command_executed cannot
    // survive it, and the session row has to.
    const {cli} = await loadTelemetry()
    const sent = captureSends()

    cli.markCommandSessionStart('preview')
    expect(sent).toHaveLength(1)

    const other = await loadTelemetry()
    const otherSent = captureSends()
    other.cli.markCommandSuccess('build')
    await other.cli.telemetry.flush()
    expect(otherSent).toHaveLength(0)
  })

  it('counts one run once, and still lets a later failure travel', async () => {
    const {cli} = await loadTelemetry()
    const sent = captureSends()

    cli.markCommandSessionStart('dev')
    cli.markCommandSuccess('dev')
    await cli.telemetry.flush()
    expect(sent).toHaveLength(1)

    cli.markCommandFailure('dev', {code: 'E_COMPILE', exitCode: 1})
    await cli.telemetry.flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].event).toBe('command_failed')
    expect(sent[1].properties.code).toBe('E_COMPILE')
  })

  it('sends nothing at all when the run opted out', async () => {
    const {cli} = await loadTelemetry({EXTENSION_TELEMETRY_DISABLED: '1'})
    const sent = captureSends()

    cli.markCommandSessionStart('dev')
    await cli.telemetry.flush()

    expect(sent).toEqual([])
  })

  it('sends nothing at all under --no-telemetry', async () => {
    const {cli} = await loadTelemetry({EXTENSION_TELEMETRY: undefined}, [
      'node',
      'extension',
      'dev',
      '--no-telemetry'
    ])
    const sent = captureSends()

    cli.markCommandSessionStart('dev')
    await cli.telemetry.flush()

    expect(sent).toEqual([])
  })
})

describe('a signal is an ending the CLI has to report', () => {
  it('flushes a command_failed for a run interrupted before it finished', async () => {
    const {cli, signals} = await loadTelemetry()
    const sent = captureSends()

    await signals.handleTerminationSignal('SIGINT', {
      sessionStarted: () => false,
      markInterrupted: (exitCode) =>
        cli.markCommandFailure('build', {code: 'E_INTERRUPTED', exitCode}),
      flush: () => cli.telemetry.flush(),
      othersOwnTermination: () => false,
      exit: async () => {}
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('command_failed')
    expect(sent[0].properties.command).toBe('build')
    expect(sent[0].properties.code).toBe('E_INTERRUPTED')
    expect(sent[0].properties.exit_code).toBe(130)
  })

  it('flushes before it exits, never after', async () => {
    const {signals} = await loadTelemetry()
    const {deps, order, exits} = fakeDeps()

    await signals.handleTerminationSignal('SIGINT', deps)

    expect(order).toEqual(['mark', 'flush', 'exit'])
    expect(exits).toEqual([130])
  })

  it('adds no second row when the session already reported its start', async () => {
    const {signals} = await loadTelemetry()
    const {deps, order, exits} = fakeDeps({sessionStarted: true})

    await signals.handleTerminationSignal('SIGTERM', deps)

    expect(order).toEqual(['flush', 'exit'])
    // A session that came up ends the way it always has, at zero.
    expect(exits).toEqual([0])
  })

  it('leaves the exit to the dev server and browser handlers that own it', async () => {
    const {signals} = await loadTelemetry()
    const {deps, exits} = fakeDeps({
      sessionStarted: true,
      othersOwnTermination: true
    })

    await signals.handleTerminationSignal('SIGINT', deps)

    expect(exits).toEqual([])
  })

  it('never calls a Ctrl-C of a watch session a failure', async () => {
    const {signals} = await loadTelemetry()
    const marks: number[] = []
    const {deps} = fakeDeps({
      othersOwnTermination: true,
      markInterrupted: (exitCode) => marks.push(exitCode)
    })

    await signals.handleTerminationSignal('SIGINT', deps)

    // The dev server owns this shutdown, and its session already reported
    // itself. Inventing a failure here is the artifact, not the measurement.
    expect(marks).toEqual([])
  })

  it('fires once for a SIGINT followed by a SIGTERM', async () => {
    const {signals} = await loadTelemetry()
    const {deps, exits} = fakeDeps()

    await signals.handleTerminationSignal('SIGINT', deps)
    await signals.handleTerminationSignal('SIGTERM', deps)

    expect(exits).toEqual([130])
  })

  it('gives up on a collector that never answers instead of hanging', async () => {
    const {cli, signals} = await loadTelemetry()
    // Queued but never sent: the send below is the one that never comes back.
    cli.markCommandFailure('dev', {code: 'E_INTERRUPTED', exitCode: 130})
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )

    const started = Date.now()
    await signals.flushTelemetryWithin(60)

    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('the signal listener respects the opt-out', () => {
  it('installs nothing for a run that opted out', async () => {
    const {signals} = await loadTelemetry({EXTENSION_TELEMETRY_DISABLED: '1'})
    const before = process.listenerCount('SIGINT')

    signals.installTelemetrySignalHandlers()

    expect(process.listenerCount('SIGINT')).toBe(before)
    signals.__resetTelemetrySignalsForTest()
  })

  it('installs one listener per signal for a run that reports', async () => {
    const {signals} = await loadTelemetry()
    const beforeInt = process.listenerCount('SIGINT')
    const beforeTerm = process.listenerCount('SIGTERM')

    signals.installTelemetrySignalHandlers()
    signals.installTelemetrySignalHandlers()

    expect(process.listenerCount('SIGINT')).toBe(beforeInt + 1)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm + 1)

    signals.__resetTelemetrySignalsForTest()
    expect(process.listenerCount('SIGINT')).toBe(beforeInt)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm)
  })
})

describe('a command that exits on purpose still reports', () => {
  async function loadExitPath(command: string) {
    const loaded = await loadTelemetry({EXTENSION_TELEMETRY_SAMPLE_RATE: '1'}, [
      'node',
      'extension',
      command
    ])
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)
    const {exitAfterDrain} = await import('../exit-after-drain')
    return {...loaded, exit, exitAfterDrain}
  }

  it('sends command_executed for a success path that calls exitAfterDrain', async () => {
    const {exit, exitAfterDrain} = await loadExitPath('doctor')
    const sent = captureSends()

    await exitAfterDrain(0)

    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('command_executed')
    expect(sent[0].properties.command).toBe('doctor')
    expect(sent[0].properties.success).toBe(true)
    expect(typeof sent[0].properties.is_source_build).toBe('boolean')
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('sends command_failed with the caller exit code, and keeps that code', async () => {
    const {exit, exitAfterDrain} = await loadExitPath('publish')
    const sent = captureSends()

    await exitAfterDrain(1)

    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('command_failed')
    expect(sent[0].properties.command).toBe('publish')
    expect(sent[0].properties.exit_code).toBe(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('leaves a failure that already named its catalog code alone', async () => {
    const {cli, exitAfterDrain} = await loadExitPath('publish')
    const sent = captureSends()

    cli.markCommandFailure('publish', {
      code: 'E_PUBLISH_REJECTED',
      exitCode: 1
    })
    await exitAfterDrain(1)

    expect(sent).toHaveLength(1)
    expect(sent[0].properties.code).toBe('E_PUBLISH_REJECTED')
  })

  it('reports nothing for a verb the CLI does not recognize', async () => {
    const {exitAfterDrain} = await loadExitPath('--ai-help')
    const sent = captureSends()

    await exitAfterDrain(0)

    expect(sent).toEqual([])
  })

  it('reports nothing on the run that turned telemetry off', async () => {
    const {cli, exitAfterDrain} = await loadExitPath('telemetry')
    const sent = captureSends()

    cli.setTelemetryConsent('disabled')
    await exitAfterDrain(0)

    expect(sent).toEqual([])
  })
})
