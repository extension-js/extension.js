import {spawn} from 'node:child_process'
import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

// dev keeps serving after a launch it could not make, so its run ends once
// the failure frame is out. start and preview end by themselves.
function runCli(args: string[], untilFailure: boolean) {
  return new Promise<Frame[]>((resolvePromise, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      EXTENSION_ENV: 'test',
      EXTENSION_TELEMETRY: '0'
    }
    delete env.VITEST
    delete env.VITEST_WORKER_ID

    const child = spawn(process.execPath, [cliBin, ...args], {
      cwd: cliRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
      detached: true
    })
    let stdout = ''

    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone
      }
    }

    const timer = setTimeout(() => {
      stop()
      reject(new Error(`CLI did not report: ${args.join(' ')}\n${stdout}`))
    }, 100_000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (untilFailure && stdout.includes('"ok":false')) stop()
    })

    child.on('close', () => {
      clearTimeout(timer)
      resolvePromise(
        stdout
          .split('\n')
          .filter((line) => line.trim().startsWith('{'))
          .map((line) => JSON.parse(line) as Frame)
      )
    })
  })
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

      pins['silent on --version'] = join(bin, 'silent')
      writeFileSync(pins['silent on --version'], '#!/bin/sh\nexec sleep 600\n')
      chmodSync(pins['silent on --version'], 0o755)
    })

    afterAll(() => {
      rmSync(work, {recursive: true, force: true})
    })

    const cases: Array<[string, string, string, string]> = []

    for (const command of ['start', 'dev', 'preview']) {
      for (const cause of [
        'missing',
        'not executable',
        'silent on --version'
      ]) {
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
