import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import * as http from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli, startCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {signal?: string} | null
  error: {code: string; message: string} | null
}

// Sends the signal on the first turn of the event loop: the entry has loaded
// and no command has had the time to arm a handler of its own.
const SIGNAL_ON_FIRST_TURN =
  'setImmediate(() => process.kill(process.pid, process.env.EXTJS_SPEC_SIGNAL))\n'

// Holds the build after its files are emitted and before they are published,
// until the release file shows up. The marker says the build got that far.
const HELD_BUILD_CONFIG = `const fs = require('node:fs')
const held = {
  apply(compiler) {
    compiler.hooks.afterEmit.tapPromise('extjs-spec-hold', async () => {
      fs.writeFileSync(process.env.EXTJS_SPEC_HELD, '')
      while (!fs.existsSync(process.env.EXTJS_SPEC_RELEASE)) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    })
  }
}
module.exports = {
  config: (config) => ({...config, plugins: [...(config.plugins || []), held]})
}
`

// Holds the command after the engine said the build succeeded: the compiler
// is closed last, behind the line, and this keeps it from closing.
const HELD_CLOSE_CONFIG = `const fs = require('node:fs')
const held = {
  apply(compiler) {
    compiler.hooks.shutdown.tapPromise('extjs-spec-hold-close', async () => {
      fs.writeFileSync(process.env.EXTJS_SPEC_HELD, '')
      while (!fs.existsSync(process.env.EXTJS_SPEC_RELEASE)) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    })
  }
}
module.exports = {
  config: (config) => ({...config, plugins: [...(config.plugins || []), held]})
}
`

const EXIT_CODES = {SIGINT: 130, SIGTERM: 143} as const

// Posix only: on Windows a kill ends the child before any handler runs.
describe.skipIf(process.platform === 'win32')(
  'a json run told to stop before its command answers signals',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    function createProject(): {work: string; projectDir: string} {
      const work = mkdtempSync(join(tmpdir(), 'extjs-early-interrupt-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      mkdirSync(projectDir)
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Early Interrupt Probe',
          version: '1.0.0'
        })
      )

      return {work, projectDir}
    }

    const COMMANDS = [
      ['dev', ['--no-browser']],
      ['build', []],
      ['start', ['--no-browser']],
      ['preview', ['--no-browser']],
      ['doctor', []]
    ] as const

    // A quick command may finish, or arm its own handler, before the signal
    // is delivered. Either way the stream has one ending and it comes last.
    describe.each([
      'SIGINT',
      'SIGTERM'
    ] as const)('%s on the first turn', (signal) => {
      it.each(COMMANDS)(
        '%s ends its stream once',
        async (command, flags) => {
          const {work, projectDir} = createProject()
          const preload = join(work, 'signal-on-first-turn.cjs')
          writeFileSync(preload, SIGNAL_ON_FIRST_TURN)

          const run = await runCli(
            [command, projectDir, ...flags, '--output', 'json'],
            {
              timeoutMs: 60_000,
              env: {
                NODE_OPTIONS: `--require "${preload}"`,
                EXTJS_SPEC_SIGNAL: signal
              }
            }
          )

          const frames = everyLineAsFrame<Frame>(run.stdout)
          const stopped = frames.filter((frame) => frame.status === 'stopped')

          expect(run.signal).toBeNull()
          expect(frames.length).toBeGreaterThan(0)
          expect(frames.filter((frame) => !frame.ok).length).toBeLessThan(2)
          expect(frames.findIndex((frame) => !frame.ok)).toBeOneOf([
            -1,
            frames.length - 1
          ])

          for (const frame of stopped) {
            expect(frame).toMatchObject({
              command,
              error: {code: 'E_INTERRUPTED'}
            })
          }
        },
        90_000
      )
    })

    // Held mid-build, so the signal certainly lands before the command ends
    // and before anything but the entry listens for it.
    describe.each([
      'SIGINT',
      'SIGTERM'
    ] as const)('%s during a held build', (signal) => {
      it.each([
        ['build', []],
        ['start', ['--no-browser']]
      ] as const)(
        '%s ends with one stopped frame and the signal exit code',
        async (command, flags) => {
          const {work, projectDir} = createProject()
          writeFileSync(
            join(projectDir, 'extension.config.js'),
            HELD_BUILD_CONFIG
          )

          const held = join(work, 'held')
          const session = startCli(
            [command, projectDir, ...flags, '--output', 'json'],
            {
              env: {
                EXTJS_SPEC_HELD: held,
                EXTJS_SPEC_RELEASE: join(work, 'never-released')
              }
            }
          )

          await session.waitFor(
            () => existsSync(held),
            60_000,
            'the held build'
          )

          const exit = await session.stop(signal, 20_000)

          expect(session.frames<Frame>()).toEqual([
            {
              schema: 1,
              ok: false,
              command,
              status: 'stopped',
              value: {signal},
              error: {
                code: 'E_INTERRUPTED',
                message: `The ${command} run was interrupted by ${signal}.`
              },
              warnings: []
            }
          ])

          expect(exit).toEqual({status: EXIT_CODES[signal], signal: null})
        },
        120_000
      )
    })

    // The window before Node runs the entry cannot be closed, so a run that
    // early may die of the signal. What it never does is end on two frames.
    it.each([
      0, 60, 250
    ])('dev signaled %d ms after the spawn ends on at most one failure frame, the last', async (afterMs) => {
      const {projectDir} = createProject()
      const session = startCli([
        'dev',
        projectDir,
        '--no-browser',
        '--output',
        'json'
      ])

      await new Promise((resolve) => setTimeout(resolve, afterMs))
      const exit = await session.stop('SIGINT', 20_000)
      const frames = session.frames<Frame>()
      const failures = frames.filter((frame) => !frame.ok)

      if (frames.length === 0) {
        expect(exit.signal).toBe('SIGINT')

        return
      }

      expect(failures).toHaveLength(1)
      expect(frames.at(-1)).toMatchObject({
        ok: false,
        command: 'dev',
        status: 'stopped',
        error: {code: 'E_INTERRUPTED'}
      })
    }, 60_000)

    it('a build stopped before it publishes frames the stop, keeps the last output and drops its staging folder', async () => {
      const {work, projectDir} = createProject()
      const first = await runCli(
        ['build', projectDir, '--browser', 'chromium', '--output', 'json'],
        {timeoutMs: 60_000}
      )

      expect(first.status, first.stderr).toBe(0)

      const built = join(projectDir, 'dist', 'chromium', 'manifest.json')
      const before = readFileSync(built, 'utf8')

      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Early Interrupt Probe',
          version: '2.0.0'
        })
      )

      writeFileSync(join(projectDir, 'extension.config.js'), HELD_BUILD_CONFIG)

      const held = join(work, 'held')
      const session = startCli(
        ['build', projectDir, '--browser', 'chromium', '--output', 'json'],
        {
          env: {
            EXTJS_SPEC_HELD: held,
            EXTJS_SPEC_RELEASE: join(work, 'never-released')
          }
        }
      )

      await session.waitFor(() => existsSync(held), 60_000, 'the held build')

      const staged = () =>
        readdirSync(join(projectDir, 'dist')).filter((name) =>
          name.startsWith('.extension-build-')
        )

      expect(staged()).toHaveLength(1)

      const exit = await session.stop('SIGINT', 20_000)

      expect(session.frames<Frame>()).toEqual([
        {
          schema: 1,
          ok: false,
          command: 'build',
          status: 'stopped',
          value: {signal: 'SIGINT'},
          error: {
            code: 'E_INTERRUPTED',
            message: 'The build run was interrupted by SIGINT.'
          },
          warnings: []
        }
      ])

      expect(exit).toEqual({status: 130, signal: null})
      expect(readFileSync(built, 'utf8')).toBe(before)
      expect(staged()).toEqual([])
    }, 120_000)

    it('a build stopped in text mode exits as the signal and drops its staging folder too', async () => {
      const {work, projectDir} = createProject()
      writeFileSync(join(projectDir, 'extension.config.js'), HELD_BUILD_CONFIG)

      const held = join(work, 'held')
      const session = startCli(['build', projectDir, '--browser', 'chromium'], {
        env: {
          EXTJS_SPEC_HELD: held,
          EXTJS_SPEC_RELEASE: join(work, 'never-released')
        }
      })

      await session.waitFor(() => existsSync(held), 60_000, 'the held build')

      const exit = await session.stop('SIGINT', 20_000)

      expect(exit).toEqual({status: 130, signal: null})
      expect(session.read().stdout).toBe('')
      expect(
        readdirSync(join(projectDir, 'dist')).filter((name) =>
          name.startsWith('.extension-build-')
        )
      ).toEqual([])
    }, 120_000)

    // The build succeeded and said so. The exit code agrees with that line,
    // whatever lands between it and the command's return.
    describe('a build signaled after it said it succeeded', () => {
      function heldAfterTold(args: string[], env: Record<string, string> = {}) {
        const {work, projectDir} = createProject()

        writeFileSync(
          join(projectDir, 'extension.config.js'),
          HELD_CLOSE_CONFIG
        )

        const held = join(work, 'held')
        const release = join(work, 'release')
        const session = startCli(['build', projectDir, ...args], {
          stderrTerminal: true,
          env: {EXTJS_SPEC_HELD: held, EXTJS_SPEC_RELEASE: release, ...env}
        })

        return {
          session,
          release,
          told: () =>
            session.waitFor(() => existsSync(held), 60_000, 'the held close')
        }
      }

      // Ends with the run when the signal ended it, or once it had its time.
      const settled = (session: ReturnType<typeof startCli>) =>
        Promise.race([
          session.closed,
          new Promise((resolve) => setTimeout(resolve, 500))
        ])

      it.each([
        'SIGINT',
        'SIGTERM'
      ] as const)('exits 0 on %s in text mode, and does not wait on the registry after', async (signal) => {
        const silent = http.createServer(() => {})

        await new Promise<void>((resolve) =>
          silent.listen(0, '127.0.0.1', resolve)
        )

        const address = silent.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const {session, release, told} = heldAfterTold(
          ['--browser', 'chromium'],
          {npm_registry: `http://127.0.0.1:${port}/`}
        )

        try {
          await told()
          await session.waitFor(
            () => session.read().stdout.includes('built for production'),
            10_000,
            'the built line'
          )

          session.child.kill(signal)
          await settled(session)
          writeFileSync(release, '')

          const releasedAt = Date.now()

          expect(await session.closed).toEqual({status: 0, signal: null})
          // The update check's bound is two seconds, and it was not waited.
          expect(Date.now() - releasedAt).toBeLessThan(1500)
          // The person who pressed the key is told it was seen, once.
          expect(
            session
              .read()
              .stderr.split('\n')
              .filter((line) => line.trim())
          ).toEqual([
            `⏵⏵⏵ The build had already finished, so there was nothing to stop.`
          ])
        } finally {
          session.killGroup()
          silent.closeAllConnections()
          await new Promise<void>((resolve) => silent.close(() => resolve()))
        }
      }, 120_000)

      it('ends a json run on its own built frame, exit 0', async () => {
        const {session, release, told} = heldAfterTold([
          '--browser',
          'chromium',
          '--output',
          'json'
        ])

        try {
          await told()
          session.child.kill('SIGINT')
          await settled(session)
          writeFileSync(release, '')

          expect(await session.closed).toEqual({status: 0, signal: null})
          expect(
            session.frames<Frame>().map(({ok, status}) => ({ok, status}))
          ).toEqual([{ok: true, status: 'built'}])

          // A machine reads the frame, so the line for a person stays out.
          expect(session.read().output).not.toContain('nothing to stop')
        } finally {
          session.killGroup()
        }
      }, 120_000)

      it('still stops a list of browsers signaled after the first one was told', async () => {
        const {session, told} = heldAfterTold(['--browser', 'chromium,firefox'])

        try {
          await told()

          expect(await session.stop('SIGINT', 20_000)).toEqual({
            status: 130,
            signal: null
          })

          expect(session.read().stdout).not.toContain('firefox')
        } finally {
          session.killGroup()
        }
      }, 120_000)
    })
  }
)
