import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

// These legs spawn the BUILT cli: source that parses in a unit test proves
// nothing when the shipped entry still drops a flag. Run `pnpm compile` first.
const CLI = path.resolve(__dirname, '../../dist/cli.cjs')
const hasCli = fs.existsSync(CLI)

function withoutTestRunnerMarkers(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = {...env}
  delete copy.VITEST
  delete copy.VITEST_WORKER_ID
  delete copy.VITEST_POOL_ID
  return copy
}

let root: string
let src: string
let built: string
let fakeBinary: string

function cli(args: string[], cwd = root) {
  const result = spawnSync('node', [CLI, ...args, '--no-telemetry'], {
    cwd,
    encoding: 'utf8',
    // The launchers short-circuit inside the test runner; the built cli must
    // behave as it does for a user, so the runner's markers stay out.
    env: {
      ...withoutTestRunnerMarkers(process.env),
      EXTENSION_HEADLESS: '1'
    },
    timeout: 120_000
  })
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    all: `${result.stdout || ''}\n${result.stderr || ''}`
  }
}

function envelope(stdout: string): Record<string, unknown> {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('{"schema":1'))
  expect(line, `no schema-1 envelope on stdout:\n${stdout}`).toBeDefined()
  return JSON.parse(String(line))
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cli-flags-'))
  src = path.join(root, 'src')
  fs.mkdirSync(src, {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'cli-flags', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(src, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'cli-flags', version: '1.0.0'})
  )
  fakeBinary = path.join(root, 'fakefox')
  fs.writeFileSync(fakeBinary, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(fakeBinary, 0o755)
  if (hasCli) {
    const build = cli(['build', src, '--browser', 'firefox'])
    expect(build.status, build.all).toBe(0)
  }
  built = path.join(root, 'dist', 'firefox')
})

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe.skipIf(!hasCli)('cli flags the help promises (built entry)', () => {
  it('preview honors --gecko-binary and --firefox-binary alike', () => {
    for (const flag of ['--gecko-binary', '--firefox-binary']) {
      const run = cli([
        'preview',
        built,
        '--browser',
        'gecko-based',
        flag,
        fakeBinary,
        '--debug',
        '--no-browser'
      ])
      expect(run.all, flag).toContain(`geckoBinary=${fakeBinary}`)
      expect(run.all, flag).not.toContain('geckoBinary=auto')
    }
  })

  it('start hands --gecko-binary to the launcher (refusal names the path)', () => {
    // start only launches after the build, so a pin that does not exist is
    // the cheapest proof the flag arrived: the launcher refuses by name.
    const missing = path.join(root, 'no-such-fox')
    const run = cli([
      'start',
      src,
      '--browser',
      'gecko-based',
      '--gecko-binary',
      missing
    ])
    expect(run.status).not.toBe(0)
    expect(run.all).toContain(missing)
    expect(run.all).toContain('NOT FOUND')
  })

  it('build and preview give one envelope for --output JSON in any case', () => {
    const build = cli(['build', src, '--output', 'JSON'])
    expect(envelope(build.stdout)).toMatchObject({ok: true, command: 'build'})

    const preview = cli([
      'preview',
      built,
      '--no-browser',
      '--output',
      ' Json '
    ])
    expect(envelope(preview.stdout)).toMatchObject({
      ok: true,
      command: 'preview'
    })
  })

  it('--format is a deprecated alias that still yields the envelope', () => {
    const run = cli(['preview', built, '--no-browser', '--format', 'json'])
    expect(envelope(run.stdout)).toMatchObject({ok: true, command: 'preview'})
    expect(run.stderr).toContain('--format is deprecated')
  })

  it('a valued root option before the command never becomes the command', () => {
    const run = cli([
      '--format',
      'json',
      'dev',
      src,
      '--no-reload',
      '--parent-pid',
      'abc'
    ])
    const frame = envelope(run.stdout)
    expect(frame.command).toBe('dev')
    expect(frame).toMatchObject({ok: false})
    expect((frame.error as {code?: string}).code).toBe('E_INVALID_OPTION')
    expect(run.all).not.toContain('got: json')
  })
})
