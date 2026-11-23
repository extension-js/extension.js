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

describe('a bad pinned browser binary reports one status on every command', () => {
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

  type Case = [string, string, string, string]
  const missing: Case[] = []
  const notExecutable: Case[] = []

  for (const command of ['start', 'dev', 'preview']) {
    // A pin that runs and never answers costs the probe's 10 seconds, so
    // browser-version-probe.contract.spec.ts reads it from one run each.
    missing.push([command, 'missing', 'chrome', '--chromium-binary'])
    notExecutable.push(
      [command, 'not executable', 'chrome', '--chromium-binary'],
      [command, 'not executable', 'firefox', '--gecko-binary']
    )
  }

  const title = '%s answers a %s %s pin with usage and E_BROWSER_BINARY_INVALID'

  const answersUsage = async (...[command, cause, browser, flag]: Case) => {
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
  }

  it.each(missing)(title, answersUsage, 120_000)

  // Windows has no executable bit, so only the missing pin is read there.
  it.skipIf(process.platform === 'win32').each(notExecutable)(
    title,
    answersUsage,
    120_000
  )
})
