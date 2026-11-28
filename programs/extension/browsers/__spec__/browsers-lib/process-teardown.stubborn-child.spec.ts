import {type ChildProcess, spawn} from 'node:child_process'
import {once} from 'node:events'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  EXIT_PROBE_TIMEOUT_MS,
  FORCE_KILL_GRACE_MS,
  forceKillChildOnExit,
  forceKillPidOnExit,
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
    startedAtOnExit: vi.fn(() => ASKED_AT - 60_000),
    startId: vi.fn(() => undefined),
    mark: vi.fn(() => []),
    sweep: vi.fn(() => []),
    kill: vi.fn(() => true),
    killTree: vi.fn(),
    killTreeOnExit: vi.fn(),
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

    try {
      process.kill(child.pid, 'SIGKILL')
    } catch (error) {
      // A row already ended it, and its exit event is still on the way.
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }

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
        `⏵⏵⏵ Warning: Chrome (pid ${child.pid}) did not stop and could not be confirmed as the browser this run started, so it was left running. ` +
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

    // Chrome and Firefox on Windows ignore a taskkill without /F, so the
    // tree is forced at once, and once more if it outlives the grace.
    it('forces the tree at once on Windows, again only past the grace', async () => {
      const child = await startChild(STUBBORN)
      const kill = vi.spyOn(child, 'kill')
      const {deps, printed} = scriptedTeardown({platform: 'win32'})
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      gracefulTerminateChild(child, 'chrome', undefined, deps)
      expect(deps.killTree).toHaveBeenCalledExactlyOnceWith(child.pid)
      endGracePeriod()

      expect(vi.mocked(deps.killTree).mock.calls).toEqual([
        [child.pid],
        [child.pid]
      ])

      expect(kill).not.toHaveBeenCalled()
      expect(deps.kill).not.toHaveBeenCalled()
      expect(deps.sweep).not.toHaveBeenCalled()
      expect(printed).toEqual([])

      // A second stop of the same child forces nothing more.
      gracefulTerminateChild(child, 'chrome', undefined, deps)
      expect(deps.killTree).toHaveBeenCalledTimes(2)
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
    expect(vi.mocked(deps.kill).mock.calls).toEqual(
      platform === 'win32' ? [] : [[pid, 'SIGTERM']]
    )

    // Windows forces the tree at the ask, while the pid is still the browser.
    expect(vi.mocked(deps.killTree).mock.calls).toEqual(
      platform === 'win32' ? [[pid]] : []
    )

    expect(deps.sweep).not.toHaveBeenCalled()
    expect(printed).toEqual([
      `⏵⏵⏵ Warning: Firefox (pid ${pid}) did not stop and could not be confirmed as the browser this run started, so it was left running. ` +
        `To stop it, run ${command.replace('<pid>', String(pid))}.`
    ])
  })

  it('kills a pid whose start id held through the grace period, whatever the clock says', async () => {
    const pid = await adoptedPid()
    const {deps, printed} = scriptedTeardown({
      platform: 'linux',
      startId: vi.fn(() => 'boot-a:5000'),
      // A clock stepped forward dates the same process after the ask.
      startedAt: vi.fn(() => Date.parse('2026-11-17T11:00:00.000Z'))
    })
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    endGracePeriod()

    expect(deps.startedAt).not.toHaveBeenCalled()
    expect(vi.mocked(deps.kill).mock.calls).toEqual([
      [pid, 'SIGTERM'],
      [pid, 'SIGKILL']
    ])

    expect(printed).toEqual([])
  })

  it('leaves a pid whose start id changed during the grace period, whatever the clock says', async () => {
    const pid = await adoptedPid()
    const ids = ['boot-a:5000', 'boot-a:9000']
    const {deps, printed} = scriptedTeardown({
      platform: 'linux',
      startId: vi.fn(() => ids.shift()),
      // A clock stepped back dates the new process before the ask.
      startedAt: vi.fn(() => Date.parse('2026-11-17T09:00:00.000Z'))
    })
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    endGracePeriod()

    expect(deps.startedAt).not.toHaveBeenCalled()
    expect(vi.mocked(deps.kill).mock.calls).toEqual([[pid, 'SIGTERM']])
    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('was left running')
  })

  it('forces the tree of a proven pid at once on Windows', async () => {
    const pid = await adoptedPid()
    const {deps} = scriptedTeardown({platform: 'win32'})
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    gracefulTerminatePid(pid, 'firefox', deps)
    expect(deps.killTree).toHaveBeenCalledExactlyOnceWith(pid)
    endGracePeriod()

    expect(vi.mocked(deps.killTree).mock.calls).toEqual([[pid], [pid]])
    expect(deps.kill).not.toHaveBeenCalled()
  })
})

describe('forceKillPidOnExit', () => {
  const ADOPTED_AT = Date.parse('2026-11-17T10:00:05.400Z')
  const BEFORE = Date.parse('2026-11-17T10:00:04.000Z')
  const AFTER = Date.parse('2026-11-17T10:00:07.000Z')
  // No process is signaled in the scripted rows, so any number will do.
  const ADOPTED_PID = 2 ** 30

  it('kills on exit by the start id it was adopted under and dates nothing', () => {
    const {deps, printed} = scriptedTeardown({
      platform: 'linux',
      startId: vi.fn(() => 'boot-a:5000'),
      startedAtOnExit: vi.fn(() => AFTER)
    })

    forceKillPidOnExit(ADOPTED_PID, 'firefox', ADOPTED_AT, deps, 'boot-a:5000')

    expect(deps.startedAtOnExit).not.toHaveBeenCalled()
    expect(vi.mocked(deps.kill).mock.calls).toEqual([[ADOPTED_PID, 'SIGKILL']])
    expect(printed).toEqual([])
  })

  it('leaves a pid on exit that now runs under another start id', () => {
    const {deps, printed} = scriptedTeardown({
      platform: 'linux',
      startId: vi.fn(() => 'boot-a:9000'),
      startedAtOnExit: vi.fn(() => BEFORE)
    })

    forceKillPidOnExit(ADOPTED_PID, 'firefox', ADOPTED_AT, deps, 'boot-a:5000')

    expect(deps.startedAtOnExit).not.toHaveBeenCalled()
    expect(deps.kill).not.toHaveBeenCalled()
    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('was left running')
  })

  it('dates the pid on exit when it was adopted with no start id', () => {
    const {deps} = scriptedTeardown({
      startId: vi.fn(() => 'boot-a:5000'),
      startedAtOnExit: vi.fn(() => BEFORE)
    })

    forceKillPidOnExit(ADOPTED_PID, 'firefox', ADOPTED_AT, deps)

    expect(deps.startId).not.toHaveBeenCalled()
    expect(deps.startedAtOnExit).toHaveBeenCalledExactlyOnceWith(ADOPTED_PID)
    expect(vi.mocked(deps.kill).mock.calls).toEqual([[ADOPTED_PID, 'SIGKILL']])
  })

  it('SIGKILLs an adopted pid that started before it was adopted', async () => {
    const pid = (await startChild(POLITE)).pid as number
    const {deps, printed} = scriptedTeardown({
      startedAtOnExit: vi.fn(() => BEFORE)
    })

    forceKillPidOnExit(pid, 'firefox', ADOPTED_AT, deps)

    expect(deps.startedAtOnExit).toHaveBeenCalledExactlyOnceWith(pid)
    expect(vi.mocked(deps.kill).mock.calls).toEqual([[pid, 'SIGKILL']])
    expect(deps.killTreeOnExit).not.toHaveBeenCalled()
    expect(printed).toEqual([])
  })

  it.each([
    ['the process table cannot date', null],
    ['that started after it was adopted', AFTER]
  ] as const)('sends nothing to a pid %s, and says it was left', async (_title, startedAt) => {
    const child = await startChild(POLITE)
    const {deps, printed} = scriptedTeardown({
      startedAtOnExit: vi.fn(() => startedAt)
    })

    forceKillPidOnExit(child.pid, 'firefox', ADOPTED_AT, deps)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(deps.kill).not.toHaveBeenCalled()
    expect(deps.killTree).not.toHaveBeenCalled()
    expect(deps.killTreeOnExit).not.toHaveBeenCalled()
    expect(isRunning(child)).toBe(true)
    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain(
      `Firefox (pid ${child.pid}) did not stop and could not be confirmed as the browser this run started, so it was left running.`
    )

    expect(printed[0]).toContain(`kill -9 ${child.pid}`)
  })

  it('says nothing about a pid that is gone', () => {
    const {deps, printed} = scriptedTeardown({
      startedAtOnExit: vi.fn(() => null),
      isAlive: vi.fn(() => false)
    })

    forceKillPidOnExit(ADOPTED_PID, 'firefox', ADOPTED_AT, deps)

    expect(deps.kill).not.toHaveBeenCalled()
    expect(printed).toEqual([])
  })

  // The exit handler never waits on the long probe the grace timer may use.
  it('dates the pid with the exit probe alone', () => {
    const {deps} = scriptedTeardown({startedAtOnExit: vi.fn(() => BEFORE)})

    forceKillPidOnExit(ADOPTED_PID, 'firefox', ADOPTED_AT, deps)

    expect(deps.startedAtOnExit).toHaveBeenCalledExactlyOnceWith(ADOPTED_PID)
    expect(deps.startedAt).not.toHaveBeenCalled()
  })

  describe('on Windows', () => {
    it('ends the tree of a pid dated before its adoption, then the pid', () => {
      const order: string[] = []
      const {deps, printed} = scriptedTeardown({
        platform: 'win32',
        startedAtOnExit: vi.fn(() => BEFORE),
        killTreeOnExit: vi.fn(() => void order.push('tree')),
        kill: vi.fn(() => {
          order.push('kill')

          return true
        })
      })

      forceKillPidOnExit(ADOPTED_PID, 'firefox', ADOPTED_AT, deps)

      expect(order).toEqual(['tree', 'kill'])
      expect(deps.killTreeOnExit).toHaveBeenCalledExactlyOnceWith(ADOPTED_PID)
      expect(vi.mocked(deps.kill).mock.calls).toEqual([
        [ADOPTED_PID, 'SIGKILL']
      ])

      expect(deps.killTree).not.toHaveBeenCalled()
      expect(printed).toEqual([])
    })

    it.each([
      ['whose date did not come back in time', null],
      ['dated after its adoption', AFTER]
    ] as const)('leaves a pid %s and names the taskkill that stops it', (_title, startedAt) => {
      const {deps, printed} = scriptedTeardown({
        platform: 'win32',
        startedAtOnExit: vi.fn(() => startedAt)
      })

      forceKillPidOnExit(ADOPTED_PID, 'firefox', ADOPTED_AT, deps)

      expect(deps.killTreeOnExit).not.toHaveBeenCalled()
      expect(deps.kill).not.toHaveBeenCalled()
      expect(printed).toHaveLength(1)
      expect(printed[0]).toContain('so it was left running')
      expect(printed[0]).toContain(`taskkill /PID ${ADOPTED_PID} /T /F`)
    })
  })
})

describe('forceKillChildOnExit', () => {
  const standIn = (pid: number | undefined) => {
    const order: string[] = []
    const child = {
      pid,
      kill: vi.fn(() => {
        order.push('kill')

        return true
      })
    }

    return {child: child as unknown as ChildProcess, kill: child.kill, order}
  }

  it('ends the tree first on Windows, then the child', () => {
    const {child, kill, order} = standIn(2 ** 30)
    const {deps} = scriptedTeardown({
      platform: 'win32',
      killTreeOnExit: vi.fn(() => void order.push('tree'))
    })

    forceKillChildOnExit(child, 'chrome', deps)

    expect(order).toEqual(['tree', 'kill'])
    expect(deps.killTreeOnExit).toHaveBeenCalledExactlyOnceWith(2 ** 30)
    expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    expect(deps.startedAtOnExit).not.toHaveBeenCalled()
  })

  it('asks for no tree on Windows when the child never got a pid', () => {
    const {child, kill} = standIn(undefined)
    const {deps} = scriptedTeardown({platform: 'win32'})

    forceKillChildOnExit(child, 'chrome', deps)

    expect(deps.killTreeOnExit).not.toHaveBeenCalled()
    expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
  })

  it.each([
    ['an exit code', {exitCode: 0}],
    ['a signal', {exitCode: null, signalCode: 'SIGTERM'}]
  ])('waits for no taskkill on Windows once the child left with %s', (_name, left) => {
    const {child, kill} = standIn(2 ** 30)
    const {deps} = scriptedTeardown({platform: 'win32'})

    forceKillChildOnExit(Object.assign(child, left), 'chrome', deps)

    expect(deps.killTreeOnExit).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it.each([
    'darwin',
    'linux'
  ] as const)('signals the child alone on %s', (platform) => {
    const {child, kill} = standIn(2 ** 30)
    const {deps} = scriptedTeardown({platform})

    forceKillChildOnExit(child, 'chrome', deps)

    expect(deps.killTreeOnExit).not.toHaveBeenCalled()
    expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
  })
})

describe('the teardown defaults', () => {
  it('date a pid with the process table and probe it with signal 0', () => {
    expect(teardownDefaults.platform).toBe(process.platform)
    expect(teardownDefaults.isAlive(process.pid)).toBe(true)
    expect(teardownDefaults.mark(undefined)).toEqual([])
    expect(teardownDefaults.sweep([])).toEqual([])
    expect(EXIT_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(1500)
  })
})
