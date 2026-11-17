import {EventEmitter} from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {exitAfterDrain} from '../exit-after-drain'
import type {TelemetryCli} from '../telemetry-cli'
import {
  createTelemetrySignals,
  type TerminationSignal,
  type TerminationSignalDeps
} from '../telemetry-signals'
import {cliRun, type Sandbox, useTelemetrySandbox} from './telemetry-sandbox'

// A killed `dev` session used to report nothing at all: the success mark ran
// after `parseAsync` resolved, which a watch loop never does, and Node emits no
// `beforeExit` for a signal death. These specs pin both halves of the fix, the
// event that leaves at session start and the flush that survives the signal.

const sandbox = useTelemetrySandbox()

afterEach(() => {
  vi.useRealTimers()
})

// An opted-in run with sampling at zero, so anything that arrives proves it
// was never up for sampling.
function reportingRun(
  env: Record<string, string | undefined> = {},
  argv: string[] = ['node', 'extension', 'dev']
) {
  const box = sandbox({
    env: {
      EXTENSION_TELEMETRY: '1',
      EXTENSION_TELEMETRY_SAMPLE_RATE: '0',
      ...env
    },
    deps: {random: () => 0.5}
  })

  return {box, ...cliRun(box, {argv})}
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('a watch session is counted when it starts', () => {
  it('sends command_executed for dev without waiting for an exit', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionStart('dev')
    await settle()

    expect(box.sentRows()).toEqual([
      {
        event: 'command_executed',
        distinct_id: expect.any(String),
        properties: expect.objectContaining({
          command: 'dev',
          success: true,
          session: 'started',
          version: '9.9.9'
        })
      }
    ])
  })

  it('keeps the markers that separate real users from this repo and from CI', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionStart('start')
    await settle()

    expect(box.sentRows()[0].properties).toMatchObject({
      is_ci: false,
      is_source_build: true,
      $ip: null,
      $geoip_disable: true,
      $process_person_profile: false
    })
  })

  it('is not sampled away, while an ordinary success row is', async () => {
    const session = reportingRun()

    session.cli.markCommandSessionStart('preview')
    await settle()
    expect(session.box.sentRows()).toHaveLength(1)

    const ordinary = reportingRun()

    ordinary.cli.markCommandSuccess('build')
    await ordinary.cli.telemetry.flush()
    expect(ordinary.box.sentRows()).toEqual([])
  })

  it('counts one run once, and still lets a later failure travel', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionStart('dev')
    cli.markCommandSuccess('dev')
    await cli.telemetry.flush()
    expect(box.sentRows()).toHaveLength(1)

    cli.markCommandFailure('dev', {code: 'E_COMPILE', exitCode: 1})
    await cli.telemetry.flush()

    expect(
      box.sentRows().map((row) => [row.event, row.properties.code])
    ).toEqual([
      ['command_executed', undefined],
      ['command_failed', 'E_COMPILE']
    ])
  })

  it('names the invoked verb when the caller names none', async () => {
    const {box, cli} = reportingRun({}, ['node', 'extension', 'preview'])

    cli.markCommandSessionStart()
    await settle()

    expect(box.sentRows()[0].properties.command).toBe('preview')
  })
})

describe('a dev session says once that it became ready', () => {
  it('sends a ready row beside the started row, inside the debounce window', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionStart('dev')
    cli.markCommandSessionReady('dev')
    await settle()

    expect(
      box.sentRows().map((row) => [row.event, row.properties.session])
    ).toEqual([
      ['command_executed', 'started'],
      ['command_executed', 'ready']
    ])
  })

  it('reports ready once, however many browsers say so', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionStart('dev')
    cli.markCommandSessionReady('dev')
    cli.markCommandSessionReady('dev')
    await settle()

    expect(box.sentRows()).toHaveLength(2)
  })

  it('says nothing for a session that was never counted at its start', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionReady('dev')
    await cli.telemetry.flush()

    expect(box.sentRows()).toEqual([])
  })

  it('says nothing after the session already reported its failure', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionStart('dev')
    cli.markCommandFailure('dev', {code: 'E_BROWSER_LAUNCH', exitCode: 1})
    cli.markCommandSessionReady('dev')
    await cli.telemetry.flush()

    expect(
      box.sentRows().map((row) => [row.event, row.properties.session])
    ).toEqual([
      ['command_executed', 'started'],
      ['command_failed', undefined]
    ])
  })

  it.each<[string, Record<string, string | undefined>, string[]]>([
    [
      'the run opted out',
      {EXTENSION_TELEMETRY_DISABLED: '1'},
      ['node', 'extension', 'dev']
    ],
    [
      '--no-telemetry',
      {EXTENSION_TELEMETRY: undefined},
      ['node', 'extension', 'dev', '--no-telemetry']
    ]
  ])('sends nothing at all when %s', async (_name, env, argv) => {
    const {box, cli} = reportingRun(env, argv)

    cli.markCommandSessionStart('dev')
    cli.markCommandSessionReady('dev')
    cli.markCommandFailure('dev', {code: 'E_COMPILE'})
    await cli.telemetry.flush()

    expect(box.sentRows()).toEqual([])
    expect(fs.existsSync(box.places.config)).toBe(false)
  })

  it('carries no property the started row does not already carry', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandSessionStart('dev')
    cli.markCommandSessionReady('dev')
    await settle()

    const [started, ready] = box.sentRows()
    expect(Object.keys(ready.properties).sort()).toEqual(
      Object.keys(started.properties).sort()
    )

    expect(ready.distinct_id).toBe(started.distinct_id)
  })
})

describe('the failure the run reports', () => {
  it('keeps a catalog code and a small exit code, and nothing else', async () => {
    const {box, cli} = reportingRun()

    cli.markCommandFailure('build', {code: 'toString', exitCode: 300})
    await cli.telemetry.flush()

    expect(box.sentRows()[0].properties).not.toHaveProperty('code')
    expect(box.sentRows()[0].properties).not.toHaveProperty('exit_code')
  })

  it('sends a refusal right away through the crash sender', () => {
    const {box, cli} = reportingRun()

    cli.reportCommandFailureNow({code: 'E_ARGS', exitCode: 1})

    expect(
      box.crashSent.map((send) => ({
        budgetMs: send.budgetMs,
        rows: send.rows.map((row) => [
          row.properties.code,
          row.properties.exit_code
        ])
      }))
    ).toEqual([{budgetMs: 1000, rows: [['E_ARGS', 1]]}])
  })

  it('carries the install outcomes the readers hold', async () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
    const {cli} = cliRun(box, {
      argv: [
        'node',
        'extension',
        'create',
        'x',
        '--template',
        'nope',
        '--source',
        'templates'
      ],
      readBrowserInstall: () => ({outcome: 'declined', browser: 'firefox'}),
      readDependencyInstall: () => ({outcome: 'installed', seconds: 12})
    })

    cli.markCommandFailure('create', {code: 'E_ARGS'})
    await cli.telemetry.flush()

    expect(box.sentRows()[0].properties).toMatchObject({
      browser_install: 'declined',
      browser_install_browser: 'firefox',
      deps_install: 'installed',
      deps_install_seconds: 12,
      source: 'templates'
    })

    expect(box.sentRows()[0].properties).not.toHaveProperty('template')
  })
})

describe('the first-run notice', () => {
  function defaultRun(box: Sandbox) {
    const run = cliRun(box)

    run.cli.start()

    return run
  }

  it('prints once per machine and stores the consent it showed', () => {
    const box = sandbox()
    const first = defaultRun(box)
    const second = defaultRun(box)

    expect(first.cli.getConsent()).toEqual({enabled: true, source: 'default'})
    expect(first.notices).toHaveLength(1)
    expect(first.notices[0]).toContain('collects anonymous, opt-out telemetry')
    expect(second.cli.getConsent()).toEqual({enabled: true, source: 'config'})
    expect(second.notices).toEqual([])
  })

  it('prints once inside a worktree, where the stored consent is not honored', () => {
    const box = sandbox()
    fs.mkdirSync(path.join(box.root, '.git'))
    const first = defaultRun(box)
    const second = defaultRun(box)

    expect(first.notices).toHaveLength(1)
    expect(second.notices).toEqual([])
    expect(second.cli.getConsent()).toEqual({enabled: true, source: 'default'})
  })

  it('prints nothing for a consent the env or a file already gave', () => {
    expect(
      defaultRun(sandbox({env: {EXTENSION_TELEMETRY: '1'}})).notices
    ).toEqual([])

    expect(defaultRun(sandbox({env: {CI: '1'}})).notices).toEqual([])
  })

  it('prints nothing and sends nothing with no storage', async () => {
    const box = sandbox({deps: {storageFolders: () => [], random: () => 0}})
    const run = defaultRun(box)

    run.cli.markCommandFailure('build', {code: 'E_ARGS'})
    await run.cli.telemetry.flush()

    expect(run.notices).toEqual([])
    expect(run.cli.getConsent()).toEqual({enabled: false, source: 'storage'})
    expect(run.hooks).toEqual({})
    expect(box.sent).toEqual([])
  })

  it('names the documented switches and a full link, not a repo path', () => {
    const notice = defaultRun(sandbox()).notices[0]

    expect(notice).toBe(
      '⏵⏵⏵ Extension.js collects anonymous, opt-out telemetry (two events: ' +
        'command_executed + command_failed). Disable with ' +
        'extension telemetry disable, EXTENSION_TELEMETRY_DISABLED=1, ' +
        'DO_NOT_TRACK=1, or --no-telemetry. Details: ' +
        'https://github.com/extension-js/extension.js/blob/main/docs/TELEMETRY.md'
    )
  })

  it('prints nothing under DO_NOT_TRACK and leaves no file behind', () => {
    const box = sandbox({env: {DO_NOT_TRACK: '1'}})
    const run = defaultRun(box)

    expect(run.notices).toEqual([])
    expect(run.cli.telemetry.isEnabled).toBe(false)
    expect(fs.existsSync(box.places.config)).toBe(false)
  })
})

describe('the exit hooks', () => {
  it('registers nothing for a run that opted out', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '0'}})
    const {cli, hooks, notices} = cliRun(box)

    cli.start()

    expect(hooks).toEqual({})
    expect(notices).toEqual([])
  })

  it.each<[number | string | undefined, string]>([
    [undefined, 'command_executed'],
    [0, 'command_executed'],
    [2, 'command_failed'],
    // Pins today's behavior. Ledger 1372 D35.
    ['0', 'command_failed']
  ])('reports an exit code of %j at beforeExit as %s', async (exitCode, event) => {
    const box = sandbox({
      env: {EXTENSION_TELEMETRY: '1'},
      deps: {random: () => 0}
    })
    const {cli, hooks, host} = cliRun(box, {
      argv: ['node', 'extension', 'build']
    })

    cli.start()
    host.state.exitCode = exitCode
    await hooks.beforeExit[0]()

    expect(
      box.sentRows().map((row) => [row.event, row.properties.command])
    ).toEqual([[event, 'build']])
  })

  it('adds nothing at beforeExit for a run that already reported', async () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
    const {cli, hooks} = cliRun(box)

    cli.start()
    cli.markCommandFailure('dev', {code: 'E_ARGS'})
    await hooks.beforeExit[0]()

    expect(box.sentRows().map((row) => row.event)).toEqual(['command_failed'])
  })

  it('sends a crash through the crash sender when nothing else catches it', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
    const {cli, hooks} = cliRun(box)

    cli.start()
    hooks.uncaughtExceptionMonitor[0]()

    expect(box.crashSent.map((send) => send.budgetMs)).toEqual([1000])
    expect(box.sent).toEqual([])
  })

  it('leaves a crash someone catches to the usual flush', async () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
    const {cli, hooks, host} = cliRun(box)

    cli.start()
    host.state.uncaughtListeners = 1
    hooks.uncaughtExceptionMonitor[0]()
    await settle()

    expect(box.crashSent).toEqual([])
    expect(box.sentRows().map((row) => row.event)).toEqual(['command_failed'])
  })
})

describe('the consent the run writes', () => {
  it('stores a refusal and stops this run at once', async () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: undefined}})
    const {cli} = cliRun(box)

    expect(cli.setConsent('disabled')).toEqual({
      ok: true,
      path: path.join(box.configDir, 'consent')
    })

    cli.markCommandFailure('telemetry', {code: 'E_ARGS'})
    await cli.telemetry.flush()

    expect(cli.telemetry.isEnabled).toBe(false)
    expect(box.sentRows()).toEqual([])
  })

  it('stores an opt-in for the next run and leaves this one as it was', () => {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '0'}})
    const {cli} = cliRun(box)

    expect(cli.setConsent('enabled').ok).toBe(true)
    expect(cli.telemetry.isEnabled).toBe(false)
    expect(fs.readFileSync(path.join(box.configDir, 'consent'), 'utf8')).toBe(
      'enabled'
    )
  })

  it('answers no path when there is nowhere to write', () => {
    const box = sandbox({deps: {storageFolders: () => []}})

    expect(cliRun(box).cli.setConsent('enabled')).toEqual({
      ok: false,
      path: null
    })
  })
})

describe('a signal is an ending the CLI has to report', () => {
  function signalRun(
    options: {
      sessionStarted?: boolean
      othersListen?: boolean
      env?: Record<string, string | undefined>
    } = {}
  ) {
    const run = reportingRun(options.env)
    const target = new EventEmitter()
    const exits: number[] = []
    const signals = createTelemetrySignals({
      cli: run.cli,
      target: target as never,
      exit: (code) => {
        exits.push(code)
      }
    })

    if (options.sessionStarted) run.cli.markCommandSessionStart('dev')

    signals.install()

    if (options.othersListen) {
      target.on('SIGINT', () => {})
    }

    return {...run, target, exits, signals}
  }

  async function raise(target: EventEmitter, signal: TerminationSignal) {
    target.emit(signal)
    await settle()
    await settle()
  }

  it('flushes a command_failed for a run interrupted before it finished', async () => {
    const {box, target, exits} = signalRun()

    await raise(target, 'SIGINT')

    expect(
      box
        .sentRows()
        .map((row) => [
          row.event,
          row.properties.code,
          row.properties.exit_code
        ])
    ).toEqual([['command_failed', 'E_INTERRUPTED', 130]])

    expect(exits).toEqual([130])
  })

  it('exits with 143 for a SIGTERM', async () => {
    const {box, target, exits} = signalRun()

    await raise(target, 'SIGTERM')

    expect(box.sentRows()[0].properties.exit_code).toBe(143)
    expect(exits).toEqual([143])
  })

  it('adds no second row when the session already reported its start', async () => {
    const {box, target, exits} = signalRun({sessionStarted: true})

    await raise(target, 'SIGTERM')

    expect(box.sentRows().map((row) => row.properties.session)).toEqual([
      'started'
    ])

    // A session that came up ends the way it always has, at zero.
    expect(exits).toEqual([0])
  })

  it('leaves the exit and the outcome to the handlers that own the shutdown', async () => {
    const {box, target, exits} = signalRun({othersListen: true})

    await raise(target, 'SIGINT')

    // Inventing a failure for a watch session's Ctrl-C is the artifact, not
    // the measurement.
    expect(box.sentRows()).toEqual([])
    expect(exits).toEqual([])
  })

  it('fires once for a SIGINT followed by a SIGTERM', async () => {
    const {box, target, exits} = signalRun()

    await raise(target, 'SIGINT')
    await raise(target, 'SIGTERM')

    expect(box.sentRows()).toHaveLength(1)
    expect(exits).toEqual([130])
  })

  it('installs one listener per signal, once, for a run that reports', () => {
    const {target, signals} = signalRun()

    signals.install()

    expect(target.listenerCount('SIGINT')).toBe(1)
    expect(target.listenerCount('SIGTERM')).toBe(1)
  })

  it('installs nothing for a run that opted out', () => {
    const {target} = signalRun({env: {EXTENSION_TELEMETRY_DISABLED: '1'}})

    expect(target.eventNames()).toEqual([])
  })

  it('exits half a second in when the collector never answers', async () => {
    vi.useFakeTimers()
    const box = sandbox({
      env: {EXTENSION_TELEMETRY: '1'},
      deps: {send: () => new Promise(() => {})}
    })
    const {cli} = cliRun(box)
    const exits: number[] = []
    const target = new EventEmitter()

    createTelemetrySignals({
      cli,
      target: target as never,
      exit: (code) => {
        exits.push(code)
      }
    }).install()

    target.emit('SIGINT')
    await vi.advanceTimersByTimeAsync(499)
    expect(exits).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(exits).toEqual([130])
  })

  it('gives up on a collector that never answers within the deadline it is given', async () => {
    vi.useFakeTimers()
    const box = sandbox({
      env: {EXTENSION_TELEMETRY: '1'},
      deps: {send: () => new Promise(() => {})}
    })
    const {cli} = cliRun(box)
    let done = false

    cli.markCommandFailure('dev', {code: 'E_INTERRUPTED', exitCode: 130})
    void createTelemetrySignals({cli, target: new EventEmitter() as never})
      .flushTelemetryWithin(60)
      .then(() => {
        done = true
      })

    await vi.advanceTimersByTimeAsync(59)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it('runs mark, flush and exit in that order', async () => {
    const order: string[] = []
    const deps: TerminationSignalDeps = {
      sessionStarted: () => false,
      markInterrupted: () => order.push('mark'),
      flush: async () => {
        order.push('flush')
      },
      othersOwnTermination: () => false,
      exit: () => {
        order.push('exit')
      }
    }

    await createTelemetrySignals({
      cli: reportingRun().cli,
      target: new EventEmitter() as never
    }).handleTerminationSignal('SIGINT', deps)

    expect(order).toEqual(['mark', 'flush', 'exit'])
  })
})

describe('a command that exits on purpose still reports', () => {
  function exitRun(command: string) {
    const run = reportingRun({EXTENSION_TELEMETRY_SAMPLE_RATE: '1'}, [
      'node',
      'extension',
      command
    ])
    const exits: number[] = []
    const drain = (code: number, cli: TelemetryCli = run.cli) =>
      exitAfterDrain(code, {cli, exit: (exitCode) => exits.push(exitCode)})

    return {...run, exits, drain}
  }

  it('sends command_executed for a success path that calls exitAfterDrain', async () => {
    const {box, exits, drain} = exitRun('doctor')

    await drain(0)

    expect(
      box.sentRows().map((row) => [row.event, row.properties.command])
    ).toEqual([['command_executed', 'doctor']])

    expect(exits).toEqual([0])
  })

  it('sends command_failed with the caller exit code, and keeps that code', async () => {
    const {box, exits, drain} = exitRun('publish')

    await drain(1)

    expect(
      box.sentRows().map((row) => [row.event, row.properties.exit_code])
    ).toEqual([['command_failed', 1]])

    expect(exits).toEqual([1])
  })

  it('leaves a failure that already named its catalog code alone', async () => {
    const {box, cli, drain} = exitRun('publish')

    cli.markCommandFailure('publish', {code: 'E_PUBLISH_REJECTED', exitCode: 1})
    await drain(1)

    expect(box.sentRows().map((row) => row.properties.code)).toEqual([
      'E_PUBLISH_REJECTED'
    ])
  })

  it('reports nothing for a verb the CLI does not recognize', async () => {
    const {box, exits, drain} = exitRun('--ai-help')

    await drain(0)

    expect(box.sentRows()).toEqual([])
    expect(exits).toEqual([0])
  })

  it('reports nothing on the run that turned telemetry off', async () => {
    const {box, cli, drain} = exitRun('telemetry')

    cli.setConsent('disabled')
    await drain(0)

    expect(box.sentRows()).toEqual([])
  })

  it('still exits, with its code, when the collector never answers', async () => {
    vi.useFakeTimers()
    const box = sandbox({
      env: {EXTENSION_TELEMETRY: '1'},
      deps: {send: () => new Promise(() => {})}
    })
    const {cli} = cliRun(box, {argv: ['node', 'extension', 'build']})
    const exits: number[] = []

    void exitAfterDrain(3, {cli, exit: (code) => exits.push(code)})
    await vi.advanceTimersByTimeAsync(499)
    expect(exits).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(exits).toEqual([3])
  })
})
