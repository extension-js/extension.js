import {spawn} from 'node:child_process'
import {once} from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  describeWaitError,
  isFreshContractPayload,
  type ReadyContractPayload,
  runWaitMode,
  type WaitCommand
} from '../commands/dev-wait'
import {CODES} from '../helpers/messaging'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()
const START = Date.parse('2026-03-01T12:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

// Time moves only when the wait sleeps, so every bound is exact.
function fakeClock(onSleep: (now: number) => void = () => {}) {
  let current = START
  const sleeps: number[] = []

  return {
    sleeps,
    elapsed: () => current - START,
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      current += ms
      onSleep(current)
    }
  }
}

// An older bridge with no path exports, so the contract sits under dist.
const loadBridge = async () => ({})

function readyPathIn(project: string, browser = 'chromium'): string {
  return path.join(project, 'dist', 'extension-js', browser, 'ready.json')
}

function writeContract(
  project: string,
  payload: ReadyContractPayload,
  browser = 'chromium'
): string {
  const file = readyPathIn(project, browser)

  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, JSON.stringify(payload))

  return file
}

// A pid this spec owned and reaped, so nothing it names is ever signaled.
async function reapedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], {stdio: 'ignore'})

  await once(child, 'exit')

  return child.pid as number
}

function wait(
  project: string,
  clock: ReturnType<typeof fakeClock>,
  options: {
    command?: WaitCommand
    browsers?: string[]
    waitTimeout?: string | number
  } = {}
) {
  return runWaitMode(
    {
      command: options.command ?? 'dev',
      pathOrRemoteUrl: project,
      browsers: options.browsers ?? ['chromium'],
      waitTimeout: options.waitTimeout ?? 1000
    },
    {now: clock.now, sleep: clock.sleep, loadBridge}
  )
}

describe('wait mode failures', () => {
  it('times out naming the contract path and the bound it waited', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    await expect(wait(project, clock)).rejects.toMatchObject({
      name: 'WaitModeError',
      code: CODES.E_READY_TIMEOUT,
      message: `Timed out waiting for ready contract at ${readyPathIn(project)} (1000 ms)`
    })

    expect(clock.sleeps).toEqual([250, 250, 250, 250])
  })

  it('adds the parse failure to the timeout when the contract never read as JSON', async () => {
    const project = makeTempFolder('extjs-wait-')
    const file = readyPathIn(project)
    const clock = fakeClock()

    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, '{"status":')

    const failure = await wait(project, clock).catch((error) => error)

    expect(failure.code).toBe(CODES.E_READY_TIMEOUT)
    expect(
      failure.message.startsWith(
        `Timed out waiting for ready contract at ${file} (1000 ms). ` +
          'The last read of the file failed to parse as JSON: '
      )
    ).toBe(true)
  })

  it.each([
    [{code: 'compile_error', message: 'bad import'}, CODES.E_COMPILE],
    [{code: 'profile_locked', message: 'in use'}, CODES.E_PROFILE_LOCKED],
    [{message: 'no code at all'}, CODES.E_READY_ERROR_STATUS],
    [{code: 'made_up', message: 'unknown id'}, CODES.E_READY_ERROR_STATUS],
    [
      {
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_BROWSER_NOT_FOUND',
        message: 'no chrome'
      },
      CODES.E_BROWSER_NOT_FOUND
    ]
  ])('reports the error status %j of a live run as %s at once', async (contract, code) => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(project, {
      ...contract,
      status: 'error',
      command: 'dev',
      pid: process.pid
    })

    await expect(wait(project, clock)).rejects.toMatchObject({
      name: 'WaitModeError',
      code,
      message: contract.message
    })

    expect(clock.sleeps).toEqual([])
  })

  it('names the first compile error when the contract carries no message', async () => {
    const project = makeTempFolder('extjs-wait-')

    writeContract(project, {
      status: 'error',
      command: 'dev',
      pid: process.pid,
      errors: ['first error', 'second error']
    })

    await expect(wait(project, fakeClock())).rejects.toMatchObject({
      code: CODES.E_READY_ERROR_STATUS,
      message: 'first error'
    })
  })

  it('reports a standing load refusal of a finished run without waiting', async () => {
    const project = makeTempFolder('extjs-wait-')
    const dist = path.join(project, 'dist', 'chromium')
    const manifest = path.join(project, 'manifest.json')
    const before = new Date(START - 60 * 60_000)
    const clock = fakeClock()

    fs.mkdirSync(dist, {recursive: true})

    for (const file of [manifest, path.join(dist, 'manifest.json')]) {
      fs.writeFileSync(file, '{}')
      fs.utimesSync(file, before, before)
    }

    writeContract(project, {
      status: 'error',
      command: 'dev',
      pid: await reapedPid(),
      code: 'extension_load_refused',
      message: 'Chrome refused the manifest.',
      extensionLoadRefusedAt: new Date(START - 30 * 60_000).toISOString(),
      extensionLoadRefusedCause: 'background.service_worker is missing',
      manifestPath: manifest,
      distPath: dist
    })

    await expect(wait(project, clock)).rejects.toMatchObject({
      name: 'WaitModeError',
      code: CODES.E_EXTENSION_LOAD_REFUSED,
      message:
        'Chrome refused the manifest. background.service_worker is missing'
    })

    expect(clock.sleeps).toEqual([])
  })

  it('refuses a remote URL before it loads the bridge', async () => {
    const bridgeLoads = vi.fn(loadBridge)

    await expect(
      runWaitMode(
        {
          command: 'dev',
          pathOrRemoteUrl: 'https://example.test/extension.zip',
          browsers: ['chromium']
        },
        {loadBridge: bridgeLoads}
      )
    ).rejects.toMatchObject({
      name: 'WaitModeError',
      code: CODES.E_REMOTE_URL_UNSUPPORTED,
      message:
        '--wait requires a local project path (remote URLs are not supported)'
    })

    expect(bridgeLoads).not.toHaveBeenCalled()
  })

  it('ignores a contract another command wrote until the wait runs out', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(project, {
      status: 'ready',
      command: 'start',
      pid: process.pid
    })

    await expect(wait(project, clock)).rejects.toMatchObject({
      code: CODES.E_READY_TIMEOUT
    })

    expect(clock.elapsed()).toBe(1000)
  })

  it('takes a fresh contract from a start run that already ended', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()
    const pid = await reapedPid()

    writeContract(project, {
      status: 'ready',
      command: 'start',
      pid,
      ts: new Date(START - 59_000).toISOString()
    })

    const result = await wait(project, clock, {command: 'start'})

    expect(result.results).toEqual([
      {
        status: 'ready',
        command: 'start',
        pid,
        ts: new Date(START - 59_000).toISOString(),
        browser: 'chromium'
      }
    ])

    expect(clock.sleeps).toEqual([])
  })

  it('waits out a stale contract from a start run that already ended', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(project, {
      status: 'ready',
      command: 'start',
      pid: await reapedPid(),
      ts: new Date(START - 61_000).toISOString()
    })

    await expect(
      wait(project, clock, {command: 'start'})
    ).rejects.toMatchObject({code: CODES.E_READY_TIMEOUT})

    expect(clock.elapsed()).toBe(1000)
  })

  it('waits past a ready contract whose pid another live process now holds', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()
    const dated: unknown[] = []

    writeContract(project, {
      status: 'ready',
      command: 'dev',
      pid: process.pid,
      pidStartedAt: new Date(START - 10 * 60_000).toISOString()
    })

    await expect(
      runWaitMode(
        {
          command: 'dev',
          pathOrRemoteUrl: project,
          browsers: ['chromium'],
          waitTimeout: 1000
        },
        {
          now: clock.now,
          sleep: clock.sleep,
          loadBridge,
          pidStartedAt: (pid) => {
            dated.push(pid)

            return START
          }
        }
      )
    ).rejects.toMatchObject({
      code: CODES.E_READY_TIMEOUT,
      message: `Timed out waiting for ready contract at ${readyPathIn(project)} (1000 ms)`
    })

    expect(clock.elapsed()).toBe(1000)
    // Dated once for the whole wait, not once per poll.
    expect(dated).toEqual([process.pid])
  })

  it('answers ready when the live pid started when the contract says', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()
    const pidStartedAt = new Date(START - 10 * 60_000).toISOString()

    writeContract(project, {
      status: 'ready',
      command: 'dev',
      pid: process.pid,
      pidStartedAt
    })

    const result = await runWaitMode(
      {command: 'dev', pathOrRemoteUrl: project, browsers: ['chromium']},
      {
        now: clock.now,
        sleep: clock.sleep,
        loadBridge,
        pidStartedAt: () => Date.parse(pidStartedAt)
      }
    )

    expect(result.results).toEqual([
      {
        status: 'ready',
        command: 'dev',
        pid: process.pid,
        pidStartedAt,
        browser: 'chromium'
      }
    ])

    expect(clock.sleeps).toEqual([])
  })

  it.each([
    ['1500', 1500],
    [' 1500 ', 1500],
    [2500, 2500],
    [undefined, 60_000]
  ])('reads --wait-timeout %j as %i ms', async (waitTimeout, timeoutMs) => {
    const project = makeTempFolder('extjs-wait-')

    writeContract(project, {
      status: 'ready',
      command: 'dev',
      pid: process.pid
    })

    const clock = fakeClock()
    const result = await runWaitMode(
      {
        command: 'dev',
        pathOrRemoteUrl: project,
        browsers: ['chromium'],
        waitTimeout
      },
      {now: clock.now, sleep: clock.sleep, loadBridge}
    )

    expect(result.timeoutMs).toBe(timeoutMs)
  })

  it.each([
    '10s',
    'abc',
    '0',
    '-5',
    '1.5',
    '1e3',
    ''
  ])('refuses --wait-timeout %j before it waits', async (waitTimeout) => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    await expect(wait(project, clock, {waitTimeout})).rejects.toMatchObject({
      name: 'WaitModeError',
      code: CODES.E_INVALID_OPTION,
      message: `--wait-timeout got "${waitTimeout}". Use a whole number of milliseconds, such as 10000.`
    })

    expect(clock.sleeps).toEqual([])
  })

  it('frames a refused --wait-timeout as usage', () => {
    expect(
      describeWaitError(
        Object.assign(new Error('bad value'), {code: CODES.E_INVALID_OPTION})
      )
    ).toEqual({
      code: CODES.E_INVALID_OPTION,
      status: 'usage',
      message: 'bad value',
      hint: 'Fix the value the message names and run the command again.'
    })
  })

  it('reads a pid it may not signal as a live process', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()
    // No signal leaves this process: the probe is answered here, as EPERM.
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill EPERM'), {code: 'EPERM'})
    })

    writeContract(project, {
      status: 'ready',
      command: 'dev',
      pid: process.pid
    })

    const result = await wait(project, clock)

    expect(result.results).toMatchObject([
      {browser: 'chromium', status: 'ready', pid: process.pid}
    ])

    expect(clock.sleeps).toEqual([])
    expect(new Set(probe.mock.calls.map((call) => call.join(':')))).toEqual(
      new Set([`${process.pid}:0`])
    )
  })

  it('reads a pid that is gone as a dead process', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(project, {
      status: 'ready',
      command: 'dev',
      pid: await reapedPid()
    })

    await expect(wait(project, clock)).rejects.toMatchObject({
      code: CODES.E_READY_TIMEOUT
    })

    expect(clock.elapsed()).toBe(1000)
  })

  it('answers the recent error of a dev run that exited with its own code at once', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(project, {
      status: 'error',
      command: 'dev',
      pid: await reapedPid(),
      code: 'compile_error',
      message: 'bad import',
      ts: new Date(START - 5000).toISOString()
    })

    await expect(wait(project, clock)).rejects.toMatchObject({
      name: 'WaitModeError',
      code: CODES.E_COMPILE,
      message: 'bad import'
    })

    expect(clock.sleeps).toEqual([])
  })

  it.each([
    ['an old', new Date(START - 61_000).toISOString()],
    ['an undated', undefined]
  ])('waits past %s error of an earlier dev run for the producer to replace it', async (_label, ts) => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(project, {
      status: 'error',
      command: 'dev',
      pid: await reapedPid(),
      code: 'compile_error',
      message: 'bad import',
      ts
    })

    await expect(wait(project, clock)).rejects.toMatchObject({
      code: CODES.E_READY_TIMEOUT,
      message: `Timed out waiting for ready contract at ${readyPathIn(project)} (1000 ms)`
    })

    expect(clock.elapsed()).toBe(1000)
  })

  it('bounds the wait for several browsers by one deadline', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock((now) => {
      if (now - START !== 750) return

      writeContract(
        project,
        {status: 'ready', command: 'dev', pid: process.pid},
        'chrome'
      )
    })

    await expect(
      wait(project, clock, {browsers: ['chrome', 'firefox']})
    ).rejects.toMatchObject({
      code: CODES.E_READY_TIMEOUT,
      message: `Timed out waiting for ready contract at ${readyPathIn(project, 'firefox')} (1000 ms)`
    })

    expect(clock.elapsed()).toBe(1000)
  })

  it('names every browser still missing when the deadline passes', async () => {
    const project = makeTempFolder('extjs-wait-')

    await expect(
      wait(project, fakeClock(), {browsers: ['chrome', 'firefox']})
    ).rejects.toMatchObject({
      message: `Timed out waiting for ready contract at ${readyPathIn(project, 'chrome')}, ${readyPathIn(project, 'firefox')} (1000 ms)`
    })
  })

  it('returns each browser in the order asked once all are ready', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock((now) => {
      const browser = {250: 'firefox', 500: 'chrome'}[now - START]
      if (!browser) return

      writeContract(
        project,
        {status: 'ready', command: 'dev', pid: process.pid},
        browser
      )
    })

    const result = await wait(project, clock, {browsers: ['chrome', 'firefox']})

    expect(result.results.map((entry) => entry.browser)).toEqual([
      'chrome',
      'firefox'
    ])

    expect(clock.elapsed()).toBe(500)
  })

  it('fails the whole wait at once when one browser reports an error', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(
      project,
      {
        status: 'error',
        command: 'dev',
        pid: process.pid,
        code: 'compile_error',
        message: 'bad import'
      },
      'firefox'
    )

    await expect(
      wait(project, clock, {browsers: ['chrome', 'firefox']})
    ).rejects.toMatchObject({code: CODES.E_COMPILE, message: 'bad import'})

    expect(clock.sleeps).toEqual([])
  })

  it.each([
    'toString',
    'constructor',
    '__proto__'
  ])('files an inherited object key %j as E_INTERNAL', (code) => {
    expect(
      describeWaitError(Object.assign(new Error('odd'), {code}))
    ).toMatchObject({code: CODES.E_INTERNAL, status: 'failed', message: 'odd'})
  })

  it('files a tagged error under no catalog code as E_INTERNAL', () => {
    expect(
      describeWaitError(Object.assign(new Error('odd'), {code: 'E_NOT_REAL'}))
    ).toMatchObject({code: CODES.E_INTERNAL, status: 'failed', message: 'odd'})
  })

  it('answers a bridge that failed to load with its own code at once', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    await expect(
      runWaitMode(
        {
          command: 'dev',
          pathOrRemoteUrl: project,
          browsers: ['chromium'],
          waitTimeout: 1000
        },
        {
          now: clock.now,
          sleep: clock.sleep,
          loadBridge: async () => {
            throw Object.assign(new Error('no runtime'), {
              code: CODES.E_RUNTIME_NOT_FOUND
            })
          }
        }
      )
    ).rejects.toMatchObject({
      name: 'WaitModeError',
      code: CODES.E_RUNTIME_NOT_FOUND,
      message: 'no runtime'
    })

    expect(clock.sleeps).toEqual([])
  })

  it('reads the plain dist path when the bridge fails to load uncoded', async () => {
    const project = makeTempFolder('extjs-wait-')
    const clock = fakeClock()

    writeContract(project, {status: 'ready', command: 'dev', pid: process.pid})

    const result = await runWaitMode(
      {
        command: 'dev',
        pathOrRemoteUrl: project,
        browsers: ['chromium'],
        waitTimeout: 1000
      },
      {
        now: clock.now,
        sleep: clock.sleep,
        loadBridge: async () => {
          throw new SyntaxError('Unexpected token')
        }
      }
    )

    expect(result.results).toMatchObject([
      {browser: 'chromium', status: 'ready'}
    ])

    expect(clock.sleeps).toEqual([])
  })
})

describe('isFreshContractPayload', () => {
  const now = () => START
  const at = (ageMs: number) => new Date(START - ageMs).toISOString()

  it.each([
    [{ts: at(60_000)}, true],
    [{ts: at(60_001)}, false],
    [{compiledAt: at(1000)}, true],
    [{ts: 'not a date', startedAt: at(1000)}, true],
    [{ts: at(60_001), compiledAt: at(1000)}, false],
    [{}, false],
    [{ts: 'not a date'}, false]
  ])('reads %j as fresh: %s', (payload, fresh) => {
    expect(isFreshContractPayload(payload, now)).toBe(fresh)
  })
})
