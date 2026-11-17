import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {framesIn, runCli as spawnCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

// dev keeps serving after a launch it could not make, so its run ends once
// the failure frame is out. start and preview end by themselves.
async function runCli(args: string[], untilFailure: boolean) {
  const run = await spawnCli(args, {
    timeoutMs: 100_000,
    until: untilFailure
      ? (output) => output.stdout.includes('"ok":false')
      : undefined
  })

  return framesIn<Frame>(run.stdout)
}

// The stand-ins lean on posix permission bits and shell scripts.
describe.skipIf(process.platform === 'win32')(
  'a bad pinned browser binary reports one status on every command',
  () => {
    let work = ''
    let projectDir = ''
    const pins: Record<string, string> = {}

    beforeAll(() => {
      work = mkdtempSync(join(tmpdir(), 'extjs-bad-pin-'))
      projectDir = join(work, 'project')
      mkdirSync(projectDir, {recursive: true})
      writeFileSync(
        join(projectDir, 'manifest.json'),
        JSON.stringify({manifest_version: 3, name: 'Bad Pin', version: '1.0.0'})
      )

      const bin = join(work, 'bin')
      mkdirSync(bin, {recursive: true})
      pins.missing = join(work, 'nowhere', 'browser')

      pins['not executable'] = join(bin, 'unrunnable')
      writeFileSync(pins['not executable'], 'not a browser\n')
      chmodSync(pins['not executable'], 0o644)
    })

    afterAll(() => {
      rmSync(work, {recursive: true, force: true})
    })

    const cases: Array<[string, string, string, string]> = []

    for (const command of ['start', 'dev', 'preview']) {
      // A pin that runs and never answers costs the probe's 10 seconds, so
      // browser-version-probe.contract.spec.ts reads it from one run each.
      for (const cause of ['missing', 'not executable']) {
        cases.push([command, cause, 'chrome', '--chromium-binary'])
      }

      cases.push([command, 'not executable', 'firefox', '--gecko-binary'])
    }

    it.each(cases)(
      '%s answers a %s %s pin with usage and E_BROWSER_BINARY_INVALID',
      async (command, cause, browser, flag) => {
        const frames = await runCli(
          [
            command,
            projectDir,
            '--browser',
            browser,
            flag,
            pins[cause],
            '--no-open',
            '--output',
            'json'
          ],
          command === 'dev'
        )

        const failures = frames.filter((frame) => !frame.ok)
        expect(failures, JSON.stringify(frames)).toHaveLength(1)
        expect(failures[0]).toMatchObject({command, status: 'usage'})
        expect(failures[0].error?.code).toBe('E_BROWSER_BINARY_INVALID')
        expect(failures[0].error?.message).toContain(pins[cause])
      },
      120_000
    )
  }
)
