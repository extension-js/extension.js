import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {CLI_ROOT, everyLineAsFrame, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

const FORMAT_NOTICE =
  '⏵⏵⏵ --format is deprecated and maps to --output.\n' +
  'Pass --output <pretty|json> instead.\n'

let root: string
let src: string
let built: string
let fakeBinary: string

// These legs run the built CLI: source that parses in a unit test proves
// nothing when the shipped entry still drops a flag.
function cli(args: string[]) {
  return runCli([...args, '--no-telemetry'], {
    cwd: root,
    env: {EXTENSION_HEADLESS: '1'}
  })
}

function onlyFrame(stdout: string): Record<string, unknown> {
  const frames = everyLineAsFrame(stdout)

  expect(frames, stdout).toHaveLength(1)

  return frames[0]
}

beforeAll(async () => {
  root = makeTempFolder('extjs-cli-flags-')
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

  const build = await cli(['build', src, '--browser', 'firefox'])
  expect(build.status, build.output).toBe(0)

  built = path.join(root, 'dist', 'firefox')
})

describe('cli flags the help promises (built entry)', () => {
  it('preview honors --gecko-binary and --firefox-binary alike', async () => {
    for (const flag of ['--gecko-binary', '--firefox-binary']) {
      const run = await cli([
        'preview',
        built,
        '--browser',
        'gecko-based',
        flag,
        fakeBinary,
        '--debug',
        '--no-browser'
      ])

      expect(run.output, flag).toContain(`geckoBinary=${fakeBinary}`)
      expect(run.output, flag).not.toContain('geckoBinary=auto')
    }
  })

  // start launches only after its build, so the build line on stdout is
  // what shows the refusal came from the launch step and not from parsing.
  it('start builds, then refuses a --gecko-binary that names nothing, by path', async () => {
    const missing = path.join(root, 'no-such-fox')
    const run = await cli([
      'start',
      src,
      '--browser',
      'gecko-based',
      '--gecko-binary',
      missing
    ])

    expect(run.status, run.output).toBe(1)
    expect(run.stdout).toContain('Add-on built for production')
    expect(run.stderr).toBe(
      "⏵⏵⏵ Can't find a Firefox or Gecko binary at the given path.\n" +
        `NOT FOUND ${missing}\n` +
        'Pass --gecko-binary <abs-path> with a working path.\n'
    )
  })

  it('build and preview give one envelope for --output JSON in any case', async () => {
    const build = await cli(['build', src, '--output', 'JSON'])

    expect(onlyFrame(build.stdout)).toMatchObject({ok: true, command: 'build'})

    const preview = await cli([
      'preview',
      built,
      '--no-browser',
      '--output',
      ' Json '
    ])

    expect(onlyFrame(preview.stdout)).toMatchObject({
      ok: true,
      command: 'preview'
    })
  })

  // Ledger 1375 N1: a value that is neither pretty nor json is taken as
  // pretty. Pinned as it is: the build runs, exits 0 and prints prose.
  it('ledger 1375 N1: build --output jsno builds, exits 0 and prints prose', async () => {
    const run = await cli(['build', src, '--output', 'jsno'])

    expect(run.status, run.output).toBe(0)
    expect(run.stdout).not.toContain('"schema":1')
    expect(run.stdout).toMatch(/cli-flags compiled in \d+ ms/)
    expect(run.stdout).toContain('Extension built for production')
    expect(run.stderr).toBe('')
  })

  // Pins today's behavior. Ledger 1375 N5.
  it('ledger 1375 N5: dev --port abc starts on 8080 with no requested port', async () => {
    const isStarting = (frame: Record<string, unknown>) =>
      frame.status === 'starting'
    // The session never ends by itself, so the group is ended once it is up.
    const run = await runCli(
      ['dev', src, '--port', 'abc', '--no-browser', '--output', 'json'],
      {
        cwd: root,
        until: ({stdout}) => everyLineAsFrame(stdout).some(isStarting)
      }
    )
    const frames = everyLineAsFrame(run.stdout)
    const realRoot = fs.realpathSync(root)
    const sessionDir = path.join(realRoot, 'dist', 'extension-js', 'chromium')
    const {version} = JSON.parse(
      fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')
    )

    expect(run.stderr).toBe('')
    expect(frames.slice(0, 2)).toEqual([
      {
        schema: 1,
        ok: true,
        command: 'dev',
        status: 'started',
        value: {
          projectPath: src,
          browser: 'chromium',
          browsers: ['chromium'],
          port: 8080,
          pid: expect.any(Number),
          noBrowser: true
        },
        error: null,
        warnings: []
      },
      {
        schema: 1,
        ok: true,
        command: 'dev',
        status: 'starting',
        value: {
          command: 'dev',
          browser: 'chromium',
          distPath: path.join(realRoot, 'dist', 'chromium'),
          pid: expect.any(Number),
          port: 8080,
          readyPath: path.join(sessionDir, 'ready.json'),
          eventsPath: path.join(sessionDir, 'events.ndjson'),
          runId: expect.any(String),
          instanceId: expect.any(String),
          toolchainVersion: version,
          requestedPort: null
        },
        error: null,
        warnings: []
      }
    ])
  })
})

// --format is documented as a deprecated alias of --output that still works
// and warns once on stderr, on the root program and on every subcommand.
describe('the deprecated --format alias', () => {
  it.each([
    [['capabilities', '--format', 'json']],
    [['capabilities', '--format=json']]
  ])('resolves to --output on a subcommand: %j', async (args) => {
    const aliased = await runCli(args)

    expect(aliased.status).toBe(0)
    expect(onlyFrame(aliased.stdout)).toMatchObject({
      schema: 1,
      ok: true,
      command: 'capabilities'
    })
  })

  it('warns once on stderr so stdout stays one parseable document', async () => {
    const aliased = await runCli(['capabilities', '--format', 'json'])

    expect(aliased.stderr).toBe(FORMAT_NOTICE)
    expect(onlyFrame(aliased.stdout).command).toBe('capabilities')
  })

  it('still yields the envelope on preview', async () => {
    const run = await cli([
      'preview',
      built,
      '--no-browser',
      '--format',
      'json'
    ])

    expect(onlyFrame(run.stdout)).toMatchObject({ok: true, command: 'preview'})
    expect(run.stderr).toContain('--format is deprecated')
  })

  it('in front of the command never becomes the command', async () => {
    const run = await cli([
      '--format',
      'json',
      'dev',
      src,
      '--no-reload',
      '--parent-pid',
      'abc'
    ])
    const frame = onlyFrame(run.stdout)

    expect(run.status).toBe(1)
    expect(frame).toMatchObject({ok: false, command: 'dev', status: 'usage'})
    expect(frame.error).toEqual({
      code: 'E_INVALID_OPTION',
      message: '--parent-pid expects a positive integer pid, got: abc'
    })

    expect(run.stderr).toBe(
      `${FORMAT_NOTICE}⏵⏵⏵ --parent-pid expects a positive integer pid, got: abc\n`
    )
  })
})

describe('--output in front of the command', () => {
  it.each([
    [['--output', 'json', 'capabilities']],
    [['--output=json', 'capabilities']]
  ])('is honored like its deprecated alias: %j', async (args) => {
    const result = await runCli(args)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(onlyFrame(result.stdout)).toMatchObject({
      schema: 1,
      ok: true,
      command: 'capabilities'
    })
  })
})
