import {type ChildProcess, spawn} from 'node:child_process'
import {once} from 'node:events'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  FORCE_KILL_GRACE_MS,
  gracefulTerminateChild,
  gracefulTerminatePid,
  type TeardownDependencies,
  teardownDefaults
} from '../../browsers-lib/process-teardown'

// A browser that hangs on shutdown: it takes SIGTERM, says so and stays.
const STUBBORN = `
process.on('SIGTERM', () => process.stdout.write('term\\n'))
process.stdout.write('ready\\n')
setInterval(() => {}, 1000)
`

// A browser that closes when asked.
const POLITE = `
process.stdout.write('ready\\n')
setInterval(() => {}, 1000)
`

const ASKED_AT = Date.parse('2026-11-17T10:00:05.400Z')

function lineFrom(child: ChildProcess, line: string): Promise<void> {
  return new Promise((resolve) => {
    let seen = ''
    child.stdout?.on('data', (chunk) => {
      seen += String(chunk)
      if (seen.split('\n').includes(line)) resolve()
    })
  })
}

const started: ChildProcess[] = []

async function startChild(script: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', script, 'extjs-spec-stubborn'], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  started.push(child)
  await lineFrom(child, 'ready')

  return child
}

// Nothing here reaches the machine: every call is recorded and answered
// from the test, so a lost injection cannot signal or list anything.
function scriptedTeardown(over: Partial<TeardownDependencies> = {}) {
  const printed: string[] = []
  const deps: TeardownDependencies = {
    platform: 'darwin',
    now: () => ASKED_AT,
    isAlive: vi.fn(() => true),
    startedAt: vi.fn(() => ASKED_AT - 60_000),
    mark: vi.fn(() => []),
    sweep: vi.fn(() => []),
    kill: vi.fn(() => true),
    killTree: vi.fn(),
    print: (line) => printed.push(line),
    ...over
  }

  return {deps, printed}
}

function endGracePeriod() {
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(FORCE_KILL_GRACE_MS - 1)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(1)
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
}

const isRunning = (child: ChildProcess) =>
  child.exitCode === null &&
  child.signalCode === null &&
  process.kill(child.pid as number, 0)

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()

  // Only the pids this spec spawned are ever signaled.
  for (const child of started.splice(0)) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      continue
    }

    const exited = once(child, 'exit')
    process.kill(child.pid, 'SIGKILL')
    await exited
  }
})

describe.skipIf(process.platform === 'win32')(
  'gracefulTerminateChild on a child that ignores SIGTERM',
  () => {
    it('sends SIGTERM, then SIGKILL once the grace period ends', async () => {
      const child = await startChild(STUBBORN)
      const tookTerm = lineFrom(child, 'term')
      const kill = vi.spyOn(child, 'kill')
      // Only the escalation timer runs on the fake clock, the child is real.
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      gracefulTerminateChild(child, 'chrome')
      await tookTerm

      expect(kill.mock.calls).toEqual([['SIGTERM']])
      expect(isRunning(child)).toBe(true)

      const exited = once(child, 'exit')
      endGracePeriod()

      expect(kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
      expect(await exited).toEqual([null, 'SIGKILL'])
    })

    it('kills the helpers it noted, after the browser', async () => {
      const child = await startChild(STUBBORN)
      const tookTerm = lineFrom(child, 'term')
      const kill = vi.spyOn(child, 'kill')
      const helpers = [{pid: 2 ** 30, started: 'Tue Nov 17 10:00:00 2026'}]
      const order: string[] = []
      const {deps, printed} = scriptedTeardown({
        mark: vi.fn(() => helpers),
        sweep: vi.fn(() => {
          order.push(`sweep after ${kill.mock.calls.length} signals`)

          return []
        })
      })
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      gracefulTerminateChild(child, 'chrome', undefined, deps)
      await tookTerm
      expect(deps.mark).toHaveBeenCalledExactlyOnceWith(child.pid)

      const exited = once(child, 'exit')
      endGracePeriod()

      expect(deps.startedAt).toHaveBeenCalledExactlyOnceWith(child.pid)
      expect(deps.sweep).toHaveBeenCalledExactlyOnceWith(helpers)
      expect(order).toEqual(['sweep after 2 signals'])
      expect(deps.kill).not.toHaveBeenCalled()
      expect(deps.killTree).not.toHaveBeenCalled()
      expect(printed).toEqual([])
      expect(await exited).toEqual([null, 'SIGKILL'])
    })

    it('takes the helpers the caller noted instead of listing again', async () => {
      const child = await startChild(STUBBORN)
      const tookTerm = lineFrom(child, 'term')
      const helpers = [{pid: 2 ** 30, started: 'Tue Nov 17 10:00:00 2026'}]
      const {deps} = scriptedTeardown()
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      gracefulTerminateChild(child, 'chrome', helpers, deps)
      await tookTerm

      const exited = once(child, 'exit')
      endGracePeriod()

      expect(deps.mark).not.toHaveBeenCalled()
      expect(deps.sweep).toHaveBeenCalledExactlyOnceWith(helpers)
      await exited
    })

    it.each([
      ['the process table cannot date', null],
      ['the process table dates after the ask', ASKED_AT + 1]
    ])('leaves a pid %s and says how to stop it', async (_title, startedAt) => {
      const child = await startChild(STUBBORN)
      const tookTerm = lineFrom(child, 'term')
      const kill = vi.spyOn(child, 'kill')
      const {deps, printed} = scriptedTeardown({
        startedAt: vi.fn(() => startedAt)
      })
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      gracefulTerminateChild(child, 'chrome', undefined, deps)
      await tookTerm
      endGracePeriod()

      expect(deps.startedAt).toHaveBeenCalledExactlyOnceWith(child.pid)
      expect(kill.mock.calls).toEqual([['SIGTERM']])
      expect(deps.kill).not.toHaveBeenCalled()
      expect(deps.killTree).not.toHaveBeenCalled()
      expect(deps.sweep).not.toHaveBeenCalled()
      expect(printed).toEqual([
        `⏵⏵⏵ Chrome (pid ${child.pid}) did not stop and could not be confirmed as the browser this run started, so it was left running. ` +
          `To stop it, run kill -9 ${child.pid}.`
      ])

      // Long enough for a SIGKILL to land, had one been sent.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(isRunning(child)).toBe(true)
    })

    it('counts a start in the very millisecond of the ask as the browser', async () => {
      const child = await startChild(STUBBORN)
      const tookTerm = lineFrom(child, 'term')
      const {deps, printed} = scriptedTeardown({
        startedAt: vi.fn(() => ASKED_AT)
      })
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      gracefulTerminateChild(child, 'chrome', undefined, deps)
      await tookTerm

      const exited = once(child, 'exit')
      endGracePeriod()

      expect(printed).toEqual([])
      expect(await exited).toEqual([null, 'SIGKILL'])
    })

    it('hands the pid to the tree kill on Windows and sends no SIGKILL', async () => {
      const child = await startChild(STUBBORN)
      const tookTerm = lineFrom(child, 'term')
      const kill = vi.spyOn(child, 'kill')
      const {deps, printed} = scriptedTeardown({platform: 'win32'})
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      gracefulTerminateChild(child, 'chrome', undefined, deps)
      await tookTerm
      endGracePeriod()

      expect(deps.killTree).toHaveBeenCalledExactlyOnceWith(child.pid)
      expect(kill.mock.calls).toEqual([['SIGTERM']])
      expect(deps.kill).not.toHaveBeenCalled()
      expect(deps.sweep).not.toHaveBeenCalled()
      expect(printed).toEqual([])
    })
  }
)

describe.skipIf(process.platform === 'win32')(
  'gracefulTerminateChild on a child that stops when asked',
  () => {
    it('asks nothing of the machine once the child has exited', async () => {
      const child = await startChild(POLITE)
      const kill = vi.spyOn(child, 'kill')
      const {deps, printed} = scriptedTeardown()
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      const exited = once(child, 'exit')
      gracefulTerminateChild(child, 'chrome', undefined, deps)
      expect(await exited).toEqual([null, 'SIGTERM'])
      endGracePeriod()

      expect(kill.mock.calls).toEqual([['SIGTERM']])
      expect(deps.startedAt).not.toHaveBeenCalled()
      expect(deps.isAlive).not.toHaveBeenCalled()
      expect(deps.kill).not.toHaveBeenCalled()
      expect(deps.killTree).not.toHaveBeenCalled()
      expect(deps.sweep).not.toHaveBeenCalled()
      expect(printed).toEqual([])
    })

    it('leaves a grace timer that cannot hold the process open', async () => {
      const child = await startChild(POLITE)
      const setTimer = vi.spyOn(globalThis, 'setTimeout')
      const {deps} = scriptedTeardown()

      gracefulTerminateChild(child, 'chrome', undefined, deps)

      const timers = setTimer.mock.results.map((result) => result.value)
      const delays = setTimer.mock.calls.map((call) => call[1])
      for (const timer of timers) clearTimeout(timer)

      expect(delays).toEqual([FORCE_KILL_GRACE_MS])
      expect(timers.map((timer) => timer.hasRef())).toEqual([false])
    })
  }
)

describe('gracefulTerminatePid', () => {
  // The pid is a node child of this spec, and every signal goes to the spy.
  async function adoptedPid(): Promise<number> {
    return (await startChild(POLITE)).pid as number
  }

  it('sends SIGTERM, then SIGKILL to a pid that started before the ask', async () => {
    const pid = await adoptedPid()
    const {deps, printed} = scriptedTeardown({
      startedAt: vi.fn(() => Date.parse('2026-11-17T10:00:04.000Z'))
    })
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    expect(deps.kill).toHaveBeenCalledExactlyOnceWith(pid, 'SIGTERM')
    endGracePeriod()

    expect(deps.isAlive).toHaveBeenCalledExactlyOnceWith(pid)
    expect(deps.startedAt).toHaveBeenCalledExactlyOnceWith(pid)
    expect(vi.mocked(deps.kill).mock.calls).toEqual([
      [pid, 'SIGTERM'],
      [pid, 'SIGKILL']
    ])

    expect(deps.killTree).not.toHaveBeenCalled()
    expect(deps.sweep).toHaveBeenCalledExactlyOnceWith([])
    expect(printed).toEqual([])
  })

  it('asks for a second stop of the same pid only once', async () => {
    const pid = await adoptedPid()
    const {deps} = scriptedTeardown()
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    gracefulTerminatePid(pid, 'firefox', deps)
    gracefulTerminatePid(null, 'firefox', deps)

    expect(vi.mocked(deps.kill).mock.calls).toEqual([[pid, 'SIGTERM']])
    endGracePeriod()
  })

  it('sends nothing more to a pid that is gone when the grace period ends', async () => {
    const pid = await adoptedPid()
    const {deps, printed} = scriptedTeardown({isAlive: vi.fn(() => false)})
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    endGracePeriod()

    expect(deps.isAlive).toHaveBeenCalledExactlyOnceWith(pid)
    expect(deps.startedAt).not.toHaveBeenCalled()
    expect(vi.mocked(deps.kill).mock.calls).toEqual([[pid, 'SIGTERM']])
    expect(printed).toEqual([])
  })

  it.each([
    ['the process table cannot date', null, 'darwin', 'kill -9 <pid>'],
    [
      'that started in the second of the ask',
      Date.parse('2026-11-17T10:00:05.000Z'),
      'linux',
      'kill -9 <pid>'
    ],
    [
      'that started after the ask',
      Date.parse('2026-11-17T10:00:07.000Z'),
      'win32',
      'taskkill /PID <pid> /T /F'
    ]
  ] as const)('leaves a pid %s and says how to stop it', async (_title, startedAt, platform, command) => {
    const pid = await adoptedPid()
    const {deps, printed} = scriptedTeardown({
      platform,
      startedAt: vi.fn(() => startedAt)
    })
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    endGracePeriod()

    expect(deps.startedAt).toHaveBeenCalledExactlyOnceWith(pid)
    expect(vi.mocked(deps.kill).mock.calls).toEqual([[pid, 'SIGTERM']])
    expect(deps.killTree).not.toHaveBeenCalled()
    expect(deps.sweep).not.toHaveBeenCalled()
    expect(printed).toEqual([
      `⏵⏵⏵ Firefox (pid ${pid}) did not stop and could not be confirmed as the browser this run started, so it was left running. ` +
        `To stop it, run ${command.replace('<pid>', String(pid))}.`
    ])
  })

  it('hands a proven pid to the tree kill on Windows', async () => {
    const pid = await adoptedPid()
    const {deps} = scriptedTeardown({platform: 'win32'})
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    endGracePeriod()

    expect(deps.killTree).toHaveBeenCalledExactlyOnceWith(pid)
    expect(vi.mocked(deps.kill).mock.calls).toEqual([[pid, 'SIGTERM']])
  })
})

describe('the teardown defaults', () => {
  it('date a pid with the process table and probe it with signal 0', () => {
    expect(teardownDefaults.platform).toBe(process.platform)
    expect(teardownDefaults.isAlive(process.pid)).toBe(true)
    expect(teardownDefaults.mark(undefined)).toEqual([])
    expect(teardownDefaults.sweep([])).toEqual([])
  })
})
