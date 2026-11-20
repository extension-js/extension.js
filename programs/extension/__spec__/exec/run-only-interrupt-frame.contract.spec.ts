import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {everyLineAsFrame, startCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  value: {signal?: string; browsers?: string[]} | null
  error: {code: string; message: string} | null
}

// A browser that answers its version and then stays up without ever opening
// a debugging port, so the session is live and no real browser is named. It
// writes one file, at the path given here, to say the session launched it.
function writeStandInBrowser(dir: string, launched: string): string {
  const binary = join(dir, 'stand-in-browser')

  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --version|--product-version)',
      '      echo "Stand-in 999.0.1234.5"',
      '      exit 0',
      '      ;;',
      '  esac',
      'done',
      `: > '${launched}'`,
      'exec sleep 600',
      ''
    ].join('\n')
  )

  chmodSync(binary, 0o755)

  return binary
}

// Posix only: the stand-in is a shell script, and on Windows a kill ends the
// child before any handler runs.
describe.skipIf(process.platform === 'win32')(
  'a run-only session told to stop ends its json stream with one coded frame',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it.each([
      ['preview', 'SIGINT'],
      ['preview', 'SIGTERM'],
      ['start', 'SIGINT'],
      ['start', 'SIGTERM']
    ] as const)(
      '%s on %s: stopped with E_INTERRUPTED last, and the run exits 0',
      async (command, signal) => {
        const work = mkdtempSync(join(tmpdir(), 'extjs-run-only-interrupt-'))
        leftovers.push(work)
        const projectDir = join(work, 'project')
        mkdirSync(projectDir)
        writeFileSync(
          join(projectDir, 'manifest.json'),
          JSON.stringify({
            manifest_version: 3,
            name: 'Interrupt Probe',
            version: '1.0.0'
          })
        )

        const launched = join(work, 'launched')
        const session = startCli([
          command,
          projectDir,
          '--browser',
          'chromium',
          '--chromium-binary',
          writeStandInBrowser(work, launched),
          '--output',
          'json'
        ])

        await session.waitFor(
          () => existsSync(launched),
          60_000,
          'the stand-in browser to be launched'
        )

        const exit = await session.stop(signal, 15_000)
        const {stdout, stderr} = session.read()

        expect(exit, stderr).toEqual({status: 0, signal: null})

        const frames = everyLineAsFrame<Frame>(stdout)
        const last = frames[frames.length - 1]

        expect(last).toMatchObject({
          ok: false,
          command,
          status: 'stopped',
          value: {signal, browsers: ['chromium']},
          error: {
            code: 'E_INTERRUPTED',
            message: `The ${command} session was interrupted by ${signal}.`
          }
        })

        expect(
          frames.filter((frame) => frame.status === 'stopped')
        ).toHaveLength(1)
      },
      90_000
    )
  }
)
