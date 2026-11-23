import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'cross-spawn'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  descendantsOf,
  installTimeoutMs,
  parseProcessTable,
  type RunCommandOptions,
  runCommand,
  type SpawnProcess,
  windowsTaskkillPath
} from '../lib/runner'

// The child is always this node binary, by absolute path, running a script
// given inline. No package runner is named, so nothing can be downloaded.
const NODE = process.execPath
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-command-'))

afterAll(() => {
  fs.rmSync(scratch, {recursive: true, force: true})
})

// A stand-in for a package runner's launcher file: found by name on the PATH
// it is handed, it passes every argument on to a script that prints them.
const shimDir = path.join(scratch, 'shims')
const SHIM = 'extjs-fixture-runner'
const printArgv = path.join(shimDir, 'print-argv.cjs')

fs.mkdirSync(shimDir)
fs.writeFileSync(
  printArgv,
  'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n'
)

fs.writeFileSync(
  path.join(shimDir, `${SHIM}.cmd`),
  `@echo off\r\n"${NODE}" "%~dp0print-argv.cjs" %*\r\n`
)

fs.writeFileSync(
  path.join(shimDir, SHIM),
  `#!/bin/sh\nexec "${NODE}" "${printArgv}" "$@"\n`,
  {mode: 0o755}
)

// Windows spells the variable Path, and a child reads one spelling only.
function envWithShimsFirst(): NodeJS.ProcessEnv {
  const env = {...process.env}

  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') Reflect.deleteProperty(env, key)
  }

  return {...env, PATH: `${shimDir}${path.delimiter}${process.env.PATH || ''}`}
}

function listeners() {
  return {
    SIGINT: process.listenerCount('SIGINT'),
    SIGTERM: process.listenerCount('SIGTERM'),
    exit: process.listenerCount('exit')
  }
}

function run(source: string, ...rest: string[]) {
  return runCommand(NODE, ['-e', source, '--', ...rest], {
    cwd: scratch,
    env: {...process.env, EXTJS_RUN_COMMAND_MARK: 'carried'}
  })
}

describe('runCommand with a real child', () => {
  let stdout: string[] = []
  let stderr: string[] = []

  beforeEach(() => {
    stdout = []
    stderr = []
    vi.stubEnv('EXTENSION_OUTPUT', '')
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))

      return true
    })

    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))

      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('hands each argument over whole, with no shell to split or run it', async () => {
    const destination = 'C:\\Users\\me & rm -rf x\\browsers'
    // Each one does something in a shell: runs a command, expands a name,
    // redirects into a file, matches files or ends the command line.
    const hostile = [
      'a & b',
      '$(echo expanded)',
      '`echo expanded`',
      '$HOME %PATH%',
      '> redirected.txt',
      '| cat',
      '; exit 7',
      '*',
      '"double" \'single\''
    ]

    const result = await run(
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      '--path',
      destination,
      ...hostile
    )

    expect(result).toEqual({
      code: 0,
      signal: null,
      stdout: JSON.stringify(['--path', destination, ...hostile]),
      stderr: ''
    })

    expect(fs.existsSync(path.join(scratch, 'redirected.txt'))).toBe(false)
  })

  // By bare name Windows finds the .cmd twin, as it finds a real launcher.
  it('finds a launcher script on the given PATH and passes its arguments whole', async () => {
    const args = ['--path', '/Users/me & co/the browsers', 'a & b', '$HOME']

    const result = await runCommand(SHIM, args, {
      cwd: scratch,
      env: envWithShimsFirst()
    })

    expect(result).toEqual({
      code: 0,
      signal: null,
      stdout: JSON.stringify(args),
      stderr: ''
    })
  })

  // A .cmd file is run by cmd.exe, the one place a shell sits between the
  // runner and its arguments, so each has to arrive escaped and still whole.
  it.runIf(process.platform === 'win32')(
    'finds a .cmd launcher on the given PATH and passes its arguments whole',
    async () => {
      const args = ['--path', 'C:\\Users\\me & co\\the browsers', 'a & b']

      const result = await runCommand(`${SHIM}.cmd`, args, {
        cwd: scratch,
        env: envWithShimsFirst()
      })

      expect(result).toEqual({
        code: 0,
        signal: null,
        stdout: JSON.stringify(args),
        stderr: ''
      })
    }
  )

  it('starts the child in the given folder with the given environment', async () => {
    const result = await run(
      'process.stdout.write(JSON.stringify(' +
        '[process.cwd(), process.env.EXTJS_RUN_COMMAND_MARK]))'
    )
    const [cwd, mark] = JSON.parse(result.stdout) as string[]

    expect(fs.realpathSync(cwd)).toBe(fs.realpathSync(scratch))
    expect(mark).toBe('carried')
  })

  it('reports the exit code and each stream apart, and echoes both as they come', async () => {
    const result = await run(
      'process.stdout.write("fetching"); process.stderr.write("warned"); ' +
        'process.exitCode = 3'
    )

    expect(result).toEqual({
      code: 3,
      signal: null,
      stdout: 'fetching',
      stderr: 'warned'
    })

    expect(stdout).toEqual(['fetching'])
    expect(stderr).toEqual(['warned'])
  })

  // A pipe holds about 64 KB. A runner that stopped reading either stream
  // would leave the child blocked on its write and this would never end.
  it('reads both streams to the end when each outgrows a pipe', async () => {
    const result = await run(
      'const mega = "x".repeat(1 << 20); ' +
        'process.stderr.write(mega + "ERR-END"); ' +
        'process.stdout.write(mega.repeat(4) + "OUT-END")'
    )

    expect(result.code).toBe(0)
    expect(result.stdout).toHaveLength((4 << 20) + 'OUT-END'.length)
    expect(result.stdout.endsWith('xOUT-END')).toBe(true)
    expect(result.stderr).toHaveLength((1 << 20) + 'ERR-END'.length)
    expect(result.stderr.endsWith('xERR-END')).toBe(true)
    expect(stdout.join('')).toHaveLength(result.stdout.length)
    expect(stderr.join('')).toHaveLength(result.stderr.length)
  })

  // A pipe hands output over in chunks cut at any byte, so a three-byte
  // character lands across two of them somewhere in 900 KB.
  it('keeps a character whole when a chunk ends inside it, on both streams', async () => {
    const result = await run(
      'const blocks = "\u2588".repeat(300000); ' +
        'process.stderr.write("e" + blocks); ' +
        'process.stdout.write("x" + blocks)'
    )

    expect(result.code).toBe(0)
    expect(result.stdout).toHaveLength(300001)
    expect(result.stderr).toHaveLength(300001)
    expect(result.stdout).toBe(`x${'\u2588'.repeat(300000)}`)
    expect(result.stderr).toBe(`e${'\u2588'.repeat(300000)}`)
    expect(result.stdout).not.toContain('\uFFFD')
  })

  it('moves the child stdout to stderr under machine output', async () => {
    vi.stubEnv('EXTENSION_OUTPUT', 'json')

    const result = await run('process.stdout.write("fetching")')

    expect(result.stdout).toBe('fetching')
    expect(stdout).toEqual([])
    expect(stderr).toEqual(['fetching'])
  })

  // Windows has no signals to die from: a child that kills itself there ends
  // with an exit code, so the signal only travels on the other platforms.
  it.skipIf(process.platform === 'win32')(
    'carries the signal through when the child is killed',
    async () => {
      const result = await run(
        'process.kill(process.pid, "SIGTERM"); setInterval(() => {}, 1000)'
      )

      expect(result).toEqual({
        code: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: ''
      })
    }
  )

  it('rejects with ENOENT when the command is not there to start', async () => {
    const missing = path.join(scratch, 'no-such-runner')
    const before = listeners()

    const error: unknown = await runCommand(missing, ['--version'], {
      cwd: scratch,
      env: {...process.env}
    }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect((error as NodeJS.ErrnoException).code).toBe('ENOENT')
    expect((error as Error).message).toBe(`spawn ${missing} ENOENT`)
    expect(listeners()).toEqual(before)
  })

  // Every child below is this node binary, started here and tracked by pid,
  // so whatever a failing case leaves running is ended by the group it led.
  describe('a child that has to be stopped', () => {
    const IDLE = 'setInterval(() => {}, 1000)'
    // Names the fixture in the process list, for the orphan check.
    const TAG = 'extjs-run-command-fixture'
    let started: number[] = []

    beforeEach(() => {
      started = []
    })

    afterEach(() => {
      for (const pid of started) {
        for (const target of [-pid, pid]) {
          try {
            process.kill(target, 'SIGKILL')
          } catch {
            // Already gone, which is what every case here expects.
          }
        }
      }
    })

    const tracked: SpawnProcess = (command, args, options) => {
      const child = spawn(command, args, options)
      if (child.pid !== undefined) started.push(child.pid)

      return child
    }

    function start(source: string, options: Partial<RunCommandOptions> = {}) {
      return runCommand(NODE, ['-e', source, '--', TAG], {
        cwd: scratch,
        env: {...process.env},
        spawnProcess: tracked,
        timeoutMs: 10_000,
        graceMs: 100,
        ...options
      })
    }

    async function until(check: () => boolean): Promise<void> {
      const deadline = Date.now() + 8_000

      while (!check()) {
        if (Date.now() > deadline) {
          throw new Error('the fixture never got there')
        }

        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }

    function alive(pid: number): boolean {
      try {
        process.kill(pid, 0)

        return true
      } catch {
        return false
      }
    }

    const printed = () => stdout.join('')

    it('ends a child that never exits once the timeout passes', async () => {
      const before = listeners()

      // taskkill takes longer to start than the short grace the other cases
      // use, and the kill after the grace would end the child first.
      const result = await start(IDLE, {
        timeoutMs: 150,
        ...(process.platform === 'win32' ? {graceMs: 5_000} : {})
      })

      expect(result).toEqual({
        code: process.platform === 'win32' ? 1 : null,
        signal: process.platform === 'win32' ? null : 'SIGTERM',
        stdout: '',
        stderr: '',
        timedOut: true
      })

      expect(alive(started[0])).toBe(false)
      expect(listeners()).toEqual(before)
    })

    it('reads the timeout from EXTENSION_INSTALL_TIMEOUT_MS in the env it is handed', async () => {
      const result = await start(IDLE, {
        timeoutMs: undefined,
        env: {...process.env, EXTENSION_INSTALL_TIMEOUT_MS: '150'}
      })

      expect(result.timedOut).toBe(true)
    })

    it('reports no timeout for a child that ends on its own', async () => {
      const result = await start('process.exitCode = 4')

      expect(result).toEqual({code: 4, signal: null, stdout: '', stderr: ''})
      expect('timedOut' in result).toBe(false)
      expect('interrupted' in result).toBe(false)
    })

    // An installer that asks a question would wait on an open pipe for ever.
    it('gives the child no input, so a read ends at once', async () => {
      const result = await start(
        'let read = ""; process.stdin.on("data", (chunk) => { read += chunk }); ' +
          'process.stdin.on("end", () => process.stdout.write("end of input after " + read.length + " bytes"))',
        {timeoutMs: 4_000}
      )

      expect(result).toEqual({
        code: 0,
        signal: null,
        stdout: 'end of input after 0 bytes',
        stderr: ''
      })
    })

    it.skipIf(process.platform === 'win32')(
      'kills a child that ignores SIGTERM, and the grandchild it started, after the grace',
      async () => {
        const result = await start(
          'process.on("SIGTERM", () => {}); ' +
            'const grandchild = require("node:child_process").spawn(process.execPath, ' +
            `["-e", 'process.on("SIGTERM", () => {}); ${IDLE}', "--", "${TAG}"], {stdio: "ignore"}); ` +
            `process.stdout.write(String(grandchild.pid)); ${IDLE}`,
          {timeoutMs: 1_000}
        )
        const grandchild = Number(result.stdout)

        expect(result).toEqual({
          code: null,
          signal: 'SIGKILL',
          stdout: String(grandchild),
          stderr: '',
          timedOut: true
        })

        expect(grandchild).toBeGreaterThan(1)
        await until(() => !alive(grandchild))
        expect(alive(grandchild)).toBe(false)
        expect(alive(started[0])).toBe(false)
      }
    )

    // The leader ends on SIGTERM and closes the pipes, so nothing but the
    // group still names the grandchild that ignored it.
    it.skipIf(process.platform === 'win32')(
      'kills a grandchild that outlives a leader which ended on SIGTERM',
      async () => {
        const signals = new EventEmitter()
        const run = start(
          'const grandchild = require("node:child_process").spawn(process.execPath, ' +
            `["-e", 'process.on("SIGTERM", () => {}); ${IDLE}', "--", "${TAG}"], {stdio: "ignore"}); ` +
            `process.stdout.write(String(grandchild.pid)); ${IDLE}`,
          {signals, graceMs: 5_000}
        )
        await until(() => /^\d+$/.test(printed()))
        const grandchild = Number(printed())

        expect(alive(grandchild)).toBe(true)
        signals.emit('SIGTERM')

        const result = await run

        expect(result.signal).toBe('SIGTERM')
        expect(result.interrupted).toBe('SIGTERM')
        await until(() => !alive(grandchild))
        expect(alive(grandchild)).toBe(false)
      }
    )

    it.skipIf(process.platform === 'win32')(
      'starts the child as the leader of its own group, and not when it is kept on the terminal',
      async () => {
        const options: Array<{detached?: boolean; stdio?: unknown}> = []

        const recording: SpawnProcess = (command, args, given) => {
          options.push(given)

          return tracked(command, args, given)
        }

        const signals = new EventEmitter()
        const own = start(`process.stdout.write("up"); ${IDLE}`, {
          spawnProcess: recording,
          signals
        })
        await until(() => printed().includes('up'))

        // Signal 0 to the negative id answers only while that group exists.
        expect(() => process.kill(-started[0], 0)).not.toThrow()
        signals.emit('SIGTERM')
        expect((await own).signal).toBe('SIGTERM')

        const attached = start(`process.stdout.write("on"); ${IDLE}`, {
          spawnProcess: recording,
          ownGroup: false,
          signals
        })
        await until(() => printed().includes('on'))

        expect(() => process.kill(-started[1], 0)).toThrow(/ESRCH/)
        signals.emit('SIGTERM')
        expect(await attached).toEqual({
          code: null,
          signal: 'SIGTERM',
          stdout: 'on',
          stderr: '',
          interrupted: 'SIGTERM'
        })

        expect(options.map((given) => [given.detached, given.stdio])).toEqual([
          [true, ['ignore', 'pipe', 'pipe']],
          [false, ['ignore', 'pipe', 'pipe']]
        ])
      }
    )

    const SWITCH_LINE = 'Switching to root user to install dependencies...'

    // sudo asks on the terminal, which no pipe shows, so silence after the
    // root-switch line is the one sign that the prompt is still waiting.
    it.skipIf(process.platform === 'win32')(
      'stops an attached installer, and the prompt it started, once the password wait passes',
      async () => {
        const run = start(
          'const prompt = require("node:child_process").spawn(process.execPath, ' +
            `["-e", '${IDLE}', "--", "${TAG}"], {stdio: "inherit"}); ` +
            `process.stdout.write(prompt.pid + "\\n${SWITCH_LINE}\\n"); ${IDLE}`,
          {ownGroup: false, promptWaitMs: 300}
        )
        await until(() => printed().includes(SWITCH_LINE))
        const prompt = Number(printed().split('\n')[0])
        // Not in the child's group, so the cleanup has to name it.
        started.push(prompt)

        const result = await run

        expect(result).toEqual({
          code: null,
          signal: 'SIGTERM',
          stdout: `${prompt}\n${SWITCH_LINE}\n`,
          stderr: '',
          promptTimedOut: true
        })

        await until(() => !alive(prompt))
        expect(alive(prompt)).toBe(false)
        expect(alive(started[0])).toBe(false)
      },
      15_000
    )

    it('lets an installer run on once anything follows the root-switch line', async () => {
      const result = await start(
        `process.stdout.write("${SWITCH_LINE}\\n"); ` +
          'setTimeout(() => process.stderr.write("+ arch\\n"), 50); ' +
          'setTimeout(() => process.exit(0), 700)',
        {ownGroup: false, promptWaitMs: 300}
      )

      expect(result).toEqual({
        code: 0,
        signal: null,
        stdout: `${SWITCH_LINE}\n`,
        stderr: '+ arch\n'
      })
    })

    it('starts no password wait for an installer that was not given one', async () => {
      const result = await start(
        `process.stdout.write("${SWITCH_LINE}\\n"); ` +
          'setTimeout(() => process.exit(0), 400)',
        {ownGroup: false}
      )

      expect(result).toEqual({
        code: 0,
        signal: null,
        stdout: `${SWITCH_LINE}\n`,
        stderr: ''
      })
    })

    it.each([
      'SIGINT',
      'SIGTERM'
    ] as const)('passes %s on to the child while it runs, and stops listening after', async (signal) => {
      const signals = new EventEmitter()
      const run = start(`process.stdout.write("up"); ${IDLE}`, {signals})
      await until(() => printed().includes('up'))

      expect(signals.listenerCount('SIGINT')).toBe(1)
      expect(signals.listenerCount('SIGTERM')).toBe(1)
      signals.emit(signal)

      const result = await run

      expect(result.interrupted).toBe(signal)
      expect(result.timedOut).toBe(undefined)

      if (process.platform !== 'win32') {
        expect(result).toEqual({
          code: null,
          signal,
          stdout: 'up',
          stderr: '',
          interrupted: signal
        })
      }

      expect(alive(started[0])).toBe(false)
      expect(signals.listenerCount('SIGINT')).toBe(0)
      expect(signals.listenerCount('SIGTERM')).toBe(0)
    })

    it.skipIf(process.platform === 'win32')(
      'kills the group of a child that ignores the signal passed on',
      async () => {
        const signals = new EventEmitter()
        const run = start(
          `process.on("SIGINT", () => {}); process.stdout.write("up"); ${IDLE}`,
          {signals}
        )
        await until(() => printed().includes('up'))
        signals.emit('SIGINT')

        expect(await run).toEqual({
          code: null,
          signal: 'SIGKILL',
          stdout: 'up',
          stderr: '',
          interrupted: 'SIGINT'
        })
      }
    )

    it('listens on the process itself by default, only for the life of the child', async () => {
      const before = listeners()
      const run = start(IDLE, {timeoutMs: 150})

      expect(listeners()).toEqual({
        SIGINT: before.SIGINT + 1,
        SIGTERM: before.SIGTERM + 1,
        exit: before.exit
      })

      expect((await run).timedOut).toBe(true)
      expect(listeners()).toEqual(before)
    })

    // taskkill is never started here: the stand-in records what it would be
    // handed and ends the one child this case started.
    it('ends the whole tree through taskkill on Windows, with no group of its own', async () => {
      const calls: Array<[string, string[], {detached?: boolean}]> = []
      let installer: ReturnType<SpawnProcess> | undefined

      const windows: SpawnProcess = (command, args, options) => {
        calls.push([command, args, options])

        if (command !== windowsTaskkillPath()) {
          installer = tracked(command, args, options)

          return installer
        }

        installer?.kill('SIGKILL')

        return new EventEmitter() as ReturnType<SpawnProcess>
      }

      const result = await start(IDLE, {
        platform: 'win32',
        spawnProcess: windows,
        timeoutMs: 150,
        graceMs: 5_000
      })

      expect(result.timedOut).toBe(true)
      expect(calls).toHaveLength(2)
      expect(calls[0][2].detached).toBe(false)
      expect(calls[1]).toEqual([
        windowsTaskkillPath(),
        ['/pid', String(started[0]), '/T', '/F'],
        {stdio: 'ignore'}
      ])
    })

    // A slow machine can take longer than the grace to start taskkill. A kill
    // in that window ends the shim alone and orphans what it started.
    it('waits for a slow taskkill on Windows before it kills anything', async () => {
      let installer: ReturnType<SpawnProcess> | undefined
      let aliveWhenTaskkillRan: boolean | undefined

      const windows: SpawnProcess = (command, args, options) => {
        if (command !== windowsTaskkillPath()) {
          installer = tracked(command, args, options)

          return installer
        }

        const taskkill = new EventEmitter()

        setTimeout(() => {
          aliveWhenTaskkillRan =
            installer?.exitCode === null && installer?.signalCode === null

          installer?.kill('SIGKILL')
          taskkill.emit('close', 0)
        }, 400)

        return taskkill as ReturnType<SpawnProcess>
      }

      const result = await start(IDLE, {
        platform: 'win32',
        spawnProcess: windows,
        timeoutMs: 150,
        graceMs: 100
      })

      expect(result.timedOut).toBe(true)
      expect(aliveWhenTaskkillRan).toBe(true)
    })

    it('kills the shim itself when taskkill cannot start', async () => {
      const commands: string[] = []

      const windows: SpawnProcess = (command, args, options) => {
        commands.push(command)

        if (command !== windowsTaskkillPath()) {
          return tracked(command, args, options)
        }

        const taskkill = new EventEmitter()

        queueMicrotask(() =>
          taskkill.emit('error', new Error('spawn taskkill ENOENT'))
        )

        return taskkill as ReturnType<SpawnProcess>
      }

      const result = await start(IDLE, {
        platform: 'win32',
        spawnProcess: windows,
        timeoutMs: 150,
        graceMs: 100
      })

      expect(result.timedOut).toBe(true)
      expect(commands).toEqual([NODE, windowsTaskkillPath()])
    })
  })

  // The child here is a stand-in on a held clock, so the 30 s bound is read
  // without waiting for it.
  describe('a taskkill that never answers', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('still ends the run, once the bound and the grace have passed', async () => {
      vi.useFakeTimers()
      const shim = Object.assign(new EventEmitter(), {
        pid: 4242,
        stdout: null,
        stderr: null,
        signals: [] as string[],
        kill(signal: NodeJS.Signals) {
          shim.signals.push(signal)
          queueMicrotask(() => shim.emit('close', null, signal))

          return true
        }
      })
      const windows: SpawnProcess = (command) =>
        (command === windowsTaskkillPath()
          ? new EventEmitter()
          : shim) as ReturnType<SpawnProcess>

      const run = runCommand(NODE, ['-e', ''], {
        cwd: scratch,
        env: {...process.env},
        platform: 'win32',
        spawnProcess: windows,
        timeoutMs: 150,
        graceMs: 100
      })

      await vi.advanceTimersByTimeAsync(150 + 29_000)
      expect(shim.signals).toEqual([])

      await vi.advanceTimersByTimeAsync(1_000 + 100)
      await expect(run).resolves.toMatchObject({timedOut: true})
      expect(shim.signals[0]).toBe('SIGKILL')
    })
  })
})

describe('installTimeoutMs, read from an environment', () => {
  const HALF_HOUR = 30 * 60_000

  it.each([
    ['1', 1],
    ['150', 150],
    [' 90000 ', 90_000],
    ['99999999999', 2_147_483_647]
  ])('takes %j as %i ms', (value, expected) => {
    expect(installTimeoutMs({EXTENSION_INSTALL_TIMEOUT_MS: value})).toBe(
      expected
    )
  })

  it.each([
    undefined,
    '',
    '   ',
    '0',
    '-1',
    '30s',
    '1.5',
    '1e3',
    'soon',
    'Infinity'
  ])('falls back to thirty minutes on %j', (value) => {
    expect(installTimeoutMs({EXTENSION_INSTALL_TIMEOUT_MS: value})).toBe(
      HALF_HOUR
    )
  })

  it('reads the process when no environment is given', () => {
    vi.stubEnv('EXTENSION_INSTALL_TIMEOUT_MS', '4321')
    expect(installTimeoutMs()).toBe(4321)
    vi.unstubAllEnvs()
    vi.stubEnv('EXTENSION_INSTALL_TIMEOUT_MS', undefined)
    expect(installTimeoutMs()).toBe(HALF_HOUR)
    vi.unstubAllEnvs()
  })
})

describe('the processes under an installer, read from ps', () => {
  const TABLE =
    '    1     0\n   10     1\n   11    10\n   12    11\n' +
    '   20     1\n   13    10\n   21    20\nnot a row\n\n'

  it('reads each pid beside its parent and skips what is not a row', () => {
    expect(parseProcessTable(TABLE)).toEqual([
      [1, 0],
      [10, 1],
      [11, 10],
      [12, 11],
      [20, 1],
      [13, 10],
      [21, 20]
    ])
  })

  it('walks every level under the root and nothing beside it', () => {
    expect(descendantsOf(10, parseProcessTable(TABLE))).toEqual([11, 13, 12])
    expect(descendantsOf(21, parseProcessTable(TABLE))).toEqual([])
  })

  it('stops on a table that loops back on itself', () => {
    expect(descendantsOf(5, parseProcessTable('5 7\n7 5\n'))).toEqual([7])
  })
})
